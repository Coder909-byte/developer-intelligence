import { randomUUID } from 'node:crypto';
import {
  AgentHandoffSchema,
  ProjectMemorySchema,
  IdSchema,
  type ProjectMemory,
  type AgentHandoff,
  type ContextRecord,
  type ContextRecordCreate,
  type HandoffCreate,
} from '@udi/contracts';

export interface ContextRepository {
  listRecords(projectId: string): Promise<ContextRecord[]>;
  saveHandoff(handoff: AgentHandoff): Promise<void>;
}

export interface ContextEngine {
  getContext(projectId: string, maxItems?: number): Promise<ProjectMemory>;
  createHandoff(handoff: AgentHandoff): Promise<AgentHandoff>;
}

export class DefaultContextEngine implements ContextEngine {
  constructor(private readonly repository: ContextRepository) {}

  async getContext(projectId: string, maxItems = 100): Promise<ProjectMemory> {
    IdSchema.parse(projectId);
    const boundedLimit = Math.max(1, Math.min(maxItems, 500));

    const allRecords = await this.repository.listRecords(projectId);
    // Guarantee records strictly belong to this project
    const scopedRecords = allRecords.filter((r) => r.projectId === projectId);

    // Limit to requested count while keeping chronological order
    const records = scopedRecords.slice(0, boundedLimit);

    // Extract open issues from records of kind 'issue'
    const openIssues = records
      .filter((r) => r.kind === 'issue')
      .map((r) => r.text)
      .filter((text, idx, arr) => arr.indexOf(text) === idx);

    const memory: ProjectMemory = {
      projectId,
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      records,
      openIssues,
    };

    return ProjectMemorySchema.parse(memory);
  }

  async createHandoff(handoff: AgentHandoff): Promise<AgentHandoff> {
    const validated = AgentHandoffSchema.parse(handoff);

    // Verify all referenced records belong to the project
    if (validated.recordIds.length > 0) {
      const records = await this.repository.listRecords(validated.projectId);
      const existingIds = new Set(records.map((r) => r.id));

      for (const recId of validated.recordIds) {
        if (!existingIds.has(recId)) {
          throw new Error(
            `Handoff references nonexistent or cross-project context record: ${recId}`,
          );
        }
      }
    }

    await this.repository.saveHandoff(validated);
    return validated;
  }
}

/**
 * Helper to build a complete ContextRecord entity from create input.
 */
export function buildContextRecord(projectId: string, input: ContextRecordCreate): ContextRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    projectId: IdSchema.parse(projectId),
    createdAt: now,
    updatedAt: now,
    kind: input.kind,
    text: input.text,
    provenance: input.provenance,
    evidence: input.evidence,
  };
}

/**
 * Helper to build a complete AgentHandoff entity from create input.
 */
export function buildAgentHandoff(projectId: string, input: HandoffCreate): AgentHandoff {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    projectId: IdSchema.parse(projectId),
    createdAt: now,
    updatedAt: now,
    fromAgentId: input.fromAgentId,
    ...(input.toAgentId !== undefined ? { toAgentId: input.toAgentId } : {}),
    summary: input.summary,
    recordIds: input.recordIds,
    nextSteps: input.nextSteps,
    provenance: input.provenance,
  };
}

export * from './compressor.js';
export * from './claude-handoff.js';
