import * as vscode from 'vscode';
import { createClient, DaemonClientError } from '@udi/client-sdk';
import {
  EvidenceSchema,
  IdSchema,
  HandoffCreateSchema,
  ContextRecordCreateSchema,
  type Project,
  type ValidationFinding,
  type ProjectMemory,
} from '@udi/contracts';
import { latestStoredHandoff } from './handoffs.js';
import { containedFile, evidencePosition, scopedFindings, workspaceProjects } from './evidence.js';
const actions = [
  'health',
  'refresh',
  'setToken',
  'selectProject',
  'registerProject',
  'context',
  'findings',
  'openEvidence',
  'mcp',
  'validate',
  'createHandoff',
  'latestHandoff',
  'events',
  'recordDecision',
  'jobLogs',
  'openDashboard',
] as const;
type Action = (typeof actions)[number];
type Row = { label: string; description?: string; action?: Action; argument?: unknown };
function errorLabel(error: unknown) {
  if (error instanceof DaemonClientError)
    return (
      (
        {
          UNAUTHORIZED: 'Authentication required — Set Daemon Token',
          NOT_IMPLEMENTED: 'Unavailable — backend service not implemented',
          CONNECTION_ERROR: 'Disconnected — start the local daemon',
          TIMEOUT: 'Disconnected — daemon timed out',
        } as Record<string, string>
      )[error.code] ?? `Daemon request failed: ${error.code}`
    );
  return 'Unable to complete request. Check connection settings and workspace paths.';
}
class Sidebar implements vscode.TreeDataProvider<Row> {
  private emitter = new vscode.EventEmitter<Row | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  rows: Row[] = [{ label: 'Checking daemon…' }];
  getTreeItem(row: Row) {
    const item = new vscode.TreeItem(row.label);
    if (row.description) item.description = row.description;
    if (row.action)
      item.command = {
        command: `udi.${row.action}`,
        title: row.label,
        arguments: row.argument === undefined ? [] : [row.argument],
      };
    return item;
  }
  getChildren() {
    return this.rows;
  }
  update(rows: Row[]) {
    this.rows = rows;
    this.emitter.fire(undefined);
  }
  dispose() {
    this.emitter.dispose();
  }
}
export function activate(context: vscode.ExtensionContext) {
  const sidebar = new Sidebar();
  const diagnostics = vscode.languages.createDiagnosticCollection('developer-intelligence');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 25);
  status.command = 'udi.refresh';
  status.text = '$(sync) Intelligence';
  status.show();
  let selected: Project | undefined;
  let candidates: Project[] = [];
  let memory: ProjectMemory | undefined;
  let generation = 0;
  let disposed = false;
  let writingHandoff = false;
  function setting(key: string, fallback: string) {
    const s = vscode.workspace.getConfiguration('udi').inspect<string>(key);
    return s?.globalValue ?? s?.defaultValue ?? fallback;
  }
  function origin() {
    return setting('daemonUrl', 'http://127.0.0.1:4317');
  }
  async function client() {
    const baseUrl = origin();
    const token = await context.secrets.get(`udi.token:${baseUrl}`);
    return createClient({ baseUrl, ...(token ? { token } : {}) });
  }
  async function document(title: string, value: unknown) {
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify({ title, data: value }, null, 2),
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }
  async function project() {
    if (!selected) await refresh();
    if (!selected) throw new Error('No registered workspace selected');
    return selected;
  }
  async function publish(p: Project, items: ValidationFinding[], request: number) {
    const groups = new Map<string, vscode.Diagnostic[]>();
    for (const finding of items) {
      if (finding.status === 'resolved') continue;
      for (const e of finding.evidence) {
        try {
          const file = await containedFile(p.rootPath, e.filePath);
          const pos = evidencePosition(e.line, e.column);
          const range = new vscode.Range(pos.line, pos.character, pos.line, pos.character + 1);
          const d = new vscode.Diagnostic(
            range,
            `${finding.message}${e.line ? '' : ' (file-level evidence; no line supplied)'}\nExpected: ${JSON.stringify(finding.expected)}\nObserved: ${JSON.stringify(finding.observed)}`,
            finding.severity === 'error'
              ? vscode.DiagnosticSeverity.Error
              : finding.severity === 'warning'
                ? vscode.DiagnosticSeverity.Warning
                : vscode.DiagnosticSeverity.Information,
          );
          d.source = `${finding.verifiedBy.tool} ${finding.verifiedBy.version}`;
          d.code = finding.ruleId;
          groups.set(file, [...(groups.get(file) ?? []), d]);
        } catch {
          /* Reject missing or escaped evidence. */
        }
      }
    }
    if (disposed || request !== generation) return;
    diagnostics.clear();
    for (const [file, items] of groups) diagnostics.set(vscode.Uri.file(file), items);
  }
  async function refresh() {
    const request = ++generation;
    selected = undefined;
    memory = undefined;
    diagnostics.clear();
    sidebar.update([{ label: 'Loading workspace…' }]);
    status.text = '$(sync) Intelligence';
    const current = () => !disposed && request === generation;
    try {
      const api = await client();
      const h = await api.health();
      if (!current()) return;
      status.text = `$(plug) Intelligence ${h.version}`;
      const projects = await api.listProjects();
      const matches = await workspaceProjects(
        projects.items,
        (vscode.workspace.workspaceFolders ?? [])
          .filter((f) => f.uri.scheme === 'file')
          .map((f) => f.uri.fsPath),
      );
      if (!current()) return;
      candidates = matches;
      selected =
        matches.find((p) => p.id === context.workspaceState.get<string>('udi.projectId')) ??
        (matches.length === 1 ? matches[0] : undefined);
      if (!selected) {
        sidebar.update([
          { label: 'Core engine', description: 'Connected', action: 'health' },
          {
            label: matches.length ? 'Select workspace project' : 'Register workspace project',
            action: matches.length ? 'selectProject' : 'registerProject',
          },
          { label: 'Set daemon token', action: 'setToken' },
          { label: 'Open desktop dashboard', action: 'openDashboard' },
        ]);
        return;
      }
      const p = selected;
      const [c, f] = await Promise.allSettled([api.getContext(p.id), api.listFindings(p.id)]);
      if (!current()) return;
      let contextState = 'Unavailable';
      let findingState = 'Unavailable';
      let findings: ValidationFinding[] = [];
      if (
        c.status === 'fulfilled' &&
        c.value.projectId === p.id &&
        c.value.records.every((r) => r.projectId === p.id)
      ) {
        memory = c.value;
        contextState = `${memory.records.length} stored records (bounded)`;
      } else if (c.status === 'rejected') contextState = errorLabel(c.reason);
      if (f.status === 'fulfilled') {
        findings = scopedFindings(p.id, f.value.items);
        findingState = `${findings.filter((v) => v.status === 'open').length} open findings (first page)`;
        await publish(p, findings, request);
      } else findingState = errorLabel(f.reason);
      if (!current()) return;
      sidebar.update([
        { label: p.name, description: p.rootPath, action: 'selectProject' },
        { label: 'Core engine', description: 'Connected' },
        { label: 'Project context', description: contextState, action: 'context' },
        { label: 'Engineering findings', description: findingState, action: 'findings' },
        ...([
          { label: 'Validate project', action: 'validate' },
          { label: 'MCP Hub', action: 'mcp' },
          { label: 'Create saved handoff', action: 'createHandoff' },
          { label: 'Stored activity events', action: 'events' },
          { label: 'Record project decision', action: 'recordDecision' },
          { label: 'Retrieve latest handoff', action: 'latestHandoff' },
          { label: 'Open desktop dashboard', action: 'openDashboard' },
        ] as Row[]),
        ...findings.slice(0, 10).map((v) => ({
          label: v.message,
          description: v.severity,
          action: 'findings' as const,
          argument: v.id,
        })),
      ]);
    } catch (e) {
      if (!current()) return;
      status.text =
        e instanceof DaemonClientError && e.code === 'UNAUTHORIZED'
          ? '$(lock) Intelligence'
          : '$(debug-disconnect) Intelligence';
      sidebar.update([
        { label: errorLabel(e) },
        { label: 'Retry connection', action: 'refresh' },
        { label: 'Set daemon token', action: 'setToken' },
        { label: 'Open desktop dashboard', action: 'openDashboard' },
      ]);
    }
  }
  async function act(action: Action, arg?: unknown): Promise<void> {
    switch (action) {
      case 'refresh':
        return refresh();
      case 'health': {
        const h = await (await client()).health();
        await vscode.window.showInformationMessage(
          `Developer Intelligence daemon ${h.version}: ${h.status}`,
        );
        return refresh();
      }
      case 'setToken': {
        const token = await vscode.window.showInputBox({
          title: 'Local daemon token',
          prompt:
            'Token from .data/token. Stored in SecretStorage for this daemon origin. Blank forgets it.',
          password: true,
          ignoreFocusOut: true,
        });
        if (token === undefined) return;
        if (token.trim()) await context.secrets.store(`udi.token:${origin()}`, token.trim());
        else await context.secrets.delete(`udi.token:${origin()}`);
        return refresh();
      }
      case 'selectProject': {
        await refresh();
        const picked = await vscode.window.showQuickPick(
          candidates.map((p) => ({ label: p.name, description: p.rootPath, project: p })),
          { placeHolder: 'Select a project matching an open folder' },
        );
        if (!picked) return;
        await context.workspaceState.update('udi.projectId', picked.project.id);
        return refresh();
      }
      case 'registerProject': {
        if (!vscode.workspace.isTrusted) {
          await vscode.window.showWarningMessage('Trust this workspace before registration.');
          return;
        }
        const folder = await vscode.window.showWorkspaceFolderPick();
        if (!folder || folder.uri.scheme !== 'file') return;
        const name = await vscode.window.showInputBox({
          title: 'Register workspace',
          value: folder.name,
          validateInput: (v) =>
            v.trim() && v.trim().length <= 120 ? undefined : 'Use a name of 1–120 characters',
        });
        if (!name) return;
        if (
          (await vscode.window.showWarningMessage(
            `Register ${folder.uri.fsPath} with the local daemon?`,
            { modal: true },
            'Register',
          )) !== 'Register'
        )
          return;
        const p = await (await client()).createProject({ name, rootPath: folder.uri.fsPath });
        await context.workspaceState.update('udi.projectId', p.id);
        return refresh();
      }
      case 'context': {
        const p = await project();
        const value = await (await client()).getContext(p.id);
        if (value.projectId !== p.id || value.records.some((r) => r.projectId !== p.id))
          throw new Error('Project scope mismatch');
        return document('Project context · provenance preserved', value);
      }
      case 'findings': {
        const p = await project();
        const result = scopedFindings(p.id, (await (await client()).listFindings(p.id)).items);
        const picked =
          typeof arg === 'string'
            ? result.find((f) => f.id === arg)
            : (
                await vscode.window.showQuickPick(
                  result.map((f) => ({
                    label: f.message,
                    description: `${f.severity} · ${f.ruleId}`,
                    finding: f,
                  })),
                  {
                    placeHolder: result.length
                      ? 'Inspect finding evidence'
                      : 'No recorded findings; this does not establish a validation pass',
                  },
                )
              )?.finding;
        if (!picked) return;
        await document('Engineering finding · configuration consistency only', picked);
        const e = await vscode.window.showQuickPick(
          picked.evidence.map((v) => ({
            label: v.filePath,
            description: v.line ? `Line ${v.line}` : 'File-level evidence',
            evidence: v,
          })),
          { placeHolder: 'Open source evidence in this workspace' },
        );
        if (e) return act('openEvidence', e.evidence);
        return;
      }
      case 'openEvidence': {
        const e = EvidenceSchema.parse(arg);
        const p = await project();
        const file = await containedFile(p.rootPath, e.filePath);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        const pos = evidencePosition(e.line, e.column);
        const range = doc.validateRange(
          new vscode.Range(pos.line, pos.character, pos.line, pos.character),
        );
        await vscode.window.showTextDocument(doc, { selection: range });
        return;
      }
      case 'mcp':
        return document(
          'MCP registry · recorded status',
          (await (await client()).listMcpServers()).items.map((s) => ({
            id: s.id,
            name: s.name,
            transport: s.transport,
            enabled: s.enabled,
            status: s.status,
          })),
        );
      case 'validate':
        await vscode.window.showWarningMessage(
          'Validation execution is not implemented by this daemon yet. The reserved endpoint returns NOT_IMPLEMENTED; stored findings and job logs remain available.',
        );
        return;
      case 'events': {
        const p = await project();
        const offset =
          typeof arg === 'number' && Number.isInteger(arg) && arg >= 0 && arg <= 1000000 ? arg : 0;
        const result = await (await client()).listEvents(p.id, { limit: 50, offset });
        if (result.items.some((e) => e.projectId !== p.id)) throw new Error('Scope mismatch');
        await document(`Stored activity � offset ${offset} � oldest first`, result);
        if (
          result.items.length === 50 &&
          offset < 1000000 &&
          (await vscode.window.showInformationMessage(
            'More stored activity may be available.',
            'Next page',
          )) === 'Next page'
        )
          return act('events', offset + 50);
        return;
      }
      case 'recordDecision': {
        if (!vscode.workspace.isTrusted) {
          await vscode.window.showWarningMessage(
            'Trust the workspace before recording a decision.',
          );
          return;
        }
        const p = await project();
        const api = await client();
        const text = await vscode.window.showInputBox({
          title: 'Record project decision',
          prompt: 'Saved as user-entered context; not an observed tool result.',
          validateInput: (v) => (v.trim() ? undefined : 'Enter a decision'),
        });
        if (!text) return;
        const input = ContextRecordCreateSchema.parse({
          kind: 'decision',
          text: text.trim(),
          provenance: { sourceKind: 'user_entered', actor: 'vscode-user' },
          evidence: [],
        });
        if (
          (await vscode.window.showWarningMessage(
            `Save this decision to ${p.name}?`,
            { modal: true },
            'Save decision',
          )) !== 'Save decision'
        )
          return;
        if (selected?.id !== p.id) throw new Error('Workspace changed');
        await api.createContextRecord(p.id, input);
        await vscode.window.showInformationMessage('Decision saved to the daemon.');
        return refresh();
      }
      case 'jobLogs': {
        const p = await project();
        const id =
          typeof arg === 'string'
            ? arg
            : await vscode.window.showInputBox({
                title: 'Stored job UUID',
                validateInput: (v) =>
                  IdSchema.safeParse(v).success ? undefined : 'Enter a job UUID',
              });
        if (!id) return;
        const job = await (await client()).getJob(p.id, id);
        if (job.projectId !== p.id) throw new Error('Scope mismatch');
        return document('Stored adapter job output � persistence is not proof of execution', job);
      }
      case 'latestHandoff': {
        const p = await project();
        const handoff = await latestStoredHandoff(await client(), p.id);
        if (!handoff) {
          await vscode.window.showInformationMessage('No stored handoffs for this project.');
          return;
        }
        return document('Latest stored handoff � original provenance', handoff);
      }
      case 'createHandoff': {
        if (writingHandoff) {
          await vscode.window.showWarningMessage('Handoff creation is already in progress.');
          return;
        }
        if (!vscode.workspace.isTrusted) {
          await vscode.window.showWarningMessage('Trust the workspace before saving a handoff.');
          return;
        }
        writingHandoff = true;
        try {
          const p = await project();
          const capturedOrigin = origin();
          const api = await client();
          const records = await api.listContextRecords(p.id, { limit: 500, offset: 0 });
          if (records.items.some((r) => r.projectId !== p.id)) throw new Error('Scope mismatch');
          const picked = await vscode.window.showQuickPick(
            records.items.map((r) => ({
              label: r.text,
              description: `${r.provenance.sourceKind} � ${r.id}`,
              record: r,
            })),
            {
              canPickMany: true,
              placeHolder: 'Select context records (first 500 stored records; Cancel aborts)',
            },
          );
          if (picked === undefined) return;
          const fromAgentId = await vscode.window.showInputBox({
            title: 'From agent UUID',
            prompt:
              'External agent identity agreed by your team. This does not register a connected agent.',
            validateInput: (v) =>
              IdSchema.safeParse(v.trim()).success ? undefined : 'Enter an agent UUID',
          });
          if (!fromAgentId) return;
          const summary = await vscode.window.showInputBox({
            title: 'Handoff summary',
            validateInput: (v) => (v.trim() ? undefined : 'Enter a summary'),
          });
          if (!summary) return;
          const next = await vscode.window.showInputBox({
            title: 'Next steps (optional)',
            prompt: 'Separate steps with semicolons',
          });
          if (next === undefined) return;
          const input = HandoffCreateSchema.parse({
            fromAgentId: fromAgentId.trim(),
            summary: summary.trim(),
            recordIds: picked.map((r) => r.record.id),
            nextSteps: next
              .split(';')
              .map((v) => v.trim())
              .filter(Boolean),
            provenance: { sourceKind: 'user_entered', actor: 'vscode-user' },
          });
          await document('Review handoff before saving', { projectId: p.id, ...input });
          if (
            (await vscode.window.showWarningMessage(
              `Save the reviewed handoff to ${p.name}?`,
              { modal: true },
              'Save handoff',
            )) !== 'Save handoff'
          )
            return;
          if (selected?.id !== p.id || origin() !== capturedOrigin)
            throw new Error('Workspace or daemon changed');
          const saved = await api.createHandoff(p.id, input);
          if (saved.projectId !== p.id) throw new Error('Scope mismatch');
          await document('Saved handoff', saved);
          await vscode.window.showInformationMessage(`Handoff saved: ${saved.id}`);
          return refresh();
        } finally {
          writingHandoff = false;
        }
      }
      case 'openDashboard': {
        const url = new URL(setting('dashboardUrl', 'http://127.0.0.1:5173'));
        if (
          url.protocol !== 'http:' ||
          !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error('Dashboard must be local HTTP');
        if (!(await vscode.env.openExternal(vscode.Uri.parse(url.toString()))))
          await vscode.window.showWarningMessage('Start pnpm dev:desktop to open dashboard.');
        return;
      }
    }
  }
  context.subscriptions.push(
    sidebar,
    diagnostics,
    status,
    vscode.window.registerTreeDataProvider('udi.workspace', sidebar),
    ...actions.map((a) =>
      vscode.commands.registerCommand(`udi.${a}`, async (arg?: unknown) => {
        try {
          await act(a, arg);
        } catch (e) {
          if (
            e instanceof DaemonClientError &&
            ['CONNECTION_ERROR', 'TIMEOUT', 'UNAUTHORIZED'].includes(e.code)
          )
            await refresh();
          await vscode.window.showErrorMessage(errorLabel(e));
        }
      }),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('udi')) void refresh();
    }),
    {
      dispose() {
        disposed = true;
        generation++;
      },
    },
  );
  void refresh();
}
export function deactivate() {}
