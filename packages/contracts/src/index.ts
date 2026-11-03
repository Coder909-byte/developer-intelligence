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

// Universal Integration Inventory & MCP Aggregator Schemas
export const DiscoveredToolSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().default(''),
  inputSchema: JsonValueSchema.optional(),
  serverName: z.string().min(1).optional(),
  serverId: IdSchema.optional(),
});
export type DiscoveredTool = z.infer<typeof DiscoveredToolSchema>;

export const DiscoveredToolListSchema = z.strictObject({
  items: z.array(DiscoveredToolSchema),
});
export type DiscoveredToolList = z.infer<typeof DiscoveredToolListSchema>;

export const IntegrationTypeSchema = z.enum([
  'mcp_server',
  'discovered_tool',
  'host_adapter',
  'specialist_pack',
]);
export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

export const HostTargetSchema = z.enum([
  'vscode',
  'opencode',
  'claude_desktop',
  'antigravity',
  'generic',
]);
export type HostTarget = z.infer<typeof HostTargetSchema>;

export const ConfigurationStatusSchema = z.enum([
  'configured',
  'pending',
  'manual_setup',
  'unsupported',
]);
export type ConfigurationStatus = z.infer<typeof ConfigurationStatusSchema>;

export const IntegrationItemSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  type: IntegrationTypeSchema,
  transport: z.enum(['stdio', 'http', 'internal', 'none']),
  status: z.enum(['healthy', 'unreachable', 'disabled', 'unknown']),
  configurationStatus: ConfigurationStatusSchema,
  enabled: z.boolean(),
  supportedHosts: z.array(HostTargetSchema),
  availableTools: z.array(z.string()),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
});
export type IntegrationItem = z.infer<typeof IntegrationItemSchema>;

export const IntegrationListSchema = z.strictObject({
  items: z.array(IntegrationItemSchema),
});
export type IntegrationList = z.infer<typeof IntegrationListSchema>;

export const McpToolExecutionRecordSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  serverId: IdSchema.optional(),
  serverName: z.string().min(1),
  toolName: z.string().min(1),
  agentId: z.string().optional(),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  outcome: z.enum(['succeeded', 'failed', 'timeout']),
  error: z.string().optional(),
  summary: z.string(),
  provenance: ProvenanceSchema,
});
export type McpToolExecutionRecord = z.infer<typeof McpToolExecutionRecordSchema>;

export const McpToolExecutionListSchema = z.strictObject({
  items: z.array(McpToolExecutionRecordSchema),
});
export type McpToolExecutionList = z.infer<typeof McpToolExecutionListSchema>;

export const McpToolCallRequestSchema = z.strictObject({
  projectId: IdSchema.optional(),
  agentId: z.string().optional(),
  arguments: z.record(z.string(), JsonValueSchema).default({}),
});
export type McpToolCallRequest = z.infer<typeof McpToolCallRequestSchema>;

export const McpToolCallResponseSchema = z.strictObject({
  ok: z.boolean(),
  serverName: z.string(),
  toolName: z.string(),
  result: JsonValueSchema,
  executionId: IdSchema,
  durationMs: z.number().nonnegative(),
});
export type McpToolCallResponse = z.infer<typeof McpToolCallResponseSchema>;

// Classifier & Proxy Schemas (Round 2 Backend 1)
export const ClassifierCategorySchema = z.enum([
  'HARDWARE_SPEC',
  'ARCHITECTURAL_DECISION',
  'VALIDATED_OUTCOME',
  'EPHEMERAL_NOISE',
]);
export type ClassifierCategory = z.infer<typeof ClassifierCategorySchema>;

export const LayaClassificationResultSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  timestamp: TimestampSchema,
  rawLengthChars: z.number().int().nonnegative(),
  signalScore: z.number().min(0).max(1),
  category: ClassifierCategorySchema,
  decision: z.enum(['preserve', 'discard']),
  distilledFact: z.string().optional(),
  sourceActor: z.string(),
  sourceType: z.enum(['user_message', 'assistant_thought', 'tool_output', 'system_message']),
});
export type LayaClassificationResult = z.infer<typeof LayaClassificationResultSchema>;

export const LayaClassificationListSchema = z.strictObject({
  items: z.array(LayaClassificationResultSchema),
});
export type LayaClassificationList = z.infer<typeof LayaClassificationListSchema>;

