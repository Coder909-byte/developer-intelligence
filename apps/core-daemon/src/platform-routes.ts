import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  API_PREFIX,
  IdSchema,
  PageQuerySchema,
  EventQuerySchema,
  FindingQuerySchema,
  EventCreateSchema,
  ContextRecordCreateSchema,
  HandoffCreateSchema,
  McpServerCreateSchema,
  McpServerUpdateSchema,
  ValidationResultSchema,
  ValidationRequestBodySchema,
  ProjectMemorySchema,
  type ProjectMemory,
  type ValidationRequest,
  type ValidationFinding,
  type Job,
  type McpServer,
} from '@udi/contracts';
import { PersistenceError, type PlatformDatabase } from '@udi/event-store';
import { buildContextRecord } from '@udi/context-engine';
import { apiSuccess, responseMeta } from './responses.js';

/** Structurally compatible with Developer 2's ContextEngine; factory receives daemon-owned ports. */
export interface ProjectContextProvider {
  getContext(projectId: string, maxItems?: number): Promise<ProjectMemory>;
}

export interface PlatformValidationRunner {
  validate(
    request: ValidationRequest,
    signal?: AbortSignal,
  ): Promise<{ job: Job; findings: ValidationFinding[] }>;
}

export interface PlatformMcpHealthChecker {
  checkHealth(id: string): Promise<McpServer>;
}

export interface PlatformIntegrations {
  context?: ProjectContextProvider;
  engineering?: PlatformValidationRunner;
  mcp?: PlatformMcpHealthChecker;
}
export type IntegrationFactory = (
  repositories: Omit<PlatformDatabase, 'close'>,
) => PlatformIntegrations;

