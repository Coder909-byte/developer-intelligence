import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  ActivityEventSchema,
  ContextRecordSchema,
  AgentHandoffSchema,
  McpServerSchema,
  JobSchema,
  ValidationFindingSchema,
  ValidationResultSchema,
  IdSchema,
  PageQuerySchema,
  EventQuerySchema,
  FindingQuerySchema,
  type ActivityEvent,
  type ContextRecord,
  type AgentHandoff,
  type McpServer,
  type Job,
  type ValidationFinding,
  type PersistedValidationResult,
  type PageOptions,
  type EventListOptions,
  type FindingListOptions,
  LayaClassificationResultSchema,
  type LayaClassificationResult,
  CompressionMetricsSchema,
  type CompressionMetrics,
  ContextSnapshotSchema,
  type ContextSnapshot,
} from '@udi/contracts';

export class PersistenceError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'PersistenceError';
  }
}
export interface ScopedRecords<T> {
  list(projectId: string, options?: PageOptions): Promise<T[]>;
  get(projectId: string, id: string): Promise<T | undefined>;
  append(record: T): Promise<void>;
}
export interface PlatformRepositories {
  events: Omit<ScopedRecords<ActivityEvent>, 'list'> & {
    list(projectId: string, options?: number | EventListOptions): Promise<ActivityEvent[]>;
  };
  context: ScopedRecords<ContextRecord> & {
    listRecords(projectId: string, options?: PageOptions): Promise<ContextRecord[]>;
    saveHandoff(handoff: AgentHandoff): Promise<void>;
  };
  handoffs: ScopedRecords<AgentHandoff>;
  mcpServers: {
    list(options?: PageOptions): Promise<McpServer[]>;
    get(id: string): Promise<McpServer | undefined>;
    register(server: McpServer): Promise<McpServer>;
    replace(server: McpServer): Promise<McpServer>;
    delete(id: string): Promise<boolean>;
  };
  validation: {
    recordResult(result: PersistedValidationResult): Promise<PersistedValidationResult>;
    getJob(projectId: string, id: string): Promise<Job | undefined>;
    listFindings(projectId: string, options?: FindingListOptions): Promise<ValidationFinding[]>;
  };
  classification: {
    record(result: LayaClassificationResult): Promise<void>;
    list(projectId: string, limit?: number): Promise<LayaClassificationResult[]>;
  };
  metrics: {
    get(projectId: string): Promise<CompressionMetrics | undefined>;
    record(metrics: CompressionMetrics): Promise<void>;
  };
  snapshots: {
    create(snapshot: ContextSnapshot): Promise<ContextSnapshot>;
    list(projectId: string): Promise<ContextSnapshot[]>;
    get(projectId: string, nameOrId: string): Promise<ContextSnapshot | undefined>;
    delete(projectId: string, nameOrId: string): Promise<boolean>;
  };
}

