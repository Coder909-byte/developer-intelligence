import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ActivityEvent,
  ContextRecord,
  AgentHandoff,
  McpServer,
  PersistedValidationResult,
} from '@udi/contracts';
import { openDatabase } from './index.js';

const timestamp = '2026-11-03T13:00:00.000Z';
const entity = () => ({ id: randomUUID(), createdAt: timestamp, updatedAt: timestamp });
const provenance = { actor: 'storage-test', sourceKind: 'user_entered' as const };
function fixtures(projectId: string) {
  const record: ContextRecord = {
    ...entity(),
    projectId,
    kind: 'decision',
    text: 'Review the pin map',
    provenance,
    evidence: [],
  };
  const event: ActivityEvent = {
    id: randomUUID(),
    projectId,
    createdAt: timestamp,
    type: 'decision.recorded',
    actor: 'storage-test',
    sourceKind: 'user_entered',
    schemaVersion: 1,
    payload: { text: record.text },
  };
  const handoff: AgentHandoff = {
    ...entity(),
    projectId,
    fromAgentId: randomUUID(),
    summary: 'Continue review',
    recordIds: [record.id],
    nextSteps: ['Check mapping'],
    provenance,
  };
  const server: McpServer = {
    ...entity(),
    name: 'Local MCP',
    transport: { type: 'stdio', executableId: 'demo', args: [] },
    enabled: true,
    status: 'unknown',
  };
  const job = {
    ...entity(),
    projectId,
    status: 'failed' as const,
    startedAt: timestamp,
    completedAt: timestamp,
    exitCode: 1,
    stdoutTail: '',
    stderrTail: 'fixture result',
    artifacts: [],
  };
  const result: PersistedValidationResult = {
    job,
    findings: [
      {
        ...entity(),
        projectId,
        jobId: job.id,
        ruleId: 'fixture.mismatch',
        severity: 'error',
        message: 'Fixture mismatch',
        expected: 'GPIO14',
        observed: 'GPIO26',
        evidence: [{ filePath: 'pins.h', line: 1 }],
        status: 'open',
        verifiedBy: { tool: 'test-fixture', version: '1' },
      },
    ],
  };
  return { record, event, handoff, server, result };
}

