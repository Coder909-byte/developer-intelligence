import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Field } from '@udi/ui';

// Audited adapter targets from packages/mcp-gateway/src/host-adapters.ts.
// These are implementation capabilities, never discovered/connected host sessions.
const targets = [
  {
    id: 'vscode',
    name: 'VS Code',
    status: 'Native extension available',
    description:
      'Use the existing Developer Intelligence sidebar with the same registered workspace and daemon token.',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    status: 'Manual configuration; host verification pending',
    description:
      'A configuration adapter exists. A real OpenCode session must be verified before claiming host compatibility.',
  },
  {
    id: 'claude_desktop',
    name: 'Claude Desktop',
    status: 'Manual configuration; host verification pending',
    description:
      'A configuration adapter exists. Installation, configuration and a real host handshake have not been verified by this dashboard.',
  },
] as const;
export function HostSetup({ onSettings }: { onSettings?: () => void }) {
  const [host, setHost] = useState<string>('vscode');
  const target = targets.find((t) => t.id === host)!;
  return (
    <>
      <Card title="Host compatibility & setup">
        <p>
          Choose a supported configuration target. Adapter availability is separate from a connected
          or verified host.
        </p>
        <Field label="Configuration target">
          <select value={host} onChange={(e) => setHost(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="row">
          <Badge>{target.status}</Badge>
          <Badge>Host connection status unavailable</Badge>
        </div>
        <p>{target.description}</p>
        <ol className="host-steps" aria-label="Host setup stages">
          <li aria-current="step">1. Choose host</li>
          <li>2. Review configuration</li>
          <li>3. Approve changes</li>
          <li>4. Apply configuration</li>
          <li>5. Verify host connection</li>
        </ol>
        <EmptyState title="Host configuration service unavailable">
          <p>
            This engine does not yet offer configuration preview, approval/apply or host
            verification. No host files have been changed.
          </p>
        </EmptyState>
        <div className="row">
          <Button disabled>Preview configuration</Button>
          <Button disabled>Approve and apply</Button>
          <Button disabled>Verify host connection</Button>
        </div>
        <p className="muted">
          Preview and explicit approval will be required before any future host-file write. Other
          IDEs and proprietary agent sessions are not automatically connected.
        </p>
      </Card>
      <Card
        title={host === 'vscode' ? 'VS Code manual connection' : 'Manual host connection checklist'}
      >
        {host === 'vscode' ? (
          <ol className="setup-steps">
            <li>Install or launch the existing Developer Intelligence extension in VS Code.</li>
            <li>Open the same workspace registered with this daemon.</li>
            <li>
              Run <strong>Developer Intelligence: Set Daemon Token</strong>.
            </li>
            <li>
              Run <strong>Developer Intelligence: Check Daemon Connection</strong>, then select the
              matching project.
            </li>
            <li>
              Retrieve Project Context or a saved handoff. Verify the result in the actual IDE
              before reporting a connected host.
            </li>
          </ol>
        ) : (
          <ol className="setup-steps">
            <li>
              Use the project's documented MCP gateway and the chosen host's actual configuration
              format.
            </li>
            <li>
              Supply the daemon URL and explicit project UUID. Keep credentials out of URLs and
              public configuration.
            </li>
            <li>Review the generated configuration and its target path before any manual write.</li>
            <li>
              Perform a real initialize/tools-list handshake and a scoped context request in that
              host.
            </li>
            <li>
              Only then mark that host verified in the team runtime report. This dashboard cannot
              verify it yet.
            </li>
          </ol>
        )}
        {onSettings && <Button onClick={onSettings}>Daemon connection settings</Button>}
        <p className="muted">
          A connected daemon or a successful transport probe does not prove that an IDE or agent
          host is connected.
        </p>
      </Card>
    </>
  );
}