/** Called only by openDatabase. This module contains persistence, never tool execution or synthesis. */
export function createPlatformRepositories(db: DatabaseSync): PlatformRepositories {
  function requireProject(projectId: string) {
    IdSchema.parse(projectId);
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId))
      throw new PersistenceError('NOT_FOUND', 'Project not found');
  }
  function atomic<T>(work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  // Table names come exclusively from this fixed internal union, never request data.
  type Table =
    | 'activity_events'
    | 'context_records'
    | 'agent_handoffs'
    | 'validation_jobs'
    | 'engineering_findings'
    | 'classification_results'
    | 'context_snapshots'
    | 'mcp_servers';
  const decodeJson = (body: unknown): unknown => {
    try {
      return JSON.parse(String(body));
    } catch {
      throw new Error('Stored record contains invalid JSON');
    }
  };
  function validateStored<T>(schema: { parse(value: unknown): T }, value: unknown): T {
    try {
      return schema.parse(value);
    } catch {
      throw new Error('Stored record violates its contract');
    }
  }
  function rows(
    table: Table,
    projectId: string,
    options: PageOptions,
    extra = '',
    values: SQLInputValue[] = [],
  ) {
    requireProject(projectId);
    const page = PageQuerySchema.parse(options);
    return db
      .prepare(
        `SELECT body FROM ${table} WHERE project_id = ? ${extra} ORDER BY julianday(created_at), id LIMIT ? OFFSET ?`,
      )
      .all(projectId, ...values, page.limit, page.offset);
  }
  function scopedBody(table: Table, projectId: string, id: string) {
    requireProject(projectId);
    IdSchema.parse(id);
    const row = db
      .prepare(`SELECT body FROM ${table} WHERE project_id = ? AND id = ?`)
      .get(projectId, id);
    return row ? decodeJson(row.body) : undefined;
  }
  function insert(
    table: Table,
    record: { id: string; projectId: string; createdAt: string },
    body: unknown,
  ) {
    requireProject(record.projectId);
    if (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(record.id))
      throw new PersistenceError('CONFLICT', 'Record ID already exists');
    db.prepare(`INSERT INTO ${table} (id, project_id, created_at, body) VALUES (?, ?, ?, ?)`).run(
      record.id,
      record.projectId,
      record.createdAt,
      JSON.stringify(body),
    );
  }
  const events: PlatformRepositories['events'] = {
    async append(input) {
      const record = ActivityEventSchema.parse(input);
      insert('activity_events', record, record);
    },
    async get(projectId, id) {
      const body = scopedBody('activity_events', projectId, id);
      return body === undefined ? undefined : validateStored(ActivityEventSchema, body);
    },
    async list(projectId, options = {}) {
      const query = EventQuerySchema.parse(
        typeof options === 'number' ? { limit: options } : options,
      );
      return rows(
        'activity_events',
        projectId,
        { limit: query.limit, offset: query.offset },
        query.type ? "AND json_extract(body, '$.type') = ?" : '',
        query.type ? [query.type] : [],
      ).map((row) => validateStored(ActivityEventSchema, decodeJson(row.body)));
    },
  };
  const handoffs: PlatformRepositories['handoffs'] = {
    async append(input) {
      const record = AgentHandoffSchema.parse(input);
      atomic(() => {
        requireProject(record.projectId);
        if (new Set(record.recordIds).size !== record.recordIds.length)
          throw new PersistenceError('VALIDATION_ERROR', 'Record references must be unique');
        for (const id of record.recordIds)
          if (
            !db
              .prepare('SELECT 1 FROM context_records WHERE id = ? AND project_id = ?')
              .get(id, record.projectId)
          )
            throw new PersistenceError(
              'VALIDATION_ERROR',
              'Handoff references must belong to this project',
            );
        insert('agent_handoffs', record, record);
        for (const id of record.recordIds)
          db.prepare('INSERT INTO handoff_records VALUES (?, ?, ?)').run(
            record.id,
            record.projectId,
            id,
          );
      });
    },
    async list(projectId, options = {}) {
      return rows('agent_handoffs', projectId, options).map((row) =>
        validateStored(AgentHandoffSchema, decodeJson(row.body)),
      );
    },
    async get(projectId, id) {
      const body = scopedBody('agent_handoffs', projectId, id);
      return body === undefined ? undefined : validateStored(AgentHandoffSchema, body);
    },
  };
  const context: PlatformRepositories['context'] = {
    async append(input) {
      const record = ContextRecordSchema.parse(input);
      insert('context_records', record, record);
    },
    async list(projectId, options = {}) {
      return rows('context_records', projectId, options).map((row) =>
        validateStored(ContextRecordSchema, decodeJson(row.body)),
      );
    },
    async get(projectId, id) {
      const body = scopedBody('context_records', projectId, id);
      return body === undefined ? undefined : validateStored(ContextRecordSchema, body);
    },
    listRecords: (projectId, options) => context.list(projectId, options),
    saveHandoff: (handoff) => handoffs.append(handoff),
  };
  function parseServer(input: McpServer) {
    const server = McpServerSchema.parse(input);
    if (server.transport.type === 'http') {
      const url = new URL(server.transport.url);
      if (url.username || url.password)
        throw new PersistenceError('VALIDATION_ERROR', 'Use secretRef instead of URL credentials');
    }
    return server;
  }
  const mcpServers: PlatformRepositories['mcpServers'] = {
    async list(options = {}) {
      const page = PageQuerySchema.parse(options);
      return db
        .prepare('SELECT body FROM mcp_servers ORDER BY julianday(created_at), id LIMIT ? OFFSET ?')
        .all(page.limit, page.offset)
        .map((row) => validateStored(McpServerSchema, decodeJson(row.body)));
    },
    async get(id) {
      IdSchema.parse(id);
      const row = db.prepare('SELECT body FROM mcp_servers WHERE id = ?').get(id);
      return row ? validateStored(McpServerSchema, decodeJson(row.body)) : undefined;
    },
    async register(input) {
      const server = parseServer(input);
      if (db.prepare('SELECT 1 FROM mcp_servers WHERE id = ?').get(server.id))
        throw new PersistenceError('CONFLICT', 'MCP server ID already exists');
      db.prepare('INSERT INTO mcp_servers VALUES (?, ?, ?)').run(
        server.id,
        server.createdAt,
        JSON.stringify(server),
      );
      return server;
    },
    async replace(input) {
      const server = parseServer(input);
      const row = db.prepare('SELECT body FROM mcp_servers WHERE id = ?').get(server.id);
      const previous = row ? validateStored(McpServerSchema, decodeJson(row.body)) : undefined;
      if (!previous) throw new PersistenceError('NOT_FOUND', 'MCP server not found');
      if (previous.createdAt !== server.createdAt)
        throw new PersistenceError('VALIDATION_ERROR', 'createdAt is immutable');
      db.prepare('UPDATE mcp_servers SET body = ? WHERE id = ?').run(
        JSON.stringify(server),
        server.id,
      );
      return server;
    },
    async delete(id) {
      IdSchema.parse(id);
      return Number(db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id).changes) > 0;
    },
  };
  const validation: PlatformRepositories['validation'] = {
    async recordResult(input) {
      const result = ValidationResultSchema.parse(input);
      atomic(() => {
        insert('validation_jobs', result.job, result.job);
        for (const finding of result.findings) {
          // The schema checks project/job matching; the composite FK also enforces it.
          if (db.prepare('SELECT 1 FROM engineering_findings WHERE id = ?').get(finding.id))
            throw new PersistenceError('CONFLICT', 'Finding ID already exists');
          db.prepare('INSERT INTO engineering_findings VALUES (?, ?, ?, ?, ?)').run(
            finding.id,
            finding.projectId,
            finding.jobId,
            finding.createdAt,
            JSON.stringify(finding),
          );
        }
      });
      return result;
    },
    async getJob(projectId, id) {
      const body = scopedBody('validation_jobs', projectId, id);
      return body === undefined ? undefined : validateStored(JobSchema, body);
    },
    async listFindings(projectId, options = {}) {
      const query = FindingQuerySchema.parse(options);
      return rows(
        'engineering_findings',
        projectId,
        { limit: query.limit, offset: query.offset },
        query.jobId ? 'AND job_id = ?' : '',
        query.jobId ? [query.jobId] : [],
      ).map((row) => validateStored(ValidationFindingSchema, decodeJson(row.body)));
    },
  };
  const classification: PlatformRepositories['classification'] = {
    async record(input) {
      const parsed = LayaClassificationResultSchema.parse(input);
      insert(
        'classification_results',
        { id: parsed.id, projectId: parsed.projectId, createdAt: parsed.timestamp },
        parsed,
      );
    },
    async list(projectId, limit = 50) {
      requireProject(projectId);
      const capped = Math.min(Math.max(1, limit), 200);
      return db
        .prepare(
          'SELECT body FROM classification_results WHERE project_id = ? ORDER BY julianday(created_at) DESC, id DESC LIMIT ?',
        )
        .all(projectId, capped)
        .map((row) => validateStored(LayaClassificationResultSchema, decodeJson(row.body)));
    },
  };

  const metrics: PlatformRepositories['metrics'] = {
    async get(projectId) {
      requireProject(projectId);
      const row = db
        .prepare('SELECT body FROM compression_metrics WHERE project_id = ?')
        .get(projectId);
      return row ? validateStored(CompressionMetricsSchema, decodeJson(row.body)) : undefined;
    },
    async record(input) {
      const parsed = CompressionMetricsSchema.parse(input);
      requireProject(parsed.projectId);
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO compression_metrics (project_id, updated_at, body) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET updated_at = excluded.updated_at, body = excluded.body',
      ).run(parsed.projectId, now, JSON.stringify(parsed));
    },
  };

  const snapshots: PlatformRepositories['snapshots'] = {
    async create(input) {
      const parsed = ContextSnapshotSchema.parse(input);
      requireProject(parsed.projectId);
      if (
        db
          .prepare('SELECT 1 FROM context_snapshots WHERE project_id = ? AND (id = ? OR name = ?)')
          .get(parsed.projectId, parsed.id, parsed.name)
      ) {
        throw new PersistenceError(
          'CONFLICT',
          `Snapshot with name "${parsed.name}" already exists`,
        );
      }
      db.prepare(
        'INSERT INTO context_snapshots (id, project_id, name, created_at, body) VALUES (?, ?, ?, ?, ?)',
      ).run(parsed.id, parsed.projectId, parsed.name, parsed.createdAt, JSON.stringify(parsed));
      return parsed;
    },
    async list(projectId) {
      requireProject(projectId);
      return db
        .prepare(
          'SELECT body FROM context_snapshots WHERE project_id = ? ORDER BY julianday(created_at) DESC, id DESC',
        )
        .all(projectId)
        .map((row) => validateStored(ContextSnapshotSchema, decodeJson(row.body)));
    },
    async get(projectId, nameOrId) {
      requireProject(projectId);
      const row = db
        .prepare('SELECT body FROM context_snapshots WHERE project_id = ? AND (id = ? OR name = ?)')
        .get(projectId, nameOrId, nameOrId);
      return row ? validateStored(ContextSnapshotSchema, decodeJson(row.body)) : undefined;
    },
    async delete(projectId, nameOrId) {
      requireProject(projectId);
      return (
        Number(
          db
            .prepare('DELETE FROM context_snapshots WHERE project_id = ? AND (id = ? OR name = ?)')
            .run(projectId, nameOrId, nameOrId).changes,
        ) > 0
      );
    },
  };

  return { events, context, handoffs, mcpServers, validation, classification, metrics, snapshots };
}
