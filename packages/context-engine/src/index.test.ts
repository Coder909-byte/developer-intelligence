import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ContextRecord, AgentHandoff } from '@udi/contracts';
import {
  DefaultContextEngine,
  buildContextRecord,
  buildAgentHandoff,
  type ContextRepository,
} from './index.js';

describe('DefaultContextEngine', () => {
  const projectId = randomUUID();
  const agentA = randomUUID();
  const agentB = randomUUID();

  function createInMemoryRepository(): ContextRepository & {
    records: ContextRecord[];
    savedHandoffs: AgentHandoff[];
  } {
    const records: ContextRecord[] = [];
    const savedHandoffs: AgentHandoff[] = [];

    return {
      records,
      savedHandoffs,
      async listRecords(pId: string) {
        return records.filter((r) => r.projectId === pId);
      },
      async saveHandoff(handoff: AgentHandoff) {
        savedHandoffs.push(handoff);
      },
    };
  }

  it('synthesizes project context memory with provenance and open issues', async () => {
    const repo = createInMemoryRepository();
    const factRecord = buildContextRecord(projectId, {
      kind: 'fact',
      text: 'KiCad netlist specifies MOTOR_EN on GPIO14',
      provenance: { sourceKind: 'observed_tool', actor: 'engineering-core' },
      evidence: [{ filePath: 'rover.net', line: 29 }],
    });
    const decisionRecord = buildContextRecord(projectId, {
      kind: 'decision',
      text: 'Do not re-route PCB; update firmware header instead',
      provenance: { sourceKind: 'user_entered', actor: 'developer-fev' },
      evidence: [],
    });
    const issueRecord = buildContextRecord(projectId, {
      kind: 'issue',
      text: 'Firmware pin mismatch: src/pins.h defines MOTOR_EN as GPIO26',
      provenance: { sourceKind: 'observed_tool', actor: 'engineering-core' },
      evidence: [{ filePath: 'src/pins.h', line: 6 }],
    });

    repo.records.push(factRecord, decisionRecord, issueRecord);

    const engine = new DefaultContextEngine(repo);
    const memory = await engine.getContext(projectId);

    expect(memory.projectId).toBe(projectId);
    expect(memory.schemaVersion).toBe(1);
    expect(memory.records).toHaveLength(3);
    expect(memory.openIssues).toEqual([
      'Firmware pin mismatch: src/pins.h defines MOTOR_EN as GPIO26',
    ]);

    // Verify provenance preservation
    expect(memory.records[0]?.provenance.sourceKind).toBe('observed_tool');
    expect(memory.records[1]?.provenance.sourceKind).toBe('user_entered');
    expect(memory.records[1]?.provenance.actor).toBe('developer-fev');
  });

  it('bounds maxItems in context retrieval', async () => {
    const repo = createInMemoryRepository();
    for (let i = 0; i < 10; i++) {
      repo.records.push(
        buildContextRecord(projectId, {
          kind: 'fact',
          text: `Fact ${i}`,
          provenance: { sourceKind: 'agent_summary', actor: 'agent-1' },
          evidence: [],
        }),
      );
    }

    const engine = new DefaultContextEngine(repo);
    const memory = await engine.getContext(projectId, 4);

    expect(memory.records).toHaveLength(4);
    expect(memory.records[0]?.text).toBe('Fact 0');
    expect(memory.records[3]?.text).toBe('Fact 3');
  });

  it('creates and verifies agent handoff referencing valid context records', async () => {
    const repo = createInMemoryRepository();
    const record = buildContextRecord(projectId, {
      kind: 'decision',
      text: 'Update motor pin config to match netlist',
      provenance: { sourceKind: 'user_entered', actor: 'dev' },
      evidence: [],
    });
    repo.records.push(record);

    const engine = new DefaultContextEngine(repo);
    const handoff = buildAgentHandoff(projectId, {
      fromAgentId: agentA,
      toAgentId: agentB,
      summary: 'Completed KiCad netlist verification; proceed with firmware patch',
      recordIds: [record.id],
      nextSteps: ['Patch src/pins.h line 6 to GPIO14', 'Run platformio build check'],
      provenance: { sourceKind: 'agent_summary', actor: 'agent-A' },
    });

    const result = await engine.createHandoff(handoff);
    expect(result.id).toBe(handoff.id);
    expect(repo.savedHandoffs).toHaveLength(1);
    expect(repo.savedHandoffs[0]?.summary).toBe(handoff.summary);
  });

  it('rejects handoff referencing nonexistent record IDs', async () => {
    const repo = createInMemoryRepository();
    const engine = new DefaultContextEngine(repo);

    const handoff = buildAgentHandoff(projectId, {
      fromAgentId: agentA,
      toAgentId: agentB,
      summary: 'Handoff with bad reference',
      recordIds: [randomUUID()],
      nextSteps: [],
      provenance: { sourceKind: 'agent_summary', actor: 'agent-A' },
    });

    await expect(engine.createHandoff(handoff)).rejects.toThrow(/nonexistent or cross-project/);
  });
});