export const CompressionMetricsSchema = z.strictObject({
  projectId: IdSchema,
  totalRawTokens: z.number().int().nonnegative(),
  totalCompressedTokens: z.number().int().nonnegative(),
  compressionRatio: z.number().min(0).max(1),
  preservedFactsCount: z.number().int().nonnegative(),
  prunedNoiseCount: z.number().int().nonnegative(),
  lastInjectedAt: TimestampSchema.optional(),
});
export type CompressionMetrics = z.infer<typeof CompressionMetricsSchema>;

export const ChatCompletionMessageSchema = z.strictObject({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.record(z.string(), JsonValueSchema)).optional(),
});
export type ChatCompletionMessage = z.infer<typeof ChatCompletionMessageSchema>;

export const ChatCompletionRequestSchema = z.object({
  model: z.string().default('default'),
  messages: z.array(ChatCompletionMessageSchema),
  temperature: z.number().optional(),
  stream: z.boolean().optional().default(false),
  projectId: IdSchema.optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

export const ChatCompletionResponseSchema = z.strictObject({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int().positive(),
  model: z.string(),
  choices: z.array(
    z.strictObject({
      index: z.number().int().nonnegative(),
      message: ChatCompletionMessageSchema,
      finish_reason: z.string(),
    }),
  ),
  usage: z.strictObject({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }),
  injectedContext: z
    .strictObject({
      tokensSaved: z.number().int().nonnegative(),
      compressionRatio: z.number().min(0).max(1),
      preservedFactsCount: z.number().int().nonnegative(),
    })
    .optional(),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

// Backend Spec 2: additive compression, category and host-bridge contracts.
export const ToolCategorySchema = z.enum([
  'hardware_validation',
  'context_memory',
  'ide_extension_bridge',
  'external_servers',
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export const ToolCategoryConfigSchema = z.strictObject({
  category: ToolCategorySchema,
  enabled: z.boolean(),
  name: z.string(),
  description: z.string(),
  toolCount: z.number().int().nonnegative(),
});
export type ToolCategoryConfig = z.infer<typeof ToolCategoryConfigSchema>;

export const ToolCategoryListSchema = z.strictObject({
  projectId: IdSchema,
  categories: z.array(ToolCategoryConfigSchema),
});
export type ToolCategoryList = z.infer<typeof ToolCategoryListSchema>;

export const ToggleCategoryRequestSchema = z.strictObject({
  projectId: IdSchema,
  category: ToolCategorySchema,
  enabled: z.boolean(),
});
export type ToggleCategoryRequest = z.infer<typeof ToggleCategoryRequestSchema>;

export const CompressedContextResultSchema = z.strictObject({
  projectId: IdSchema,
  mode: z.enum(['deterministic_delta', 'ai_distillation']),
  rawTokensEstimate: z.number().int().nonnegative(),
  compressedTokensEstimate: z.number().int().nonnegative(),
  savingsPercent: z.number().min(0).max(100),
  injectedBlock: z.string(),
  activeInvariants: z.array(z.string()),
  openIssuesCount: z.number().int().nonnegative(),
  generatedAt: TimestampSchema,
});
export type CompressedContextResult = z.infer<typeof CompressedContextResultSchema>;

export const CompressionQuerySchema = z.strictObject({
  mode: CompressedContextResultSchema.shape.mode.default('deterministic_delta'),
});

export const BridgedExtensionToolSchema = z.strictObject({
  projectId: IdSchema,
  hostId: IdSchema,
  name: z.enum(['vscode_execute_command', 'vscode_list_diagnostics']),
  description: z.string().max(1000),
  commandIds: z.array(z.string().min(1).max(200)).max(100).default([]),
});
export type BridgedExtensionTool = z.infer<typeof BridgedExtensionToolSchema>;

export const BridgedExtensionToolListSchema = z.strictObject({
  items: z.array(BridgedExtensionToolSchema),
});

export const BridgeCallSchema = z.strictObject({
  name: BridgedExtensionToolSchema.shape.name,
  arguments: z.record(z.string(), JsonValueSchema).default({}),
});

export const BridgeResultSchema = z.strictObject({
  isError: z.boolean(),
  content: JsonValueSchema,
});

export const BridgeInvocationSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  hostId: IdSchema,
  name: BridgedExtensionToolSchema.shape.name,
  arguments: z.record(z.string(), JsonValueSchema),
  expiresAt: TimestampSchema,
});
export const BridgePollSchema = z.strictObject({ items: z.array(BridgeInvocationSchema) });

// Explicit, local Codex -> Claude Code Markdown handoff. This is not a native session resume.
export const CodexClaudeConvertRequestSchema = z.strictObject({ sessionId: IdSchema.optional() });
export const NativeContextEntrySchema = z.strictObject({
  id: z.string().min(1).max(300),
  role: z.enum(['user', 'assistant', 'tool']),
  occurredAt: TimestampSchema,
  text: z.string().min(1).max(8000),
  originalChars: z.number().int().positive(),
  truncated: z.boolean(),
});
export type NativeContextEntry = z.infer<typeof NativeContextEntrySchema>;

export const CodexClaudeHandoffSchema = z.strictObject({
  projectId: IdSchema,
  projectName: z.string(),
  sessionId: IdSchema,
  storage: z.enum(['codex_sqlite', 'codex_rollout']),
  generatedAt: TimestampSchema,
  filename: z.literal('codex-claude-context.md'),
  importLine: z.literal('@./codex-claude-context.md'),
  markdown: z.string().min(1).max(40000),
  entries: z.array(NativeContextEntrySchema).min(1).max(24),
  stats: z.strictObject({
    messagesRead: z.number().int().positive(),
    messagesIncluded: z.number().int().positive(),
    omittedMessages: z.number().int().nonnegative(),
    truncatedMessages: z.number().int().nonnegative(),
    rawTokensEstimate: z.number().int().nonnegative(),
    outputTokensEstimate: z.number().int().nonnegative(),
    sourceWindowLimited: z.boolean(),
  }),
  nativeClaudeSessionVerified: z.literal(false),
});
export type CodexClaudeHandoff = z.infer<typeof CodexClaudeHandoffSchema>;

// Named Context Saves (Session Checkpoints / Snapshots for Cross-Harness Injection)
export const ContextSnapshotSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(''),
  createdAt: TimestampSchema,
  recordCount: z.number().int().nonnegative(),
  activeInvariants: z.array(z.string()),
  injectedPromptBlock: z.string(),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
});
export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

export const ContextSnapshotCreateSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  metadata: z.record(z.string(), JsonValueSchema).optional(),
});
export type ContextSnapshotCreate = z.infer<typeof ContextSnapshotCreateSchema>;

