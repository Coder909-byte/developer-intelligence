import { describe, it, expect, vi } from 'vitest';
import type { DaemonClient } from '@udi/client-sdk';
import { readJobFindings } from './validation.js';
describe('job-scoped findings', () => {
  it('filters by selected job including empty results and never infers a pass from old findings', async () => {
    const getJob = vi
      .fn()
      .mockResolvedValue({ id: 'new', projectId: 'project', status: 'succeeded' });
    const listFindings = vi.fn().mockResolvedValue({ items: [] });
    const result = await readJobFindings(
      { getJob, listFindings } as unknown as DaemonClient,
      'project',
      'new',
    );
    expect(result.items).toEqual([]);
    expect(listFindings).toHaveBeenCalledWith('project', { limit: 100, offset: 0, jobId: 'new' });
  });
  it('rejects a job or findings from another scope instead of showing mixed history as current', async () => {
    const getJob = vi.fn().mockResolvedValue({ id: 'new', projectId: 'project' });
    const listFindings = vi
      .fn()
      .mockResolvedValue({ items: [{ projectId: 'project', jobId: 'old' }] });
    await expect(
      readJobFindings({ getJob, listFindings } as unknown as DaemonClient, 'project', 'new'),
    ).rejects.toThrow('selected job');
    getJob.mockResolvedValue({ id: 'new', projectId: 'other' });
    await expect(
      readJobFindings({ getJob, listFindings } as unknown as DaemonClient, 'project', 'new'),
    ).rejects.toThrow('scope');
  });
});