export function registerPlatformRoutes(
  app: FastifyInstance,
  store: PlatformDatabase,
  integrations: PlatformIntegrations,
) {
  const prefix = API_PREFIX;
  const projectId = (params: unknown) => {
    const { id } = z.object({ id: IdSchema }).parse(params);
    if (!store.projects.get(id)) throw new PersistenceError('NOT_FOUND', 'Project not found');
    return id;
  };
  const routeId = (params: unknown) => z.object({ id: IdSchema }).parse(params).id;
  const entity = () => {
    const now = new Date().toISOString();
    return { id: randomUUID(), createdAt: now, updatedAt: now };
  };
  const found = <T>(value: T | undefined, name: string): T => {
    if (value === undefined) throw new PersistenceError('NOT_FOUND', `${name} not found`);
    return value;
  };

  app.get(`${prefix}/projects/:id/events`, async (request) =>
    apiSuccess(
      {
        items: await store.events.list(
          projectId(request.params),
          EventQuerySchema.parse(request.query),
        ),
      },
      request.id,
    ),
  );
  app.post(`${prefix}/projects/:id/events`, async (request, reply) => {
    const id = projectId(request.params);
    const input = EventCreateSchema.parse(request.body);
    const event = {
      ...input,
      id: randomUUID(),
      projectId: id,
      createdAt: new Date().toISOString(),
      schemaVersion: 1 as const,
    };
    await store.events.append(event);
    return reply
      .code(201)
      .header('Location', `${prefix}/projects/${id}/events/${event.id}`)
      .send(apiSuccess(event, request.id));
  });
  app.get(`${prefix}/projects/:id/events/:eventId`, async (request) => {
    const id = projectId(request.params);
    const { eventId } = z.object({ eventId: IdSchema }).parse(request.params);
    return apiSuccess(found(await store.events.get(id, eventId), 'Event'), request.id);
  });

  app.get(`${prefix}/projects/:id/context/records`, async (request) =>
    apiSuccess(
      {
        items: await store.context.list(
          projectId(request.params),
          PageQuerySchema.parse(request.query),
        ),
      },
      request.id,
    ),
  );
  app.post(`${prefix}/projects/:id/context/records`, async (request, reply) => {
    const id = projectId(request.params);
    const record = { ...ContextRecordCreateSchema.parse(request.body), ...entity(), projectId: id };
    await store.context.append(record);
    return reply
      .code(201)
      .header('Location', `${prefix}/projects/${id}/context/records/${record.id}`)
      .send(apiSuccess(record, request.id));
  });
  app.get(`${prefix}/projects/:id/context/records/:recordId`, async (request) => {
    const id = projectId(request.params);
    const { recordId } = z.object({ recordId: IdSchema }).parse(request.params);
    return apiSuccess(found(await store.context.get(id, recordId), 'Context record'), request.id);
  });
  app.get(`${prefix}/projects/:id/context`, async (request) => {
    const id = projectId(request.params);
    const { maxItems } = z
      .strictObject({ maxItems: z.coerce.number().int().min(1).max(500).default(100) })
      .parse(request.query);
    let context: ProjectMemory;
    if (integrations.context) {
      // Validate plugin output as an internal boundary. Invalid adapter output is never a client 400.
      const parsed = ProjectMemorySchema.safeParse(
        await integrations.context.getContext(id, maxItems),
      );
      if (
        !parsed.success ||
        parsed.data.projectId !== id ||
        parsed.data.records.some((record) => record.projectId !== id) ||
        parsed.data.records.length > maxItems
      )
        throw new Error('Context provider returned an invalid or incorrectly scoped result');
      context = parsed.data;
    } else {
      const records = await store.context.list(id, { limit: maxItems });
      context = {
        projectId: id,
        generatedAt: new Date().toISOString(),
        schemaVersion: 1,
        records,
        openIssues: records
          .filter((record) => record.kind === 'issue')
          .map((record) => record.text),
      };
    }
    return apiSuccess(context, request.id);
  });

  app.get(`${prefix}/projects/:id/handoffs`, async (request) =>
    apiSuccess(
      {
        items: await store.handoffs.list(
          projectId(request.params),
          PageQuerySchema.parse(request.query),
        ),
      },
      request.id,
    ),
  );
  app.post(`${prefix}/projects/:id/handoffs`, async (request, reply) => {
    const id = projectId(request.params);
    const handoff = { ...HandoffCreateSchema.parse(request.body), ...entity(), projectId: id };
    await store.handoffs.append(handoff);
    return reply
      .code(201)
      .header('Location', `${prefix}/projects/${id}/handoffs/${handoff.id}`)
      .send(apiSuccess(handoff, request.id));
  });
  app.get(`${prefix}/projects/:id/handoffs/:handoffId`, async (request) => {
    const id = projectId(request.params);
    const { handoffId } = z.object({ handoffId: IdSchema }).parse(request.params);
    return apiSuccess(found(await store.handoffs.get(id, handoffId), 'Handoff'), request.id);
  });

  app.get(`${prefix}/mcp/servers`, async (request) =>
    apiSuccess(
      { items: await store.mcpServers.list(PageQuerySchema.parse(request.query)) },
      request.id,
    ),
  );
  app.post(`${prefix}/mcp/servers`, async (request, reply) => {
    const input = McpServerCreateSchema.parse(request.body);
    const server = {
      ...input,
      ...entity(),
      status: input.enabled ? ('unknown' as const) : ('disabled' as const),
    };
    await store.mcpServers.register(server);
    return reply
      .code(201)
      .header('Location', `${prefix}/mcp/servers/${server.id}`)
      .send(apiSuccess(server, request.id));
  });
  app.get(`${prefix}/mcp/servers/:id`, async (request) =>
    apiSuccess(
      found(await store.mcpServers.get(routeId(request.params)), 'MCP server'),
      request.id,
    ),
  );
  app.put(`${prefix}/mcp/servers/:id`, async (request) => {
    const previous = found(await store.mcpServers.get(routeId(request.params)), 'MCP server');
    const server = {
      ...McpServerUpdateSchema.parse(request.body),
      id: previous.id,
      createdAt: previous.createdAt,
      updatedAt: new Date().toISOString(),
    };
    return apiSuccess(await store.mcpServers.replace(server), request.id);
  });
  app.delete(`${prefix}/mcp/servers/:id`, async (request) => {
    const id = routeId(request.params);
    if (!(await store.mcpServers.delete(id)))
      throw new PersistenceError('NOT_FOUND', 'MCP server not found');
    return apiSuccess({ id, deleted: true as const }, request.id);
  });

  app.post(`${prefix}/projects/:id/validation-results`, async (request, reply) => {
    const id = projectId(request.params);
    const result = ValidationResultSchema.parse(request.body);
    if (result.job.projectId !== id)
      throw new PersistenceError(
        'VALIDATION_ERROR',
        'Validation result must belong to the route project',
      );
    await store.validation.recordResult(result);
    return reply
      .code(201)
      .header('Location', `${prefix}/jobs/${result.job.id}?projectId=${id}`)
      .send(apiSuccess(result, request.id));
  });
  app.get(`${prefix}/engineering/findings`, async (request) => {
    const { projectId: id, ...query } = FindingQuerySchema.extend({ projectId: IdSchema }).parse(
      request.query,
    );
    return apiSuccess({ items: await store.validation.listFindings(id, query) }, request.id);
  });
  app.get(`${prefix}/jobs/:id`, async (request) => {
    const { projectId: id } = z.strictObject({ projectId: IdSchema }).parse(request.query);
    return apiSuccess(
      found(await store.validation.getJob(id, routeId(request.params)), 'Job'),
      request.id,
    );
  });

  // Validation execution and MCP health checks: run through Developer 2's integrations when provided.
  app.post(`${prefix}/projects/:id/validation-jobs`, async (request, reply) => {
    const id = projectId(request.params);
    const body = ValidationRequestBodySchema.parse(request.body);

    if (integrations.engineering) {
      const valRequest: ValidationRequest = {
        ...body,
        projectId: id,
      };
      const parsed = ValidationResultSchema.safeParse(
        await integrations.engineering.validate(valRequest),
      );
      if (!parsed.success || parsed.data.job.projectId !== id)
        throw new Error('Engineering provider returned an invalid or incorrectly scoped result');
      const result = parsed.data;
      await store.validation.recordResult(result);

      // Record activity event
      await store.events.append({
        id: randomUUID(),
        projectId: id,
        type: 'engineering.validation.completed',
        actor: 'engineering-core',
        sourceKind: 'observed_tool',
        sourceRef: result.job.id,
        createdAt: new Date().toISOString(),
        schemaVersion: 1,
        payload: {
          jobId: result.job.id,
          status: result.job.status,
          findingCount: result.findings.length,
        },
      });

      // Persist only actual validator observations. Context synthesis remains Developer 2's engine.
      // Both failed and successful runs are historical facts; success must not leave an artificial open issue.
      await store.context.append(
        buildContextRecord(id, {
          kind: 'fact',
          text: `${body.kind} ${result.job.status}: ${result.findings.length} finding(s). ${result.findings.map((finding) => finding.message).join('; ') || result.job.stdoutTail || result.job.stderrTail}`,
          provenance: {
            sourceKind: 'observed_tool',
            actor: 'engineering-core',
            sourceRef: result.job.id,
          },
          evidence: result.findings.length
            ? result.findings.flatMap((finding) => finding.evidence)
            : result.job.artifacts.map((filePath) => ({ filePath })),
        }),
      );

      return reply
        .code(201)
        .header('Location', `${prefix}/jobs/${result.job.id}?projectId=${id}`)
        .send(apiSuccess(result.job, request.id));
    }

    return reply.code(501).send({
      ok: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          "Validation execution requires Developer 2's engineering implementation; record completed results through validation-results",
      },
      meta: responseMeta(request.id),
    });
  });

  app.post(`${prefix}/mcp/servers/:id/health-check`, async (request, reply) => {
    const serverId = routeId(request.params);
    found(await store.mcpServers.get(serverId), 'MCP server');

    if (integrations.mcp) {
      const updated = await integrations.mcp.checkHealth(serverId);
      return apiSuccess(updated, request.id);
    }

    return reply.code(501).send({
      ok: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: "MCP execution and health checks require Developer 2's gateway implementation",
      },
      meta: responseMeta(request.id),
    });
  });
}
