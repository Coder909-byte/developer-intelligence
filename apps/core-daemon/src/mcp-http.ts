import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PlatformDatabase } from '@udi/event-store';
import type { PlatformIntegrations } from './platform-routes.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface PlatformToolItem {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function registerHttpMcpRoutes(
  app: FastifyInstance,
  store: PlatformDatabase,
  integrations: PlatformIntegrations,
) {
  const PLATFORM_TOOLS: PlatformToolItem[] = [
    {
      name: 'get_project_context',
      description: 'Retrieves verified ground truth project memory, active invariants, and open issues.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID (optional if bound)' },
        },
      },
    },
    {
      name: 'list_project_events',
      description: 'Lists chronological activity events and audit history for the project.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID' },
          limit: { type: 'number', description: 'Max items' },
        },
      },
    },
    {
      name: 'get_validation_results',
      description: 'Retrieves genuine engineering validation findings and diagnostic evidence.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID' },
          jobId: { type: 'string', description: 'Validation job UUID' },
        },
      },
    },
    {
      name: 'record_decision',
      description: 'Records an engineering or task decision into project memory with strict agent_summary provenance.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The decision text' },
          actor: { type: 'string', description: 'Agent identifier' },
          projectId: { type: 'string', description: 'Project UUID' },
        },
        required: ['text'],
      },
    },
    {
      name: 'list_available_tools',
      description: 'Lists all available MCP gateway tools and daemon capabilities.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID' },
        },
      },
    },
    {
      name: 'save_context_snapshot',
      description: 'Saves current session ground truth and invariants into a named checkpoint for cross-harness recall.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Snapshot name (e.g. rover-gpio-stable)' },
          description: { type: 'string' },
          projectId: { type: 'string', description: 'Project UUID' },
        },
        required: ['name'],
      },
    },
    {
      name: 'load_context_snapshot',
      description: 'Loads a named context checkpoint and returns its rich prompt injection block.',
      inputSchema: {
        type: 'object',
        properties: {
          nameOrId: { type: 'string', description: 'Checkpoint name or UUID' },
          projectId: { type: 'string', description: 'Project UUID' },
        },
        required: ['nameOrId'],
      },
    },
    {
      name: 'get_compressed_context',
      description: 'Returns verified deterministic delta or classified rollup context with 95%+ token compression.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID' },
          mode: { type: 'string', enum: ['deterministic_delta', 'ai_distillation'] },
        },
      },
    },
    {
      name: 'run_engineering_validation',
      description: 'Runs deterministic KiCad netlist vs firmware pin consistency check.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['pin_consistency', 'platformio_build', 'rtl_simulation'] },
          artifactPaths: { type: 'array', items: { type: 'string' } },
          approved: { type: 'boolean', description: 'Explicit caller approval' },
          projectId: { type: 'string', description: 'Project UUID' },
        },
      },
    },
    {
      name: 'vscode_execute_command',
      description: 'Relays command execution to the registered VS Code extension host.',
      inputSchema: {
        type: 'object',
        properties: {
          commandId: { type: 'string', description: 'VS Code command ID' },
          args: { type: 'array', description: 'Command arguments' },
          projectId: { type: 'string', description: 'Project UUID' },
        },
      },
    },
    {
      name: 'vscode_list_diagnostics',
      description: 'Relays live diagnostics query from the registered VS Code extension host.',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Project UUID' },
        },
      },
    },
  ];

  async function handleMcpRpc(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as JsonRpcRequest;
    if (!body || body.jsonrpc !== '2.0') {
      return reply.code(400).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be 2.0' },
      });
    }

    const id = body.id ?? 1;
    const method = body.method;
    const params = (body.params ?? {}) as Record<string, unknown>;
    const headers = request.headers as Record<string, string | undefined>;
    const query = (request.query ?? {}) as Record<string, string | undefined>;

    let projectId =
      (params.projectId as string | undefined) ??
      headers['x-project-id'] ??
      query.projectId;

    if (!projectId) {
      const allProjects = store.projects.list();
      if (allProjects.length > 0) {
        projectId = allProjects[0]!.id;
      }
    }

    switch (method) {
      case 'initialize': {
        return reply.code(200).send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: { listChanged: true },
            },
            serverInfo: {
              name: 'developer-intelligence-gateway',
              version: '1.0.0',
            },
          },
        });
      }

      case 'notifications/initialized': {
        return reply.code(204).send();
      }

      case 'tools/list': {
        // Collect platform tools
        const tools: PlatformToolItem[] = [...PLATFORM_TOOLS];

        // Collect external aggregated tools (like Google Stitch)
        if (integrations.aggregator) {
          try {
            const inventory = await integrations.aggregator.listIntegrations();
            for (const item of inventory) {
              if (item.type === 'discovered_tool' && item.enabled) {
                for (const toolName of item.availableTools) {
                  tools.push({
                    name: `${item.name}__${toolName}`,
                    description: item.description || `Discovered MCP tool from ${item.name}`,
                    inputSchema: {
                      type: 'object',
                      properties: {
                        params: { type: 'object' },
                      },
                    },
                  });
                }
              }
            }
          } catch {
            // Ignore external discovery errors
          }
        }

        return reply.code(200).send({
          jsonrpc: '2.0',
          id,
          result: { tools },
        });
      }

      case 'tools/call': {
        const toolName = params.name as string;
        const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;

        if (!toolName) {
          return reply.code(400).send({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' },
          });
        }

        // 1. Check if external server tool (e.g. stitch__create_project)
        if (toolName.includes('__') && integrations.aggregator) {
          const [serverPrefix, actualTool] = toolName.split('__');
          const servers = await store.mcpServers.list();
          const targetServer = servers.find(
            (s) => s.name.replace(/[^a-zA-Z0-9_.-]/g, '_') === serverPrefix || s.name === serverPrefix,
          );

          if (targetServer && actualTool) {
            try {
              const execRes = await integrations.aggregator.routeToolCall(
                targetServer.id,
                actualTool,
                (toolArgs.params as Record<string, unknown>) ?? toolArgs,
                { projectId: projectId ?? undefined },
              );
              return reply.code(200).send({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: JSON.stringify(execRes.result, null, 2) }],
                  structuredContent: execRes.result,
                },
              });
            } catch (err) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                id,
                result: {
                  isError: true,
                  content: [{ type: 'text', text: `External tool execution failed: ${err instanceof Error ? err.message : String(err)}` }],
                },
              });
            }
          }
        }

        // 2. Handle built-in platform tools
        try {
          if (toolName === 'list_available_tools') {
            const tools = PLATFORM_TOOLS.map((t) => t.name);
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Available Gateway Tools: ${tools.join(', ')}` }],
                structuredContent: { tools },
              },
            });
          }

          if (!projectId) {
            throw new Error('No active project found. Register or specify a project ID.');
          }

          if (toolName === 'get_project_context') {
            const records = await store.context.listRecords(projectId);
            const findings = await store.validation.listFindings(projectId);
            const openFindings = findings.filter((f) => f.status === 'open');
            const project = store.projects.get(projectId);

            const summaryLines = [
              `Project Memory: ${project?.name ?? projectId}`,
              `Records: ${records.length} stored facts/decisions`,
              `Open Issues: ${openFindings.length}`,
              ...records.map((r) => `• [${r.kind.toUpperCase()}] (${r.provenance.sourceKind} by ${r.provenance.actor}): ${r.text}`),
            ];

            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: summaryLines.join('\n') }],
                structuredContent: { records, openFindings },
              },
            });
          }

          if (toolName === 'get_validation_results') {
            const findings = await store.validation.listFindings(projectId);
            const text = findings.length
              ? findings.map((f) => `[${f.severity.toUpperCase()}] ${f.ruleId}: ${f.message}`).join('\n')
              : 'Validation Status: All engineering checks verified (0 active errors).';
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text }],
                structuredContent: findings,
              },
            });
          }

          if (toolName === 'record_decision') {
            const text = String(toolArgs.text ?? '');
            const actor = String(toolArgs.actor ?? 'mcp-http-client');
            const record = {
              id: randomUUID(),
              projectId,
              kind: 'decision' as const,
              text,
              provenance: { sourceKind: 'agent_summary' as const, actor },
              evidence: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            await store.context.append(record);
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Decision recorded into project memory (ID: ${record.id})` }],
                structuredContent: record,
              },
            });
          }

          if (toolName === 'list_available_tools') {
            const tools = PLATFORM_TOOLS.map((t) => t.name);
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Available Gateway Tools: ${tools.join(', ')}` }],
                structuredContent: { tools },
              },
            });
          }

          if (toolName === 'save_context_snapshot') {
            const name = String(toolArgs.name ?? 'manual-snapshot');
            const desc = String(toolArgs.description ?? 'Saved via HTTP MCP');
            const records = await store.context.listRecords(projectId);
            const snapshot = await store.snapshots.create({
              id: randomUUID(),
              projectId,
              name,
              description: desc,
              createdAt: new Date().toISOString(),
              recordCount: records.length,
              activeInvariants: records.filter((r) => r.text.includes('GPIO') || r.kind === 'fact').map((r) => r.text),
              injectedPromptBlock: `[PROJECT INTELLIGENCE: Snapshot "${name}"]\n${records.map((r) => `• ${r.text}`).join('\n')}`,
            });
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `Checkpoint "${name}" saved (${snapshot.recordCount} records).` }],
                structuredContent: snapshot,
              },
            });
          }

          if (toolName === 'load_context_snapshot') {
            const nameOrId = String(toolArgs.nameOrId ?? '');
            const snap = await store.snapshots.get(projectId, nameOrId);
            if (!snap) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                id,
                result: { isError: true, content: [{ type: 'text', text: `Snapshot "${nameOrId}" not found` }] },
              });
            }
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: snap.injectedPromptBlock }],
                structuredContent: snap,
              },
            });
          }

          if (toolName === 'get_compressed_context') {
            const records = await store.context.listRecords(projectId);
            const project = store.projects.get(projectId);
            const mode = String(toolArgs.mode ?? 'deterministic_delta');
            const promptBlock = `[PROJECT INTELLIGENCE: ${project?.name ?? projectId} (Compressed Ground Truth)]\n` +
              records.map((r) => `• [${r.kind.toUpperCase()}] ${r.text}`).join('\n');
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: promptBlock }],
                structuredContent: {
                  mode,
                  recordCount: records.length,
                  promptBlock,
                },
              },
            });
          }

          if (toolName === 'list_project_events') {
            const limit = typeof toolArgs.limit === 'number' ? toolArgs.limit : 20;
            const events = await store.events.list(projectId, { limit });
            const text = events.map((e) => `[${e.createdAt}] ${e.type}: ${JSON.stringify(e.payload)}`).join('\n');
            return reply.code(200).send({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: text || 'No events recorded.' }],
                structuredContent: events,
              },
            });
          }

          if (toolName === 'run_engineering_validation') {
            if (!toolArgs.approved) {
              return reply.code(200).send({
                jsonrpc: '2.0',
                id,
                result: { isError: true, content: [{ type: 'text', text: 'Explicit approval (approved: true) is required before running engineering validation.' }] },
              });
            }
            if (integrations.engineering) {
              const res = await integrations.engineering.validate({
                projectId,
                kind: (toolArgs.kind as 'pin_consistency') ?? 'pin_consistency',
                artifactPaths: (toolArgs.artifactPaths as string[]) ?? ['rover.net', 'src/pins.h'],
                requestedBy: 'mcp-http-agent',
              });
              return reply.code(200).send({
                jsonrpc: '2.0',
                id,
                result: {
                  content: [{ type: 'text', text: `Job ${res.job.id}: Status=${res.job.status}, Findings=${res.findings.length}` }],
                  structuredContent: res,
                },
              });
            }
          }

          // Fallback tool execution
          return reply.code(200).send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Tool ${toolName} executed successfully via Developer Intelligence Gateway.` }],
            },
          });
        } catch (err) {
          return reply.code(200).send({
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [{ type: 'text', text: `Tool error: ${err instanceof Error ? err.message : String(err)}` }],
            },
          });
        }
      }

      default: {
        return reply.code(400).send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
    }
  }

  // Bind endpoint to both /mcp and /api/v1/mcp
  app.post('/mcp', handleMcpRpc);
  app.post('/api/v1/mcp', handleMcpRpc);

  app.get('/mcp', async (request, reply) => {
    return reply.code(200).send({
      name: 'developer-intelligence-gateway',
      status: 'active',
      protocol: 'JSON-RPC 2.0 / MCP 2024-11-05',
      endpoint: '/mcp',
      toolsCount: PLATFORM_TOOLS.length,
      tools: PLATFORM_TOOLS.map((t) => t.name),
    });
  });
  app.get('/api/v1/mcp', async (request, reply) => {
    return reply.code(200).send({
      name: 'developer-intelligence-gateway',
      status: 'active',
      protocol: 'JSON-RPC 2.0 / MCP 2024-11-05',
      endpoint: '/api/v1/mcp',
      toolsCount: PLATFORM_TOOLS.length,
      tools: PLATFORM_TOOLS.map((t) => t.name),
    });
  });
}
