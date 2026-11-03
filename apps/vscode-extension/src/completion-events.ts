import type { DaemonClient } from '@udi/client-sdk';
import type { ActivityEvent } from '@udi/contracts';

/** Follow actual daemon observations, including corrections performed in desktop. */
export async function latestCompletionEvent(client: DaemonClient, projectId: string) {
  const types = [
    'engineering.validation.completed',
    'engineering.correction.applied',
    'engineering.correction.rolled_back',
  ];
  const latest = await Promise.all(
    types.map(async (type) => {
      let found: ActivityEvent | undefined;
      for (let offset = 0; ; offset += 500) {
        const page = await client.listEvents(projectId, { type, limit: 500, offset });
        if (page.items.some((e) => e.projectId !== projectId || e.type !== type))
          throw new Error('Event scope mismatch');
        for (const event of page.items) {
          if (
            event.sourceKind === 'observed_tool' &&
            event.sourceRef &&
            ['engineering-core', 'safe-correction-engine'].includes(event.actor)
          )
            found = event;
        }
        if (page.items.length < 500) return found;
      }
    }),
  );
  return latest
    .filter((e): e is ActivityEvent => Boolean(e))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .at(-1);
}
