import { describe, it, expect } from 'vitest';
import { DaemonClientError } from '@udi/client-sdk';
import { Resource, describeError } from './resource.js';
describe('frontend request state', () => {
  it('publishes loading, data and retry recovery', async () => {
    const r = new Resource<number>();
    expect(r.getSnapshot().status).toBe('loading');
    await r.load(() => Promise.reject(new DaemonClientError('CONNECTION_ERROR', 'offline')));
    expect(r.getSnapshot()).toMatchObject({ status: 'error', title: 'Daemon disconnected' });
    await r.load(async () => 2);
    expect(r.getSnapshot()).toEqual({ status: 'ready', data: 2 });
  });
  it('ignores superseded responses and disposed requests', async () => {
    const r = new Resource<string>();
    let done!: (s: string) => void;
    const old = r.load(
      () =>
        new Promise<string>((resolve) => {
          done = resolve;
        }),
    );
    await r.load(async () => 'current');
    done('obsolete');
    await old;
    expect(r.getSnapshot()).toEqual({ status: 'ready', data: 'current' });
    const pending = r.load(
      () =>
        new Promise<string>((resolve) => {
          done = resolve;
        }),
    );
    r.cancel();
    done('disposed');
    await pending;
    expect(r.getSnapshot()).toEqual({ status: 'loading' });
  });
  it('distinguishes authentication, unavailable and connection errors without leaking raw errors', () => {
    expect(describeError(new DaemonClientError('UNAUTHORIZED', 'secret'))).toMatchObject({
      title: 'Authentication required',
    });
    expect(describeError(new DaemonClientError('NOT_IMPLEMENTED', 'secret'))).toMatchObject({
      title: 'Not available from this daemon',
    });
    expect(JSON.stringify(describeError(new Error('secret')))).not.toContain('secret');
  });
});
