import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@udi/client-sdk';
import { ErrorResponseSchema, type PersistedValidationResult } from '@udi/contracts';
import { buildApp } from './app.js';

const token = 'persistence-integration-token-32-characters';
const headers = { authorization: `Bearer ${token}` };
const provenance = { sourceKind: 'agent_summary' as const, actor: 'fixture-agent' };
let directory: string;
let app: ReturnType<typeof buildApp>;
function client() {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: url.pathname + url.search,
      headers: Object.fromEntries(new Headers(init?.headers)),
      ...(init?.body ? { payload: String(init.body) } : {}),
    });
    return new Response(response.body, { status: response.statusCode });
  };
  return createClient({ token, fetch: fetcher });
}
function result(projectId: string): PersistedValidationResult {
  const timestamp = new Date().toISOString();
  const base = () => ({ id: randomUUID(), createdAt: timestamp, updatedAt: timestamp });
  const job = {
    ...base(),
    projectId,
    status: 'failed' as const,
    startedAt: timestamp,
    completedAt: timestamp,
    exitCode: 1,
    stdoutTail: 'fixture output',
    stderrTail: '',
    artifacts: ['pins.h'],
  };
  return {
    job,
    findings: [
      {
        ...base(),
        projectId,
        jobId: job.id,
        ruleId: 'fixture.pin-mismatch',
        severity: 'error',
        message: 'Intentional test fixture',
        expected: 'GPIO14',
        observed: 'GPIO26',
        evidence: [{ filePath: 'pins.h', line: 1 }],
        status: 'open',
        verifiedBy: { tool: 'integration-fixture', version: '1' },
      },
    ],
  };
}
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'udi-api-')));
  app = buildApp({ databasePath: join(directory, 'platform.sqlite'), token, logger: false });
});
afterEach(async () => {
  await app.close();
  await rm(directory, { recursive: true, force: true });
});
const project = () => client().createProject({ name: 'Persisted project', rootPath: directory });

