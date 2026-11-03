import { z } from 'zod';
export const API_VERSION = 'v1' as const;
export const API_PREFIX = '/api/v1' as const;
export const IdSchema = z.uuid();
export const TimestampSchema = z.iso.datetime();
export const SourceKindSchema = z.enum([
  'observed_tool',
  'user_entered',
  'agent_summary',
  'imported',
]);
export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const Entity = { id: IdSchema, createdAt: TimestampSchema, updatedAt: TimestampSchema };
export const ProjectCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  rootPath: z.string().min(1).max(4096),
  description: z.string().max(4000).default(''),
});
export const ProjectUpdateSchema = z
  .strictObject({
    name: ProjectCreateSchema.shape.name.optional(),
    rootPath: ProjectCreateSchema.shape.rootPath.optional(),
    description: z.string().max(4000).optional(),
  })
  .refine(
    (v) => Object.values(v).some((value) => value !== undefined),
    'At least one field is required',
  )
  .transform((v) => ({
    ...(v.name === undefined ? {} : { name: v.name }),
    ...(v.rootPath === undefined ? {} : { rootPath: v.rootPath }),
    ...(v.description === undefined ? {} : { description: v.description }),
  }));
export const ProjectSchema = ProjectCreateSchema.extend(Entity);
export const ProvenanceSchema = z.strictObject({
  sourceKind: SourceKindSchema,
  sourceRef: z.string().min(1).optional(),
  actor: z.string().min(1),
});
export const EvidenceSchema = z.strictObject({
  filePath: z.string().min(1),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
});
export const ContextRecordSchema = z.strictObject({
  ...Entity,
  projectId: IdSchema,
  kind: z.enum(['fact', 'decision', 'issue', 'summary']),
  text: z.string().min(1),
  provenance: ProvenanceSchema,
  evidence: z.array(EvidenceSchema),
});
export const ProjectMemorySchema = z.strictObject({
  projectId: IdSchema,
  generatedAt: TimestampSchema,
  schemaVersion: z.literal(1),
  records: z.array(ContextRecordSchema),
  openIssues: z.array(z.string()),
});
export const AgentRegistrationSchema = z.strictObject({
  ...Entity,
  name: z.string().min(1),
  host: z.enum(['vscode', 'codex', 'opencode', 'other']),
  capabilities: z.array(z.string()),
  status: z.enum(['connected', 'disconnected', 'unknown']),
});
export const AgentHandoffSchema = z.strictObject({
  ...Entity,
  projectId: IdSchema,
  fromAgentId: IdSchema,
  toAgentId: IdSchema.optional(),
  summary: z.string().min(1),
  recordIds: z.array(IdSchema),
  nextSteps: z.array(z.string()),
  provenance: ProvenanceSchema,
});
// Secret references only; credentials never belong in public server inventory.
export const McpServerSchema = z.strictObject({
  ...Entity,
  name: z.string().min(1),
  transport: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('stdio'),
      executableId: z.string().min(1),
      args: z.array(z.string()),
    }),
    z.strictObject({ type: z.literal('http'), url: z.url() }),
  ]),
  enabled: z.boolean(),
  status: z.enum(['unknown', 'healthy', 'unreachable', 'disabled']),
  secretRef: z.string().optional(),
});
export const ValidationRequestSchema = z.strictObject({
  projectId: IdSchema,
  kind: z.enum(['pin_consistency', 'platformio_build', 'rtl_simulation']),
  artifactPaths: z.array(z.string().min(1)).min(1),
  requestedBy: z.string().min(1),
});
export const ValidationFindingSchema = z.strictObject({
  ...Entity,
  projectId: IdSchema,
  jobId: IdSchema,
  ruleId: z.string().min(1),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().min(1),
  expected: JsonValueSchema,
  observed: JsonValueSchema,
  evidence: z.array(EvidenceSchema).min(1),
  suggestedFix: z.string().optional(),
  status: z.enum(['open', 'resolved', 'unknown']),
  verifiedBy: z.strictObject({ tool: z.string().min(1), version: z.string().min(1) }),
});
export const JobSchema = z.strictObject({
  ...Entity,
  projectId: IdSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  exitCode: z.number().int().nullable(),
  stdoutTail: z.string(),
  stderrTail: z.string(),
  artifacts: z.array(z.string()),
});
export const DeviceTelemetrySchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  deviceId: z.string().min(1),
  observedAt: TimestampSchema,
  metrics: z.record(z.string(), z.number().finite()),
  units: z.record(z.string(), z.string()),
  sourceKind: z.literal('observed_tool'),
});
export const ActivityEventSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  type: z.string().min(1),
  actor: z.string().min(1),
  sourceKind: SourceKindSchema,
  sourceRef: z.string().optional(),
  createdAt: TimestampSchema,
  schemaVersion: z.literal(1),
  payload: JsonValueSchema,
});
export const HealthSchema = z.strictObject({
  status: z.literal('ok'),
  version: z.string(),
  apiVersion: z.literal(API_VERSION),
  database: z.literal('ready'),
  capabilities: z.strictObject({
    projects: z.boolean(),
    context: z.boolean(),
    mcp: z.boolean(),
    engineering: z.boolean(),
  }),
});
export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_IMPLEMENTED',
  'INTERNAL_ERROR',
  'TIMEOUT',
  'CONNECTION_ERROR',
  'INVALID_RESPONSE',
  'HTTP_ERROR',
]);
export const ApiErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: z.string(),
  details: JsonValueSchema.optional(),
});
export const ResponseMetaSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  requestId: IdSchema,
  timestamp: TimestampSchema,
});
export const ErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: ApiErrorSchema,
  meta: ResponseMetaSchema,
});
export const successSchema = <T extends z.ZodType>(data: T) =>
  z.strictObject({ ok: z.literal(true), data, meta: ResponseMetaSchema });
