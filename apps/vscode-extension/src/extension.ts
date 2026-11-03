import * as vscode from 'vscode';
import { createClient, DaemonClientError } from '@udi/client-sdk';
import {
  EvidenceSchema,
  type Project,
  type ValidationFinding,
  type ProjectMemory,
} from '@udi/contracts';
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
        contextState = `${memory.records.length} records`;
      } else if (c.status === 'rejected') contextState = errorLabel(c.reason);
      if (f.status === 'fulfilled') {
        findings = scopedFindings(p.id, f.value.items);
        findingState = `${findings.filter((v) => v.status === 'open').length} open findings`;
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
          { label: 'Review handoff draft', action: 'createHandoff' },
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
          'Validation submission unavailable: the shared SDK has no job creation method. Review Engineering Findings for recorded results.',
        );
        return;
      case 'latestHandoff':
        await vscode.window.showWarningMessage(
          'Handoff retrieval unavailable: shared handoff API and SDK methods are required. Project Context retrieves current memory.',
        );
        return;
      case 'createHandoff': {
        const p = await project();
        if (!memory) {
          await vscode.window.showWarningMessage(
            'Retrieve project context first. Handoff storage is not supported yet.',
          );
          return;
        }
        const summary = await vscode.window.showInputBox({
          title: 'Review UNSAVED handoff draft',
          prompt: 'Creates a local review document only. No handoff save API exists.',
          validateInput: (v) => (v.trim() ? undefined : 'Enter a summary'),
        });
        if (!summary) return;
        const draft = { projectId: p.id, summary, context: memory };
        await document('UNSAVED handoff draft · backend storage unavailable', draft);
        if (
          (await vscode.window.showInformationMessage(
            'Draft opened for review. Not saved to daemon.',
            'Copy draft',
          )) === 'Copy draft'
        )
          await vscode.env.clipboard.writeText(JSON.stringify(draft, null, 2));
        return;
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
