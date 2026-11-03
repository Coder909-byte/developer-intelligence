import { useRef, useState } from 'react';
import type { IntegrationItem } from '@udi/contracts';
import { Badge, Card, EmptyState } from '@udi/ui';

export function CategoricalToolHub({
  snapshot,
  inventory,
  onToggle,
}: {
  snapshot?:
    | {
        categories: {
          id: string;
          name: string;
          description: string;
          enabled: boolean;
          toolCount: number;
        }[];
        activeTools: { id: string; name: string; description: string; category: string }[];
        visibilityLabel?: string;
      }
    | undefined;
  inventory: IntegrationItem[] | undefined;
  onToggle?: ((category: string, enabled: boolean) => Promise<void>) | undefined;
}) {
  const [pending, setPending] = useState<string>();
  const lock = useRef(false);
  const [error, setError] = useState('');
  async function toggle(id: string, enabled: boolean) {
    if (!onToggle || lock.current) return;
    lock.current = true;
    setPending(id);
    setError('');
    try {
      await onToggle(id, enabled);
    } catch {
      setError(
        'Category change failed or could not be confirmed. Refresh the policy before trying again.',
      );
    } finally {
      lock.current = false;
      setPending(undefined);
    }
  }
  return (
    <section className="categorical-hub" aria-label="Categorical MCP switchboard">
      <div className="hub-section-intro">
        <p className="eyebrow">COMMUNICATIONS / TOOL SCOPE</p>
        <h2>Your agent’s tools. Your control.</h2>
        <p>Review categories and the tool scope confirmed by the gateway.</p>
      </div>
      <Card title="Categorical switchboard">
        {snapshot?.categories.length ? (
          <div className="category-grid">
            {snapshot.categories.map((category) => (
              <div className="category-switch" key={category.id}>
                <div>
                  <h3>{category.name}</h3>
                  <p>{category.description}</p>
                  <small>{category.toolCount} tools</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label={category.name}
                  aria-checked={category.enabled}
                  disabled={!onToggle || Boolean(pending)}
                  onClick={() => void toggle(category.id, !category.enabled)}
                >
                  <span className="switch-track">
                    <span />
                  </span>
                  {pending === category.id ? 'Saving…' : category.enabled ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Awaiting category policy">
            Tool categories will appear when the gateway provides project permissions.
          </EmptyState>
        )}
        {error && <p role="alert">{error}</p>}
      </Card>
      <Card
        title="Active tool registry"
        action={
          <Badge>
            {snapshot ? `${snapshot.activeTools.length} active tools` : 'Scope unavailable'}
          </Badge>
        }
      >
        {snapshot?.visibilityLabel && <p>{snapshot.visibilityLabel}</p>}
        {snapshot?.activeTools.length ? (
          <div className="active-tools">
            {snapshot.activeTools.map((tool) => (
              <article key={tool.id}>
                <div className="row">
                  <code>{tool.name}</code>
                  <Badge>{tool.category}</Badge>
                </div>
                <p>{tool.description}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={snapshot ? 'No active tools' : 'Awaiting active tool scope'}>
            Only gateway-confirmed tools are shown here.
          </EmptyState>
        )}
      </Card>
      <Card title="Discovered integration inventory">
        <div className="active-tools">
          {inventory?.map((item) => (
            <article key={item.id}>
              <div className="row">
                <strong>{item.name}</strong>
                <Badge>{item.type}</Badge>
                <Badge>{item.status}</Badge>
              </div>
              <p>{item.description}</p>
              {item.availableTools.length > 0 && <pre>{item.availableTools.join('\n')}</pre>}
            </article>
          ))}
          {inventory?.length === 0 && (
            <EmptyState title="No discovered integrations">
              Refresh inventory after registering and discovering an MCP server.
            </EmptyState>
          )}
        </div>
        <small>Discovery records do not establish a connected agent’s active permissions.</small>
        {!inventory && (
          <EmptyState title="Inventory unavailable">
            Refresh the gateway inventory to load discovered integrations.
          </EmptyState>
        )}
      </Card>
    </section>
  );
}