export const DeleteResultSchema = z.strictObject({ id: IdSchema, deleted: z.literal(true) });
export const ProjectListSchema = z.strictObject({ items: z.array(ProjectSchema) });
export const FindingListSchema = z.strictObject({ items: z.array(ValidationFindingSchema) });
export const McpServerListSchema = z.strictObject({ items: z.array(McpServerSchema) });
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectCreate = z.input<typeof ProjectCreateSchema>;
export type ProjectUpdate = z.input<typeof ProjectUpdateSchema>;
export type ContextRecord = z.infer<typeof ContextRecordSchema>;
export type ProjectMemory = z.infer<typeof ProjectMemorySchema>;
export type AgentRegistration = z.infer<typeof AgentRegistrationSchema>;
export type AgentHandoff = z.infer<typeof AgentHandoffSchema>;
export type McpServer = z.infer<typeof McpServerSchema>;
export type ValidationRequest = z.infer<typeof ValidationRequestSchema>;
export type ValidationFinding = z.infer<typeof ValidationFindingSchema>;
export type Job = z.infer<typeof JobSchema>;
export type DeviceTelemetry = z.infer<typeof DeviceTelemetrySchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type Health = z.infer<typeof HealthSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiSuccess<T> = { ok: true; data: T; meta: z.infer<typeof ResponseMetaSchema> };
export type ApiResponse<T> = ApiSuccess<T> | z.infer<typeof ErrorResponseSchema>;

