import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  EventCreateSchema,
  ContextRecordCreateSchema,
  HandoffCreateSchema,
  McpServerCreateSchema,
  PageQuerySchema,
  ValidationResultSchema,
} from './index.js';
const timestamp = '2026-11-03T13:00:00.000Z';
const provenance = { sourceKind: 'agent_summary', actor: 'test-agent' };
const event = {
  type: 'decision.recorded',
  actor: 'test-agent',
  sourceKind: 'agent_summary',
  payload: { reason: 'Review required' },
};
describe('persistence contracts', () => {
  it('rejects spoofed server-owned fields while preserving provenance and JSON payloads', () => {
    expect(EventCreateSchema.parse(event)).toEqual(event);
    for (const extra of [
      { id: randomUUID() },
      { projectId: randomUUID() },
      { createdAt: timestamp },
      { schemaVersion: 1 },
    ])
      expect(EventCreateSchema.safeParse({ ...event, ...extra }).success).toBe(false);
    const record = { kind: 'summary', text: 'Unverified assertion', provenance, evidence: [] };
    expect(ContextRecordCreateSchema.parse(record).provenance.sourceKind).toBe('agent_summary');
    expect(ContextRecordCreateSchema.safeParse({ ...record, provenance: undefined }).success).toBe(
      false,
    );
  });
  it('requires unique handoff references and refuses a claimed health result on registration', () => {
    const id = randomUUID();
    expect(
      HandoffCreateSchema.safeParse({
        fromAgentId: randomUUID(),
        summary: 'Continue',
        nextSteps: [],
        provenance,
        recordIds: [id, id],
      }).success,
    ).toBe(false);
    expect(
      McpServerCreateSchema.safeParse({
        name: 'MCP',
        enabled: true,
        transport: { type: 'stdio', executableId: 'local', args: [] },
        status: 'healthy',
      }).success,
    ).toBe(false);
  });
  it('bounds list queries and rejects unsupported query fields', () => {
    expect(PageQuerySchema.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(PageQuerySchema.parse({ limit: '2', offset: '3' })).toEqual({ limit: 2, offset: 3 });
    for (const query of [
      { limit: 0 },
      { limit: 501 },
      { offset: -1 },
      { limit: 'NaN' },
      { limit: 1.5 },
      { extra: 1 },
    ])
      expect(PageQuerySchema.safeParse(query).success).toBe(false);
  });
  it('requires completed, chronologically consistent jobs and scoped unique findings', () => {
    const job = {
      id: randomUUID(),
      projectId: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'failed',
      startedAt: timestamp,
      completedAt: timestamp,
      exitCode: 1,
      stdoutTail: '',
      stderrTail: '',
      artifacts: [],
    };
    const finding = {
      id: randomUUID(),
      projectId: job.projectId,
      jobId: job.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      ruleId: 'test',
      severity: 'error',
      message: 'Fixture',
      expected: 1,
      observed: 2,
      evidence: [{ filePath: 'pins.h' }],
      status: 'open',
      verifiedBy: { tool: 'fixture', version: '1' },
    };
    expect(ValidationResultSchema.safeParse({ job, findings: [finding] }).success).toBe(true);
    for (const patch of [
      { status: 'running' },
      { completedAt: null },
      { completedAt: '2026-11-03T12:00:00.000Z' },
    ])
      expect(
        ValidationResultSchema.safeParse({ job: { ...job, ...patch }, findings: [] }).success,
      ).toBe(false);
    expect(
      ValidationResultSchema.safeParse({ job, findings: [{ ...finding, projectId: randomUUID() }] })
        .success,
    ).toBe(false);
    expect(
      ValidationResultSchema.safeParse({ job, findings: [{ ...finding, jobId: randomUUID() }] })
        .success,
    ).toBe(false);
    expect(ValidationResultSchema.safeParse({ job, findings: [finding, finding] }).success).toBe(
      false,
    );
  });
});
