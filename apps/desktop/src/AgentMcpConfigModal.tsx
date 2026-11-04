import { useState } from 'react';
import { Button, Card, Dialog, Badge, Field } from '@udi/ui';

export function AgentMcpConfigModal({
  token,
  baseUrl = 'http://127.0.0.1:4317',
  projectId,
  onClose,
}: {
  token?: string | undefined;
  baseUrl?: string | undefined;
  projectId?: string | undefined;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'antigravity_http' | 'antigravity_stdio' | 'claude_desktop' | 'cursor' | 'hermes'>('antigravity_http');
  const [copied, setCopied] = useState(false);

  const displayToken = token || 'YOUR_LOCAL_DAEMON_TOKEN_32_CHARS';
  const displayProject = projectId || 'DEFAULT_PROJECT_UUID';

  const configs: Record<typeof activeTab, { title: string; filename: string; code: string; language: string }> = {
    antigravity_http: {
      title: 'Antigravity / Universal HTTP JSON-RPC',
      filename: 'mcp_config.json',
      language: 'json',
      code: JSON.stringify(
        {
          mcpServers: {
            'developer-intelligence-gateway': {
              url: `${baseUrl}/mcp`,
              headers: {
                Authorization: `Bearer ${displayToken}`,
                'x-project-id': displayProject,
              },
            },
          },
        },
        null,
        2,
      ),
    },
    antigravity_stdio: {
      title: 'Antigravity / Stdio Gateway CLI',
      filename: 'mcp_config.json',
      language: 'json',
      code: JSON.stringify(
        {
          mcpServers: {
            'developer-intelligence-gateway': {
              command: 'node',
              args: [
                '/home/fev/GitRepos/developer-intelligence/packages/mcp-gateway/dist/cli.js',
                '--url',
                baseUrl,
                '--token',
                displayToken,
                '--project-id',
                displayProject,
              ],
            },
          },
        },
        null,
        2,
      ),
    },
    claude_desktop: {
      title: 'Claude Desktop App',
      filename: 'claude_desktop_config.json',
      language: 'json',
      code: JSON.stringify(
        {
          mcpServers: {
            'developer-intelligence': {
              command: 'node',
              args: [
                '/home/fev/GitRepos/developer-intelligence/packages/mcp-gateway/dist/cli.js',
                '--url',
                baseUrl,
                '--token',
                displayToken,
                '--project-id',
                displayProject,
              ],
            },
          },
        },
        null,
        2,
      ),
    },
    cursor: {
      title: 'Cursor / Continue / Roo Code (.vscode/mcp.json)',
      filename: '.vscode/mcp.json',
      language: 'json',
      code: JSON.stringify(
        {
          servers: [
            {
              name: 'developer-intelligence-gateway',
              url: `${baseUrl}/mcp`,
              headers: {
                Authorization: `Bearer ${displayToken}`,
                'x-project-id': displayProject,
              },
            },
          ],
        },
        null,
        2,
      ),
    },
    hermes: {
      title: 'Hermes Agent (~/.hermes/config.yaml)',
      filename: '~/.hermes/config.yaml',
      language: 'yaml',
      code: `# Hermes Agent MCP Gateway Registration
mcp:
  developer-intelligence:
    url: "${baseUrl}/mcp"
    headers:
      Authorization: "Bearer ${displayToken}"
      x-project-id: "${displayProject}"`,
    },
  };

  const current = configs[activeTab];

  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(current.code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <Dialog title="Export Agent MCP Configuration" onClose={onClose}>
      <div style={{ display: 'grid', gap: '16px' }}>
        <p style={{ margin: 0, color: '#94a3b8' }}>
          Connect any external coding harness directly to the Universal Developer Intelligence Gateway.
          All 11 built-in platform tools and aggregated external servers (Google Stitch, KiCad, PlatformIO)
          are dynamically exposed according to your active switchboard toggles.
        </p>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button
            variant={activeTab === 'antigravity_http' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('antigravity_http')}
          >
            Antigravity (HTTP)
          </Button>
          <Button
            variant={activeTab === 'antigravity_stdio' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('antigravity_stdio')}
          >
            Antigravity (Stdio)
          </Button>
          <Button
            variant={activeTab === 'claude_desktop' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('claude_desktop')}
          >
            Claude Desktop
          </Button>
          <Button
            variant={activeTab === 'cursor' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('cursor')}
          >
            Cursor / VS Code
          </Button>
          <Button
            variant={activeTab === 'hermes' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('hermes')}
          >
            Hermes Agent
          </Button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <strong>{current.title}</strong>
            <Badge>{current.filename}</Badge>
          </div>
          <Button variant="primary" onClick={handleCopy}>
            {copied ? '✓ Copied to Clipboard!' : 'Copy Config'}
          </Button>
        </div>

        <pre
          style={{
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            padding: '16px',
            fontFamily: 'Consolas, monospace',
            fontSize: '13px',
            color: '#38bdf8',
            overflowX: 'auto',
            maxHeight: '320px',
            lineHeight: '1.5',
            margin: 0,
          }}
        >
          {current.code}
        </pre>

        <div
          style={{
            padding: '12px 16px',
            background: '#131b2e',
            border: '1px solid #1d4ed8',
            borderRadius: '6px',
            display: 'grid',
            gap: '4px',
            fontSize: '12px',
            color: '#cbd5e1',
          }}
        >
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>✦ Dynamic Switchboard Control:</span>
            <span>Zero agent restarts required</span>
          </div>
          <p style={{ margin: 0, color: '#94a3b8' }}>
            When you flip category switches in the MCP Hub tab, connected agents automatically receive
            updated <code>tools/list</code> inventories on their subsequent turns without restarting.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
