# Shared contracts — v1

Source of truth: `packages/contracts/src/index.ts`. All entities use UUID IDs; timestamps are ISO 8601 UTC strings. Objects reject unknown fields except explicitly extensible JSON payloads. HTTP prefix **`/api/v1`** supersedes `/v1` in the original spec. `schemaVersion: 1` versions persisted event/context records independently.

Success:

```json
{
  "ok": true,
  "data": { "items": [] },
  "meta": {
    "apiVersion": "v1",
    "requestId": "61d626eb-26fa-4bae-bbe7-64dc03fb921b",
    "timestamp": "2026-11-03T13:00:00.000Z"
  }
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "Validation execution requires Developer 2's engineering implementation"
  },
  "meta": {
    "apiVersion": "v1",
    "requestId": "61d626eb-26fa-4bae-bbe7-64dc03fb921b",
    "timestamp": "2026-11-03T13:00:00.000Z"
  }
}
```

`error.details` is optional JSON. Daemon status mapping: 400 validation; 401 token; 403 Host/Origin; 404 route/resource; 409 duplicate canonical workspace; 413 body too large; 415 unsupported content type; 500 internal; 501 unfinished module. SDK adds TIMEOUT, CONNECTION_ERROR and INVALID_RESPONSE with optional HTTP status; schema failures before sending are Zod errors. Never parse errors by message text.

| Method | Path relative to `/api/v1`             | Input                        | Success data/status                                   |
| ------ | -------------------------------------- | ---------------------------- | ----------------------------------------------------- |
| GET    | `/health`                              | none, token exempt           | `HealthSchema` / 200                                  |
| GET    | `/projects`                            | bearer token                 | `{items: Project[]}` / 200                            |
| POST   | `/projects`                            | `ProjectCreateSchema`        | `ProjectSchema` / 201 + Location                      |
| GET    | `/projects/:id`                        | UUID                         | `ProjectSchema` / 200                                 |
| PATCH  | `/projects/:id`                        | UUID + `ProjectUpdateSchema` | `ProjectSchema` / 200                                 |
| DELETE | `/projects/:id`                        | UUID                         | `{id, deleted: true}` / 200                           |
| GET    | `/projects/:id/context`                | existing project UUID        | ProjectMemorySchema / 200 (stored projection)         |
| GET    | `/mcp/servers`                         | bearer token                 | `{items: McpServer[]}` / 200 (inventory)              |
| GET    | `/engineering/findings?projectId=UUID` | required UUID scope          | `{items: ValidationFinding[]}` / 200 (stored results) |

All non-health routes require `Authorization: Bearer <local token>`. CORS permits the local Vite origin on port 5173 and Tauri origins; preflight returns 204 without a token, but actual requests require one. Invalid/missing project scope is 400; nonexistent context project is 404. POST/PATCH accept JSON, maximum 64 KiB. PATCH requires at least one defined field. Workspace path must be an absolute, existing directory and is saved after realpath resolution. Duplicate canonical paths are 409. Deletion affects project records/events only. The original project list remains unpaginated. New resource lists use the bounded pagination described below.

## Schemas and boundaries

