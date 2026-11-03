import { spawn } from 'node:child_process';
import type { McpServer, DiscoveredTool, IntegrationItem } from '@udi/contracts';

export class McpRoutingError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'TIMEOUT' | 'UNREACHABLE' | 'EXECUTION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'McpRoutingError';
  }
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | undefined;
  method?: string | undefined;
  params?: Record<string, unknown> | undefined;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown } | undefined;
}

/**
 * Connects to a target MCP server over stdio, performs protocol handshake,
 * and calls tools/list to discover available tools.
 */
export async function discoverServerTools(
  server: McpServer,
  timeoutMs = 5000,
): Promise<DiscoveredTool[]> {
  if (server.transport.type !== 'stdio') {
    // For HTTP servers, can be extended if endpoint supports JSON-RPC
    return [];
  }

  const exe = server.transport.executableId;
  const args = server.transport.args;

  return new Promise<DiscoveredTool[]>((resolveDiscovery, rejectDiscovery) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return rejectDiscovery(
        new McpRoutingError(
          'UNREACHABLE',
          `Failed to spawn MCP server ${server.name}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    let buffer = '';
    let messageId = 1;
    const pending = new Map<
      number | string,
      { resolve: (val: unknown) => void; reject: (err: Error) => void }
    >();

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectDiscovery(
        new McpRoutingError(
          'TIMEOUT',
          `Tool discovery timed out after ${timeoutMs}ms for ${server.name}`,
        ),
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        // already exited
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage;
          if (msg.id !== undefined && pending.has(msg.id)) {
            const handler = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) {
              handler.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              handler.resolve(msg.result);
            }
          }
        } catch {
          // Ignore non-json lines
        }
      }
    });

    child.on('error', (err) => {
      cleanup();
      rejectDiscovery(
        new McpRoutingError('UNREACHABLE', `MCP server process error: ${err.message}`),
      );
    });

    const sendRpc = (method: string, params: Record<string, unknown> = {}) => {
      const id = messageId++;
      return new Promise<unknown>((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
        child.stdin?.write(payload);
      });
    };

    const sendNotification = (method: string, params: Record<string, unknown> = {}) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
      child.stdin?.write(payload);
    };

    // Protocol flow: initialize -> initialized -> tools/list
    (async () => {
      try {
        await sendRpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'udi-aggregator', version: '1.0.0' },
        });

        sendNotification('notifications/initialized');

        const listRes = (await sendRpc('tools/list', {})) as {
          tools?: Array<{
            name: string;
            description?: string;
            inputSchema?: unknown;
          }>;
        };

        cleanup();

        const rawTools = listRes.tools ?? [];
        const discovered: DiscoveredTool[] = rawTools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema as DiscoveredTool['inputSchema'],
          serverName: server.name,
          serverId: server.id,
        }));

        resolveDiscovery(discovered);
      } catch (err) {
        cleanup();
        rejectDiscovery(
          new McpRoutingError(
            'EXECUTION_FAILED',
            `Discovery RPC failed on ${server.name}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    })();
  });
}

/**
 * Connects to a target MCP server over stdio, performs protocol handshake,
 * and routes a tools/call request.
 */
