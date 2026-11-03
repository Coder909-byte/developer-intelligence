import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildClaudeHandoff, type NativeContextMessage } from './claude-handoff.js';
const now = '2026-11-04T00:00:00.000Z';
const project = {
  id: randomUUID(),
  name: 'Rover',
  rootPath: '/workspace/rover',
  description: '',
  createdAt: now,
  updatedAt: now,
};
const sessionId = randomUUID();
const message = (
  role: NativeContextMessage['role'],
  text: string,
  index = 0,
): NativeContextMessage => ({
  id: `source-${index}`,
  role,
  text,
  occurredAt: new Date(Date.parse(now) + index * 1000).toISOString(),
});
describe('Claude Code compatible context handoff', () => {
  it('carries actual message content with explicit roles, original time and source identity', () => {
    const result = buildClaudeHandoff(project, sessionId, 'codex_sqlite', [
      message('user', 'Keep GPIO14'),
      message('assistant', 'A proposed fix', 1),
      message('tool', 'Exit code: 1', 2),
    ]);
    expect(result.entries.map((entry) => entry.text)).toEqual([
      'Keep GPIO14',
      'A proposed fix',
      'Exit code: 1',
    ]);
    for (const text of [
      'user_entered:codex-user',
      'agent_summary:codex',
      'observed_tool:codex-tool',
      now,
      'source-0',
    ])
      expect(result.markdown).toContain(text);
    expect(result.nativeClaudeSessionVerified).toBe(false);
    expect(result.importLine).toBe('@./codex-claude-context.md');
    expect(result.stats.truncatedMessages).toBe(0);
  });
  it('bounds long history, retains the latest user intent and declares omissions/truncation', () => {
    const messages = [
      message('user', 'Important final user intent', 0),
      ...Array.from({ length: 40 }, (_, i) => message('tool', 'scrollback '.repeat(1000), i + 1)),
    ];
    const result = buildClaudeHandoff(project, sessionId, 'codex_rollout', messages, true);
    expect(result.entries.some((entry) => entry.text === 'Important final user intent')).toBe(true);
    expect(result.entries.length).toBeLessThanOrEqual(24);
    expect(result.markdown.length).toBeLessThan(40000);
    expect(result.stats.omittedMessages).toBeGreaterThan(0);
    expect(result.stats.truncatedMessages).toBeGreaterThan(0);
    expect(result.stats.sourceWindowLimited).toBe(true);
    expect(result.markdown).toContain('[Excerpt truncated locally]');
  });
  it('keeps at-paths inside code fences even when the original message contains Markdown fences', () => {
    const result = buildClaudeHandoff(
      { ...project, name: '@private-project' },
      sessionId,
      'codex_sqlite',
      [message('user', '```\n@/private/file\n```\n~~~\n@other\n~~~')],
    );
    expect(result.markdown).toContain('Project: `@private-project`');
    expect(result.markdown).toContain('````text\n```\n@/private/file');
    expect(result.entries[0]!.text).toContain('@/private/file');
  });
  it('fails explicitly for absent meaningful context instead of creating a success placeholder', () => {
    expect(() => buildClaudeHandoff(project, sessionId, 'codex_sqlite', [])).toThrow('No readable');
  });
});
