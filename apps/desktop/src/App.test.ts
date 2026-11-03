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
}));
vi.mock('@udi/client-sdk', async (original) => ({
  ...(await original<typeof import('@udi/client-sdk')>()),
  createClient: vi.fn(() => api),
}));
import { DaemonClientError } from '@udi/client-sdk';
import { App, Findings, McpList } from './App.js';
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
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.health.mockResolvedValue({ version: '0.1.0', status: 'ok' });
  api.listProjects.mockResolvedValue({ items: [project] });
  api.getContext.mockResolvedValue(memory);
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
  it('explains real and planned application integrations inside Settings', async () => {
    await render();
    await click('Settings');
    expect(host.textContent).toContain('How integrations work');
    expect(host.textContent).toContain('KiCad');
    expect(host.textContent).toContain('PlatformIO');
    expect(host.textContent).toContain('Gateway & context service required');
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
    let resolveFirst!: (data: ProjectMemory) => void;
    api.getContext.mockImplementation((key: string) =>
      key === id
        ? new Promise<ProjectMemory>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({
            ...memory,
            projectId: second.id,
            records: memory.records.map((r) => ({
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
    await act(async () => resolveFirst(memory));
    expect(host.textContent).not.toContain('Review motor mapping');
  });
  it('renders dashboard, selected workspace and navigation for all six screens', async () => {
    await render();
    expect(host.textContent).toContain('Choose your active project');
    await select();
    expect(host.textContent).toContain('Firmware project');
    expect(api.listFindings).toHaveBeenCalledWith(id);
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
    expect(host.textContent).toContain('Live API · No demo data');
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
    expect(host.textContent).toContain('Review motor mapping');
    api.getContext.mockRejectedValue(new DaemonClientError('NOT_IMPLEMENTED', 'not ready'));
    await click('Retrieve latest context');
    expect(host.textContent).toContain('Not available from this daemon');
    await click('Agent Handoffs');
    expect(host.textContent).toContain('Handoff storage is not available yet');
  });
  it('renders empty MCP inventory and honestly disabled actions', async () => {
    await render();
    await click('MCP Hub');
    expect(host.textContent).toContain('No registered servers');
    const add = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add MCP');
    expect(add?.disabled).toBe(true);
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
