import { z } from 'zod';
import {
  API_PREFIX,
  ActivityEventSchema,
  EventCreateSchema,
  EventListSchema,
  EventQuerySchema,
  ContextRecordSchema,
  ContextRecordCreateSchema,
  ContextRecordListSchema,
  AgentHandoffSchema,
  HandoffCreateSchema,
  HandoffListSchema,
  McpServerSchema,
  McpServerCreateSchema,
  McpServerUpdateSchema,
  ValidationResultSchema,
  ValidationRequestBodySchema,
  CorrectionPreviewRequestSchema,
  CorrectionPreviewSchema,
  CorrectionApplyRequestSchema,
  CorrectionApplyResultSchema,
  CorrectionRollbackRequestSchema,
  CorrectionRollbackResultSchema,
  type CorrectionPreviewRequest,
  type CorrectionApplyRequest,
  type CorrectionRollbackRequest,
  JobSchema,
  PageQuerySchema,
  FindingQuerySchema,
  type EventCreate,
  type ContextRecordCreate,
  type HandoffCreate,
  type McpServerCreate,
  type McpServerUpdate,
  type PersistedValidationResult,
  type PageOptions,
  type EventListOptions,
  type FindingListOptions,
  type ValidationRequestBody,
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
  function query(values: Record<string, unknown>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) params.set(key, String(value));
    return `?${params.toString()}`;
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
    getContext: (id: string, maxItems?: number) =>
      request(
        'GET',
        `/projects/${IdSchema.parse(id)}/context${query({ maxItems: PageQuerySchema.shape.limit.parse(maxItems) })}`,
        ProjectMemorySchema,
      ),
    listEvents: (projectId: string, options: EventListOptions = {}) =>
      request(
        'GET',
        `/projects/${IdSchema.parse(projectId)}/events${query(EventQuerySchema.parse(options))}`,
        EventListSchema,
      ),
    getEvent: (projectId: string, eventId: string) =>
      request(
        'GET',
        `/projects/${IdSchema.parse(projectId)}/events/${IdSchema.parse(eventId)}`,
        ActivityEventSchema,
      ),
    createEvent: (projectId: string, input: EventCreate) =>
      request(
        'POST',
        `/projects/${IdSchema.parse(projectId)}/events`,
        ActivityEventSchema,
        EventCreateSchema.parse(input),
      ),
    listContextRecords: (projectId: string, options: PageOptions = {}) =>
      request(
        'GET',
        `/projects/${IdSchema.parse(projectId)}/context/records${query(PageQuerySchema.parse(options))}`,
        ContextRecordListSchema,
      ),
    getContextRecord: (projectId: string, recordId: string) =>
      request(
        'GET',
        `/projects/${IdSchema.parse(projectId)}/context/records/${IdSchema.parse(recordId)}`,
        ContextRecordSchema,
      ),
    createContextRecord: (projectId: string, input: ContextRecordCreate) =>
      request(
        'POST',
        `/projects/${IdSchema.parse(projectId)}/context/records`,
        ContextRecordSchema,
        ContextRecordCreateSchema.parse(input),
      ),
    listHandoffs: (projectId: string, options: PageOptions = {}) =>
      request(
        'GET',
        `/projects/${IdSchema.parse(projectId)}/handoffs${query(PageQuerySchema.parse(options))}`,
        HandoffListSchema,
      ),
    getHandoff: (projectId: string, handoffId: string) =>
      request(
        'GET',
        `/projects/${IdSchema.parse(projectId)}/handoffs/${IdSchema.parse(handoffId)}`,
        AgentHandoffSchema,
      ),
    createHandoff: (projectId: string, input: HandoffCreate) =>
      request(
        'POST',
        `/projects/${IdSchema.parse(projectId)}/handoffs`,
        AgentHandoffSchema,
        HandoffCreateSchema.parse(input),
      ),
    listMcpServers: (options: PageOptions = {}) =>
      request('GET', `/mcp/servers${query(PageQuerySchema.parse(options))}`, McpServerListSchema),
    getMcpServer: (id: string) =>
      request('GET', `/mcp/servers/${IdSchema.parse(id)}`, McpServerSchema),
    createMcpServer: (input: McpServerCreate) =>
      request('POST', '/mcp/servers', McpServerSchema, McpServerCreateSchema.parse(input)),
    replaceMcpServer: (id: string, input: McpServerUpdate) =>
      request(
        'PUT',
        `/mcp/servers/${IdSchema.parse(id)}`,
        McpServerSchema,
        McpServerUpdateSchema.parse(input),
      ),
    deleteMcpServer: (id: string) =>
      request('DELETE', `/mcp/servers/${IdSchema.parse(id)}`, DeleteResultSchema),
    checkMcpServerHealth: (id: string) =>
      request('POST', `/mcp/servers/${IdSchema.parse(id)}/health-check`, McpServerSchema),
    listFindings: (projectId: string, options: FindingListOptions = {}) =>
      request(
        'GET',
        `/engineering/findings${query({ projectId: IdSchema.parse(projectId), ...FindingQuerySchema.parse(options) })}`,
        FindingListSchema,
      ),
    getJob: (projectId: string, jobId: string) =>
      request(
        'GET',
        `/jobs/${IdSchema.parse(jobId)}${query({ projectId: IdSchema.parse(projectId) })}`,
        JobSchema,
      ),
    recordValidationResult: (projectId: string, input: PersistedValidationResult) => {
      const id = IdSchema.parse(projectId);
      const result = ValidationResultSchema.refine(
        (result) => result.job.projectId === id,
        'Validation result must belong to the route project',
      ).parse(input);
      return request('POST', `/projects/${id}/validation-results`, ValidationResultSchema, result);
    },
    requestValidation: (projectId: string, input: ValidationRequestBody) =>
      request(
        'POST',
        `/projects/${IdSchema.parse(projectId)}/validation-jobs`,
        JobSchema,
        ValidationRequestBodySchema.parse(input),
      ),
    previewCorrection: (projectId: string, input: CorrectionPreviewRequest) =>
      request(
        'POST',
        `/projects/${IdSchema.parse(projectId)}/corrections/preview`,
        CorrectionPreviewSchema,
        CorrectionPreviewRequestSchema.parse(input),
      ),
    applyCorrection: (projectId: string, input: CorrectionApplyRequest) =>
      request(
        'POST',
        `/projects/${IdSchema.parse(projectId)}/corrections/apply`,
        CorrectionApplyResultSchema,
        CorrectionApplyRequestSchema.parse(input),
      ),
    rollbackCorrection: (projectId: string, input: CorrectionRollbackRequest) =>
      request(
        'POST',
        `/projects/${IdSchema.parse(projectId)}/corrections/rollback`,
        CorrectionRollbackResultSchema,
        CorrectionRollbackRequestSchema.parse(input),
      ),
  };
}
export type DaemonClient = ReturnType<typeof createClient>;
