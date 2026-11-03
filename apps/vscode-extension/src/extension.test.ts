import { describe, it, expect, vi } from 'vitest';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Project, ValidationFinding, AgentHandoff, HandoffCreate } from '@udi/contracts';
const require = createRequire(import.meta.url);
const source = buildSync({
  entryPoints: [fileURLToPath(new URL('./extension.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  write: false,
}).outputFiles[0]!.text;
function host(fail = false, project?: Project, findings: ValidationFinding[] = []) {
  const callbacks = new Map<string, (arg?: unknown) => Promise<void>>();
  const dispose = vi.fn();
  const disposable = { dispose };
  const diagnosticSet = vi.fn();
  let provider: { getChildren: () => { label: string }[] } | undefined;
  const info = vi.fn();
  const error = vi.fn();
  const warning = vi.fn();
  const secrets = { get: vi.fn(async () => undefined), store: vi.fn(), delete: vi.fn() };
  const vscode = {
    EventEmitter: class {
      event = () => disposable;
      fire() {}
      dispose() {}
    },
    TreeItem: class {
      constructor(public label: string) {}
    },
    StatusBarAlignment: { Left: 1 },
    languages: {
      createDiagnosticCollection: () => ({ clear: vi.fn(), set: diagnosticSet, dispose }),
    },
    Range: class {
      constructor(
        public line: number,
        public character: number,
        public endLine: number,
        public endCharacter: number,
      ) {}
    },
    Diagnostic: class {
      constructor(
        public range: unknown,
        public message: string,
        public severity: number,
      ) {}
    },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    window: {
      createStatusBarItem: () => ({ show: vi.fn(), dispose }),
      registerTreeDataProvider: vi.fn((_id: string, p: typeof provider) => {
        provider = p;
        return disposable;
      }),
      showInformationMessage: info,
      showErrorMessage: error,
      showWarningMessage: warning,
      showInputBox: vi.fn<(...args: unknown[]) => Promise<string | undefined>>(
        async () => undefined,
      ),
      showQuickPick: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
      showTextDocument: vi.fn(async () => undefined),
    },
    commands: {
      registerCommand: (id: string, callback: (arg?: unknown) => Promise<void>) => {
        callbacks.set(id, callback);
        return disposable;
      },
    },
    workspace: {
      isTrusted: true,
      openTextDocument: vi.fn(async (input: unknown) => input),
      workspaceFolders: project ? [{ uri: { scheme: 'file', fsPath: project.rootPath } }] : [],
      getConfiguration: () => ({ inspect: () => undefined }),
      onDidChangeWorkspaceFolders: () => disposable,
      onDidChangeConfiguration: () => disposable,
    },
    env: { openExternal: vi.fn(async () => true) },
    Uri: { parse: (v: string) => v, file: (fsPath: string) => ({ fsPath }) },
  };
  let savedHandoff: AgentHandoff | undefined;
  const record = project
    ? {
        id: project.id,
        projectId: project.id,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        kind: 'decision',
        text: 'Review fixture',
        provenance: { sourceKind: 'user_entered', actor: 'test-user' },
        evidence: [],
      }
    : undefined;
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (fail) throw new Error('offline');
    let data: unknown = input.endsWith('/health')
      ? {
          status: 'ok',
          version: '0.1.0',
          apiVersion: 'v1',
          database: 'ready',
          capabilities: { projects: true, context: false, mcp: false, engineering: false },
        }
      : input.includes('/engineering/findings')
        ? { items: findings }
        : { items: project ? [project] : [] };
    if (input.includes('/context/records')) data = { items: record ? [record] : [] };
    else if (input.includes('/context?') && project)
      data = {
        projectId: project.id,
        generatedAt: project.createdAt,
        schemaVersion: 1,
        records: record ? [record] : [],
        openIssues: [],
      };
    if (input.includes('/handoffs')) {
      if (init?.method === 'POST' && project)
        savedHandoff = {
          ...(JSON.parse(String(init.body)) as HandoffCreate),
          id: project.id,
          projectId: project.id,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        };
      data = init?.method === 'POST' ? savedHandoff : { items: savedHandoff ? [savedHandoff] : [] };
    }
    return new Response(
      JSON.stringify({
        ok: true,
        data,
        meta: {
          apiVersion: 'v1',
          requestId: '61d626eb-26fa-4bae-bbe7-64dc03fb921b',
          timestamp: '2026-11-03T13:00:00Z',
        },
      }),
    );
  });
  const exports: Record<string, unknown> = {};
  const module = { exports };
  runInNewContext(source, {
    exports,
    module,
    require: (id: string) => (id === 'vscode' ? vscode : require(id)),
    fetch,
    URL,
    URLSearchParams,
    Response,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
  });
  const subscriptions: { dispose: () => void }[] = [];
  const context = {
    subscriptions,
    secrets,
    workspaceState: { get: () => undefined, update: vi.fn() },
  };
  (module.exports.activate as (c: unknown) => void)(context);
  return {
    callbacks,
    info,
    error,
    warning,
    secrets,
    subscriptions,
    fetch,
    diagnosticSet,
    ui: vscode.window,
    record,
    getRows: () => provider?.getChildren(),
  };
}
describe('extension activation in mocked VS Code host', () => {
  it('does not save a cancelled handoff and saves only the explicitly approved payload', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'udi-handoff-'));
    const id = '61d626eb-26fa-4bae-bbe7-64dc03fb921b';
    const createdAt = '2026-11-03T13:00:00Z';
    const h = host(false, {
      id,
      name: 'Rover',
      rootPath: directory,
      description: '',
      createdAt,
      updatedAt: createdAt,
    });
    try {
      await vi.waitFor(() => expect(h.getRows()?.some((r) => r.label === 'Rover')).toBe(true));
      const prepare = () => {
        h.ui.showQuickPick.mockResolvedValueOnce([{ record: h.record }]);
        h.ui.showInputBox
          .mockResolvedValueOnce(id)
          .mockResolvedValueOnce('Continue review')
          .mockResolvedValueOnce('Inspect GPIO; Review mapping');
      };
      prepare();
      h.warning.mockResolvedValueOnce('Cancel');
      await h.callbacks.get('udi.createHandoff')!();
      expect(h.fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
      prepare();
      h.warning.mockResolvedValueOnce('Save handoff');
      await h.callbacks.get('udi.createHandoff')!();
      const writes = h.fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
      expect(writes).toHaveLength(1);
      expect(JSON.parse(String(writes[0]![1]!.body))).toEqual({
        fromAgentId: id,
        summary: 'Continue review',
        recordIds: [id],
        nextSteps: ['Inspect GPIO', 'Review mapping'],
        provenance: { sourceKind: 'user_entered', actor: 'vscode-user' },
      });
      expect(h.error).not.toHaveBeenCalled();
      expect(h.info).toHaveBeenCalledWith(`Handoff saved: ${id}`);
    } finally {
      for (const d of h.subscriptions) d.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('publishes native source diagnostics using SDK findings and one-based evidence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'udi-host-'));
    await writeFile(path.join(directory, 'pins.h'), 'GPIO26');
    const id = '61d626eb-26fa-4bae-bbe7-64dc03fb921b';
    const createdAt = '2026-11-03T13:00:00Z';
    const project: Project = {
      id,
      name: 'Rover',
      rootPath: directory,
      description: '',
      createdAt,
      updatedAt: createdAt,
    };
    const finding: ValidationFinding = {
      id,
      projectId: id,
      jobId: id,
      createdAt,
      updatedAt: createdAt,
      ruleId: 'gpio.mismatch',
      severity: 'error',
      message: 'GPIO mismatch',
      expected: 'GPIO14',
      observed: 'GPIO26',
      evidence: [{ filePath: 'pins.h', line: 4, column: 2 }, { filePath: '../outside.h' }],
      status: 'open',
      verifiedBy: { tool: 'validator', version: '1' },
    };
    const h = host(false, project, [finding]);
    try {
      await vi.waitFor(() => expect(h.diagnosticSet).toHaveBeenCalledOnce());
      expect(h.diagnosticSet).toHaveBeenCalledWith({ fsPath: path.join(directory, 'pins.h') }, [
        expect.objectContaining({
          range: expect.objectContaining({ line: 3, character: 1 }),
          message: expect.stringContaining('GPIO26'),
          severity: 0,
          source: 'validator 1',
        }),
      ]);
      expect(h.getRows()?.some((r) => r.label === 'GPIO mismatch')).toBe(true);
    } finally {
      for (const d of h.subscriptions) d.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('registers every manifest command and native sidebar, detects no-workspace state, and runs actual SDK health', async () => {
    const h = host();
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { contributes: { commands: { command: string }[] } };
    for (const c of manifest.contributes.commands) expect(h.callbacks.has(c.command)).toBe(true);
    await vi.waitFor(() =>
      expect(h.getRows()?.some((r) => r.label === 'Register workspace project')).toBe(true),
    );
    await h.callbacks.get('udi.health')!();
    expect(h.info).toHaveBeenCalledWith('Developer Intelligence daemon 0.1.0: ok');
    expect(h.fetch.mock.calls.some(([url]) => url.endsWith('/api/v1/health'))).toBe(true);
    expect(h.secrets.store).not.toHaveBeenCalled();
    for (const d of h.subscriptions) d.dispose();
  });
  it('shows disconnected state and keeps retry/token commands available', async () => {
    const h = host(true);
    await vi.waitFor(() =>
      expect(h.getRows()?.some((r) => r.label.startsWith('Disconnected'))).toBe(true),
    );
    await h.callbacks.get('udi.health')!();
    expect(h.error).toHaveBeenCalled();
    expect(h.callbacks.has('udi.setToken')).toBe(true);
    for (const d of h.subscriptions) d.dispose();
  });
  it('does not report unsupported validation and handoff retrieval as success', async () => {
    const h = host();
    await h.callbacks.get('udi.validate')!();
    await h.callbacks.get('udi.latestHandoff')!();
    expect(h.warning).toHaveBeenCalledTimes(1);
    expect(h.error).toHaveBeenCalled();
    expect(h.info).not.toHaveBeenCalled();
    for (const d of h.subscriptions) d.dispose();
  });
});
