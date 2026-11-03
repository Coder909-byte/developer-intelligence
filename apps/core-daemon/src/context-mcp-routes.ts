// Spec 2 ports only. No proxy, classifier, model calls or second database.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  API_PREFIX,
  IdSchema,
  ToolCategorySchema,
  ToggleCategoryRequestSchema,
  CompressionQuerySchema,
  BridgedExtensionToolSchema,
  BridgeCallSchema,
  BridgeResultSchema,
  type ToolCategory,
  type BridgedExtensionTool,
  type ActivityEvent,
  type ContextRecord,
  type ValidationFinding,
  type BridgeInvocationSchema,
  type IntegrationItem,
} from '@udi/contracts';
import { PersistenceError, type PlatformDatabase } from '@udi/event-store';
import {
  buildDeterministicDelta,
  buildDistilledRollup,
  CompressionUnavailableError,
} from '@udi/context-engine';
import { apiSuccess, responseMeta } from './responses.js';

export function registerContextMcpRoutes(
  app: FastifyInstance,
  store: PlatformDatabase,
  inventory: () => Promise<IntegrationItem[]> = async () => [],
) {
  const prefix = API_PREFIX;
  const scope = (params: unknown) => {
    const { id } = z.object({ id: IdSchema }).parse(params);
    if (!store.projects.get(id)) throw new PersistenceError('NOT_FOUND', 'Project not found');
    return id;
  };
  async function all<T>(read: (offset: number) => Promise<T[]>): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await read(offset);
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  }
  const hosts = new Map<string, { tool: BridgedExtensionTool; seen: number }>();
  type Invocation = z.infer<typeof BridgeInvocationSchema>;
  const calls = new Map<
    string,
    {
      request: Invocation;
      resolve: (result: z.infer<typeof BridgeResultSchema>) => void;
      timer: ReturnType<typeof setTimeout>;
      delivered: boolean;
    }
  >();
  let lastWrite = 0;
  function tools(projectId: string) {
    for (const [key, host] of hosts) if (Date.now() - host.seen > 10000) hosts.delete(key);
    return [...hosts.values()].filter((h) => h.tool.projectId === projectId).map((h) => h.tool);
  }
  async function categories(projectId: string) {
    const events = await all<ActivityEvent>((offset) =>
      store.events.list(projectId, { type: 'mcp.category.configured', limit: 500, offset }),
    );
    const state = new Map<ToolCategory, boolean>(ToolCategorySchema.options.map((c) => [c, true]));
    for (const e of events) {
      const parsed = ToggleCategoryRequestSchema.safeParse(e.payload);
      if (parsed.success && parsed.data.projectId === projectId)
        state.set(parsed.data.category, parsed.data.enabled);
    }
    return { state, last: events.at(-1)?.createdAt };
  }
  app.get(`${prefix}/projects/:id/tool-categories`, async (request) => {
    const projectId = scope(request.params);
    const { state } = await categories(projectId);
    const externalCount = (await inventory()).filter(
      (i) => i.type === 'discovered_tool' && i.enabled,
    ).length;
    return apiSuccess(
      {
        projectId,
        categories: ToolCategorySchema.options.map((category) => ({
          category,
          enabled: state.get(category)!,
          name: category.replaceAll('_', ' '),
          description: `MCP ${category.replaceAll('_', ' ')} tools`,
          toolCount:
            category === 'context_memory'
              ? 5
              : category === 'hardware_validation'
                ? 2
                : category === 'ide_extension_bridge'
                  ? 2
                  : externalCount,
        })),
      },
      request.id,
    );
  });
  app.put(`${prefix}/projects/:id/tool-categories`, async (request) => {
    const projectId = scope(request.params);
    const input = ToggleCategoryRequestSchema.parse(request.body);
    if (input.projectId !== projectId)
      throw new PersistenceError('VALIDATION_ERROR', 'Category project mismatch');
    const previous = await categories(projectId);
    lastWrite = Math.max(Date.now(), lastWrite + 1, Date.parse(previous.last ?? '') + 1 || 0);
    await store.events.append({
      id: randomUUID(),
      projectId,
      type: 'mcp.category.configured',
      actor: 'local-user',
      sourceKind: 'user_entered',
      createdAt: new Date(lastWrite).toISOString(),
      schemaVersion: 1,
      payload: input,
    });
    return apiSuccess(input, request.id);
  });
  app.get(`${prefix}/projects/:id/compressed-context`, async (request, reply) => {
    const projectId = scope(request.params);
    const { mode } = CompressionQuerySchema.parse(request.query);
    const records = await all<ContextRecord>((offset) =>
      store.context.listRecords(projectId, { limit: 500, offset }),
    );
    const findings = await all<ValidationFinding>((offset) =>
      store.validation.listFindings(projectId, { limit: 500, offset }),
    );
    const events = await all<ActivityEvent>((offset) =>
      store.events.list(projectId, { limit: 500, offset }),
    );
    const completed = events
      .filter(
        (e) =>
          e.type === 'engineering.validation.completed' ||
          e.type === 'engineering.correction.applied' ||
          e.type === 'engineering.correction.rolled_back',
      )
      .at(-1);
    const latestJob = completed?.sourceRef
      ? await store.validation.getJob(projectId, completed.sourceRef)
      : undefined;
    const input = {
      projectId,
      projectName: store.projects.get(projectId)!.name,
      records,
      findings,
      events,
      ...(latestJob ? { latestJob } : {}),
    };
    try {
      return apiSuccess(
        mode === 'deterministic_delta'
          ? buildDeterministicDelta(input)
          : buildDistilledRollup(input),
        request.id,
      );
    } catch (error) {
      if (!(error instanceof CompressionUnavailableError)) throw error;
      return reply.code(501).send({
        ok: false,
        error: { code: 'NOT_IMPLEMENTED', message: error.message },
        meta: responseMeta(request.id),
      });
    }
  });
  app.get(`${prefix}/projects/:id/extension-tools`, async (request) =>
    apiSuccess({ items: tools(scope(request.params)) }, request.id),
  );
  app.post(`${prefix}/projects/:id/extension-tools`, async (request) => {
    const projectId = scope(request.params);
    const input = BridgedExtensionToolSchema.parse(request.body);
    if (input.projectId !== projectId)
      throw new PersistenceError('VALIDATION_ERROR', 'Bridge project mismatch');
    hosts.set(`${projectId}:${input.hostId}:${input.name}`, { tool: input, seen: Date.now() });
    return apiSuccess(input, request.id);
  });
  app.get(`${prefix}/projects/:id/extension-hosts/:hostId/requests`, async (request) => {
    const projectId = scope(request.params);
    const { hostId } = z.object({ hostId: IdSchema }).parse(request.params);
    for (const host of hosts.values())
      if (host.tool.projectId === projectId && host.tool.hostId === hostId) host.seen = Date.now();
    const pending = [...calls.values()].filter(
      (c) => c.request.projectId === projectId && c.request.hostId === hostId && !c.delivered,
    );
    pending.forEach((c) => (c.delivered = true));
    return apiSuccess({ items: pending.map((c) => c.request) }, request.id);
  });
  app.post(`${prefix}/projects/:id/extension-hosts/:hostId/results/:callId`, async (request) => {
    const projectId = scope(request.params);
    const { hostId, callId } = z
      .object({ hostId: IdSchema, callId: IdSchema })
      .parse(request.params);
    const pending = calls.get(callId);
    if (!pending || pending.request.projectId !== projectId || pending.request.hostId !== hostId)
      throw new PersistenceError('NOT_FOUND', 'Bridge request unavailable');
    const result = BridgeResultSchema.parse(request.body);
    const completedAt = new Date().toISOString();
    await store.events.append({
      id: callId,
      projectId,
      type: 'mcp.extension.executed',
      actor: 'vscode-extension',
      sourceKind: 'observed_tool',
      sourceRef: callId,
      createdAt: completedAt,
      schemaVersion: 1,
      payload: {
        hostId,
        toolName: pending.request.name,
        outcome: result.isError ? 'failed' : 'succeeded',
      },
    });
    await store.context.append({
      id: randomUUID(),
      projectId,
      kind: 'fact',
      text: `VS Code bridge ${pending.request.name}: ${result.isError ? 'failed' : 'succeeded'}`,
      createdAt: completedAt,
      updatedAt: completedAt,
      provenance: { sourceKind: 'observed_tool', actor: 'vscode-extension', sourceRef: callId },
      evidence: [],
    });
    clearTimeout(pending.timer);
    calls.delete(callId);
    pending.resolve(result);
    return apiSuccess({ id: callId, deleted: true as const }, request.id);
  });
  app.post(`${prefix}/projects/:id/extension-tools/call`, async (request) => {
    const projectId = scope(request.params);
    const input = BridgeCallSchema.parse(request.body);
    if (!(await categories(projectId)).state.get('ide_extension_bridge'))
      return apiSuccess(
        { isError: true, content: 'IDE extension bridge category is disabled' },
        request.id,
      );
    const matches = tools(projectId).filter((t) => t.name === input.name);
    if (matches.length !== 1)
      throw new PersistenceError(
        'VALIDATION_ERROR',
        matches.length
          ? 'Select a single extension host for this project'
          : 'No live extension host is registered',
      );
    const host = matches[0]!;
    if (
      input.name === 'vscode_execute_command' &&
      (typeof input.arguments.commandId !== 'string' ||
        !host.commandIds.includes(input.arguments.commandId))
    )
      throw new PersistenceError(
        'VALIDATION_ERROR',
        'Command is not registered by the extension host',
      );
    const id = randomUUID();
    const result = await new Promise<z.infer<typeof BridgeResultSchema>>((resolve) => {
      const timer = setTimeout(() => {
        calls.delete(id);
        resolve({
          isError: true,
          content: 'Extension request timed out; do not retry automatically',
        });
      }, 20000);
      calls.set(id, {
        request: {
          id,
          projectId,
          hostId: host.hostId,
          name: input.name,
          arguments: input.arguments,
          expiresAt: new Date(Date.now() + 20000).toISOString(),
        },
        resolve,
        timer,
        delivered: false,
      });
    });
    return apiSuccess(result, request.id);
  });
  app.addHook('onClose', async () => {
    for (const call of calls.values()) {
      clearTimeout(call.timer);
      call.resolve({ isError: true, content: 'Daemon shutting down' });
    }
    calls.clear();
    hosts.clear();
  });
}
