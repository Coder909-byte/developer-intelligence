// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DaemonClientError, type DaemonClient } from '@udi/client-sdk';
import type { AgentHandoff } from '@udi/contracts';
import { Library } from './Library.js';

const projectId = '61d626eb-26fa-4bae-bbe7-64dc03fb921b';
const handoff: AgentHandoff = {
  id: 'b785354e-2e71-4b89-94ac-55a5d7c154d8',
  projectId,
  createdAt: '2026-11-04T00:00:00Z',
  updatedAt: '2026-11-04T00:00:00Z',
  fromAgentId: projectId,
  summary: 'Saved firmware investigation',
  recordIds: [],
  nextSteps: ['Review the pin mapping'],
  provenance: { sourceKind: 'user_entered', actor: 'test-librarian' },
};
let host: HTMLDivElement;
let root: Root;
const listHandoffs = vi.fn();
const getHandoff = vi.fn();
const client = { listHandoffs, getHandoff } as unknown as DaemonClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  listHandoffs.mockResolvedValue({
    items: [handoff, { ...handoff, id: projectId, summary: 'Second session' }],
  });
  getHandoff.mockResolvedValue(handoff);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(createElement(Library, { client, projectId })));
}
it('renders separate session books and opens the selected project-scoped saved information', async () => {
  await render();
  expect(host.querySelectorAll('.session-book')).toHaveLength(2);
  expect(host.querySelector('.library-librarian')?.getAttribute('aria-label')).toContain(
    'librarian',
  );
  await act(async () => host.querySelector<HTMLButtonElement>('.session-book')!.click());
  expect(getHandoff).toHaveBeenCalledWith(projectId, handoff.id);
  expect(host.querySelector('dialog')?.textContent).toContain('Review the pin mapping');
  expect(host.querySelector('dialog')?.textContent).toContain('User entered');
});
it('shows empty and failed reads honestly and recovers when refreshed', async () => {
  listHandoffs.mockRejectedValue(new DaemonClientError('CONNECTION_ERROR', 'offline'));
  await render();
  expect(host.textContent).toContain('Daemon disconnected');
  expect(host.querySelector('.session-book')).toBeNull();
  listHandoffs.mockResolvedValue({ items: [] });
  await act(async () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Refresh shelves')!.click(),
  );
  expect(host.textContent).toContain('Your shelf is waiting for its first story');
});
it('rejects cross-project books instead of exposing them on the shelf', async () => {
  listHandoffs.mockResolvedValue({ items: [{ ...handoff, projectId: 'other-project' }] });
  await render();
  expect(host.textContent).toContain('Unable to complete request');
  expect(host.querySelector('.session-book')).toBeNull();
  expect(host.textContent).not.toContain(handoff.summary);
});
