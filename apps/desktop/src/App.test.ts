// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { createElement, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Project, ProjectMemory, ValidationFinding } from '@udi/contracts';
const api = vi.hoisted(() => ({
  health: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getContext: vi.fn(),
  listFindings: vi.fn(),
  listMcpServers: vi.fn(),
  listContextRecords: vi.fn(),
  listEvents: vi.fn(),
  listHandoffs: vi.fn(),
  createHandoff: vi.fn(),
  getHandoff: vi.fn(),
  createContextRecord: vi.fn(),
  getJob: vi.fn(),
  createMcpServer: vi.fn(),
  replaceMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  requestValidation: vi.fn(),
  checkMcpServerHealth: vi.fn(),
}));
vi.mock('@udi/client-sdk', async (original) => ({
  ...(await original<typeof import('@udi/client-sdk')>()),
  createClient: vi.fn(() => api),
}));
import { DaemonClientError } from '@udi/client-sdk';
import { App, Findings, McpList } from './App.js';
import { CreateHandoff, StoredEvents, RegistryControls } from './persistence.js';
import { ValidationRun } from './ValidationRun.js';
import type { DaemonClient } from '@udi/client-sdk';
const client = api as unknown as DaemonClient;
const id = '61d626eb-26fa-4bae-bbe7-64dc03fb921b';
const project: Project = {
  id,
  name: 'Rover',
  rootPath: 'C:/workspace/rover',
  description: 'Firmware project',
  createdAt: '2026-11-03T13:00:00Z',
  updatedAt: '2026-11-03T13:00:00Z',
};
const memory: ProjectMemory = {
  projectId: id,
  generatedAt: project.createdAt,
  schemaVersion: 1,
  records: [
    {
      id,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      projectId: id,
      kind: 'decision',
      text: 'Review motor mapping',
      provenance: { sourceKind: 'user_entered', actor: 'developer' },
      evidence: [],
    },
  ],
  openIssues: [],
};
const finding: ValidationFinding = {
  id,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  projectId: id,
  jobId: id,
  ruleId: 'gpio.mismatch',
  severity: 'error',
  message: 'GPIO mismatch',
  expected: 'GPIO14',
  observed: 'GPIO26',
  evidence: [
    { filePath: 'rover.net', line: 4 },
    { filePath: 'src/pins.h', line: 9 },
  ],
  status: 'open',
  verifiedBy: { tool: 'pin-validator', version: '1' },
};
let host: HTMLDivElement;
let root: Root;
async function render(element: ReactNode = createElement(App)) {
  await act(async () => {
    root.render(element);
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}
async function select() {
  const input = host.querySelector<HTMLSelectElement>('select[aria-label="Active project"]')!;
  await act(async () => {
    input.value = id;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function fill(label: string, value: string) {
  const field = [...host.querySelectorAll('label')]
    .find((l) => l.textContent?.startsWith(label))
    ?.querySelector('input,textarea') as HTMLInputElement | HTMLTextAreaElement;
  if (!field) throw new Error(`Missing field ${label}`);
  const proto =
    field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.health.mockResolvedValue({ version: '0.1.0', status: 'ok' });
  api.listProjects.mockResolvedValue({ items: [project] });
  api.getContext.mockResolvedValue(memory);
  api.listContextRecords.mockResolvedValue({ items: memory.records });
  api.listEvents.mockResolvedValue({
    items: [
      {
        id,
        projectId: id,
        type: 'firmware.updated',
        sourceKind: 'imported',
        actor: 'fixture-import',
        createdAt: project.createdAt,
        schemaVersion: 1,
        payload: { fixture: true },
      },
    ],
  });
  api.listHandoffs.mockResolvedValue({ items: [] });
  api.listFindings.mockResolvedValue({ items: [finding] });
  api.listMcpServers.mockResolvedValue({ items: [] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  localStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
describe('desktop user journeys', () => {
  it('opens real workspaces from ship compartments and keeps navigation usable offline', async () => {
    await render();
    expect(host.querySelector('nav[aria-label="Ship compartments"]')).not.toBeNull();
    expect(host.textContent).toContain('Engine connected');
    for (const [room, screen] of [
      ['Crew quarters', 'Agent Workspace'],
      ['Communications', 'MCP Hub'],
      ['Engineering bay', 'Engineering'],
      ['Device bay', 'Devices'],
      ['Control room', 'Settings'],
    ]) {
      await click(`Open ${room}`);
      expect(host.querySelector('h1')?.textContent).toBe(screen);
      await click('Overview');
    }
    expect(host.textContent).toContain('No validation job selected');
    api.health.mockRejectedValue(new DaemonClientError('CONNECTION_ERROR', 'offline'));
    await click('Refresh');
    expect(host.textContent).toContain('Engine disconnected');
    await click('Open Control room');
    expect(host.querySelector('h1')?.textContent).toBe('Settings');
  });
  it('reviews validation paths and clears the old scope before using an actual returned job', async () => {
    const onStart = vi.fn(),
      onJob = vi.fn();
    let resolve!: (job: unknown) => void;
    api.requestValidation.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await render(
      createElement(ValidationRun, { client, projectId: id, onClose: vi.fn(), onStart, onJob }),
    );
    await fill('Workspace artifact paths', 'rover.net\nsrc/pins.h\nengineering-map.json');
    await click('Review validation request');
    expect(api.requestValidation).not.toHaveBeenCalled();
    await click('Confirm and run validation');
    expect(onStart).toHaveBeenCalledOnce();
    expect(onJob).not.toHaveBeenCalled();
    expect(api.requestValidation).toHaveBeenCalledExactlyOnceWith(id, {
      kind: 'pin_consistency',
      artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
      requestedBy: 'desktop-user',
    });
    const job = { id, projectId: id, status: 'failed' };
    await act(async () => resolve(job));
    expect(onJob).toHaveBeenCalledWith(job);
  });
  it('keeps unsupported validation honest and does not invent a returned job', async () => {
    api.requestValidation.mockRejectedValue(
      new DaemonClientError('NOT_IMPLEMENTED', 'not enabled'),
    );
    const onJob = vi.fn();
    await render(
      createElement(ValidationRun, {
        client,
        projectId: id,
        onClose: vi.fn(),
        onStart: vi.fn(),
        onJob,
      }),
    );
    await fill('Workspace artifact paths', 'rover.net\nsrc/pins.h');
    await click('Review validation request');
    await click('Confirm and run validation');
    expect(host.textContent).toContain('Not available from this daemon');
    expect(onJob).not.toHaveBeenCalled();
    expect(api.requestValidation).toHaveBeenCalledTimes(1);
  });
  it('shows a real probe result without treating it as MCP tool compatibility', async () => {
    const server = {
      id,
      name: 'Probe test',
      transport: { type: 'http' as const, url: 'http://127.0.0.1:9999' },
      enabled: true,
      status: 'unknown' as const,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    api.checkMcpServerHealth.mockResolvedValue({ ...server, status: 'unreachable' });
    await render(
      createElement(RegistryControls, { client, servers: [server], onChanged: vi.fn() }),
    );
    await click('Probe connection');
    expect(api.checkMcpServerHealth).toHaveBeenCalledWith(id);
    expect(host.textContent).toContain('unreachable');
    expect(host.textContent).toContain('does not establish MCP tool compatibility');
  });
  it('keeps history separate and removes old failures when another validation job is selected', async () => {
    const newer = 'b785354e-2e71-4b89-94ac-55a5d7c154d8';
    api.getJob.mockImplementation(async (_projectId: string, jobId: string) => ({
      id: jobId,
      projectId: id,
      status: jobId === id ? 'failed' : 'succeeded',
      startedAt: project.createdAt,
      completedAt: project.createdAt,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      exitCode: jobId === id ? 1 : 0,
      stdoutTail: '',
      stderrTail: '',
      artifacts: [],
    }));
    api.listFindings.mockImplementation(
      async (_projectId: string, options: { jobId?: string }) => ({
        items: options.jobId === newer ? [] : [finding],
      }),
    );
    await render();
    await select();
    expect(host.textContent).toContain('No validation job selected');
    expect(host.textContent).not.toContain('GPIO mismatch');
    await click('Engineering');
    expect(host.textContent).not.toContain('GPIO mismatch');
    await fill('Validation job UUID', id);
    await click('Select validation job');
    expect(host.textContent).toContain('GPIO mismatch');
    expect(api.listFindings).toHaveBeenLastCalledWith(id, { limit: 50, offset: 0, jobId: id });
    await fill('Validation job UUID', newer);
    await click('Select validation job');
    expect(host.textContent).not.toContain('GPIO mismatch');
    expect(host.textContent).toContain('No recorded findings');
    expect(api.listFindings).toHaveBeenLastCalledWith(id, { limit: 50, offset: 0, jobId: newer });
    await click('History');
    expect(host.textContent).toContain('GPIO mismatch');
    expect(host.textContent).toContain('Historical records across jobs');
    await click('Overview');
    expect(host.textContent).not.toContain('GPIO mismatch');
    expect(host.textContent).toContain(newer);
  });
  it('updates global connection state when a project request fails and recovers on retry', async () => {
    api.listHandoffs.mockRejectedValue(new DaemonClientError('CONNECTION_ERROR', 'offline'));
    await render();
    await select();
    await click('Agent Workspace');
    await click('Agent Handoffs');
    expect(host.querySelector('.topbar')?.textContent).toContain('Disconnected');
    api.listHandoffs.mockResolvedValue({ items: [] });
    await click('Retry');
    expect(host.querySelector('.topbar')?.textContent).toContain('Daemon 0.1.0');
  });
  it('requires review and explicit confirmation before saving a scoped handoff', async () => {
    const onSaved = vi.fn();
    const saved = {
      id,
      projectId: id,
      fromAgentId: id,
      summary: 'Continue review',
      recordIds: [id],
      nextSteps: ['Inspect GPIO'],
      provenance: { sourceKind: 'user_entered' as const, actor: 'desktop-user' },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    api.createHandoff.mockResolvedValue(saved);
    await render(
      createElement(CreateHandoff, { client, projectId: id, onClose: vi.fn(), onSaved }),
    );
    await fill('From agent UUID', id);
    await fill('Handoff summary', 'Continue review');
    await fill('Next steps', 'Inspect GPIO');
    await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    await click('Review handoff');
    expect(api.createHandoff).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Review this exact project-scoped payload');
    await click('Confirm and save handoff');
    expect(api.createHandoff).toHaveBeenCalledExactlyOnceWith(id, {
      fromAgentId: id,
      summary: 'Continue review',
      recordIds: [id],
      nextSteps: ['Inspect GPIO'],
      provenance: { sourceKind: 'user_entered', actor: 'desktop-user' },
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });
  it('retains the handoff preview after a failed save and allows explicit retry', async () => {
    const onSaved = vi.fn();
    api.createHandoff.mockRejectedValue(new DaemonClientError('VALIDATION_ERROR', 'bad reference'));
    await render(
      createElement(CreateHandoff, { client, projectId: id, onClose: vi.fn(), onSaved }),
    );
    await fill('From agent UUID', id);
    await fill('Handoff summary', 'Keep this summary');
    await click('Review handoff');
    await click('Confirm and save handoff');
    expect(onSaved).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Invalid request');
    expect(host.textContent).toContain('Keep this summary');
    expect(api.createHandoff).toHaveBeenCalledTimes(1);
    await click('Back to edit');
    expect(host.querySelector('textarea')?.value).toBe('Keep this summary');
  });
  it('pages stored activity and keeps original provenance and payload visible', async () => {
    api.listEvents.mockImplementation((_id: string, options: { offset: number }) =>
      Promise.resolve({
        items:
          options.offset === 0
            ? Array.from({ length: 50 }, (_, i) => ({
                id: `event-${i}`,
                projectId: id,
                type: 'fixture.imported',
                actor: 'adapter',
                sourceKind: 'imported',
                createdAt: project.createdAt,
                schemaVersion: 1,
                payload: { fixture: true },
              }))
            : [],
      }),
    );
    await render(createElement(StoredEvents, { client, projectId: id }));
    expect(host.textContent).toContain('Imported');
    expect(host.textContent).toContain('"fixture": true');
    await click('Next page');
    expect(api.listEvents).toHaveBeenLastCalledWith(id, { limit: 50, offset: 50 });
    expect(host.textContent).toContain('No stored activity');
  });
  it('replaces MCP configuration as a complete snapshot without inventing healthy status', async () => {
    const server = {
      id,
      name: 'Stored MCP',
      transport: { type: 'stdio' as const, executableId: 'allowed', args: [] },
      enabled: true,
      status: 'healthy' as const,
      secretRef: 'private-reference',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    api.replaceMcpServer.mockResolvedValue({ ...server, status: 'unknown' });
    await render(
      createElement(RegistryControls, { client, servers: [server], onChanged: vi.fn() }),
    );
    await click('Configure inventory');
    expect(host.textContent).not.toContain('private-reference');
    await click('Save inventory');
    expect(api.replaceMcpServer).toHaveBeenCalledWith(id, {
      name: 'Stored MCP',
      transport: server.transport,
      enabled: true,
      status: 'unknown',
      secretRef: 'private-reference',
    });
  });
  it('explains real and planned application integrations inside Settings', async () => {
    await render();
    await click('Settings');
    expect(host.textContent).toContain('How integrations work');
    expect(host.textContent).toContain('KiCad');
    expect(host.textContent).toContain('PlatformIO');
    expect(host.textContent).toContain('Gateway setup & host verification required');
    expect(host.textContent).toContain(
      'Private conversations and hidden agent reasoning are not automatically captured',
    );
  });
  it('isolates current project context from a late response for the previous project', async () => {
    const second = {
      ...project,
      id: 'b785354e-2e71-4b89-94ac-55a5d7c154d8',
      name: 'Second project',
    };
    api.listProjects.mockResolvedValue({ items: [project, second] });
    let resolveFirst!: (data: { items: ProjectMemory['records'] }) => void;
    api.listContextRecords.mockImplementation((key: string) =>
      key === id
        ? new Promise<{ items: ProjectMemory['records'] }>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({
            ...memory,
            projectId: second.id,
            items: memory.records.map((r) => ({
              ...r,
              projectId: second.id,
              text: 'Second project context',
            })),
          }),
    );
    await render();
    await select();
    await click('Agent Workspace');
    const input = host.querySelector<HTMLSelectElement>('select[aria-label="Active project"]')!;
    await act(async () => {
      input.value = second.id;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.textContent).toContain('Second project context');
    await act(async () => resolveFirst({ items: memory.records }));
    expect(host.textContent).not.toContain('Review motor mapping');
  });
  it('renders dashboard, selected workspace and navigation for all six screens', async () => {
    await render();
    expect(host.textContent).toContain('Choose your active project');
    await select();
    expect(host.textContent).toContain('Firmware project');
    expect(api.listFindings).not.toHaveBeenCalled();
    for (const screen of [
      'Engineering',
      'MCP Hub',
      'Agent Workspace',
      'Devices',
      'Settings',
      'Overview',
    ]) {
      await click(screen);
      expect(host.querySelector('h1')?.textContent).toBe(screen);
    }
    expect(host.textContent).toContain('Live daemon API · Original provenance');
  });
  it('shows loading, then disconnected and authenticated-data errors while preserving navigation', async () => {
    let reject!: (e: Error) => void;
    api.health.mockReturnValue(
      new Promise((_r, j) => {
        reject = j;
      }),
    );
    api.listProjects.mockRejectedValue(new DaemonClientError('UNAUTHORIZED', 'token missing'));
    await render();
    expect(host.textContent).toContain('Connecting');
    await act(async () => reject(new DaemonClientError('CONNECTION_ERROR', 'offline')));
    expect(host.textContent).toContain('Daemon disconnected');
    expect(host.textContent).toContain('Authentication required');
    await click('Settings');
    expect(host.textContent).toContain('Kept in memory');
    expect(localStorage.length).toBe(0);
  });
  it('renders context provenance and distinct unavailable states without fake results', async () => {
    await render();
    await select();
    await click('Agent Workspace');
    expect(host.textContent).toContain('Review motor mapping');
    expect(host.textContent).toContain('User entered');
    await click('Context Timeline');
    expect(host.textContent).toContain('firmware.updated');
    expect(host.textContent).toContain('Imported');
    await click('Project Memory');
    api.listContextRecords.mockRejectedValue(new DaemonClientError('NOT_IMPLEMENTED', 'not ready'));
    await click('Retrieve latest context');
    expect(host.textContent).toContain('Not available from this daemon');
    await click('Agent Handoffs');
    expect(host.textContent).toContain('No stored handoffs');
  });
  it('renders empty MCP inventory and enables supported registration', async () => {
    await render();
    await click('MCP Hub');
    expect(host.textContent).toContain('No registered servers');
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add MCP');
    expect(add?.disabled).toBe(false);
  });
  it('shows source evidence and expected/observed values in the finding dialog', async () => {
    await render(createElement(Findings, { items: [finding] }));
    await act(async () => host.querySelector<HTMLButtonElement>('.finding-row')!.click());
    expect(host.querySelector('dialog')?.textContent).toContain('GPIO14');
    expect(host.textContent).toContain('GPIO26');
    expect(host.textContent).toContain('rover.net:4');
    expect(host.textContent).toContain('src/pins.h:9');
  });
  it('validates registration input before invoking project mutation', async () => {
    await render();
    await click('Open project');
    const form = host.querySelector('form')!;
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(api.createProject).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('renders real registry rows and explicit empty findings', async () => {
    await render(
      createElement(McpList, {
        items: [
          {
            id,
            name: 'Local MCP',
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
            transport: { type: 'stdio', executableId: 'allowed-server', args: [] },
            enabled: true,
            status: 'unreachable',
          },
        ],
      }),
    );
    expect(host.textContent).toContain('Local MCP');
    expect(host.textContent).toContain('unreachable');
    await render(createElement(Findings, { items: [] }));
    expect(host.textContent).toContain('does not establish that validation has passed');
  });
});
