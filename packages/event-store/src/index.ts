import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';
import { createPlatformRepositories } from './repositories.js';
export * from './repositories.js';
import { randomUUID } from 'node:crypto';
import {
  ProjectSchema,
  type Project,
  type ProjectCreate,
  type ProjectUpdate,
  type ActivityEvent,
} from '@udi/contracts';
export interface EventStore {
  append(event: ActivityEvent): Promise<void>;
  list(projectId: string, limit?: number): Promise<ActivityEvent[]>;
}
export interface ProjectRepository {
  list(): Project[];
  get(id: string): Project | undefined;
  create(input: ProjectCreate): Project;
  update(id: string, input: ProjectUpdate): Project | undefined;
  delete(id: string): boolean;
}
/** Daemon-owned SQLite connection. Algorithms consume repositories; only the daemon opens SQLite. */
export function openDatabase(filename: string) {
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  function decode(
    row: ReturnType<ReturnType<DatabaseSync['prepare']>['get']>,
  ): Project | undefined {
    if (!row) return undefined;
    return ProjectSchema.parse({
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  const projects: ProjectRepository = {
    list: () =>
      db
        .prepare('SELECT * FROM projects ORDER BY created_at, id')
        .all()
        .map((row) => decode(row)!),
    get: (id) => decode(db.prepare('SELECT * FROM projects WHERE id = ?').get(id)),
    create: (input) => {
      const timestamp = new Date().toISOString();
      const project = ProjectSchema.parse({
        ...input,
        id: randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)').run(
        project.id,
        project.name,
        project.rootPath,
        project.description,
        timestamp,
        timestamp,
      );
      return project;
    },
    update: (id, input) => {
      const previous = projects.get(id);
      if (!previous) return undefined;
      const project = ProjectSchema.parse({
        ...previous,
        ...input,
        updatedAt: new Date().toISOString(),
      });
      db.prepare(
        'UPDATE projects SET name = ?, root_path = ?, description = ?, updated_at = ? WHERE id = ?',
      ).run(project.name, project.rootPath, project.description, project.updatedAt, id);
      return project;
    },
    delete: (id) => Number(db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes) > 0,
  };
  return { projects, ...createPlatformRepositories(db), close: () => db.close() };
}
export type PlatformDatabase = ReturnType<typeof openDatabase>;
