# Shared contracts — bootstrap v1

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
    "message": "context-engine is not implemented in this bootstrap; Developer 2 owns this module"
  },
  "meta": {
    "apiVersion": "v1",
    "requestId": "61d626eb-26fa-4bae-bbe7-64dc03fb921b",
    "timestamp": "2026-11-03T13:00:00.000Z"
  }
}
```

`error.details` is optional JSON. Daemon status mapping: 400 validation; 401 token; 403 Host/Origin; 404 route/resource; 409 duplicate canonical workspace; 413 body too large; 415 unsupported content type; 500 internal; 501 unfinished module. SDK adds TIMEOUT, CONNECTION_ERROR and INVALID_RESPONSE with optional HTTP status; schema failures before sending are Zod errors. Never parse errors by message text.

| Method | Path relative to `/api/v1`             | Input                        | Success data/status                        |
| ------ | -------------------------------------- | ---------------------------- | ------------------------------------------ |
| GET    | `/health`                              | none, token exempt           | `HealthSchema` / 200                       |
| GET    | `/projects`                            | bearer token                 | `{items: Project[]}` / 200                 |
| POST   | `/projects`                            | `ProjectCreateSchema`        | `ProjectSchema` / 201 + Location           |
| GET    | `/projects/:id`                        | UUID                         | `ProjectSchema` / 200                      |
| PATCH  | `/projects/:id`                        | UUID + `ProjectUpdateSchema` | `ProjectSchema` / 200                      |
| DELETE | `/projects/:id`                        | UUID                         | `{id, deleted: true}` / 200                |
| GET    | `/projects/:id/context`                | existing project UUID        | **501** until ContextEngine is implemented |
| GET    | `/mcp/servers`                         | bearer token                 | **501** until McpRegistry is implemented   |
| GET    | `/engineering/findings?projectId=UUID` | required UUID scope          | **501** until validator is implemented     |

All non-health routes require `Authorization: Bearer <local token>`. CORS permits the local Vite origin on port 5173 and Tauri origins; preflight returns 204 without a token, but actual requests require one. Invalid/missing project scope is 400; nonexistent context project is 404. POST/PATCH accept JSON, maximum 64 KiB. PATCH requires at least one defined field. Workspace path must be an absolute, existing directory and is saved after realpath resolution. Duplicate canonical paths are 409. Deletion affects project records/events only. List pagination is deferred; do not assume the initial unpaginated project list is suitable for very large stores.

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

Planned write endpoints (events/handoffs/jobs/registry/config preview/apply) are listed in TECHNICAL_SPEC but **not yet frozen or implemented**. Agree create/update schemas and route errors with Developer 1 before wiring them. Do not infer request bodies from full entity records with server-generated fields.
