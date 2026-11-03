import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { CodexClaudeHandoffSchema } from '@udi/contracts';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup({ sqlite = true, outside = false, rollout = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'udi-codex-convert-'));
  const workspace = join(directory, 'workspace'),
    other = join(directory, 'other'),
    codexHome = join(directory, 'codex');
  for (const path of [workspace, other, join(codexHome, 'sessions')])
    await mkdir(path, { recursive: true });
  const sessionId = randomUUID();
  const rolloutPath = join(codexHome, 'sessions', 'session.jsonl');
  const state = new DatabaseSync(join(codexHome, 'state_5.sqlite'));
  state.exec(
    'CREATE TABLE threads (id TEXT,cwd TEXT,rollout_path TEXT,source TEXT,originator TEXT,updated_at INTEGER)',
  );
  state
    .prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)')
    .run(sessionId, outside ? other : workspace, rolloutPath, 'vscode', 'codex_vscode', 1);
  state.close();
  if (sqlite) {
    const history = new DatabaseSync(join(codexHome, 'thread_history_1.sqlite'));
    history.exec(
      'CREATE TABLE thread_items (thread_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_type TEXT,item_json TEXT)',
    );
    const add = history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?,?)');
    const rows = [
      ['userMessage', { content: [{ type: 'text', text: 'Use GPIO14 for MOTOR_EN' }] }],
      ['agentMessage', { text: 'A proposed change, not a verified pass' }],
      [
        'commandExecution',
        {
          command: 'validate',
          exitCode: 1,
          status: 'completed',
          aggregatedOutput: 'GPIO26 mismatch',
        },
      ],
      ['reasoning', { text: 'PRIVATE_REASONING_MUST_NOT_APPEAR' }],
      ['agentMessage', { text: 'PRIVATE_REASONING_PHASE_MUST_NOT_APPEAR', phase: 'analysis' }],
    ] as const;
    rows.forEach(([type, item], i) =>
      add.run(
        sessionId,
        `item-${i}`,
        i,
        Date.parse('2026-11-04T00:00:00Z') + i,
        type,
        JSON.stringify(item),
      ),
    );
    history.close();
  }
  if (rollout)
    await writeFile(
      rolloutPath,
      [
        {
          timestamp: '2026-11-04T00:00:00Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Actual saved rollout request' }],
          },
        },
        {
          timestamp: '2026-11-04T00:00:01Z',
          type: 'response_item',
          payload: { type: 'reasoning', summary: 'PRIVATE_REASONING' },
        },
        {
          timestamp: '2026-11-04T00:00:01Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            channel: 'analysis',
            content: [{ type: 'output_text', text: 'PRIVATE_REASONING_CHANNEL' }],
          },
        },
        {
          timestamp: '2026-11-04T00:00:02Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Saved assistant response' }],
          },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n',
    );
  const token = 'test-token-for-conversion-only-32-characters';
  const app = buildApp({
    databasePath: join(directory, 'platform.sqlite'),
    token,
    logger: false,
    codexHome,
  });
  await app.ready();
  cleanups.push(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = (url: string, payload: unknown = {}, auth = true) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: { host: '127.0.0.1', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    });
  const project = (await request('/api/v1/projects', { name: 'Rover', rootPath: workspace })).json()
    .data;
  return {
    request,
    url: `/api/v1/projects/${project.id}/context-bridge/codex-to-claude`,
    project,
    directory,
    codexHome,
    rolloutPath,
    sessionId,
  };
}
describe('Authenticated native Codex to Claude conversion', () => {
  it('converts actual native SQLite rows read-only and excludes private reasoning', async () => {
    const env = await setup();
    const before = await readFile(join(env.codexHome, 'thread_history_1.sqlite'));
    const response = await env.request(env.url);
    expect(response.statusCode).toBe(200);
    const handoff = CodexClaudeHandoffSchema.parse(response.json().data);
    expect(handoff.storage).toBe('codex_sqlite');
    expect(handoff.entries.map((entry) => entry.role)).toEqual(['user', 'assistant', 'tool']);
    expect(handoff.markdown).toContain('GPIO26 mismatch');
    expect(handoff.markdown).not.toContain('PRIVATE_REASONING');
    expect(await readFile(join(env.codexHome, 'thread_history_1.sqlite'))).toEqual(before);
  });
  it('never imports a different workspace even when it is the only native session', async () => {
    const env = await setup({ outside: true });
    const response = await env.request(env.url);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('GPIO14');
  });
  it('requires authentication and rejects arbitrary source paths or an unrelated session ID', async () => {
    const env = await setup();
    expect((await env.request(env.url, {}, false)).statusCode).toBe(401);
    expect((await env.request(env.url, { path: '/private/anything' })).statusCode).toBe(400);
    expect((await env.request(env.url, { sessionId: randomUUID() })).statusCode).toBe(404);
  });
  it('supports real rollout format when the active session has no SQLite projection', async () => {
    const env = await setup({ sqlite: false, rollout: true });
    const response = await env.request(env.url);
    expect(response.statusCode).toBe(200);
    expect(response.json().data.storage).toBe('codex_rollout');
    expect(response.json().data.entries).toHaveLength(2);
    expect(response.json().data.markdown).toContain('Actual saved rollout request');
    expect(response.body).not.toContain('PRIVATE_REASONING');
  });
  it('denies a rollout symlink escaping the configured native sessions directory', async () => {
    const env = await setup({ sqlite: false });
    const privateFile = join(env.directory, 'private.jsonl');
    await writeFile(privateFile, 'PRIVATE_DATA');
    await symlink(privateFile, env.rolloutPath);
    expect((await env.request(env.url)).statusCode).toBe(404);
  });
  it('returns an explicit unavailable result for absent session history', async () => {
    const env = await setup({ sqlite: false });
    expect((await env.request(env.url)).statusCode).toBe(404);
  });
  it('keeps the latest user intent when more than 96 later tool events fill the history window', async () => {
    const env = await setup();
    const history = new DatabaseSync(join(env.codexHome, 'thread_history_1.sqlite'));
    const add = history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?,?)');
    for (let index = 5; index < 110; index++)
      add.run(
        env.sessionId,
        `tool-${index}`,
        index,
        Date.parse('2026-11-04T00:00:00Z') + index,
        'commandExecution',
        JSON.stringify({
          command: 'check',
          status: 'completed',
          exitCode: 0,
          aggregatedOutput: 'Observed output',
        }),
      );
    history.close();
    const response = await env.request(env.url);
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .data.entries.some(
          (entry: { role: string; text: string }) =>
            entry.role === 'user' && entry.text.includes('Use GPIO14'),
        ),
    ).toBe(true);
  });
});
