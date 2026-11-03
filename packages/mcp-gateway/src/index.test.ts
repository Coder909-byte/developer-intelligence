import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { DaemonClient } from '@udi/client-sdk';
import type {
  McpServer,
  ProjectMemory,
  ActivityEvent,
  ValidationFinding,
  Job,
  ContextRecord,
} from '@udi/contracts';
import {
  DefaultMcpGateway,
  DefaultMcpRegistry,
  generateHostConfig,
  previewConfigDiff,
  applyHostConfig,
} from './index.js';
import { unlink } from 'node:fs/promises';

describe('DefaultMcpGateway via MCP SDK v2', () => {
  const projectId = randomUUID();

  function createMockDaemonClient(): DaemonClient {
    const memory: ProjectMemory = {
      projectId,
      generatedAt: '2026-11-03T12:00:00.000Z',
      schemaVersion: 1,
      records: [
        {
          id: randomUUID(),
          projectId,
          createdAt: '2026-11-03T12:00:00.000Z',
          updatedAt: '2026-11-03T12:00:00.000Z',
          kind: 'fact',
          text: 'Motor EN pin mismatch detected on GPIO26',
          provenance: { sourceKind: 'observed_tool', actor: 'engineering-core' },
          evidence: [{ filePath: 'rover.net' }],
        },
      ],
      openIssues: ['Motor EN pin mismatch detected on GPIO26'],
    };

    const event: ActivityEvent = {
      id: randomUUID(),
      projectId,
      type: 'engineering.validation.completed',
      actor: 'engineering-core',
      sourceKind: 'observed_tool',
      createdAt: '2026-11-03T12:00:00.000Z',
      schemaVersion: 1,
      payload: { status: 'failed' },
    };

    const finding: ValidationFinding = {
      id: randomUUID(),
      projectId,
      jobId: randomUUID(),
      createdAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-11-03T12:00:00.000Z',
      ruleId: 'pin_consistency',
      severity: 'error',
      message: 'Signal MOTOR_EN pin mismatch',
      expected: { pin: 'GPIO14' },
      observed: { pin: 'GPIO26' },
      evidence: [{ filePath: 'src/pins.h', line: 6 }],
      status: 'open',
      verifiedBy: { tool: 'engineering-core', version: '1.0.0' },
    };

    const record: ContextRecord = {
      id: randomUUID(),
      projectId,
      createdAt: '2026-11-03T12:00:00.000Z',
      updatedAt: '2026-11-03T12:00:00.000Z',
      kind: 'decision',
      text: 'Apply proposed fix',
      provenance: { sourceKind: 'agent_summary', actor: 'mcp-agent' },
      evidence: [],
    };

    return {
      health: vi.fn(async () => ({
        status: 'ok' as const,
        version: '0.1.0',
        apiVersion: 'v1' as const,
        database: 'ready' as const,
        capabilities: {
          projects: true,
          context: true,
          mcp: true,
          engineering: true,
        },
      })),
      getContext: vi.fn(async () => memory),
      listEvents: vi.fn(async () => ({ items: [event] })),
      listFindings: vi.fn(async () => ({ items: [finding] })),
      getJob: vi.fn(
        async () =>
          ({
            id: finding.jobId,
            projectId,
            createdAt: '2026-11-03T12:00:00.000Z',
            updatedAt: '2026-11-03T12:00:00.000Z',
            status: 'failed' as const,
            startedAt: '2026-11-03T12:00:00.000Z',
            completedAt: '2026-11-03T12:00:00.000Z',
            exitCode: 1,
            stdoutTail: '',
            stderrTail: '',
            artifacts: [],
          }) as Job,
      ),
      createContextRecord: vi.fn(async () => record),
      listMcpServers: vi.fn(async () => ({ items: [] })),
      getMcpServer: vi.fn(),
      createMcpServer: vi.fn(),
      replaceMcpServer: vi.fn(),
      deleteMcpServer: vi.fn(),
      checkMcpServerHealth: vi.fn(),
      listProjects: vi.fn(),
      createProject: vi.fn(),
      getProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
      getEvent: vi.fn(),
      createEvent: vi.fn(),
      listContextRecords: vi.fn(),
      getContextRecord: vi.fn(),
      listHandoffs: vi.fn(),
      getHandoff: vi.fn(),
      createHandoff: vi.fn(),
      recordValidationResult: vi.fn(),
      requestValidation: vi.fn(),
    };
  }

  it('exposes and executes get_project_context tool over MCP protocol', async () => {
    const mockClient = createMockDaemonClient();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const gateway = new DefaultMcpGateway({ client: mockClient, projectId }, serverTransport);
    await gateway.start();

    // Call tool over client transport
    let responseText = '';
    clientTransport.onmessage = (msg: unknown) => {
      const res = msg as {
        id: number;
        result?: { content: Array<{ type: string; text: string }> };
      };
      if (res.id === 101 && res.result?.content?.[0]) {
        responseText = res.result.content[0].text;
      }
    };
    await clientTransport.start();

    await clientTransport.send({
      jsonrpc: '2.0',
      id: 101,
      method: 'tools/call',
      params: {
        name: 'get_project_context',
        arguments: { projectId },
      },
    });

    // Wait for in-memory message delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(mockClient.getContext).toHaveBeenCalledWith(projectId, undefined);
    expect(responseText).toContain('Project Memory');
    expect(responseText).toContain('Motor EN pin mismatch');

    await gateway.stop();
  });

  it('executes record_decision tool with agent_summary provenance', async () => {
    const mockClient = createMockDaemonClient();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const gateway = new DefaultMcpGateway({ client: mockClient, projectId }, serverTransport);
    await gateway.start();

    let responseText = '';
    clientTransport.onmessage = (msg: unknown) => {
      const res = msg as {
        id: number;
        result?: { content: Array<{ type: string; text: string }> };
      };
      if (res.id === 102 && res.result?.content?.[0]) {
        responseText = res.result.content[0].text;
      }
    };
    await clientTransport.start();

    await clientTransport.send({
      jsonrpc: '2.0',
      id: 102,
      method: 'tools/call',
      params: {
        name: 'record_decision',
        arguments: {
          projectId,
          text: 'Approved proposed firmware GPIO patch',
          actor: 'opencode-agent',
        },
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockClient.createContextRecord).toHaveBeenCalledWith(projectId, {
      kind: 'decision',
      text: 'Approved proposed firmware GPIO patch',
      provenance: {
        sourceKind: 'agent_summary',
        actor: 'opencode-agent',
      },
      evidence: [],
    });
    expect(responseText).toContain('Decision recorded successfully');

    await gateway.stop();
  });

  it('executes list_available_tools tool returning gateway tools and daemon capabilities', async () => {
    const mockClient = createMockDaemonClient();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    const gateway = new DefaultMcpGateway({ client: mockClient, projectId }, serverTransport);
    await gateway.start();

    let responseText = '';
    clientTransport.onmessage = (msg: unknown) => {
      const res = msg as {
        id: number;
        result?: { content: Array<{ type: string; text: string }> };
      };
      if (res.id === 103 && res.result?.content?.[0]) {
        responseText = res.result.content[0].text;
      }
    };
    await clientTransport.start();

    await clientTransport.send({
      jsonrpc: '2.0',
      id: 103,
      method: 'tools/call',
      params: {
        name: 'list_available_tools',
        arguments: {},
      },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockClient.health).toHaveBeenCalled();
    expect(responseText).toContain('get_project_context');
    expect(responseText).toContain('record_decision');

    await gateway.stop();
  });
});

describe('DefaultMcpRegistry health checking', () => {
  it('updates status to healthy for accessible tools', async () => {
    const server: McpServer = {
      id: randomUUID(),
      name: 'node-probe',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabled: true,
      status: 'unknown',
      transport: {
        type: 'stdio',
        executableId: process.execPath,
        args: ['-v'],
      },
    };

    const mockClient = {
      getMcpServer: vi.fn(async () => server),
      replaceMcpServer: vi.fn(async (_id: string, s: McpServer) => s),
      listMcpServers: vi.fn(async () => ({ items: [server] })),
      createMcpServer: vi.fn(async () => server),
      deleteMcpServer: vi.fn(async () => ({ id: server.id, deleted: true as const })),
    } as unknown as DaemonClient;

    const registry = new DefaultMcpRegistry(mockClient);
    const checked = await registry.checkHealth(server.id);

    expect(checked.status).toBe('healthy');
    expect(mockClient.replaceMcpServer).toHaveBeenCalledWith(
      server.id,
      expect.objectContaining({ status: 'healthy' }),
    );
  });

  it('updates status to unreachable for invalid executable', async () => {
    const server: McpServer = {
      id: randomUUID(),
      name: 'bad-exe',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabled: true,
      status: 'unknown',
      transport: {
        type: 'stdio',
        executableId: 'nonexistent-executable-12345',
        args: [],
      },
    };

    const mockClient = {
      getMcpServer: vi.fn(async () => server),
      replaceMcpServer: vi.fn(async (_id: string, s: McpServer) => s),
    } as unknown as DaemonClient;

    const registry = new DefaultMcpRegistry(mockClient);
    const checked = await registry.checkHealth(server.id);

    expect(checked.status).toBe('unreachable');
  });

  it('sets disabled status when server is not enabled', async () => {
    const server: McpServer = {
      id: randomUUID(),
      name: 'disabled-server',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabled: false,
      status: 'unknown',
      transport: {
        type: 'http',
        url: 'http://127.0.0.1:9999/mcp',
      },
    };

    const mockClient = {
      getMcpServer: vi.fn(async () => server),
      replaceMcpServer: vi.fn(async (_id: string, s: McpServer) => s),
    } as unknown as DaemonClient;

    const registry = new DefaultMcpRegistry(mockClient);
    const checked = await registry.checkHealth(server.id);

    expect(checked.status).toBe('disabled');
  });
});

describe('Host compatibility adapters', () => {
  const servers: McpServer[] = [
    {
      id: randomUUID(),
      name: 'rover-mcp',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabled: true,
      status: 'healthy',
      transport: {
        type: 'stdio',
        executableId: 'node',
        args: ['dist/mcp-server.js'],
      },
    },
  ];

  it('generates valid VS Code mcp config', () => {
    const config = generateHostConfig('vscode', servers) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(config.mcpServers['rover-mcp']).toEqual({
      command: 'node',
      args: ['dist/mcp-server.js'],
    });
  });

  it('generates valid OpenCode config', () => {
    const config = generateHostConfig('opencode', servers) as {
      mcp: { servers: Record<string, { type: string; command: string[] }> };
    };
    expect(config.mcp.servers['rover-mcp']).toEqual({
      type: 'local',
      command: ['node', 'dist/mcp-server.js'],
    });
  });

  it('previews diff between current and proposed configs', () => {
    const current = JSON.stringify({ mcpServers: {} }, null, 2);
    const proposed = generateHostConfig('vscode', servers);
    const preview = previewConfigDiff(current, proposed);

    expect(preview.hasChanges).toBe(true);
    expect(preview.diff).toContain('+');
    expect(preview.diff).toContain('rover-mcp');
  });

  it('safely applies host config with backup creation', async () => {
    const tmpFile = `/tmp/test-mcp-config-${randomUUID()}.json`;
    const config = generateHostConfig('vscode', servers);

    // Initial write
    const res1 = await applyHostConfig(tmpFile, config);
    expect(res1.written).toBe(true);
    expect(res1.backupPath).toBeNull();

    // Second write creates backup
    const res2 = await applyHostConfig(tmpFile, { ...config, updated: true });
    expect(res2.written).toBe(true);
    expect(res2.backupPath).toBe(`${tmpFile}.bak`);

    // Cleanup
    try {
      await unlink(tmpFile);
      if (res2.backupPath) await unlink(res2.backupPath);
    } catch {
      // ignore
    }
  });
});
