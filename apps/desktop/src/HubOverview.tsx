import type { DaemonClient } from '@udi/client-sdk';
import { Badge, Button, Card } from '@udi/ui';
import { Result, useResource } from './data.js';

export function HubOverview({
  client,
  onMcp,
  onHosts,
  onMemory,
}: {
  client: DaemonClient;
  onMcp: () => void;
  onHosts: () => void;
  onMemory: () => void;
}) {
  const inventory = useResource(() => client.listMcpServers({ limit: 100, offset: 0 }), [client]);
  return (
    <section className="hub-overview" aria-label="Integration command center">
      <div className="hub-mission">
        <div>
          <p className="eyebrow">UNIVERSAL INTEGRATION HUB</p>
          <h2>
            One command center for your IDEs, MCP servers, tools, and shared agent intelligence.
          </h2>
          <p>
            Connect your tools once. Carry project context between supported hosts. Keep every
            observation traceable.
          </p>
        </div>
        <div className="hub-actions">
          <Button variant="primary" onClick={onMcp}>
            Open MCP Hub
          </Button>
          <Button onClick={onHosts}>Set up a host</Button>
          <Button onClick={onMemory}>Shared intelligence</Button>
        </div>
      </div>
      <Result value={inventory}>
        {({ items }) => (
          <div className="hub-metrics">
            <div>
              <span>Registered MCP servers</span>
              <strong>{items.length}</strong>
              <small>First 100 inventory records</small>
            </div>
            <div>
              <span>Enabled integrations</span>
              <strong>{items.filter((s) => s.enabled).length}</strong>
              <small>Configuration state, not a connection claim</small>
            </div>
            <div>
              <span>Recorded transport health</span>
              <strong>{items.filter((s) => s.enabled && s.status === 'healthy').length}</strong>
              <small>Healthy observations; not fresh MCP handshakes</small>
            </div>
            <div>
              <span>Tools & host connections</span>
              <Badge>Gateway inventory</Badge>
              <small>
                Inspect discovered tools in MCP Hub. Host sessions require verification.
              </small>
            </div>
          </div>
        )}
      </Result>
      <div className="hub-host-paths">
        <span>HOST PATHS</span>
        <span>VS Code / native extension</span>
        <span>OpenCode / manual adapter</span>
        <span>Claude Desktop / manual adapter</span>
        <span>Host sessions unverified</span>
      </div>
      <p className="hub-boundary">
        The ship is your navigation map. Its crew and monitor animations are decorative; integration
        state comes from the local daemon.
      </p>
    </section>
  );
}

export function ToolDiscoveryUnavailable() {
  return (
    <Card title="Discovered tools">
      <Badge tone="warning">Discovery unavailable</Badge>
      <p>
        Registered servers are available in inventory. This engine does not expose discovered tools,
        tool routing or recorded tool-call results yet.
      </p>
      <div className="row">
        <Button disabled title="Requires the daemon discovery API">
          Discover tools
        </Button>
        <Button disabled title="Requires the daemon tool-routing API">
          Route a tool call
        </Button>
      </div>
      <p className="muted">
        No tool list, successful call or permissions state is inferred from server registration or a
        transport probe.
      </p>
    </Card>
  );
}
