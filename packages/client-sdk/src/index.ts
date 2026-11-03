import { z } from 'zod';
import {
  API_PREFIX,
  successSchema,
  ErrorResponseSchema,
  ProjectSchema,
  ProjectCreateSchema,
  ProjectUpdateSchema,
  ProjectListSchema,
  HealthSchema,
  IdSchema,
  DeleteResultSchema,
  ProjectMemorySchema,
  FindingListSchema,
  McpServerListSchema,
  type ApiError,
  type ProjectCreate,
  type ProjectUpdate,
} from '@udi/contracts';
export class DaemonClientError extends Error {
  constructor(
    public readonly code: ApiError['code'],
    message: string,
    public readonly status?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DaemonClientError';
  }
}
export interface ClientOptions {
  baseUrl?: string;
  token?: string | (() => string | undefined);
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}
export function createClient(options: ClientOptions = {}) {
  const url = new URL(options.baseUrl ?? 'http://127.0.0.1:4317');
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Daemon URL must be an HTTP loopback origin');
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('timeoutMs must be positive and finite');
  const fetcher = options.fetch ?? globalThis.fetch;
  async function request<T extends z.ZodType>(
    method: string,
    path: string,
    schema: T,
    body?: unknown,
  ): Promise<z.output<T>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      const token = typeof options.token === 'function' ? options.token() : options.token;
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetcher(`${url.origin}${API_PREFIX}${path}`, {
        method,
        headers,
        signal: controller.signal,
        redirect: 'error',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new DaemonClientError(
          'INVALID_RESPONSE',
          'Daemon response was not JSON',
          response.status,
        );
      }
      if (!response.ok) {
        const parsed = ErrorResponseSchema.safeParse(json);
        if (!parsed.success)
          throw new DaemonClientError(
            'INVALID_RESPONSE',
            'Daemon returned an invalid error envelope',
            response.status,
          );
        throw new DaemonClientError(
          parsed.data.error.code,
          parsed.data.error.message,
          response.status,
          parsed.data.error.details,
        );
      }
      const parsed = successSchema(z.unknown()).safeParse(json);
      if (!parsed.success)
        throw new DaemonClientError(
          'INVALID_RESPONSE',
          'Daemon response does not match the v1 contract',
          response.status,
          parsed.error.issues,
        );
      const data = schema.safeParse(parsed.data.data);
      if (!data.success)
        throw new DaemonClientError(
          'INVALID_RESPONSE',
          'Daemon data does not match the v1 contract',
          response.status,
          data.error.issues,
        );
      return data.data;
    };
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new DaemonClientError('TIMEOUT', `Daemon request exceeded ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof DaemonClientError) throw error;
      throw new DaemonClientError('CONNECTION_ERROR', 'Cannot connect to the local daemon');
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    health: () => request('GET', '/health', HealthSchema),
    listProjects: () => request('GET', '/projects', ProjectListSchema),
    createProject: (input: ProjectCreate) =>
      request('POST', '/projects', ProjectSchema, ProjectCreateSchema.parse(input)),
    getProject: (id: string) => request('GET', `/projects/${IdSchema.parse(id)}`, ProjectSchema),
    updateProject: (id: string, input: ProjectUpdate) =>
      request(
        'PATCH',
        `/projects/${IdSchema.parse(id)}`,
        ProjectSchema,
        ProjectUpdateSchema.parse(input),
      ),
    deleteProject: (id: string) =>
      request('DELETE', `/projects/${IdSchema.parse(id)}`, DeleteResultSchema),
    getContext: (id: string) =>
      request('GET', `/projects/${IdSchema.parse(id)}/context`, ProjectMemorySchema),
    listMcpServers: () => request('GET', '/mcp/servers', McpServerListSchema),
    listFindings: (projectId: string) =>
      request(
        'GET',
        `/engineering/findings?projectId=${IdSchema.parse(projectId)}`,
        FindingListSchema,
      ),
  };
}
export type DaemonClient = ReturnType<typeof createClient>;