export async function routeToolCall(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ result: unknown; durationMs: number }> {
  if (server.transport.type !== 'stdio') {
    throw new McpRoutingError('UNREACHABLE', 'HTTP tool routing is not configured');
  }

  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 30000;
  const exe = server.transport.executableId;
  const serverArgs = server.transport.args;

  return new Promise<{ result: unknown; durationMs: number }>((resolveCall, rejectCall) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, serverArgs, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return rejectCall(
        new McpRoutingError(
          'UNREACHABLE',
          `Cannot launch MCP server ${server.name}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    let buffer = '';
    let messageId = 1;
    const pending = new Map<
      number | string,
      { resolve: (val: unknown) => void; reject: (err: Error) => void }
    >();

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      rejectCall(
        new McpRoutingError(
          'TIMEOUT',
          `Tool call ${toolName} on server ${server.name} timed out after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        // already exited
      }
    };

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          cleanup();
          rejectCall(new McpRoutingError('EXECUTION_FAILED', 'Tool call cancelled by caller'));
        },
        { once: true },
      );
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage;
          if (msg.id !== undefined && pending.has(msg.id)) {
            const handler = pending.get(msg.id)!;
            pending.delete(msg.id);
            if (msg.error) {
              handler.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              handler.resolve(msg.result);
            }
          }
        } catch {
          // ignore non-json
        }
      }
    });

    child.on('error', (err) => {
      cleanup();
      rejectCall(new McpRoutingError('UNREACHABLE', `MCP server error: ${err.message}`));
    });

    const sendRpc = (method: string, params: Record<string, unknown> = {}) => {
      const id = messageId++;
      return new Promise<unknown>((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
        child.stdin?.write(payload);
      });
    };

    const sendNotification = (method: string, params: Record<string, unknown> = {}) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
      child.stdin?.write(payload);
    };

    (async () => {
      try {
        await sendRpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'udi-gateway-router', version: '1.0.0' },
        });

        sendNotification('notifications/initialized');

        const callRes = await sendRpc('tools/call', {
          name: toolName,
          arguments: args,
        });

        cleanup();
        const durationMs = Date.now() - startTime;
        resolveCall({ result: callRes, durationMs });
      } catch (err) {
        cleanup();
        rejectCall(
          new McpRoutingError(
            'EXECUTION_FAILED',
            `Tool execution failed on ${server.name} -> ${toolName}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    })();
  });
}

/**
 * Builds the Unified Integration Inventory synthesizing MCP servers,
 * discovered tools, host adapters, and specialist engineering packs.
 */
export function buildUnifiedInventory(
  servers: McpServer[],
  discoveredMap: Map<string, DiscoveredTool[]> = new Map(),
): IntegrationItem[] {
  const items: IntegrationItem[] = [];

  // 1. Registered MCP Servers
  for (const s of servers) {
    const discovered = discoveredMap.get(s.id) ?? [];
    items.push({
      id: s.id,
      name: s.name,
      description: `Configured MCP server via ${s.transport.type} transport`,
      type: 'mcp_server',
      transport: s.transport.type,
      status: s.status,
      configurationStatus: s.enabled ? 'configured' : 'pending',
      enabled: s.enabled,
      supportedHosts: ['vscode', 'opencode', 'claude_desktop'],
      availableTools: discovered.map((t) => t.name),
      metadata: {
        serverType: s.transport.type,
        toolCount: discovered.length,
      },
    });

    // Discovered Tools under this server
    for (const tool of discovered) {
      items.push({
        id: `${s.name}__${tool.name}`,
        name: tool.name,
        description: tool.description || `Tool provided by ${s.name}`,
        type: 'discovered_tool',
        transport: s.transport.type,
        status: s.status,
        configurationStatus: s.enabled ? 'configured' : 'pending',
        enabled: s.enabled,
        supportedHosts: ['vscode', 'opencode', 'claude_desktop'],
        availableTools: [tool.name],
        metadata: {
          serverName: s.name,
          serverId: s.id,
        },
      });
    }
  }

  // 2. Specialist Engineering Pack (Our first specialist integration)
  items.push({
    id: 'specialist-pack:electronics',
    name: 'Electronics & Firmware Intelligence Pack',
    description:
      'Deterministic KiCad schematic netlist analysis, C/C++ firmware pin consistency checking, and PlatformIO/RTL toolchain runners.',
    type: 'specialist_pack',
    transport: 'internal',
    status: 'healthy',
    configurationStatus: 'configured',
    enabled: true,
    supportedHosts: ['vscode', 'opencode', 'claude_desktop'],
    availableTools: [
      'pin_consistency_validator',
      'platformio_build_runner',
      'rtl_simulation_runner',
      'safe_correction_preview',
      'safe_correction_apply',
    ],
    metadata: {
      packVersion: '1.0.0',
      category: 'embedded_systems',
    },
  });

  // 3. Supported Host Adapters
  items.push({
    id: 'host-adapter:vscode',
    name: 'VS Code Extension & MCP Host Adapter',
    description:
      'Native host integration providing in-editor diagnostics, command palette actions, and automated .vscode/mcp.json configuration.',
    type: 'host_adapter',
    transport: 'internal',
    status: 'healthy',
    configurationStatus: 'configured',
    enabled: true,
    supportedHosts: ['vscode'],
    availableTools: [],
    metadata: {
      configTarget: '.vscode/mcp.json',
      diagnosticSupport: true,
    },
  });

  items.push({
    id: 'host-adapter:opencode',
    name: 'OpenCode Agent CLI Adapter',
    description:
      'Automated opencode.json configuration generator and stdio client interoperability for OpenCode AI coding agents.',
    type: 'host_adapter',
    transport: 'stdio',
    status: 'healthy',
    configurationStatus: 'configured',
    enabled: true,
    supportedHosts: ['opencode'],
    availableTools: [],
    metadata: {
      configTarget: 'opencode.json',
      supportedVersion: 'v2.0.32',
    },
  });

  items.push({
    id: 'host-adapter:claude-desktop',
    name: 'Claude Desktop Host Adapter',
    description:
      'Configuration generator for Anthropic Claude Desktop MCP settings (claude_desktop_config.json).',
    type: 'host_adapter',
    transport: 'stdio',
    status: 'healthy',
    configurationStatus: 'configured',
    enabled: true,
    supportedHosts: ['claude_desktop'],
    availableTools: [],
    metadata: {
      configTarget: 'claude_desktop_config.json',
    },
  });

  items.push({
    id: 'host-adapter:antigravity',
    name: 'Google Antigravity Agent Integration',
    description:
      'Antigravity MCP integration. Requires manual setup via documented environment variables (UDI_DAEMON_URL and UDI_TOKEN). Direct automated config rewrite is not supported.',
    type: 'host_adapter',
    transport: 'none',
    status: 'unknown',
    configurationStatus: 'manual_setup',
    enabled: false,
    supportedHosts: ['antigravity'],
    availableTools: [],
    metadata: {
      manualSetupNotice:
        'Set UDI_DAEMON_URL and UDI_TOKEN in your agent environment; automated config rewriting is unsupported.',
    },
  });

  return items;
}
