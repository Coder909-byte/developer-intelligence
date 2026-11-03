import type { ProjectMemory, AgentHandoff, ContextRecord } from '@udi/contracts';
export interface ContextRepository {
  listRecords(projectId: string): Promise<ContextRecord[]>;
  saveHandoff(handoff: AgentHandoff): Promise<void>;
}
export interface ContextEngine {
  getContext(projectId: string, maxItems?: number): Promise<ProjectMemory>;
  createHandoff(handoff: AgentHandoff): Promise<AgentHandoff>;
}
// Developer 2: implement against daemon-injected repositories; no frontend database access.
