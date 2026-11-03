import { useState } from 'react';
import { Badge, Button, Card, EmptyState, Field } from '@udi/ui';
import type { DaemonClient } from '@udi/client-sdk';

const targets = [
  {
    id: 'vscode',
    name: 'VS Code Extensions (Cline / Continue / Roo Code)',
    status: 'Native extension available',
    description:
      'Route in-editor AI extensions through the local daemon proxy at http://127.0.0.1:4317/v1 with live context injection.',
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
  {
    id: 'codex',
    name: 'OpenAI Codex & Terminal Harnesses',
    status: 'OpenAI-Compatible Proxy & SSE Streaming',
    description:
      'Export OPENAI_BASE_URL and OPENAI_API_KEY to route all terminal LLM requests through the ground-truth intelligence layer.',
  },
] as const;

export function HostSetup({
  client,
  projectId,
  onSettings,
}: {
  client?: DaemonClient | undefined;
  projectId?: string | undefined;
  onSettings?: (() => void) | undefined;
}) {
  const [host, setHost] = useState<string>('vscode');
  const [copied, setCopied] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState<string>('');
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [savingSnapshot, setSavingSnapshot] = useState<boolean>(false);

  const target = targets.find((t) => t.id === host)!;

  const copyToClipboard = (text: string, label: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(label);
        setTimeout(() => setCopied(null), 2500);
      });
    }
  };

  const handleSaveSnapshot = async () => {
    if (!client || !projectId || !snapshotName.trim()) return;
    setSavingSnapshot(true);
    setSnapshotStatus(null);
    try {
      const snap = await client.createSnapshot(projectId, {
        name: snapshotName.trim(),
        description: 'Captured via Mission Control Host Setup',
      });
      setSnapshotStatus(`✓ Checkpoint "${snap.name}" saved! (${snap.recordCount} facts bundled)`);
      setSnapshotName('');
    } catch (err) {
      setSnapshotStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingSnapshot(false);
    }
  };

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
          <Badge>8 MCP Gateway Tools Active</Badge>
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
            This engine does not yet offer automated server-side host writing. Use the tested
            developer routing scripts below to configure host files safely.
          </p>
        </EmptyState>

        <div className="row">
          <Button disabled>Preview configuration</Button>
          <Button disabled>Approve and apply</Button>
          <Button disabled>Verify host connection</Button>
        </div>

        <div
          style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
        >
          {host === 'vscode' && (
            <div className="setup-box">
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-neon-cyan, #00f0ff)' }}>
                One-Command VS Code Setup
              </h4>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                Run in workspace root to automatically configure <code>.vscode/mcp.json</code> and{' '}
                <code>.vscode/settings.json</code> for Cline, Continue, and Roo Code:
              </p>
              <pre
                style={{
                  background: '#0b0d13',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  overflowX: 'auto',
                }}
              >
                node scripts/route.mjs vscode
              </pre>
              <Button
                onClick={() => copyToClipboard('node scripts/route.mjs vscode', 'vscode-cmd')}
              >
                {copied === 'vscode-cmd' ? 'Copied to Clipboard!' : 'Copy Setup Command'}
              </Button>
            </div>
          )}

          {host === 'claude_desktop' && (
            <div className="setup-box">
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-neon-cyan, #00f0ff)' }}>
                Claude Code MCP Connection
              </h4>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                Register Developer Intelligence directly in Claude Code CLI:
              </p>
              <pre
                style={{
                  background: '#0b0d13',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  overflowX: 'auto',
                }}
              >
                claude mcp add developer-intelligence -- node packages/mcp-gateway/dist/cli.js
              </pre>
              <Button
                onClick={() =>
                  copyToClipboard(
                    'claude mcp add developer-intelligence -- node packages/mcp-gateway/dist/cli.js',
                    'claude-cmd',
                  )
                }
              >
                {copied === 'claude-cmd' ? 'Copied to Clipboard!' : 'Copy Claude MCP Command'}
              </Button>
            </div>
          )}

          {host === 'codex' && (
            <div className="setup-box">
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-neon-cyan, #00f0ff)' }}>
                Terminal Agent Environment Routing
              </h4>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                Source this export to route all terminal CLI agents through the proxy:
              </p>
              <pre
                style={{
                  background: '#0b0d13',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  overflowX: 'auto',
                }}
              >
                source scripts/export-env.sh
              </pre>
              <Button onClick={() => copyToClipboard('source scripts/export-env.sh', 'shell-cmd')}>
                {copied === 'shell-cmd' ? 'Copied to Clipboard!' : 'Copy Shell Export'}
              </Button>
            </div>
          )}

          {host === 'opencode' && (
            <div className="setup-box">
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-neon-cyan, #00f0ff)' }}>
                OpenCode Stdio Gateway
              </h4>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>
                Configure <code>opencode.json</code> with the stdio MCP bridge:
              </p>
              <pre
                style={{
                  background: '#0b0d13',
                  padding: '0.75rem',
                  borderRadius: '4px',
                  overflowX: 'auto',
                }}
              >
                node scripts/route.mjs vscode
              </pre>
            </div>
          )}
        </div>
      </Card>

      <Card title="Context Checkpoints (Game-Save Slots)">
        <p>
          Save the current verified session state into an immutable named checkpoint. Any external
          agent can load this checkpoint via header <code>x-context-snapshot: &lt;name&gt;</code> or
          MCP tool <code>load_context_snapshot</code> for zero-discovery continuation.
        </p>

        <div className="row" style={{ alignItems: 'flex-end', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <Field label="Checkpoint Name">
              <input
                type="text"
                placeholder="e.g. rover-gpio-fixed"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
              />
            </Field>
          </div>
          <Button
            onClick={handleSaveSnapshot}
            disabled={savingSnapshot || !snapshotName.trim() || !projectId}
          >
            {savingSnapshot ? 'Saving...' : 'Save Checkpoint'}
          </Button>
        </div>

        {snapshotStatus && (
          <p
            style={{
              marginTop: '0.5rem',
              color: snapshotStatus.startsWith('✓') ? '#10b981' : '#f87171',
            }}
          >
            {snapshotStatus}
          </p>
        )}

        {onSettings && (
          <div style={{ marginTop: '1rem' }}>
            <Button onClick={onSettings}>Daemon connection settings</Button>
          </div>
        )}
      </Card>
    </>
  );
}
