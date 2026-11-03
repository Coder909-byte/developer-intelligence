# ADR 0002: daemon persistence boundary and migration v2

Status: accepted by Developer 1 for the core-platform milestone, 3 November 2026.

The current task explicitly assigns event/context/MCP/findings/handoff database persistence to Developer 1. This supersedes the bootstrap handoff's proposed assignment of event persistence to Developer 2. Developer 2 continues to own context intelligence, handoff logic, MCP execution and engineering algorithms. No frontend or intelligence package implementation is changed.

Migration 1 is retained. Migration 2 adds context records, global MCP inventory, validation jobs/findings, handoffs and scoped reference constraints. Migrations run forward under BEGIN IMMEDIATE; unknown/noncontiguous history is rejected. Project removal cascades project records, while global inventory survives. No down migrations or data resets are introduced.

`openDatabase` returns typed async PlatformRepositories in addition to the unchanged synchronous project repository. Its events port remains compatible with EventStore.append/list(projectId, limit?). Its context port remains compatible with ContextRepository.listRecords/saveHandoff. Only the daemon opens SQLite. MCP adapters should call the shared HTTP SDK, not open databases.

Events, context records, handoffs and completed validation results are append-only. Reusing IDs is a conflict. Validation job and findings insertion is one transaction; each finding must match the job and project. Handoffs can reference only existing context records from the same project. Agent IDs are external registration IDs; this milestone does not implement an agent registry or validate agent existence.

Existing entity schemas, API version/envelopes and list response shapes are unchanged. Additive contracts define EventCreateSchema, ContextRecordCreateSchema, HandoffCreateSchema, McpServerCreateSchema/UpdateSchema, bounded pagination/filter queries, list schemas, and ValidationResultSchema. HTTP create requests omit daemon-generated IDs/timestamps and route projectId. Completed validation snapshots retain the existing job/finding entity shapes and observation timestamps, including projectId. These inputs are authenticated adapter submissions, not proof that the daemon ran any validator.

Default pagination is 100, maximum 500, with offset and ascending timestamp/UUID order. ContextRepository.listRecords is bounded too; consumers requiring more records must paginate. SQLite timestamps are sorted with julianday so ISO fractions do not change chronological order. All records read from JSON storage are validated against shared entity schemas.

MCP registration stores configuration with unknown/disabled initial status. Replacing inventory stores an explicit adapter snapshot, without spawning processes, contacting a server or changing host configuration. Inline HTTP URL credentials are refused; use secretRef. MCP inventory remains global because the existing McpServerSchema has no projectId.

Persisted context reads return the stored records with provenance and issue text. They do not synthesize context or promote AI assertions to observed facts. The daemon supports an injected ProjectContextProvider structurally compatible with Developer 2's ContextEngine. Provider output must satisfy the existing ProjectMemorySchema, route scope and requested size. Validation execution and MCP health checks remain explicit 501s until Developer 2's services are integrated.
