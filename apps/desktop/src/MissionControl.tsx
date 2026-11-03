import type { DaemonClient } from '@udi/client-sdk';
import { Button, Card } from '@udi/ui';
import { useResource, Result } from './data.js';
import { ContextCompressionInspector } from './ContextCompressionInspector.js';
import { CategoricalToolHub } from './CategoricalToolHub.js';
import type { MissionControlSource } from './mission-control.js';

export function ContextInspectorScreen({
  client,
  projectId,
  source,
}: {
  client: DaemonClient;
  projectId: string;
  source: MissionControlSource | undefined;
}) {
  const data = useResource(async () => {
    const [events, inspection] = await Promise.all([
      client.listEvents(projectId, { limit: 100, offset: 0 }),
      source?.inspect(projectId),
    ]);
    if (events.items.some((event) => event.projectId !== projectId))
      throw new Error('Project scope mismatch');
    return { events: events.items, inspection };
  }, [client, projectId, source]);
  return (
    <>
      <div className="row">
        <Button onClick={data.retry}>Refresh inspection</Button>
        <small>Loaded snapshot · first 100 stored events</small>
      </div>
      <Result value={data}>{(value) => <ContextCompressionInspector {...value} />}</Result>
    </>
  );
}

export function ToolHubScreen({
  client,
  projectId,
  source,
}: {
  client: DaemonClient;
  projectId: string | undefined;
  source: MissionControlSource | undefined;
}) {
  const inventory = useResource(() => client.listIntegrations(), [client]);
  const data = useResource(
    async () => ({
      snapshot: projectId ? await source?.tools(projectId) : undefined,
    }),
    [client, projectId, source],
  );
  return (
    <>
      <Card title="Gateway inventory">
        <Button
          onClick={() => {
            inventory.retry();
            data.retry();
          }}
        >
          Refresh tool inventory
        </Button>
      </Card>
      <Result value={data}>
        {(value) => (
          <CategoricalToolHub
            {...value}
            inventory={inventory.state.status === 'ready' ? inventory.state.data.items : undefined}
            onToggle={
              source && projectId
                ? async (category, enabled) => {
                    await source.toggle(projectId, category, enabled);
                    // Re-read authoritative scope; never claim a change from a local filter.
                    await data.retry();
                  }
                : undefined
            }
          />
        )}
      </Result>
      {inventory.state.status !== 'ready' && <Result value={inventory}>{() => null}</Result>}
    </>
  );
}
