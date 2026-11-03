import { describe, it, expect, vi } from 'vitest';
import type { DaemonClient } from '@udi/client-sdk';
import { latestStoredHandoff } from './handoffs.js';
describe('latest persisted handoff selection', () => {
  it('traverses complete pages instead of treating the first page as the latest', async () => {
    const listHandoffs = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 500 }, (_, i) => ({ id: `older-${i}`, projectId: 'project' })),
      })
      .mockResolvedValueOnce({ items: [{ id: 'latest', projectId: 'project' }] });
    expect(
      await latestStoredHandoff({ listHandoffs } as unknown as DaemonClient, 'project'),
    ).toEqual({ id: 'latest', projectId: 'project' });
    expect(listHandoffs).toHaveBeenLastCalledWith('project', { limit: 500, offset: 500 });
  });
  it("returns an honest empty state and rejects another project's records", async () => {
    expect(
      await latestStoredHandoff(
        { listHandoffs: async () => ({ items: [] }) } as unknown as DaemonClient,
        'project',
      ),
    ).toBeUndefined();
    await expect(
      latestStoredHandoff(
        {
          listHandoffs: async () => ({ items: [{ projectId: 'other' }] }),
        } as unknown as DaemonClient,
        'project',
      ),
    ).rejects.toThrow('scope');
  });
});
