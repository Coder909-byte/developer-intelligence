import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { successSchema, ProjectSchema, ErrorResponseSchema } from '@udi/contracts';
import { createClient, DaemonClientError } from '@udi/client-sdk';
import { buildApp } from './app.js';
const token = 'integration-token-at-least-32-characters';
const headers = { authorization: `Bearer ${token}` };
let app: ReturnType<typeof buildApp>;
let directory: string;
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'udi-test-')));
  app = buildApp({ databasePath: join(directory, 'test.sqlite'), token, logger: false });
});
afterEach(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});
const create = () =>
  app.inject({
    method: 'POST',
    url: '/api/v1/projects',
    headers,
    payload: { name: 'Rover', rootPath: directory, description: 'Preserve this description' },
  });
describe('loopback daemon', () => {
  it('serves genuine database health without authentication', async () => {
    const response = await app.inject('/api/v1/health');
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: 'ok',
      database: 'ready',
      capabilities: { context: false, mcp: false },
    });
  });
  it('requires authentication, enforces Host and blocks arbitrary origins', async () => {
    expect((await app.inject('/api/v1/projects')).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/projects', headers: { authorization: 'Bearer invalid' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ url: '/api/v1/health', headers: { host: 'evil.example' } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ url: '/api/v1/health', headers: { origin: 'https://evil.example' } }))
        .statusCode,
    ).toBe(403);
  });
  it('allows CORS preflight only from approved frontend origins', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/projects',
      headers: { origin: 'http://127.0.0.1:5173' },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    expect(
      (
        await app.inject({
          method: 'OPTIONS',
          url: '/api/v1/projects',
          headers: { origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('creates, reads, lists, updates, and deletes a project', async () => {
    const response = await create();
    expect(response.statusCode).toBe(201);
    const project = successSchema(ProjectSchema).parse(response.json()).data;
    expect(project.rootPath).toBe(directory);
    expect(response.headers.location).toBe(`/api/v1/projects/${project.id}`);
    const list = await app.inject({ url: '/api/v1/projects', headers });
    expect(list.json().data.items).toHaveLength(1);
    expect(
      (await app.inject({ url: `/api/v1/projects/${project.id}`, headers })).json().data.id,
    ).toBe(project.id);
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}`,
      headers,
      payload: { name: 'Updated' },
    });
    expect(update.json().data).toMatchObject({
      name: 'Updated',
      rootPath: directory,
      description: 'Preserve this description',
    });
    expect(
      (
        await app.inject({ method: 'DELETE', url: `/api/v1/projects/${project.id}`, headers })
      ).json().data.deleted,
    ).toBe(true);
    expect((await app.inject({ url: `/api/v1/projects/${project.id}`, headers })).statusCode).toBe(
      404,
    );
  });
  it('persists projects across a database restart', async () => {
    const project = (await create()).json().data;
    await app.close();
    app = buildApp({ databasePath: join(directory, 'test.sqlite'), token, logger: false });
    expect(
      (await app.inject({ url: `/api/v1/projects/${project.id}`, headers })).json().data,
    ).toEqual(project);
  });
  it('returns a conflict for duplicate canonical workspace paths', async () => {
    await create();
    const response = await create();
    expect(response.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('CONFLICT');
  });
  it.each([
    { name: '', rootPath: '/tmp' },
    { name: 'x', rootPath: 'relative' },
    { name: 'x', rootPath: '/definitely/missing/udi-workspace' },
    { name: 'x', rootPath: '/tmp', extra: 'forbidden' },
  ])('rejects invalid project input: %j', async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers,
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  });
  it('rejects malformed JSON, IDs, empty patches, and oversized requests', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { ...headers, 'content-type': 'application/json' },
          payload: '{',
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ url: '/api/v1/projects/not-a-uuid', headers })).statusCode).toBe(
      400,
    );
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/projects/${randomUUID()}`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers,
          payload: { name: 'x'.repeat(70000), rootPath: directory },
        })
      ).statusCode,
    ).toBe(413);
  });
  it('returns structured missing-resource and route errors', async () => {
    for (const request of [
      { method: 'GET' as const, url: `/api/v1/projects/${randomUUID()}` },
      { method: 'DELETE' as const, url: `/api/v1/projects/${randomUUID()}` },
      { method: 'GET' as const, url: '/api/v1/missing' },
    ]) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
    }
  });
  it('returns empty persisted views without claiming execution support', async () => {
    const project = (await create()).json().data;
    for (const url of [
      '/api/v1/mcp/servers',
      `/api/v1/engineering/findings?projectId=${project.id}`,
    ]) {
      const response = await app.inject({ url, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ items: [] });
    }
    const response = await app.inject({ url: `/api/v1/projects/${project.id}/context`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      projectId: project.id,
      records: [],
      openIssues: [],
    });
    expect((await app.inject({ url: '/api/v1/engineering/findings', headers })).statusCode).toBe(
      400,
    );
  });
  it('uses the real shared SDK against daemon responses', async () => {
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const response = await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'DELETE',
        url: url.pathname + url.search,
        headers: Object.fromEntries(new Headers(init?.headers)),
        ...(init?.body ? { payload: String(init.body) } : {}),
      });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    };
    const client = createClient({ token, fetch: fetcher });
    const project = await client.createProject({ name: 'SDK', rootPath: directory });
    expect((await client.getProject(project.id)).id).toBe(project.id);
    expect((await client.listProjects()).items).toHaveLength(1);
    expect((await client.getContext(project.id)).records).toEqual([]);
    await expect(
      client.requestValidation(project.id, {
        kind: 'pin_consistency',
        artifactPaths: ['pins.h'],
        requestedBy: 'test',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      status: 501,
    });
    expect(DaemonClientError.prototype).toBeInstanceOf(Error);
  });
});
