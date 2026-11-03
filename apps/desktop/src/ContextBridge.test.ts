// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DaemonClientError, type DaemonClient } from '@udi/client-sdk';
import type { CodexClaudeHandoff } from '@udi/contracts';
import { ContextBridge } from './ContextBridge.js';
const project = {
  id: '61d626eb-26fa-4bae-bbe7-64dc03fb921b',
  name: 'Rover',
  rootPath: '/workspace/rover',
  description: '',
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
};
// View fixture only; native capture/formatting have independent production-path tests.
const result: CodexClaudeHandoff = {
  projectId: project.id,
  projectName: project.name,
  sessionId: 'd1cd0096-533f-4973-b71b-e3990a6f11bf',
  storage: 'codex_sqlite',
  generatedAt: project.createdAt,
  filename: 'codex-claude-context.md',
  importLine: '@./codex-claude-context.md',
  markdown: '# Codex context\n\nRetain GPIO14',
  entries: [
    {
      id: 'source-user',
      role: 'user',
      occurredAt: project.createdAt,
      text: 'Retain GPIO14',
      originalChars: 13,
      truncated: false,
    },
  ],
  stats: {
    messagesRead: 1,
    messagesIncluded: 1,
    omittedMessages: 0,
    truncatedMessages: 0,
    rawTokensEstimate: 4,
    outputTokensEstimate: 9,
    sourceWindowLimited: false,
  },
  nativeClaudeSessionVerified: false,
};
let host: HTMLDivElement, root: Root;
let convert: ReturnType<typeof vi.fn>;
let client: DaemonClient;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  convert = vi.fn().mockResolvedValue(result);
  client = { convertCodexContext: convert } as unknown as DaemonClient;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const render = (selected = project) =>
  act(async () => root.render(createElement(ContextBridge, { client, project: selected })));
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
describe('One-click context bridge component', () => {
  it('reads no private context until clicked, then shows the real source and converted output', async () => {
    await render();
    expect(convert).not.toHaveBeenCalled();
    await click('Convert to Claude Code');
    expect(convert).toHaveBeenCalledExactlyOnceWith(project.id);
    expect(host.querySelector('[aria-label="Captured Codex context"]')?.textContent).toContain(
      'Retain GPIO14',
    );
    expect(host.querySelector('[aria-label="Claude-ready handoff"]')?.textContent).toBe(
      result.markdown,
    );
    expect(host.textContent).toContain('Ready to import');
    expect(host.textContent).not.toContain('Claude connected');
  });
  it('shows an actionable missing-session error without a fabricated success preview', async () => {
    convert.mockRejectedValue(new DaemonClientError('NOT_FOUND', 'No Codex session', 404));
    await render();
    await click('Convert to Claude Code');
    expect(host.textContent).toContain('No saved Codex session');
    expect(host.querySelector('[aria-label="Claude-ready handoff"]')).toBeNull();
  });
  it('disables conversion while a real request is pending and ignores a result after project change', async () => {
    let resolve!: (value: typeof result) => void;
    convert.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await render();
    await click('Convert to Claude Code');
    expect(
      [...host.querySelectorAll('button')].find(
        (node) => node.textContent === 'Converting context…',
      )?.disabled,
    ).toBe(true);
    await render({ ...project, id: '43c9cd53-0900-4a26-a33b-f1ab933e4560', name: 'Other' });
    await act(async () => resolve(result));
    expect(host.textContent).not.toContain('Retain GPIO14');
    expect(host.textContent).toContain('Other');
  });
  it('copies exactly the converted Markdown for Claude Code', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy },
    });
    await render();
    await click('Convert to Claude Code');
    await click('Copy for Claude Code');
    expect(copy).toHaveBeenCalledExactlyOnceWith(result.markdown);
    expect(host.textContent).toContain('Paste this handoff into a new Claude Code conversation');
  });
});