export const ContextSnapshotListSchema = z.strictObject({
  items: z.array(ContextSnapshotSchema),
});
export type ContextSnapshotList = z.infer<typeof ContextSnapshotListSchema>;

// Anthropic Messages API Schemas (for Claude Code CLI & Claude VS Code Extension)
export const AnthropicMessageContentItemSchema = z.union([
  z.string(),
  z.strictObject({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.record(z.string(), JsonValueSchema),
]);

export const AnthropicMessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(AnthropicMessageContentItemSchema)]),
});
export type AnthropicMessage = z.infer<typeof AnthropicMessageSchema>;

export const AnthropicChatRequestSchema = z.object({
  model: z.string().default('claude-3-5-sonnet-20241022'),
  messages: z.array(AnthropicMessageSchema),
  max_tokens: z.number().int().positive().optional().default(1024),
  system: z.string().optional(),
  stream: z.boolean().optional().default(false),
  temperature: z.number().optional(),
  projectId: IdSchema.optional(),
});
export type AnthropicChatRequest = z.infer<typeof AnthropicChatRequestSchema>;

export const AnthropicChatResponseSchema = z.strictObject({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  content: z.array(
    z.strictObject({
      type: z.literal('text'),
      text: z.string(),
    }),
  ),
  model: z.string(),
  stop_reason: z.string().nullable().default('end_turn'),
  usage: z.strictObject({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
  injectedContext: z
    .strictObject({
      tokensSaved: z.number().int().nonnegative(),
      compressionRatio: z.number().min(0).max(1),
      preservedFactsCount: z.number().int().nonnegative(),
    })
    .optional(),
});
export type AnthropicChatResponse = z.infer<typeof AnthropicChatResponseSchema>;