| Export                    | Required shape/purpose                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ProjectSchema`           | id, name, rootPath, description, createdAt, updatedAt                                                                                                        |
| `ProjectCreateSchema`     | name (1–120 after trim), rootPath, optional description (default empty)                                                                                      |
| `ProjectUpdateSchema`     | nonempty partial create fields                                                                                                                               |
| `McpServerSchema`         | entity fields, name, enabled, status, discriminated stdio executableId/args or http URL transport, optional secretRef; never inline credentials              |
| `AgentRegistrationSchema` | entity fields, name, host, capabilities, status                                                                                                              |
| `ContextRecordSchema`     | entity fields, projectId, kind (fact/decision/issue/summary), text, provenance, evidence                                                                     |
| `ProjectMemorySchema`     | projectId, generatedAt, schemaVersion=1, records, openIssues                                                                                                 |
| `AgentHandoffSchema`      | entity fields, projectId, fromAgentId, optional toAgentId, summary, recordIds, nextSteps, provenance                                                         |
| `ValidationRequestSchema` | projectId, kind (pin_consistency/platformio_build/rtl_simulation), artifactPaths, requestedBy                                                                |
| `ValidationFindingSchema` | entity fields, projectId/jobId, ruleId, severity, message, expected/observed JSON, nonempty evidence, status, verifiedBy tool/version, optional suggestedFix |
| `JobSchema`               | entity fields, projectId, lifecycle status, nullable startedAt/completedAt/exitCode, stdoutTail, stderrTail, artifacts                                       |
| `DeviceTelemetrySchema`   | id, projectId, deviceId, observedAt, finite numeric metrics, units, observed_tool sourceKind                                                                 |
| `HealthSchema`            | status, daemon version, apiVersion, database ready, capability flags (unfinished capabilities false)                                                         |
| `ActivityEventSchema`     | id, projectId, type, actor, sourceKind, optional sourceRef, createdAt, schemaVersion=1, JSON payload                                                         |

`ProvenanceSchema`: sourceKind (`observed_tool`, `user_entered`, `agent_summary`, `imported`), actor, optional sourceRef. AI assertions must retain `agent_summary`; only actual tool observations use `observed_tool`. `EvidenceSchema`: filePath, optional positive 1-based line/column, optional excerpt. File path schema validation is not filesystem authorization; runners must canonicalize paths against the registered workspace and reject escape through symlinks/traversal. Transport URL schema validation is not server-network authorization; the registry must enforce its own allowed destinations.

`successSchema(schema)` builds a response schema. Exported TypeScript types derive from schemas. Runtime output validation is performed by the shared SDK; daemon validates inputs and project records through the same schemas. Store adapters must validate JSON read from storage.

The persistence milestone below freezes events/context/handoffs/registry/result write schemas. Validation execution, config preview/apply and additional workflow endpoints still require integration with Developer 1. Do not infer create bodies from full entities unless the documented adapter snapshot endpoint explicitly requires them.

## Core-platform persistence milestone (supersedes bootstrap 501s)

Developer 1 now owns the database and HTTP persistence layer; see ADR 0002. The existing context/MCP/findings read shapes and SDK methods are preserved, and these reads now return actual stored data (including valid empty lists). No existing entity, response envelope or API version changed. The following routes are implemented in the persistence milestone merged into main (cb848d5); coordinate integration through the lead rather than merging teammate branches without approval.

All paths below are relative to `/api/v1` and require the existing bearer token.

| Methods          | Path                                      | Request / response data                                                                | Shared SDK                                            |
| ---------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| GET, POST        | `/projects/:id/events`                    | `EventCreateSchema` on POST → ActivityEvent; GET → `{items: ActivityEvent[]}`          | `listEvents`, `createEvent`                           |
| GET              | `/projects/:id/events/:eventId`           | ActivityEvent                                                                          | `getEvent`                                            |
| GET, POST        | `/projects/:id/context/records`           | `ContextRecordCreateSchema` → ContextRecord; GET → `{items: ContextRecord[]}`          | `listContextRecords`, `createContextRecord`           |
| GET              | `/projects/:id/context/records/:recordId` | ContextRecord                                                                          | `getContextRecord`                                    |
| GET              | `/projects/:id/context?maxItems=100`      | existing ProjectMemorySchema                                                           | `getContext(projectId, maxItems?)`                    |
| GET, POST        | `/projects/:id/handoffs`                  | `HandoffCreateSchema` → AgentHandoff; GET → `{items: AgentHandoff[]}`                  | `listHandoffs`, `createHandoff`                       |
| GET              | `/projects/:id/handoffs/:handoffId`       | AgentHandoff                                                                           | `getHandoff`                                          |
| GET, POST        | `/mcp/servers`                            | `McpServerCreateSchema` → McpServer; GET → existing `{items: McpServer[]}`             | `listMcpServers`, `createMcpServer`                   |
| GET, PUT, DELETE | `/mcp/servers/:id`                        | GET → McpServer; PUT `McpServerUpdateSchema` → McpServer; DELETE → `{id,deleted:true}` | `getMcpServer`, `replaceMcpServer`, `deleteMcpServer` |
| POST             | `/projects/:id/validation-results`        | `ValidationResultSchema` → `{job: Job, findings: ValidationFinding[]}`                 | `recordValidationResult`                              |
| GET              | `/jobs/:id?projectId=UUID`                | Job (required explicit project scope)                                                  | `getJob(projectId, jobId)`                            |
| GET              | `/engineering/findings?projectId=UUID`    | existing `{items: ValidationFinding[]}`                                                | `listFindings(projectId, options?)`                   |

POST returns 201 and Location; other completed operations return 200. Successful POST bodies are the submitted/created record, not an extra wrapper around it. Standard `ok/data/meta` HTTP envelopes are still unwrapped by the SDK. UUID/timestamp fields for events, context records, handoffs and MCP registrations are daemon-generated. Their create bodies omit `id`, `projectId` and timestamps (where present). Unknown fields, including spoofed metadata, are rejected.

All new lists accept `limit` (default 100, range 1–500) and `offset` (default 0, max 1,000,000). Lists return `{items}` with ascending timestamp then UUID order and no total/cursor field. An empty page ends traversal; when length equals the limit, request the next page. For stable exports, stop writes while paging; offset pagination is not a snapshot. Events support exact `type` filtering; findings support `jobId`. MCP inventory is global, consistent with its existing schema; every other resource is project-scoped. Invalid scope/filters return 400; missing projects or resources return 404. Cross-project resource lookup returns 404 without revealing the owning project.

Default context is a bounded projection of persisted ContextRecords, not synthesized intelligence. It preserves provenance exactly and sets openIssues to text from the returned `kind: issue` records. `maxItems` is 1–500 (default 100); use `/context/records` pagination for full history. Agent summaries are never promoted to observed facts. The daemon may receive a ProjectContextProvider from Developer 2; its output is runtime-validated for schema, project scope (including nested records) and size. Invalid provider output yields 500, never another project's data. Existing health context/MCP/engineering flags describe injected intelligence/execution support rather than storage availability; persisted reads work while those flags are false. The context flag becomes true when a provider is injected.

Handoffs require unique `recordIds` referencing existing context records of the same project; invalid references return 400 and nothing is saved. Agent IDs remain external UUIDs; no agent-registration database is implemented here. Handoff generation/selection remains Developer 2's work. Records and handoffs are append-only; repeated direct repository IDs are 409.

MCP create omits status; the daemon sets `unknown` when enabled and `disabled` otherwise. PUT is a **complete replacement** of name, transport, enabled, status and optional secretRef, preserving id/createdAt and generating updatedAt. Omitted secretRef is removed. Status is an authenticated adapter observation, not a health check performed by persistence. Frontends must not fabricate healthy status; use unknown/disabled for configuration changes. Inline URL username/password are refused; actual secrets belong behind secretRef. Inventory operations never execute an MCP process or edit host configuration.

Validation submission uses the unchanged full Job and Finding entity shapes because Developer 2's validator already returns IDs, project IDs and observation timestamps. Jobs must be terminal (`succeeded`, `failed`, `cancelled`), have completedAt, and not complete before startedAt. Finding IDs must be unique and every finding must reference that exact job and project; route projectId must match too. Job and findings commit atomically. Reusing a job/finding ID returns 409 without partial writes. Caller-provided tool/version/output is retained; accepting a result does not prove the daemon executed that tool. Successful comparisons, unavailable tools and meaningful exit codes remain the validator's responsibility.

Reserved execution routes explicitly remain 501: `POST /projects/:id/validation-jobs` with ValidationRequestBodySchema (ValidationRequest without route projectId), and `POST /mcp/servers/:id/health-check`. SDK methods `requestValidation` and `checkMcpServerHealth` surface `DaemonClientError` code NOT_IMPLEMENTED. Invalid requests/missing projects or servers still return 400/404 before 501. No runner, gateway execution, config apply, context synthesis algorithm or frontend implementation is included.

## End-to-end integration clarifications

No entity/API changes are needed for existing frontend reads or handoff storage. See INTEGRATION_READINESS and DEMO_PLAN before enabling execution. Findings are append-only history: use listFindings(projectId, {jobId}) for current diagnostics, and preserve an agreed current-job reference for reload. recordValidationResult does not automatically create an event or ContextRecord. A raw getContext response is not proof that a context intelligence engine or second MCP host is connected. Handoff lists are ascending; limit=1 is not latest. The SDK currently has a five-second default timeout, the daemon accepts at most 64 KiB per JSON body, and queued-job persistence/async execution are not implemented by the completed-result API.

## Live runtime composition (merged intelligence implementation)

Start with UDI_INTEGRATIONS=true or UDI_ENABLE_INTEGRATIONS=1. Without either flag the persistence-only behavior and explicit 501 execution boundaries remain available. No existing entity schemas, SDK methods or envelopes change.

POST /projects/:id/validation-jobs now invokes the real engineering provider when enabled. The request remains ValidationRequestBodySchema; a synchronous completed Job is returned with 201 and Location. Results are schema- and project-validated as an internal boundary (invalid/wrong-project provider output is 500 without writes). Default composition authorizes existing artifact paths against the canonical project workspace, including symlinks and the validator's optional default engineering-map.json; invalid/missing or escaped inputs are 400 before invocation. Slow optional tool builds still require an appropriate client timeout; no async queued-job API is added.

After execution, the daemon persists the actual job/findings, a completed activity event and a fact ContextRecord with observed_tool provenance/sourceRef=job UUID and real evidence. Both failed and successful runs remain historical facts; no synthetic unresolved issue is left by the bridge. D2's existing context engine synthesizes those stored observations. Direct POST /validation-results remains snapshot ingestion and does not automatically promote externally submitted data into observed context.

Unfiltered findings remain historical for compatibility. Use listFindings(projectId,{jobId}) for the current completed job and the latest engineering.validation.completed event to recover that job after reload. A successful rerun does not rewrite the earlier failed finding.

scripts/mcp-stdio.mjs is a thin executable composition of DefaultMcpGateway, not a separate gateway. It reads the existing daemon token (or explicit UDI_TOKEN), validates UDI_PROJECT_ID and project access, and uses the shared SDK over loopback. stdout is MCP JSON-RPC only. Runtime testing negotiates protocol 2025-11-25 and calls real tools via an independent child process. See RUNTIME_DEMO for commands/results and remaining UI/host limitations.
