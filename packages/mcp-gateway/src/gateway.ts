import {
  McpServer as SdkMcpServer,
  type RegisteredTool,
  type Tool,
  type CallToolResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { DaemonClient } from '@udi/client-sdk';
import type { McpServer as RegisteredMcpServer, DiscoveredTool } from '@udi/contracts';
import { z } from 'zod';
import type { ToolCategory, JsonValue } from '@udi/contracts';
import { TOOL_CATEGORIES, getFilteredTools } from './categories.js';

export type McpServerTransport = Parameters<SdkMcpServer['connect']>[0];

export interface GatewayOptions {
  client: DaemonClient;
  projectId: string;
}

export interface McpGateway {
  server: SdkMcpServer;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export const READ_TOOL_NAMES = [
  'get_project_context',
  'list_project_events',
  'get_validation_results',
  'list_available_tools',
] as const;

export class DefaultMcpGateway implements McpGateway {
  public readonly server: SdkMcpServer;
  private readonly client: DaemonClient;
  private readonly defaultProjectId: string;
  private transport: McpServerTransport | undefined;

  constructor(options: GatewayOptions, transport?: McpServerTransport) {
    this.client = options.client;
    this.defaultProjectId = options.projectId;
    this.transport = transport;

    this.server = new SdkMcpServer({
      name: 'developer-intelligence-gateway',
      version: '1.0.0',
    });

    this.registerGatewayTools();
    this.registerSpec2Tools();
    this.server.server.setRequestHandler('tools/list', async () => {
      await this.refreshExternalTools();
      const active = await this.activeCategories(this.defaultProjectId);
      return {
        tools: getFilteredTools(active, [...this.definitions.values()]).map((t) => t.definition),
      };
    });
  }

  private registerGatewayTools(): void {
    // 1. get_project_context
    this.registerTool(
      'get_project_context',
      {
        description:
          'Retrieves verified project context memory including facts, decisions, open issues, and provenance.',
        inputSchema: {
          projectId: z.string().uuid().optional(),
          maxItems: z.number().int().min(1).max(500).optional(),
        },
      },
      async ({ projectId, maxItems }) => {
        const targetProjectId = projectId ?? this.defaultProjectId;
        try {
          const memory = await this.client.getContext(targetProjectId, maxItems);
          const summary = [
            `Project Memory: ${memory.projectId}`,
            `Generated at: ${memory.generatedAt}`,
            `Open Issues (${memory.openIssues.length}):`,
            ...memory.openIssues.map((issue) => ` - [ISSUE] ${issue}`),
            `Context Records (${memory.records.length}):`,
            ...memory.records.map(
              (r) =>
                ` - [${r.kind.toUpperCase()}] (${r.provenance.sourceKind} by ${r.provenance.actor}): ${r.text}`,
            ),
          ].join('\n');

          return {
            content: [
              { type: 'text', text: summary },
              { type: 'text', text: JSON.stringify(memory, null, 2) },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: 'text',
                text: `Error retrieving project context for ${targetProjectId}: ${msg}`,
              },
            ],
          };
        }
      },
    );

    // 2. list_project_events
    this.registerTool(
      'list_project_events',
      {
        description:
          'Lists chronological activity events for the project with provenance metadata.',
        inputSchema: {
          projectId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(500).optional(),
          type: z.string().optional(),
        },
      },
      async ({ projectId, limit, type }) => {
        const targetProjectId = projectId ?? this.defaultProjectId;
        try {
          const { items } = await this.client.listEvents(targetProjectId, {
            limit: limit ?? 50,
            type,
          });
          const summary = [
            `Project Events (${items.length}):`,
            ...items.map(
              (e) =>
                `[${e.createdAt}] ${e.type} (actor: ${e.actor}, source: ${e.sourceKind}) - ${JSON.stringify(e.payload)}`,
            ),
          ].join('\n');

          return {
            content: [
              { type: 'text', text: summary },
              { type: 'text', text: JSON.stringify(items, null, 2) },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text', text: `Error listing project events: ${msg}` }],
          };
        }
      },
    );

    // 3. get_validation_results
    this.registerTool(
      'get_validation_results',
      {
        description:
          'Retrieves genuine engineering validation findings and diagnostic evidence for the project.',
        inputSchema: {
          projectId: z.string().uuid().optional(),
          jobId: z.string().uuid().optional(),
        },
      },
      async ({ projectId, jobId }) => {
        const targetProjectId = projectId ?? this.defaultProjectId;
        try {
          const { items: findings } = await this.client.listFindings(targetProjectId, {
            jobId,
          });
          let jobDetail = '';
          if (jobId) {
            try {
              const job = await this.client.getJob(targetProjectId, jobId);
              jobDetail = `Job ${job.id} Status: ${job.status} (exit: ${job.exitCode ?? 'none'})\n`;
            } catch {
              // Ignore job lookup failure if findings are retrieved
            }
          }

          const findingsSummary = findings.map(
            (f) =>
              `[${f.severity.toUpperCase()}] ${f.ruleId}: ${f.message}\n` +
              `  Expected: ${JSON.stringify(f.expected)}\n` +
              `  Observed: ${JSON.stringify(f.observed)}\n` +
              `  Evidence: ${f.evidence.map((e) => `${e.filePath}${e.line ? `:${e.line}` : ''}`).join(', ')}\n` +
              (f.suggestedFix ? `  Fix: ${f.suggestedFix}\n` : ''),
          );

          const summary = `${jobDetail}Validation Findings (${findings.length}):\n${findingsSummary.join('\n')}`;

          return {
            content: [
              { type: 'text', text: summary },
              { type: 'text', text: JSON.stringify(findings, null, 2) },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text', text: `Error retrieving validation results: ${msg}` }],
          };
        }
      },
    );

    // 4. record_decision
    this.registerTool(
      'record_decision',
      {
        description:
          'Records an engineering or task decision into project memory with strict agent_summary provenance.',
        inputSchema: {
          projectId: z.string().uuid().optional(),
          text: z.string().min(1),
          actor: z.string().optional(),
          sourceRef: z.string().optional(),
        },
      },
      async ({ projectId, text, actor, sourceRef }) => {
        const targetProjectId = projectId ?? this.defaultProjectId;
        try {
          const record = await this.client.createContextRecord(targetProjectId, {
            kind: 'decision',
            text,
            provenance: {
              sourceKind: 'agent_summary',
              actor: actor ?? 'mcp-agent',
              ...(sourceRef !== undefined ? { sourceRef } : {}),
            },
            evidence: [],
          });

          return {
            content: [
              {
                type: 'text',
                text: `Decision recorded successfully. ID: ${record.id} (provenance: agent_summary)`,
              },
              { type: 'text', text: JSON.stringify(record, null, 2) },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text', text: `Error recording decision: ${msg}` }],
          };
        }
      },
    );

    // 5. list_available_tools
    this.registerTool(
      'list_available_tools',
      {
        description: 'Lists all available MCP gateway tools and daemon capabilities.',
        inputSchema: {
          projectId: z.string().uuid().optional(),
        },
      },
      async ({ projectId }) => {
        try {
          const health = await this.client.health();
          let serverList: unknown[] = [];
          try {
            const { items } = await this.client.listMcpServers();
            serverList = items;
          } catch {
            // Ignore if server listing fails
          }

          const capabilities = health.capabilities;
          const tools = getFilteredTools(
            await this.activeCategories(projectId ?? this.defaultProjectId),
            [...this.definitions.values()],
          ).map((t) => t.name);

          return {
            content: [
              {
                type: 'text',
                text: `Developer Intelligence Platform Capabilities: ${JSON.stringify(capabilities, null, 2)}\nGateway Tools: ${tools.join(', ')}\nRegistered External MCP Servers: ${serverList.length}`,
              },
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    daemonVersion: health.version,
                    capabilities,
                    gatewayTools: tools,
                    mcpServers: serverList,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text', text: `Error retrieving platform tools: ${msg}` }],
          };
        }
      },
    );
  }

  private readonly aggregatedTools = new Map<string, DiscoveredTool>();

  getAggregatedTools(): DiscoveredTool[] {
    return Array.from(this.aggregatedTools.values());
  }

  async aggregateExternalServer(server: RegisteredMcpServer): Promise<DiscoveredTool[]> {
    const { items: discovered } = await this.client.discoverServerTools(server.id);
    for (const tool of discovered) {
      const prefix = server.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const base = `${prefix}__${tool.name}`;
      const namespaced = this.definitions.has(base)
        ? `${prefix}_${server.id.slice(0, 8)}__${tool.name}`
        : base;
      this.aggregatedTools.set(namespaced, tool);
      this.registerTool(
        namespaced,
        {
          description: `[${server.name}] ${tool.description || tool.name}`,
          inputSchema: {
            params: z.record(z.string(), z.unknown()).optional(),
            projectId: z.uuid().optional(),
            agentId: z.string().optional(),
          },
        },
        async ({ params, projectId, agentId }) => {
          try {
            const response = await this.client.callMcpTool(server.id, tool.name, {
              projectId: projectId ?? this.defaultProjectId,
              ...(agentId ? { agentId } : {}),
              arguments: (params ?? {}) as Record<string, JsonValue>,
            });
            const raw = response.result;
            return raw !== null &&
              typeof raw === 'object' &&
              !Array.isArray(raw) &&
              Array.isArray(raw.content)
              ? (raw as unknown as CallToolResult)
              : { content: [{ type: 'text', text: JSON.stringify(raw) }] };
          } catch {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: 'External MCP execution failed; inspect project activity. No automatic retry.',
                },
              ],
            };
          }
        },
      );
    }
    return discovered;
  }

  private readonly definitions = new Map<
    string,
    { name: string; category: ToolCategory; definition: Tool; handle: RegisteredTool }
  >();
  private readonly serverFingerprints = new Map<string, string>();
  private refreshing: Promise<void> | undefined;

  private async activeCategories(projectId: string): Promise<Set<ToolCategory>> {
    const result = await this.client.getToolCategories(projectId);
    return new Set(result.categories.filter((c) => c.enabled).map((c) => c.category));
  }
  private registerTool<S extends z.ZodRawShape>(
    name: string,
    config: { description: string; inputSchema: S },
    callback: (
      args: z.infer<z.ZodObject<S>>,
      context: ServerContext,
    ) => CallToolResult | Promise<CallToolResult>,
  ) {
    const category = TOOL_CATEGORIES[name] ?? 'external_servers';
    const handle = this.server.registerTool(
      name,
      { ...config, inputSchema: z.object(config.inputSchema) },
      async (args, context) => {
        const supplied = (args as Record<string, unknown>).projectId;
        const projectId = typeof supplied === 'string' ? supplied : this.defaultProjectId;
        try {
          if (!(await this.activeCategories(projectId)).has(category))
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Tool '${name}' is in category '${category}', which is currently toggled OFF in Mission Control.`,
                },
              ],
            };
          return await callback(z.object(config.inputSchema).parse(args), context);
        } catch {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: 'Tool unavailable: cannot verify project category state or complete operation.',
              },
            ],
          };
        }
      },
    );
    this.definitions.set(name, {
      name,
      category,
      handle,
      definition: {
        name,
        description: config.description,
        inputSchema: z.toJSONSchema(z.object(config.inputSchema), {
          unrepresentable: 'any',
        }) as Tool['inputSchema'],
      },
    });
    return handle;
  }
  async refreshExternalTools(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      if (!(await this.activeCategories(this.defaultProjectId)).has('external_servers')) return;
      const servers: RegisteredMcpServer[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = (await this.client.listMcpServers({ limit: 500, offset })).items;
        servers.push(...page);
        if (page.length < 500) break;
      }
      for (const [id] of this.serverFingerprints) {
        const server = servers.find((s) => s.id === id && s.enabled);
        const fingerprint = server && JSON.stringify([server.name, server.transport]);
        if (!server || fingerprint !== this.serverFingerprints.get(id)) {
          for (const [name, tool] of this.aggregatedTools)
            if (tool.serverId === id) {
              this.definitions.get(name)?.handle.remove();
              this.definitions.delete(name);
              this.aggregatedTools.delete(name);
            }
          this.serverFingerprints.delete(id);
        }
      }
      for (const server of servers.filter((s) => s.enabled && s.transport.type === 'stdio')) {
        if (this.serverFingerprints.has(server.id)) continue;
        // Never recursively launch another copy of our own gateway.
        if (
          server.transport.type === 'stdio' &&
          server.transport.args.some((a) =>
            /(?:mcp-gateway[/\\]dist[/\\]cli\.js|mcp-stdio\.mjs)$/.test(a),
          )
        )
          continue;
        try {
          await this.aggregateExternalServer(server);
          this.serverFingerprints.set(server.id, JSON.stringify([server.name, server.transport]));
        } catch {
          /* An unreachable external server never removes working core tools. */
        }
      }
    })();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }
  private registerSpec2Tools() {
    this.registerTool(
      'get_compressed_context',
      {
        description:
          'Spec 2 verified deterministic delta or classified AI rollup; token estimates and provenance retained.',
        inputSchema: {
          projectId: z.uuid().optional(),
          mode: z.enum(['deterministic_delta', 'ai_distillation']).default('deterministic_delta'),
        },
      },
      async ({ projectId, mode }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await this.client.getCompressedContext(projectId ?? this.defaultProjectId, mode),
            ),
          },
        ],
      }),
    );
    this.registerTool(
      'run_engineering_validation',
      {
        description: 'Run scoped engineering validation only after explicit caller approval.',
        inputSchema: {
          projectId: z.uuid().optional(),
          kind: z.enum(['pin_consistency', 'platformio_build', 'rtl_simulation']),
          artifactPaths: z.array(z.string()).min(1),
          approved: z.boolean(),
        },
      },
      async ({ projectId, kind, artifactPaths, approved }) => {
        if (!approved)
          return {
            isError: true,
            content: [
              { type: 'text', text: 'Explicit approval is required before engineering execution' },
            ],
          };
        const job = await this.client.requestValidation(projectId ?? this.defaultProjectId, {
          kind,
          artifactPaths,
          requestedBy: 'mcp-gateway',
        });
        return { content: [{ type: 'text', text: JSON.stringify(job) }] };
      },
    );
    for (const name of ['vscode_execute_command', 'vscode_list_diagnostics'] as const)
      this.registerTool(
        name,
        {
          description: `Relay ${name} to the live registered VS Code extension. Commands require native user approval.`,
          inputSchema: {
            projectId: z.uuid().optional(),
            commandId: z.string().optional(),
            args: z.array(z.unknown()).optional(),
          },
        },
        async ({ projectId, commandId, args }) => {
          const result = await this.client.callHostExtensionTool(
            projectId ?? this.defaultProjectId,
            {
              name,
              arguments: {
                ...(commandId ? { commandId } : {}),
                ...(args ? { args: args as JsonValue[] } : {}),
              },
            },
          );
          return {
            isError: result.isError,
            content: [{ type: 'text', text: JSON.stringify(result.content) }],
          };
        },
      );
  }

  async start(): Promise<void> {
    const transport = this.transport ?? new StdioServerTransport();
    this.transport = transport;
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
