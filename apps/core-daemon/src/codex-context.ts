import { DatabaseSync } from 'node:sqlite';
import { open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  API_PREFIX,
  IdSchema,
  CodexClaudeConvertRequestSchema,
  type Project,
} from '@udi/contracts';
import { PersistenceError, type PlatformDatabase } from '@udi/event-store';
import { buildClaudeHandoff, type NativeContextMessage } from '@udi/context-engine';
import { apiSuccess } from './responses.js';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const missing = () =>
  new PersistenceError(
    'NOT_FOUND',
    'No readable Codex VS Code session exists for this project. Select its registered workspace or open the project in Codex first.',
  );
const textParts = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((part) => object(part).text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n')
    : '';
function date(value: unknown): string | undefined {
  const milliseconds =
    typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  const valueDate = new Date(milliseconds);
  return Number.isFinite(valueDate.getTime()) ? valueDate.toISOString() : undefined;
}

/** Native stores are read-only. All exported content stays in the authenticated response. */
export async function convertCodexContext(
  project: Project,
  codexHome = join(homedir(), '.codex'),
  requestedSession?: string,
) {
  const root = await realpath(project.rootPath);
  let state: DatabaseSync;
  try {
    state = new DatabaseSync(join(codexHome, 'state_5.sqlite'), { readOnly: true });
  } catch {
    throw missing();
  }
  let thread: Record<string, unknown> | undefined;
  try {
    state.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500;');
    // Metadata only: other workspaces' session content is never loaded.
    const rows = state
      .prepare(
        "SELECT id,cwd,rollout_path FROM threads WHERE source='vscode' AND originator='codex_vscode' ORDER BY updated_at DESC LIMIT 1000",
      )
      .all();
    for (const row of rows) {
      if (
        typeof row.id !== 'string' ||
        !IdSchema.safeParse(row.id).success ||
        typeof row.cwd !== 'string' ||
        (requestedSession && row.id !== requestedSession)
      )
        continue;
      try {
        if ((await realpath(row.cwd)) === root) {
          thread = row;
          break;
        }
      } catch {
        /* A deleted workspace does not authorize another workspace. */
      }
    }
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError(
      'VALIDATION_ERROR',
      'The installed Codex session index format could not be read. No source files were changed.',
    );
  } finally {
    state.close();
  }
  if (!thread) throw missing();
  const sessionId = IdSchema.parse(thread.id);
  let messages: NativeContextMessage[] = [];
  let history: DatabaseSync | undefined;
  try {
    history = new DatabaseSync(join(codexHome, 'thread_history_1.sqlite'), { readOnly: true });
    history.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500;');
    const rows = history
      .prepare(
        "SELECT item_id,rollout_ordinal,created_at_ms,item_type,item_json FROM thread_items WHERE thread_id=? AND item_type IN ('userMessage','agentMessage','commandExecution') AND length(item_json)<=524288 ORDER BY rollout_ordinal DESC LIMIT 96",
      )
      .all(sessionId);
    if (!rows.some((row) => row.item_type === 'userMessage')) {
      const latestUser = history
        .prepare(
          "SELECT item_id,rollout_ordinal,created_at_ms,item_type,item_json FROM thread_items WHERE thread_id=? AND item_type='userMessage' AND length(item_json)<=524288 ORDER BY rollout_ordinal DESC LIMIT 1",
        )
        .get(sessionId);
      if (latestUser) rows.push(latestUser);
    }
    for (const row of rows) {
      if (typeof row.item_json !== 'string') continue;
      let item: Record<string, unknown>;
      try {
        item = object(JSON.parse(row.item_json));
      } catch {
        continue;
      }
      const occurredAt = date(row.created_at_ms);
      if (!occurredAt) continue;
      const role =
        row.item_type === 'userMessage'
          ? 'user'
          : row.item_type === 'agentMessage'
            ? 'assistant'
            : 'tool';
      if (role === 'assistant' && (item.phase === 'analysis' || item.channel === 'analysis'))
        continue;
      const text =
        role === 'user'
          ? textParts(item.content)
          : role === 'assistant'
            ? typeof item.text === 'string'
              ? item.text
              : ''
            : JSON.stringify({
                command: item.command,
                status: item.status,
                exitCode: item.exitCode,
                output: item.aggregatedOutput,
              });
      if (text.trim())
        messages.push({
          id: `${sessionId}:${String(row.rollout_ordinal)}:${String(row.item_id)}`.slice(0, 300),
          role,
          occurredAt,
          text,
        });
    }
    if (messages.length)
      return buildClaudeHandoff(project, sessionId, 'codex_sqlite', messages, true);
  } catch {
    /* Current Codex sessions may not have a SQLite projection yet; use their saved rollout. */
  } finally {
    history?.close();
  }

  if (typeof thread.rollout_path !== 'string' || !isAbsolute(thread.rollout_path)) throw missing();
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const path = await realpath(thread.rollout_path);
    const allowed = await realpath(join(codexHome, 'sessions'));
    const rel = relative(allowed, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw missing();
    file = await open(path, 'r');
    const info = await file.stat();
    if (!info.isFile()) throw missing();
    const offset = Math.max(0, info.size - 4 * 1024 * 1024);
    const buffer = Buffer.alloc(Math.min(info.size, 4 * 1024 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    let lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    if (offset) lines = lines.slice(1);
    messages = [];
    for (const line of lines) {
      if (!line || line.length > 524288) continue;
      let event: Record<string, unknown>;
      try {
        event = object(JSON.parse(line));
      } catch {
        continue;
      }
      if (event.type !== 'response_item') continue; // Excludes reasoning and mirrored event notifications.
      const payload = object(event.payload);
      const occurredAt = date(event.timestamp);
      if (!occurredAt) continue;
      let role: NativeContextMessage['role'], text: string;
      if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
        if (
          payload.role === 'assistant' &&
          (payload.channel === 'analysis' || payload.phase === 'analysis')
        )
          continue;
        role = payload.role;
        text = textParts(payload.content);
      } else if (payload.type === 'function_call_output') {
        role = 'tool';
        text =
          typeof payload.output === 'string'
            ? payload.output
            : JSON.stringify(payload.output ?? '');
      } else continue;
      if (!text.trim()) continue;
      const id =
        typeof payload.id === 'string'
          ? payload.id
          : typeof payload.call_id === 'string'
            ? payload.call_id
            : createHash('sha256').update(line).digest('hex').slice(0, 24);
      messages.push({ id: `${sessionId}:${id}`.slice(0, 300), role, occurredAt, text });
    }
    if (!messages.length) throw missing();
    return buildClaudeHandoff(project, sessionId, 'codex_rollout', messages, offset > 0);
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw missing();
  } finally {
    await file?.close();
  }
}

export function registerCodexContextRoutes(
  app: FastifyInstance,
  store: PlatformDatabase,
  codexHome?: string,
) {
  app.post(`${API_PREFIX}/projects/:id/context-bridge/codex-to-claude`, async (request) => {
    const params = object(request.params);
    const id = IdSchema.parse(params.id);
    const project = store.projects.get(id);
    if (!project) throw new PersistenceError('NOT_FOUND', 'Project not found');
    const input = CodexClaudeConvertRequestSchema.parse(request.body);
    const result = await convertCodexContext(project, codexHome, input.sessionId);
    // Do not log/store captured personal text or call an upstream model.
    return apiSuccess(result, request.id);
  });
}
