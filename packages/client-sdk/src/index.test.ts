import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from './index.js';
const meta = { apiVersion: 'v1', requestId: randomUUID(), timestamp: new Date().toISOString() };
const fetchResponse = (body: unknown, status = 200): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));
describe('shared daemon client', () => {
  it.each([
    'https://example.com',
    'http://192.168.1.1:4317',
    'http://localhost:4317/api',
    'http://user:secret@localhost:4317',
    'http://localhost:4317?token=x',
  ])('rejects non-local or non-origin URL %s', (baseUrl) => {
    expect(() => createClient({ baseUrl })).toThrow();
  });
  it('rejects invalid request data before making network calls', () => {
    const fetcher = vi.fn();
    const client = createClient({ fetch: fetcher });
    expect(() => client.createProject({ name: '', rootPath: '/tmp' })).toThrow();
    expect(() => client.getProject('invalid')).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves structured daemon errors', async () => {
    const client = createClient({
      fetch: fetchResponse(
        { ok: false, error: { code: 'UNAUTHORIZED', message: 'Token required' }, meta },
        401,
      ),
    });
    await expect(client.listProjects()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
      message: 'Token required',
    });
  });
  it('maps connection failures', async () => {
    const client = createClient({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(client.health()).rejects.toMatchObject({ code: 'CONNECTION_ERROR' });
  });
  it('bounds timeout even if the transport ignores abort', async () => {
    const client = createClient({ timeoutMs: 10, fetch: () => new Promise(() => {}) });
    await expect(client.health()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('bounds response-body reading with the same timeout', async () => {
    const client = createClient({
      timeoutMs: 10,
      fetch: async () => new Response(new ReadableStream({ start() {} })),
    });
    await expect(client.health()).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it.each([
    { ok: true, data: {}, meta },
    { ok: true, data: { items: [] }, meta: { ...meta, apiVersion: 'v2' } },
  ])('rejects invalid successful response %j', async (body) => {
    await expect(createClient({ fetch: fetchResponse(body) }).health()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('rejects invalid error envelopes and non-JSON responses', async () => {
    await expect(
      createClient({ fetch: fetchResponse({ message: 'error' }, 500) }).health(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      createClient({ fetch: async () => new Response('not json') }).health(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('reads the current token at request time and sends it only in a header', async () => {
    const fetcher = fetchResponse({ ok: true, data: { items: [] }, meta });
    const client = createClient({ token: () => 'current-token', fetch: fetcher });
    await client.listProjects();
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:4317/api/v1/projects',
      expect.objectContaining({
        headers: { Authorization: 'Bearer current-token' },
        redirect: 'error',
      }),
    );
  });
});

describe('persistence client validation', () => {
  it('validates pagination, references and write fields before making any request', () => {
    const fetcher = vi.fn();
    const client = createClient({ fetch: fetcher });
    const projectId = randomUUID();
    const recordId = randomUUID();
    expect(() => client.listEvents(projectId, { limit: 501 })).toThrow();
    expect(() => client.listFindings(projectId, { jobId: 'invalid' })).toThrow();
    expect(() => client.getContext(projectId, 0)).toThrow();
    expect(() =>
      client.createContextRecord(projectId, {
        kind: 'decision',
        text: '',
        provenance: { sourceKind: 'user_entered', actor: 'test' },
        evidence: [],
      }),
    ).toThrow();
    expect(() =>
      client.createHandoff(projectId, {
        fromAgentId: randomUUID(),
        summary: 'Invalid duplicates',
        recordIds: [recordId, recordId],
        nextSteps: [],
        provenance: { sourceKind: 'user_entered', actor: 'test' },
      }),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects malformed persisted records instead of passing unchecked data to frontend callers', async () => {
    const client = createClient({
      fetch: fetchResponse({ ok: true, data: { items: [{ id: randomUUID() }] }, meta }),
    });
    await expect(client.listContextRecords(randomUUID())).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
