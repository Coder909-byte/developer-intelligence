import Fastify, { LogController } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import {
  API_PREFIX,
  API_VERSION,
  HealthSchema,
  IdSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  type ApiError,
} from '@udi/contracts';
import { openDatabase, PersistenceError } from '@udi/event-store';
import { registerPlatformRoutes, type IntegrationFactory } from './platform-routes.js';
import { apiSuccess as success, responseMeta as meta } from './responses.js';
export interface AppOptions {
  databasePath: string;
  token: string;
  logger?: boolean;
  integrations?: IntegrationFactory;
}
export function buildApp(options: AppOptions) {
  if (options.token.length < 32) throw new Error('Local token must be at least 32 characters');
  const store = openDatabase(options.databasePath);
  const app = Fastify({
    logger: options.logger ?? true,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 64 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.addHook('onClose', async () => {
    store.close();
  });
  const fail = (code: ApiError['code'], message: string) => ({ code, message });
  const allowedOrigins = new Set([
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
  ]);
  app.addHook('onRequest', async (request, reply) => {
    const hostname = request.headers.host?.split(':')[0];
    if (hostname !== '127.0.0.1' && hostname !== 'localhost')
      return reply.code(403).send({
        ok: false,
        error: fail('FORBIDDEN', 'Loopback Host header required'),
        meta: meta(request.id),
      });
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin))
      return reply.code(403).send({
        ok: false,
        error: fail('FORBIDDEN', 'Origin is not allowed'),
        meta: meta(request.id),
      });
    if (origin) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS')
      return reply
        .header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        .code(204)
        .send();
    if (request.method === 'GET' && request.url.split('?')[0] === `${API_PREFIX}/health`) return;
    const supplied = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return reply.code(401).send({
        ok: false,
        error: fail('UNAUTHORIZED', 'A valid local daemon token is required'),
        meta: meta(request.id),
      });
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
      },
      'request completed',
    );
  });
  app.setErrorHandler((error, request, reply) => {
    const parsedError = z
      .object({
        code: z.string().optional(),
        statusCode: z.number().optional(),
        message: z.string().optional(),
      })
      .safeParse(error);
    const info = parsedError.success ? parsedError.data : {};
    let status = 500;
    let apiError = fail('INTERNAL_ERROR', 'An internal error occurred');
    if (
      error instanceof PersistenceError ||
      (error as { name?: string })?.name === 'PersistenceError' ||
      (error as { name?: string })?.name === 'CorrectionError'
    ) {
      const code = (
        error as { code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_ERROR' | 'UNAUTHORIZED' }
      ).code;
      status =
        { NOT_FOUND: 404, CONFLICT: 409, VALIDATION_ERROR: 400, UNAUTHORIZED: 401 }[code] ?? 500;
      apiError = fail(
        code === 'UNAUTHORIZED' ? 'UNAUTHORIZED' : (code as ApiError['code']),
        (error as Error).message,
      );
    } else if (error instanceof z.ZodError) {
      status = 400;
      apiError = fail(
        'VALIDATION_ERROR',
        error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      );
    } else if (
      info.code === 'ERR_SQLITE_ERROR' &&
      /UNIQUE constraint failed/.test(info.message ?? '')
    ) {
      status = 409;
      apiError = fail('CONFLICT', 'A project already uses this workspace path');
    } else if (info.statusCode === 400 || info.statusCode === 413 || info.statusCode === 415) {
      status = info.statusCode;
      apiError = fail(
        'VALIDATION_ERROR',
        'Invalid JSON, unsupported content type, or request body too large',
      );
    } else {
      request.log.error({ requestId: request.id, code: info.code }, 'request failed');
    }
    reply.code(status).send({ ok: false, error: apiError, meta: meta(request.id) });
  });
  app.setNotFoundHandler((request, reply) =>
    reply
      .code(404)
      .send({ ok: false, error: fail('NOT_FOUND', 'Route not found'), meta: meta(request.id) }),
  );
  async function canonicalPath(path: string) {
    if (!isAbsolute(path))
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['rootPath'],
          message: 'An absolute existing directory is required',
        },
      ]);
    try {
      const resolved = await realpath(path);
      if (!(await stat(resolved)).isDirectory()) throw new Error('Not a directory');
      return resolved;
    } catch {
      throw new z.ZodError([
        {
          code: 'custom',
          path: ['rootPath'],
          message: 'Workspace directory does not exist or is inaccessible',
        },
      ]);
    }
  }
  const integrations = options.integrations?.(store) ?? {};
  const idFrom = (params: unknown) => z.object({ id: IdSchema }).parse(params).id;
  app.get(`${API_PREFIX}/health`, async (request) =>
    success(
      HealthSchema.parse({
        status: 'ok',
        version: '0.1.0',
        apiVersion: API_VERSION,
        database: 'ready',
        capabilities: {
          projects: true,
          context: Boolean(integrations.context),
          mcp: Boolean(integrations.mcp),
          engineering: Boolean(integrations.engineering),
        },
      }),
      request.id,
    ),
  );
  app.get(`${API_PREFIX}/projects`, async (request) =>
    success({ items: store.projects.list() }, request.id),
  );
  app.post(`${API_PREFIX}/projects`, async (request, reply) => {
    const input = ProjectCreateSchema.parse(request.body);
    input.rootPath = await canonicalPath(input.rootPath);
    const project = store.projects.create(input);
    return reply
      .code(201)
      .header('Location', `${API_PREFIX}/projects/${project.id}`)
      .send(success(project, request.id));
  });
  app.get(`${API_PREFIX}/projects/:id`, async (request, reply) => {
    const project = store.projects.get(idFrom(request.params));
    return project
      ? success(project, request.id)
      : reply.code(404).send({
          ok: false,
          error: fail('NOT_FOUND', 'Project not found'),
          meta: meta(request.id),
        });
  });
  app.patch(`${API_PREFIX}/projects/:id`, async (request, reply) => {
    const id = idFrom(request.params);
    const input = ProjectUpdateSchema.parse(request.body);
    if (input.rootPath !== undefined) input.rootPath = await canonicalPath(input.rootPath);
    const project = store.projects.update(id, input);
    return project
      ? success(project, request.id)
      : reply.code(404).send({
          ok: false,
          error: fail('NOT_FOUND', 'Project not found'),
          meta: meta(request.id),
        });
  });
  app.delete(`${API_PREFIX}/projects/:id`, async (request, reply) => {
    const id = idFrom(request.params);
    return store.projects.delete(id)
      ? success({ id, deleted: true }, request.id)
      : reply.code(404).send({
          ok: false,
          error: fail('NOT_FOUND', 'Project not found'),
          meta: meta(request.id),
        });
  });
  registerPlatformRoutes(app, store, integrations);
  return app;
}
