# Core-platform persistence integration

Current owner: Developer 1. Persistence baseline is merged into main (cb848d5); readiness work continues on feat/core-platform. This milestone adds database/API/SDK support without changing frontend or intelligence implementations. Consult API_CONTRACTS for all route/input/filter details. Consume the merged baseline through the lead's team workflow; do not merge teammate branches without approval.

## Developer 2

Do not implement a second event/context/MCP/results/handoff database or a competing migration v2. Migration v2 and repositories now belong to Developer 1 under the updated assignment. Algorithms, handoff selection/formatting, MCP execution, engineering validation, adapters and tool runners remain yours.

The daemon's `openDatabase` returns `PlatformDatabase`, which includes `PlatformRepositories`:

- `events.append(event)` and `events.list(projectId, limitOrOptions?)` satisfy the existing EventStore interface. Events are append-only; filters support exact type plus bounded pagination.
- `context.listRecords(projectId, options?)` and `context.saveHandoff(handoff)` satisfy the existing ContextRepository interface. Additional list/get/append ports handle raw records. Pagination defaults to 100; request more pages for complete history. Cross-project handoff references are rejected atomically.
- `mcpServers.list/get/register/replace/delete` persist global configurations and explicit adapter observations. They perform no health checks or process execution.
- `validation.recordResult({job, findings})` atomically saves terminal results; `getJob(projectId, id)` and `listFindings(projectId, options?)` read scoped data. IDs/observation times come from the validator; schema and matching job/project references are checked. Duplicate result IDs yield CONFLICT.
- `handoffs.list/get/append` persist prepared handoffs. The repository never decides what context to share.

These repositories are daemon-owned ports. Modules running in another process, including the MCP stdio bridge, use the shared client SDK instead of SQLite. Example daemon composition (performed with Developer 1):

```ts
const app = buildApp({
  databasePath,
  token,
  integrations: (repositories) => ({
    context: createYourContextEngine(repositories.context),
  }),
});
```

`createYourContextEngine` is illustrative, not an implemented export. The returned object must implement the existing `getContext(projectId, maxItems?) => Promise<ProjectMemory>`. Daemon validates schema, project scope and item count. Default GET context is just persisted records, with no intelligence synthesis. MCP/engineering invocation is not auto-enabled by persistence: validation-jobs and health-check remain 501. Coordinate execution/job orchestration as the next integration milestone.

## Developer 3

Use @udi/client-sdk only. Existing methods and entity shapes remain available; new methods return validated data and raise the existing DaemonClientError for HTTP/connection/timeout failures. Writes with bad local input raise ZodError before sending. All reads/writes except health require the local bearer token.

```ts
const { items: events } = await client.listEvents(projectId, { limit: 50, offset: 0 });
const record = await client.createContextRecord(projectId, {
  kind: 'decision',
  text: 'Review firmware mapping before changing hardware',
  provenance: { sourceKind: 'user_entered', actor: 'vscode-user' },
  evidence: [],
});
const memory = await client.getContext(projectId, 100);
const handoff = await client.createHandoff(projectId, {
  fromAgentId,
  summary: 'Continue firmware mapping review',
  recordIds: [record.id],
  nextSteps: ['Inspect GPIO assignments'],
  provenance: { sourceKind: 'user_entered', actor: 'vscode-user' },
});
const { items: servers } = await client.listMcpServers();
const { items: findings } = await client.listFindings(projectId, { jobId });
const job = await client.getJob(projectId, jobId);
```

Create requests for events/records/handoffs/MCP omit IDs and timestamps. MCP registration omits status and starts unknown/disabled. `replaceMcpServer(id, snapshot)` sends complete PUT input; it is not a patch or a health check. `recordValidationResult(projectId, result)` is for authenticated engineering adapters submitting completed job/finding entities, not fabricated frontend progress.

No UI modules changed. Render valid empty data, offline/401/400/404/409 errors, original provenance and test/fixture labels. A 200 context response means persisted data is available; it does not establish that a context intelligence engine exists. Health context/MCP/engineering flags describe integrated intelligence/execution, separately from persistence. Show 501 for unsupported execution, never simulated success.

## Verification

Migration tests preserve a preexisting v1 project's data/events and verify forward-only/idempotent behavior. Integration tests exercise all records through the SDK, project isolation, authentication, invalid scope/references, pagination, conflicts, atomic rollback and provider output validation. `node scripts/smoke.mjs` restarts the actual daemon process over HTTP and rechecks every record type; all engineering data in that test is explicitly synthetic persistence-test input, not an executed validation.

See [integration readiness](INTEGRATION_READINESS.md) for the current branch audit, exact teammate actions and contract gaps, and [demo plan](DEMO_PLAN.md) for deterministic product acceptance gates.