describe('platform persistence', () => {
  it('round-trips all records after reopen, keeps project scope, and cascades project deletion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'udi-store-'));
    let store = openDatabase(join(directory, 'platform.sqlite'));
    try {
      const project = store.projects.create({ name: 'A', rootPath: '/workspace/a' });
      const other = store.projects.create({ name: 'B', rootPath: '/workspace/b' });
      const f = fixtures(project.id);
      await store.events.append(f.event);
      await store.context.append(f.record);
      await store.context.saveHandoff(f.handoff);
      await store.mcpServers.register(f.server);
      await store.validation.recordResult(f.result);
      store.close();
      store = openDatabase(join(directory, 'platform.sqlite'));
      expect(await store.events.list(project.id, 10)).toEqual([f.event]);
      expect(await store.context.listRecords(project.id)).toEqual([f.record]);
      expect(await store.handoffs.get(project.id, f.handoff.id)).toEqual(f.handoff);
      expect(await store.mcpServers.get(f.server.id)).toEqual(f.server);
      expect(await store.validation.getJob(project.id, f.result.job.id)).toEqual(f.result.job);
      expect(await store.validation.listFindings(project.id)).toEqual(f.result.findings);
      expect(await store.events.list(other.id)).toEqual([]);
      expect(await store.context.get(other.id, f.record.id)).toBeUndefined();
      expect(await store.handoffs.list(other.id)).toEqual([]);
      expect(await store.validation.getJob(other.id, f.result.job.id)).toBeUndefined();
      expect(await store.validation.listFindings(other.id)).toEqual([]);
      expect(store.projects.delete(project.id)).toBe(true);
      const raw = new DatabaseSync(join(directory, 'platform.sqlite'));
      try {
        for (const table of [
          'activity_events',
          'context_records',
          'agent_handoffs',
          'handoff_records',
          'validation_jobs',
          'engineering_findings',
        ])
          expect(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count).toBe(0);
      } finally {
        raw.close();
      }
      expect(await store.mcpServers.get(f.server.id)).toEqual(f.server); // Global inventory survives project removal.
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects dangling and cross-project references without partially persisting a result or handoff', async () => {
    const store = openDatabase(':memory:');
    try {
      const a = store.projects.create({ name: 'A', rootPath: '/a' });
      const b = store.projects.create({ name: 'B', rootPath: '/b' });
      const f = fixtures(a.id);
      await store.context.append(f.record);
      await expect(store.handoffs.append({ ...f.handoff, projectId: b.id })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(await store.handoffs.list(b.id)).toEqual([]);
      await expect(
        store.validation.recordResult({
          ...f.result,
          findings: [{ ...f.result.findings[0]!, projectId: b.id }],
        }),
      ).rejects.toThrow();
      expect(await store.validation.getJob(a.id, f.result.job.id)).toBeUndefined();
      await store.validation.recordResult(f.result);
      const duplicate = { ...f.result, job: { ...f.result.job, id: randomUUID() } };
      duplicate.findings = duplicate.findings.map((finding) => ({
        ...finding,
        jobId: duplicate.job.id,
      }));
      await expect(store.validation.recordResult(duplicate)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(await store.validation.getJob(a.id, duplicate.job.id)).toBeUndefined();
      expect(await store.validation.listFindings(a.id)).toHaveLength(1);
      await expect(
        store.events.append({ ...f.event, projectId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      store.close();
    }
  });
  it('paginates and filters deterministically, validates bounds, and rejects duplicate append IDs', async () => {
    const store = openDatabase(':memory:');
    try {
      const project = store.projects.create({ name: 'A', rootPath: '/a' });
      const f = fixtures(project.id);
      for (const [id, type] of [
        ['00000000-0000-4000-8000-000000000002', 'two'],
        ['00000000-0000-4000-8000-000000000001', 'one'],
      ] as const)
        await store.events.append({ ...f.event, id, type });
      expect((await store.events.list(project.id, { limit: 1 }))[0]?.type).toBe('one');
      expect((await store.events.list(project.id, { limit: 1, offset: 1 }))[0]?.type).toBe('two');
      expect((await store.events.list(project.id, { type: 'two' })).map((e) => e.type)).toEqual([
        'two',
      ]);
      await expect(store.events.list(project.id, { limit: 501 })).rejects.toThrow();
      await store.context.append(f.record);
      await expect(store.context.append(f.record)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        store.handoffs.append({ ...f.handoff, recordIds: [f.record.id, f.record.id] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    } finally {
      store.close();
    }
  });
  it('stores MCP adapter observations without executing a health check, and protects immutable creation time', async () => {
    const store = openDatabase(':memory:');
    try {
      const f = fixtures(randomUUID());
      await store.mcpServers.register(f.server);
      const updated = {
        ...f.server,
        status: 'unreachable' as const,
        updatedAt: '2026-11-03T14:00:00.000Z',
      };
      expect(await store.mcpServers.replace(updated)).toEqual(updated);
      await expect(store.mcpServers.register(f.server)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        store.mcpServers.replace({ ...updated, createdAt: updated.updatedAt }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        store.mcpServers.register({
          ...f.server,
          id: randomUUID(),
          transport: { type: 'http', url: 'https://user:password@example.com' },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await store.mcpServers.delete(f.server.id)).toBe(true);
      expect(await store.mcpServers.get(f.server.id)).toBeUndefined();
    } finally {
      store.close();
    }
  });
});

describe('forward-only migrations', () => {
  it('upgrades an existing v1 database without changing projects or events and reopens idempotently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'udi-v1-'));
    const filename = join(directory, 'legacy.sqlite');
    const projectId = randomUUID();
    const event = fixtures(projectId).event;
    const db = new DatabaseSync(filename);
    db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations VALUES (1, '2026-11-03T12:00:00Z');
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE activity_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
      CREATE INDEX activity_events_project_time ON activity_events(project_id, created_at);`);
    db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)').run(
      projectId,
      'Legacy',
      '/legacy',
      'retained',
      timestamp,
      timestamp,
    );
    db.prepare('INSERT INTO activity_events VALUES (?, ?, ?, ?)').run(
      event.id,
      projectId,
      event.createdAt,
      JSON.stringify(event),
    );
    db.close();
    try {
      for (let i = 0; i < 2; i++) {
        const store = openDatabase(filename);
        try {
          expect(store.projects.get(projectId)?.description).toBe('retained');
          expect(await store.events.list(projectId)).toEqual([event]);
        } finally {
          store.close();
        }
      }
      const migrated = new DatabaseSync(filename);
      try {
        expect(
          migrated
            .prepare('SELECT version FROM schema_migrations ORDER BY version')
            .all()
            .map((r) => r.version),
        ).toEqual([1, 2, 3, 4]);
        expect(
          migrated.prepare('SELECT applied_at FROM schema_migrations WHERE version=1').get()
            ?.applied_at,
        ).toBe('2026-11-03T12:00:00Z');
      } finally {
        migrated.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each([[1, 2, 3, 4, 5], [2]])(
    'refuses newer or noncontiguous migration history %j without altering it',
    async (...versions) => {
      const directory = await mkdtemp(join(tmpdir(), 'udi-newer-'));
      const filename = join(directory, 'future.sqlite');
      const db = new DatabaseSync(filename);
      db.exec(
        'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      for (const version of versions)
        db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(version, timestamp);
      db.close();
      try {
        expect(() => openDatabase(filename)).toThrow('refusing to downgrade');
        const check = new DatabaseSync(filename);
        try {
          expect(
            check
              .prepare('SELECT version FROM schema_migrations ORDER BY version')
              .all()
              .map((r) => r.version),
          ).toEqual(versions);
        } finally {
          check.close();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it('persists and retrieves classification results and compression metrics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'udi-class-'));
    const filename = join(directory, 'app.sqlite');
    const store = openDatabase(filename);
    try {
      const project = await store.projects.create({
        name: 'Rover AI',
        rootPath: '/work/rover',
      });
      const classId = 'c0000000-0000-4000-8000-000000000001';
      await store.classification.record({
        id: classId,
        projectId: project.id,
        timestamp: new Date().toISOString(),
        rawLengthChars: 120,
        signalScore: 0.95,
        category: 'HARDWARE_SPEC',
        decision: 'preserve',
        distilledFact: 'MOTOR_EN mapped to GPIO14',
        sourceActor: 'engineering-core',
        sourceType: 'tool_output',
      });

      const listed = await store.classification.list(project.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]?.category).toBe('HARDWARE_SPEC');
      expect(listed[0]?.signalScore).toBe(0.95);

      await store.metrics.record({
        projectId: project.id,
        totalRawTokens: 5000,
        totalCompressedTokens: 200,
        compressionRatio: 0.96,
        preservedFactsCount: 4,
        prunedNoiseCount: 40,
        lastInjectedAt: new Date().toISOString(),
      });

      const metrics = await store.metrics.get(project.id);
      expect(metrics).toBeDefined();
      expect(metrics?.totalRawTokens).toBe(5000);
      expect(metrics?.compressionRatio).toBe(0.96);
    } finally {
      store.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
