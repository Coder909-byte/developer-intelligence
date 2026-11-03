import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@udi/client-sdk';
import { buildApp } from './app.js';
import { createDefaultIntegrations } from './integrations.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const externalMcpPath = resolve(repoRoot, 'examples/external-mcp-server/server.mjs');

describe('Daemon universal MCP aggregator & unified inventory API', () => {
  async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'udi-aggregator-data-'));
    const token = randomBytes(32).toString('hex');
    const app = buildApp({
      databasePath: join(dataDir, 'test.sqlite'),
      token,
      logger: false,
      integrations: createDefaultIntegrations,
    });
    await app.ready();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const url = new URL(address);

    const baseUrl = `http://127.0.0.1:${url.port}`;
    const client = createClient({
      baseUrl,
      token,
    });

    const cleanup = async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    };

    return { client, cleanup };
  }

  it('discovers tools from a real external MCP server, exposes unified inventory, and routes calls with execution history', async () => {
    const { client, cleanup } = await setup();
    try {
      // 1. Create a project
      const project = await client.createProject({
        name: 'Aggregator Test Project',
        rootPath: resolve(repoRoot, 'examples/rover'),
      });

      // 2. Register real external MCP server
      const server = await client.createMcpServer({
        name: 'code-intelligence-pack',
        enabled: true,
        transport: {
          type: 'stdio',
          executableId: process.execPath,
          args: [externalMcpPath],
        },
      });

      expect(server.id).toBeDefined();

      // 3. Discover tools on the external server via POST /mcp/servers/:id/discover
      const { items: discoveredTools } = await client.discoverServerTools(server.id);
      expect(discoveredTools.length).toBeGreaterThanOrEqual(3);

      const toolNames = discoveredTools.map((t) => t.name);
      expect(toolNames).toContain('analyze_code_metrics');
      expect(toolNames).toContain('format_code_snippet');
      expect(toolNames).toContain('inspect_environment');

      // 4. Query unified integration inventory via GET /integrations
      const { items: integrations } = await client.listIntegrations();
      expect(integrations.length).toBeGreaterThan(0);

      // Verify representations of servers, discovered tools, specialist pack, and host adapters
      const serverItem = integrations.find((i) => i.id === server.id);
      expect(serverItem).toBeDefined();
      expect(serverItem?.type).toBe('mcp_server');
      expect(serverItem?.availableTools).toContain('analyze_code_metrics');

      const toolItem = integrations.find(
        (i) => i.id === 'code-intelligence-pack__analyze_code_metrics',
      );
      expect(toolItem).toBeDefined();
      expect(toolItem?.type).toBe('discovered_tool');

      const electronicsPack = integrations.find((i) => i.id === 'specialist-pack:electronics');
      expect(electronicsPack).toBeDefined();
      expect(electronicsPack?.type).toBe('specialist_pack');
      expect(electronicsPack?.availableTools).toContain('pin_consistency_validator');

      const vscodeAdapter = integrations.find((i) => i.id === 'host-adapter:vscode');
      expect(vscodeAdapter?.configurationStatus).toBe('configured');

      const opencodeAdapter = integrations.find((i) => i.id === 'host-adapter:opencode');
      expect(opencodeAdapter?.configurationStatus).toBe('configured');

      const antigravityAdapter = integrations.find((i) => i.id === 'host-adapter:antigravity');
      expect(antigravityAdapter?.configurationStatus).toBe('manual_setup');
      expect(antigravityAdapter?.enabled).toBe(false);

      // 5. Route an authorized tool call through the aggregator
      const callRes = await client.callMcpTool(server.id, 'analyze_code_metrics', {
        projectId: project.id,
        agentId: 'agent-alex',
        arguments: { path: 'src/pins.h' },
      });

      expect(callRes.ok).toBe(true);
      expect(callRes.serverName).toBe('code-intelligence-pack');
      expect(callRes.toolName).toBe('analyze_code_metrics');
      expect(callRes.executionId).toBeDefined();

      // 6. Verify tool execution activity is recorded in project history
      const { items: executions } = await client.listMcpExecutions(project.id);
      expect(executions).toHaveLength(1);
      const execRecord = executions[0]!;
      expect(execRecord.serverName).toBe('code-intelligence-pack');
      expect(execRecord.toolName).toBe('analyze_code_metrics');
      expect(execRecord.outcome).toBe('succeeded');
      expect(execRecord.agentId).toBe('agent-alex');
      expect(execRecord.provenance.sourceKind).toBe('observed_tool');

      // 7. Verify cross-agent retrieval: Second Agent querying context gets the observation
      const memory = await client.getContext(project.id);
      const executionFact = memory.records.find((r) =>
        r.text.includes('code-intelligence-pack -> analyze_code_metrics'),
      );
      expect(executionFact).toBeDefined();
      expect(executionFact?.provenance.sourceKind).toBe('observed_tool');
    } finally {
      await cleanup();
    }
  });

  it('rejects routing calls to nonexistent or disabled MCP servers', async () => {
    const { client, cleanup } = await setup();
    try {
      const disabledServer = await client.createMcpServer({
        name: 'disabled-server',
        enabled: false,
        transport: {
          type: 'stdio',
          executableId: process.execPath,
          args: ['-v'],
        },
      });

      await expect(client.callMcpTool(disabledServer.id, 'test_tool', {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });

      await expect(client.callMcpTool(randomUUID(), 'test_tool', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    } finally {
      await cleanup();
    }
  });
});
