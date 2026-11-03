import type { DatabaseSync } from 'node:sqlite';

// Never edit an applied migration. Add the next numbered migration instead.
export const migrations = [
  {
    version: 1,
    sql: `
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, description TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE activity_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
    CREATE INDEX activity_events_project_time ON activity_events(project_id, created_at);
  `,
  },
  {
    version: 2,
    sql: `
    CREATE TABLE context_records (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), UNIQUE(id, project_id)
    );
    CREATE INDEX context_records_project_time ON context_records(project_id, created_at, id);
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body))
    );
    CREATE TABLE validation_jobs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), UNIQUE(id, project_id)
    );
    CREATE INDEX validation_jobs_project_time ON validation_jobs(project_id, created_at, id);
    CREATE TABLE engineering_findings (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      FOREIGN KEY(job_id, project_id) REFERENCES validation_jobs(id, project_id) ON DELETE CASCADE
    );
    CREATE INDEX engineering_findings_project_time ON engineering_findings(project_id, created_at, id);
    CREATE INDEX engineering_findings_job ON engineering_findings(project_id, job_id);
    CREATE TABLE agent_handoffs (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), UNIQUE(id, project_id)
    );
    CREATE INDEX agent_handoffs_project_time ON agent_handoffs(project_id, created_at, id);
    CREATE TABLE handoff_records (
      handoff_id TEXT NOT NULL, project_id TEXT NOT NULL, record_id TEXT NOT NULL,
      PRIMARY KEY(handoff_id, record_id),
      FOREIGN KEY(handoff_id, project_id) REFERENCES agent_handoffs(id, project_id) ON DELETE CASCADE,
      FOREIGN KEY(record_id, project_id) REFERENCES context_records(id, project_id) ON DELETE CASCADE
    );
    CREATE INDEX activity_events_project_order ON activity_events(project_id, created_at, id);
  `,
  },
  {
    version: 3,
    sql: `
    CREATE TABLE classification_results (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      body TEXT NOT NULL CHECK(json_valid(body)),
      UNIQUE(id, project_id)
    );
    CREATE INDEX classification_results_project_time ON classification_results(project_id, created_at, id);
    CREATE TABLE compression_metrics (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL,
      body TEXT NOT NULL CHECK(json_valid(body))
    );
  `,
  },
] as const;

export function migrate(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    if (applied.length > migrations.length || applied.some((row, i) => row.version !== i + 1))
      throw new Error('Unknown or noncontiguous database migrations; refusing to downgrade');
    for (const migration of migrations.slice(applied.length)) {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(
        migration.version,
        new Date().toISOString(),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