describe('persisted API and shared SDK', () => {
  it('writes and reads every resource through the typed SDK after a daemon/database restart', async () => {
    const sdk = client();
    const p = await project();
    const event = await sdk.createEvent(p.id, {
      type: 'decision.recorded',
      actor: 'fixture-agent',
      sourceKind: 'agent_summary',
      sourceRef: 'fixture',
      payload: { text: 'Review pin map' },
    });
    const record = await sdk.createContextRecord(p.id, {
      kind: 'issue',
      text: 'Check the pin map',
      provenance,
      evidence: [{ filePath: 'pins.h', line: 1 }],
    });
    const handoff = await sdk.createHandoff(p.id, {
      fromAgentId: randomUUID(),
      summary: 'Continue review',
      recordIds: [record.id],
      nextSteps: ['Review mapping'],
      provenance,
    });
    const server = await sdk.createMcpServer({
      name: 'Fixture inventory',
      enabled: true,
      transport: { type: 'stdio', executableId: 'fixture', args: [] },
    });
    expect(server.status).toBe('unknown');
    const observation = await sdk.replaceMcpServer(server.id, {
      name: server.name,
      enabled: true,
      transport: server.transport,
      status: 'unreachable',
    });
    const validation = result(p.id);
    expect(await sdk.recordValidationResult(p.id, validation)).toEqual(validation);
    await app.close();
    app = buildApp({ databasePath: join(directory, 'platform.sqlite'), token, logger: false });
    expect(await sdk.getEvent(p.id, event.id)).toEqual(event);
    expect((await sdk.listEvents(p.id, { type: 'decision.recorded' })).items).toEqual([event]);
    expect(await sdk.getContextRecord(p.id, record.id)).toEqual(record);
    expect((await sdk.listContextRecords(p.id)).items).toEqual([record]);
    expect((await sdk.getContext(p.id)).records).toEqual([record]);
    expect((await sdk.getContext(p.id)).openIssues).toEqual([record.text]);
    expect((await sdk.getContext(p.id)).records[0]?.provenance.sourceKind).toBe('agent_summary');
    expect(await sdk.getHandoff(p.id, handoff.id)).toEqual(handoff);
    expect((await sdk.listHandoffs(p.id)).items).toEqual([handoff]);
    expect(await sdk.getMcpServer(server.id)).toEqual(observation);
    expect((await sdk.listMcpServers()).items).toEqual([observation]);
    expect(await sdk.getJob(p.id, validation.job.id)).toEqual(validation.job);
    expect((await sdk.listFindings(p.id, { jobId: validation.job.id })).items).toEqual(
      validation.findings,
    );
    await expect(sdk.recordValidationResult(p.id, validation)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    expect((await sdk.deleteMcpServer(server.id)).deleted).toBe(true);
    await expect(sdk.getMcpServer(server.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
  it('requires authentication on every new resource route before accepting payloads', async () => {
    const p = await project();
    for (const [method, url] of [
      ['GET', `/projects/${p.id}/events`],
      ['POST', `/projects/${p.id}/events`],
      ['GET', `/projects/${p.id}/context`],
      ['GET', `/projects/${p.id}/context/records`],
      ['POST', `/projects/${p.id}/context/records`],
      ['GET', `/projects/${p.id}/handoffs`],
      ['POST', `/projects/${p.id}/handoffs`],
      ['GET', '/mcp/servers'],
      ['POST', '/mcp/servers'],
      ['PUT', `/mcp/servers/${randomUUID()}`],
      ['DELETE', `/mcp/servers/${randomUUID()}`],
      ['POST', `/projects/${p.id}/validation-results`],
      ['GET', `/engineering/findings?projectId=${p.id}`],
      ['GET', `/jobs/${randomUUID()}?projectId=${p.id}`],
      ['POST', `/projects/${p.id}/validation-jobs`],
      ['POST', `/mcp/servers/${randomUUID()}/health-check`],
    ] as const) {
      const response = await app.inject({ method, url: `/api/v1${url}` });
      expect(response.statusCode).toBe(401);
      expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('UNAUTHORIZED');
    }
    expect((await client().listEvents(p.id)).items).toEqual([]);
  });
  it('isolates projects and rejects cross-project handoffs and validation submissions without partial writes', async () => {
    const sdk = client();
    const a = await project();
    const b = await sdk.createProject({ name: 'Other', rootPath: tmpdir() });
    const record = await sdk.createContextRecord(a.id, {
      kind: 'fact',
      text: 'Scoped fact',
      provenance,
      evidence: [],
    });
    await expect(sdk.getContextRecord(b.id, record.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(
      sdk.createHandoff(b.id, {
        fromAgentId: randomUUID(),
        summary: 'Invalid reference',
        recordIds: [record.id],
        nextSteps: [],
        provenance,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect((await sdk.listHandoffs(b.id)).items).toEqual([]);
    const validation = result(a.id);
    const wrongScope = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${b.id}/validation-results`,
      headers,
      payload: validation,
    });
    expect(wrongScope.statusCode).toBe(400);
    const mismatched = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${a.id}/validation-results`,
      headers,
      payload: { ...validation, findings: [{ ...validation.findings[0]!, projectId: b.id }] },
    });
    expect(mismatched.statusCode).toBe(400);
    await expect(sdk.getJob(a.id, validation.job.id)).rejects.toMatchObject({ status: 404 });
    await sdk.recordValidationResult(a.id, validation);
    expect((await sdk.listFindings(b.id)).items).toEqual([]);
    await expect(sdk.getJob(b.id, validation.job.id)).rejects.toMatchObject({ status: 404 });
    expect((await sdk.getContext(b.id)).records).toEqual([]);
  });
  it('validates query bounds, UUIDs, metadata spoofing, provenance and missing resources', async () => {
    const p = await project();
    for (const [method, path, payload] of [
      ['GET', `/projects/${p.id}/events?limit=501`, undefined],
      ['GET', `/projects/${p.id}/handoffs?offset=-1`, undefined],
      ['GET', `/projects/${p.id}/context?maxItems=0`, undefined],
      ['GET', `/engineering/findings?projectId=${p.id}&jobId=invalid`, undefined],
      [
        'POST',
        `/projects/${p.id}/events`,
        { id: randomUUID(), type: 'event', actor: 'test', sourceKind: 'user_entered', payload: {} },
      ],
      [
        'POST',
        `/projects/${p.id}/context/records`,
        { kind: 'fact', text: 'No provenance', evidence: [] },
      ],
      [
        'POST',
        '/mcp/servers',
        {
          name: 'Secret',
          enabled: true,
          transport: { type: 'http', url: 'https://user:secret@example.com' },
        },
      ],
    ] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1${path}`,
        headers,
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode).toBe(400);
      expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
    }
    for (const path of [
      `/projects/${randomUUID()}/context`,
      `/projects/${randomUUID()}/events`,
      `/projects/${p.id}/events/${randomUUID()}`,
      `/projects/${p.id}/handoffs/${randomUUID()}`,
      `/mcp/servers/${randomUUID()}`,
    ])
      expect((await app.inject({ url: `/api/v1${path}`, headers })).statusCode).toBe(404);
  });
  it('paginates stored events and distinguishes persistence from unavailable execution', async () => {
    const sdk = client();
    const p = await project();
    for (const type of ['first', 'second', 'second'])
      await sdk.createEvent(p.id, {
        type,
        actor: 'test',
        sourceKind: 'user_entered',
        payload: null,
      });
    const all = (await sdk.listEvents(p.id)).items;
    expect((await sdk.listEvents(p.id, { limit: 1, offset: 1 })).items).toEqual([all[1]]);
    expect((await sdk.listEvents(p.id, { type: 'second' })).items).toHaveLength(2);
    expect((await sdk.listEvents(p.id, { offset: 100 })).items).toEqual([]);
    const server = await sdk.createMcpServer({
      name: 'Disabled',
      enabled: false,
      transport: { type: 'stdio', executableId: 'fixture', args: [] },
    });
    expect(server.status).toBe('disabled');
    await expect(sdk.checkMcpServerHealth(server.id)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      status: 501,
    });
    await expect(
      sdk.requestValidation(p.id, {
        kind: 'pin_consistency',
        artifactPaths: ['pins.h'],
        requestedBy: 'test',
      }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 });
    expect((await sdk.listFindings(p.id)).items).toEqual([]);
  });
  it('accepts an injected context provider and rejects its invalid or cross-project output', async () => {
    await app.close();
    let invalid: 'none' | 'project' | 'record' | 'count' = 'none';
    app = buildApp({
      databasePath: join(directory, 'platform.sqlite'),
      token,
      logger: false,
      integrations: (repositories) => ({
        context: {
          async getContext(id, maxItems) {
            const records = await repositories.context.listRecords(id, { limit: maxItems ?? 100 });
            return {
              projectId: invalid === 'project' ? randomUUID() : id,
              generatedAt: new Date().toISOString(),
              schemaVersion: 1,
              records:
                invalid === 'record'
                  ? records.map((record) => ({ ...record, projectId: randomUUID() }))
                  : invalid === 'count'
                    ? [...records, ...records]
                    : records,
              openIssues: [],
            };
          },
        },
      }),
    });
    const sdk = client();
    const p = await project();
    await sdk.createContextRecord(p.id, {
      kind: 'decision',
      text: 'User choice',
      provenance,
      evidence: [],
    });
    expect((await sdk.getContext(p.id, 1)).records).toHaveLength(1);
    expect((await sdk.health()).capabilities.context).toBe(true);
    for (const mode of ['project', 'record', 'count'] as const) {
      invalid = mode;
      await expect(sdk.getContext(p.id, 1)).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        status: 500,
      });
    }
  });
});