// Persistence API additions: existing entity schemas and response envelopes stay unchanged.
export const PageQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type PageOptions = Partial<z.output<typeof PageQuerySchema>>;
export const EventQuerySchema = PageQuerySchema.extend({ type: z.string().min(1).optional() });
export type EventListOptions = PageOptions & { type?: string | undefined };
export const FindingQuerySchema = PageQuerySchema.extend({ jobId: IdSchema.optional() });
export type FindingListOptions = PageOptions & { jobId?: string | undefined };
export const EventCreateSchema = ActivityEventSchema.omit({
  id: true,
  projectId: true,
  createdAt: true,
  schemaVersion: true,
});
export const ContextRecordCreateSchema = ContextRecordSchema.omit({
  id: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
});
export const HandoffCreateSchema = AgentHandoffSchema.omit({
  id: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
}).refine((v) => new Set(v.recordIds).size === v.recordIds.length, {
  path: ['recordIds'],
  message: 'Record references must be unique',
});
export const McpServerCreateSchema = McpServerSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
});
// Explicit snapshots from an authenticated adapter; saving is not a server health check.
export const McpServerUpdateSchema = McpServerSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const EventListSchema = z.strictObject({ items: z.array(ActivityEventSchema) });
export const ContextRecordListSchema = z.strictObject({ items: z.array(ContextRecordSchema) });
export const HandoffListSchema = z.strictObject({ items: z.array(AgentHandoffSchema) });
export const ValidationResultSchema = z
  .strictObject({ job: JobSchema, findings: z.array(ValidationFindingSchema) })
  .superRefine((result, ctx) => {
    if (!['succeeded', 'failed', 'cancelled'].includes(result.job.status))
      ctx.addIssue({
        code: 'custom',
        path: ['job', 'status'],
        message: 'Only completed validation results may be recorded',
      });
    if (!result.job.completedAt)
      ctx.addIssue({
        code: 'custom',
        path: ['job', 'completedAt'],
        message: 'Completed results require a completion timestamp',
      });
    if (
      result.job.startedAt &&
      result.job.completedAt &&
      Date.parse(result.job.completedAt) < Date.parse(result.job.startedAt)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['job', 'completedAt'],
        message: 'Completion cannot precede start',
      });
    if (new Set(result.findings.map((f) => f.id)).size !== result.findings.length)
      ctx.addIssue({ code: 'custom', path: ['findings'], message: 'Finding IDs must be unique' });
    result.findings.forEach((finding, index) => {
      if (finding.projectId !== result.job.projectId || finding.jobId !== result.job.id)
        ctx.addIssue({
          code: 'custom',
          path: ['findings', index],
          message: 'Finding must reference this job and project',
        });
    });
  });
export const ValidationRequestBodySchema = ValidationRequestSchema.omit({ projectId: true });
export type EventCreate = z.input<typeof EventCreateSchema>;
export type ContextRecordCreate = z.input<typeof ContextRecordCreateSchema>;
export type HandoffCreate = z.input<typeof HandoffCreateSchema>;
export type McpServerCreate = z.input<typeof McpServerCreateSchema>;
export type McpServerUpdate = z.input<typeof McpServerUpdateSchema>;
export type PersistedValidationResult = z.infer<typeof ValidationResultSchema>;
export type ValidationRequestBody = z.input<typeof ValidationRequestBodySchema>;

// Correction API schemas for safe engineering repair
export const CorrectionPreviewRequestSchema = z.strictObject({
  findingId: IdSchema,
});
export type CorrectionPreviewRequest = z.infer<typeof CorrectionPreviewRequestSchema>;

export const CorrectionPreviewSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  findingId: IdSchema,
  targetFile: z.string().min(1),
  originalHash: z.string().min(1),
  originalLineNumber: z.number().int().positive(),
  originalLineText: z.string(),
  proposedLineText: z.string(),
  diff: z.string(),
  explanation: z.string(),
  generatedAt: TimestampSchema,
});
export type CorrectionPreview = z.infer<typeof CorrectionPreviewSchema>;

export const CorrectionApplyRequestSchema = z.strictObject({
  previewId: IdSchema,
  findingId: IdSchema,
  expectedOriginalHash: z.string().min(1),
  userApproved: z.literal(true),
});
export type CorrectionApplyRequest = z.infer<typeof CorrectionApplyRequestSchema>;

export const CorrectionApplyResultSchema = z.strictObject({
  ok: z.literal(true),
  projectId: IdSchema,
  targetFile: z.string().min(1),
  backupPath: z.string().min(1),
  revalidationJob: JobSchema,
  revalidationFindings: z.array(ValidationFindingSchema),
  contextRecord: ContextRecordSchema,
  appliedAt: TimestampSchema,
});
export type CorrectionApplyResult = z.infer<typeof CorrectionApplyResultSchema>;

export const CorrectionRollbackRequestSchema = z.strictObject({
  targetFile: z.string().min(1),
  backupPath: z.string().min(1),
});
export type CorrectionRollbackRequest = z.infer<typeof CorrectionRollbackRequestSchema>;

export const CorrectionRollbackResultSchema = z.strictObject({
  ok: z.literal(true),
  targetFile: z.string().min(1),
  restoredAt: TimestampSchema,
  revalidationJob: JobSchema,
  revalidationFindings: z.array(ValidationFindingSchema).optional(),
});
export type CorrectionRollbackResult = z.infer<typeof CorrectionRollbackResultSchema>;
