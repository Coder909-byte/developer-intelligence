import { McpServer as SdkMcpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { DaemonClient } from '@udi/client-sdk';
import { z } from 'zod';

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
  }

  private registerGatewayTools(): void {
    // 1. get_project_context
    this.server.registerTool(
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
    this.server.registerTool(
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
    this.server.registerTool(
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
    this.server.registerTool(
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
    this.server.registerTool(
      'list_available_tools',
      {
        description: 'Lists all available MCP gateway tools and daemon capabilities.',
        inputSchema: {
          projectId: z.string().uuid().optional(),
        },
      },
      async ({ projectId }) => {
        void projectId;
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
          const tools = [
            'get_project_context',
            'list_project_events',
            'get_validation_results',
            'record_decision',
            'list_available_tools',
          ];

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

  async start(): Promise<void> {
    const transport = this.transport ?? new StdioServerTransport();
    this.transport = transport;
    await this.server.connect(transport);
  }

  async stop(): Promise<void> {
    await this.server.close();
  }
}
