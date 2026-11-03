import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ActivityEvent, ValidationFinding } from '@udi/contracts';
import {
  buildContextRecord,
  buildDeterministicDelta,
  buildDistilledRollup,
  estimateTokens,
  CompressionUnavailableError,
} from './index.js';
const projectId = randomUUID(),
  jobId = randomUUID(),
  now = '2026-11-04T00:00:00.000Z';
const finding: ValidationFinding = {
  id: randomUUID(),
  projectId,
  jobId,
  createdAt: now,
  updatedAt: now,
  ruleId: 'pin_consistency',
  severity: 'error',
  message: 'MOTOR_EN mismatch',
  expected: { signal: 'MOTOR_EN', pin: 'GPIO14', component: 'U2', mcuPin: '12' },
  observed: { pin: 'GPIO26' },
  evidence: [
    { filePath: 'rover.net', line: 28 },
    { filePath: 'src/pins.h', line: 7 },
  ],
  status: 'open',
  verifiedBy: { tool: 'engineering-core', version: '1' },
};
const record = (
  text: string,
  kind: 'fact' | 'decision' = 'fact',
  sourceKind: 'observed_tool' | 'user_entered' | 'agent_summary' = 'observed_tool',
) =>
  buildContextRecord(projectId, {
    text,
    kind,
    provenance: { sourceKind, actor: 'test' },
    evidence: [],
  });
describe('Spec 2 dual-mode context compression', () => {
  it('compresses 10,000 characters of scrollback below 500 chars / 150 tokens and 90% savings without losing GPIO14 or component evidence', () => {
    const input = {
      projectId,
      projectName: 'rover-demo',
      records: [record('compiler noise '.repeat(800))],
      findings: [finding],
    };
    const result = buildDeterministicDelta(input);
    expect(result.injectedBlock.length).toBeLessThan(500);
    expect(result.compressedTokensEstimate).toBeLessThan(150);
    expect(result.savingsPercent).toBeGreaterThanOrEqual(90);
    expect(result.activeInvariants).toContain('MOTOR_EN=GPIO14');
    expect(result.injectedBlock).toContain('U2 pin 12');
    expect(result.injectedBlock).toContain('rover.net:28');
    expect(result.injectedBlock).toContain('src/pins.h:7');
    expect(result.injectedBlock).toContain('GPIO26');
    expect(result.injectedBlock).toBe(buildDeterministicDelta(input).injectedBlock);
  });
  it('keeps authoritative decisions, excludes agent claims and resolved findings, and never infers a pass from empty findings', () => {
    const result = buildDeterministicDelta({
      projectId,
      records: [
        record('Patch firmware only', 'decision', 'user_entered'),
        record('Hardware is safe', 'decision', 'agent_summary'),
      ],
      findings: [{ ...finding, status: 'resolved' }],
    });
    expect(result.injectedBlock).toContain('Patch firmware only');
    expect(result.injectedBlock).not.toContain('Hardware is safe');
    expect(result.openIssuesCount).toBe(0);
    expect(result.injectedBlock).toContain('No verified current validation pass');
  });
  it('uses the current validation job rather than historical open errors', () => {
    const result = buildDeterministicDelta({
      projectId,
      records: [],
      findings: [finding],
      latestJob: {
        id: randomUUID(),
        projectId,
        createdAt: now,
        updatedAt: now,
        status: 'succeeded',
        startedAt: now,
        completedAt: now,
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        artifacts: [],
      },
    });
    expect(result.openIssuesCount).toBe(0);
    expect(result.injectedBlock).toContain('Latest validation succeeded');
    expect(result.injectedBlock).not.toContain('GPIO26');
  });
  it('keeps the latest authoritative binding and gives current validator evidence priority', () => {
    const records = [
      { ...record('MOTOR_EN=GPIO26'), createdAt: '2026-11-03T00:00:00.000Z' },
      { ...record('MOTOR_EN=GPIO14'), createdAt: now },
    ];
    expect(buildDeterministicDelta({ projectId, records, findings: [] }).activeInvariants).toEqual([
      'MOTOR_EN=GPIO14',
    ]);
    expect(
      buildDeterministicDelta({ projectId, records: records.slice(0, 1), findings: [finding] })
        .activeInvariants,
    ).toEqual(['MOTOR_EN=GPIO14']);
  });
  it('rejects cross-project input and handles empty token estimates honestly', () => {
    expect(() =>
      buildDeterministicDelta({
        projectId,
        records: [],
        findings: [{ ...finding, projectId: randomUUID() }],
      }),
    ).toThrow('scope');
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('12345')).toBe(2);
  });
  it('rolls up classified events chronologically above ten turns, preserving original provenance and excluding noise', () => {
    const event = (
      category: string,
      text: string,
      score: number,
      sourceKind: ActivityEvent['sourceKind'] = 'observed_tool',
      createdAt = now,
    ): ActivityEvent => ({
      id: randomUUID(),
      projectId,
      type: 'context.classified',
      actor: sourceKind === 'agent_summary' ? 'opencode' : 'engineering-core',
      sourceKind,
      createdAt,
      schemaVersion: 1,
      payload: { category, distilledFact: text, signalScore: score, decision: 'preserve' },
    });
    const result = buildDistilledRollup({
      projectId,
      records: [],
      findings: [finding],
      sessionTurns: 11,
      events: [
        event('ARCHITECTURAL_DECISION', 'Review proposed patch', 0.8, 'agent_summary'),
        event('HARDWARE_SPEC', 'MOTOR_EN=GPIO14', 0.95),
        event('VALIDATED_OUTCOME', 'Validation failed', 0.9),
        event('EPHEMERAL_NOISE', 'compiler spam', 0.99),
        event('HARDWARE_SPEC', 'low score', 0.69),
      ],
    });
    expect(result.mode).toBe('ai_distillation');
    expect(result.injectedBlock).toContain('What was completed');
    expect(result.injectedBlock).toContain('[observed_tool:engineering-core]');
    expect(result.injectedBlock).toContain('[agent_summary:opencode]');
    expect(result.injectedBlock).not.toContain('compiler spam');
    expect(result.injectedBlock).not.toContain('low score');
  });
  it('falls back below the turn threshold and reports missing classified input above it', () => {
    expect(
      buildDistilledRollup({ projectId, records: [], findings: [], sessionTurns: 10 }).mode,
    ).toBe('deterministic_delta');
    expect(() =>
      buildDistilledRollup({ projectId, records: [], findings: [], sessionTurns: 11 }),
    ).toThrow(CompressionUnavailableError);
  });
});
