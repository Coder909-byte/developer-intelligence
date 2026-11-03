import { describe, it, expect, vi } from 'vitest';
import type { DaemonClient } from '@udi/client-sdk';
import { latestCompletionEvent } from './completion-events.js';
describe('completed job observations', () => {
  it('pages past imported records and follows the newest actual correction observation', async () => {
    const listEvents = vi.fn(async (_id: string, o: { type?: string; offset?: number }) => ({
      items:
        o.type === 'engineering.correction.applied'
          ? o.offset === 0
            ? Array.from({ length: 500 }, () => ({
                projectId: 'p',
                type: o.type,
                sourceKind: 'imported',
              }))
            : [
                {
                  id: 'event',
                  projectId: 'p',
                  type: o.type,
                  sourceKind: 'observed_tool',
                  actor: 'safe-correction-engine',
                  sourceRef: 'new-job',
                  createdAt: '2026-11-03T14:00:00Z',
                },
              ]
          : [],
    }));
    const event = await latestCompletionEvent({ listEvents } as unknown as DaemonClient, 'p');
    expect(event?.sourceRef).toBe('new-job');
    expect(listEvents).toHaveBeenCalledWith('p', {
      type: 'engineering.correction.applied',
      limit: 500,
      offset: 500,
    });
  });
  it('rejects cross-project completion events', async () => {
    const listEvents = vi.fn(async (_id: string, o: { type?: string }) => ({
      items: [{ projectId: 'other', type: o.type }],
    }));
    await expect(
      latestCompletionEvent({ listEvents } as unknown as DaemonClient, 'p'),
    ).rejects.toThrow('Event scope mismatch');
  });
});
