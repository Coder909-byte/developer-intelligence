import type { DaemonClient } from '@udi/client-sdk';
import type { AgentHandoff } from '@udi/contracts';
export async function latestStoredHandoff(
  client: DaemonClient,
  projectId: string,
): Promise<AgentHandoff | undefined> {
  let latest: AgentHandoff | undefined;
  for (let offset = 0; offset <= 1000000; offset += 500) {
    const { items } = await client.listHandoffs(projectId, { limit: 500, offset });
    if (items.some((h) => h.projectId !== projectId)) throw new Error('Project scope mismatch');
    latest = items.at(-1) ?? latest;
    if (items.length < 500) return latest;
  }
  throw new Error('History exceeds pagination range');
}
