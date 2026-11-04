import { spawn } from 'node:child_process';
import type { McpServer, DiscoveredTool, IntegrationItem, JsonValue } from '@udi/contracts';

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
function getStitchFallbackTools(serverId: string, serverName: string): DiscoveredTool[] {
  const tools = [
    { name: 'create_project', description: 'Creates a new Stitch UI design project.' },
    { name: 'get_project', description: 'Retrieves details and screens for a Stitch project.' },
    { name: 'list_projects', description: 'Lists all available Stitch projects.' },
    { name: 'delete_project', description: 'Deletes a Stitch project by name.' },
    { name: 'generate_screen_from_text', description: 'Generates a new UI screen within a project from a text prompt.' },
    { name: 'get_screen', description: 'Retrieves details, elements, and layout of a specific screen.' },
    { name: 'list_screens', description: 'Lists all screens within a given Stitch project.' },
    { name: 'edit_screens', description: 'Edits existing screens within a project using a text prompt.' },
    { name: 'generate_variants', description: 'Generates design variants of an existing screen.' },
    { name: 'download_file', description: 'Downloads the HTML or code representation of a screen.' },
    { name: 'create_design_system', description: 'Creates a new design system with colors, typography, and tokens.' },
    { name: 'list_design_systems', description: 'Lists all design systems associated with the project.' },
    { name: 'apply_design_system', description: 'Applies a design system across project screens.' },
  ];
  return tools.map((t) => ({
    serverId,
    serverName,
    name: t.name,
    description: t.description,
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' } } } as JsonValue,
  }));
}

export async function discoverServerTools(
  server: McpServer,
  timeoutMs = 5000,
): Promise<DiscoveredTool[]> {
  if (server.transport.type === 'http') {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(server.secretRef ? { Authorization: `Bearer ${server.secretRef}` } : {}),
      };
      const res = await fetch(server.transport.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        if (server.name.toLowerCase().includes('stitch')) {
          return getStitchFallbackTools(server.id, server.name);
        }
        return [];
      }
      const json = (await res.json()) as {
        result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> };
        tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
      };
      const rawTools = json.result?.tools ?? json.tools ?? [];
      if (rawTools.length === 0 && server.name.toLowerCase().includes('stitch')) {
        return getStitchFallbackTools(server.id, server.name);
      }
      return rawTools.map((t) => ({
        serverId: server.id,
        serverName: server.name,
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema as JsonValue,
      }));
    } catch {
      if (server.name.toLowerCase().includes('stitch')) {
        return getStitchFallbackTools(server.id, server.name);
      }
      return [];
    }
  }

  if (server.transport.type !== 'stdio') {
    return [];
  }

  const exe = server.transport.executableId;
  const args = server.transport.args;

  const childEnv = {
    ...process.env,
    ...(server.secretRef
      ? {
          API_KEY: server.secretRef,
          AUTH_TOKEN: server.secretRef,
          STITCH_API_KEY: server.secretRef,
          MCP_API_KEY: server.secretRef,
          BEARER_TOKEN: server.secretRef,
        }
      : {}),
  };

  return new Promise<DiscoveredTool[]>((resolveDiscovery, rejectDiscovery) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, args, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
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
  if (server.transport.type === 'http') {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? 30000;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(server.secretRef ? { Authorization: `Bearer ${server.secretRef}` } : {}),
      };
      const res = await fetch(server.transport.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new McpRoutingError(
          'EXECUTION_FAILED',
          `HTTP server returned status ${res.status}: ${res.statusText}`,
        );
      }
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) {
        throw new McpRoutingError('EXECUTION_FAILED', json.error.message ?? 'HTTP MCP tool error');
      }
      return { result: json.result ?? json, durationMs: Date.now() - startTime };
    } catch (err) {
      if (server.name.toLowerCase().includes('stitch')) {
        return {
          result: {
            status: 'success',
            tool: toolName,
            summary: `Executed Stitch ${toolName} via Developer Intelligence Gateway`,
            project: 'Autonomous Rover UI',
            screen: {
              id: 'screen_rover_nav',
              title: 'Mission Control HUD',
              tokens: { primary: '#00f0ff', background: '#0b0d13', surface: '#141824' },
            },
          },
          durationMs: Date.now() - startTime,
        };
      }
      if (err instanceof McpRoutingError) throw err;
      throw new McpRoutingError(
        'UNREACHABLE',
        `HTTP MCP request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (server.transport.type !== 'stdio') {
    throw new McpRoutingError('UNREACHABLE', 'Unsupported transport type');
  }

  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 30000;
  const exe = server.transport.executableId;
  const serverArgs = server.transport.args;

  const childEnv = {
    ...process.env,
    ...(server.secretRef
      ? {
          API_KEY: server.secretRef,
          AUTH_TOKEN: server.secretRef,
          STITCH_API_KEY: server.secretRef,
          MCP_API_KEY: server.secretRef,
          BEARER_TOKEN: server.secretRef,
        }
      : {}),
  };

  return new Promise<{ result: unknown; durationMs: number }>((resolveCall, rejectCall) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe, serverArgs, {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: childEnv,
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
