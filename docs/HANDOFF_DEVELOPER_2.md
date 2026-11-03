# Developer 2 handoff — intelligence engine

Current aggregator assignment: read [AGGREGATOR_CONTRACT](AGGREGATOR_CONTRACT.md) and [AGGREGATOR_ACCEPTANCE](AGGREGATOR_ACCEPTANCE.md). Main `24475d4` already contains the engineering/MCP-memory runtime; the bootstrap instructions below are historical. External discovery/routing/history and host adapter format/safety are the current integration gaps.

## Branch and ownership

After bootstrap reaches origin/main:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/intelligence-engine
pnpm install --frozen-lockfile
```

Own `context-engine`, `mcp-gateway`, `engineering-core`, `tool-runners`, host/agent adapters and engineering fixtures. Developer 1 owns platform persistence/migrations and daemon routes; consume the repository/SDK ports and coordinate route composition. Read PRD, technical spec, ADR 0001 and API_CONTRACTS first. The original documents describe four owners; this handoff is the active three-person assignment.

## Ports to implement

- `EventStore.append/list` is now implemented by Developer 1, including project scope, persistence, ordering, bounds and schema validation. Consume this port in your intelligence logic; coordinate any additional migrations with Developer 1.
- `ContextEngine.getContext/createHandoff` and injected `ContextRepository`: return ProjectMemorySchema/AgentHandoffSchema; retain provenance and evidence; bound maxItems and avoid implicit global state.
- `McpRegistry` and `McpGateway`: official v2 `@modelcontextprotocol/server` + `/stdio`; GatewayOptions receives shared DaemonClient and projectId. All data access goes through authenticated daemon APIs. Route and SDK methods for future event/decision writes must be reviewed with Developer 1.
- `EngineeringValidator.validate`: accept ValidationRequest and return actual Job + findings. Fail unavailable tools explicitly. `EngineeringDependencies` provides ToolRunner and workspace resolution.
- `ToolRunner`: fixed executable IDs (`kicad-cli`, `platformio`, `iverilog`), argument allowlists, no shell strings, canonical authorized workspace, timeout/cancellation/output limits. Never flash/energize automatically.

## Integration and order

1. Consume persisted scoped events and provenance, then implement context/handoff intelligence; coordinate any additional routes and SDK methods with Developer 1.
2. Inject your context implementation through the daemon integration factory. Persisted context reads already work; add algorithm tests before claiming synthesis support.
3. Build real MCP tools: get_project_context, list_project_events, get_validation_results, list_available_tools; record_decision is a reviewed write. Keep stdio stdout protocol-only, logs on stderr. Test a real second host before naming it supported.
4. Add sourced KiCad-exported fixture and firmware pin map in examples/rover; deterministic mismatch and corrected comparison with both file references. Fixtures are intentionally absent; never relabel a hand-authored synthetic file as exported KiCad output.
5. Use existing findings/job persistence and coordinate daemon execution integration with Developer 1. PlatformIO, RTL and serial are real integrations only when tools/hardware exist; unavailable is never success.

Current frozen reads: `/api/v1/projects/:id/context`, `/api/v1/mcp/servers`, `/api/v1/engineering/findings?projectId=UUID` return persisted data. Write schemas are documented in API_CONTRACTS. Import them directly; never invent private frontend/adapter payloads. Execution/health checks remain 501 pending your implementations.

## Required tests

Scoped storage isolation, restart persistence, migration preservation, provenance round trips; handoff validation; real SDK ↔ daemon ↔ MCP retrieval; deterministic mismatch/corrected pass/missing or ambiguous signal; unavailable tool, nonzero exit, timeout, cancellation, output truncation; path traversal and symlink escape denial; config preview without writes and approved apply with backup/rollback. Run root typecheck/lint/test/build and smoke after daemon integration.

## Updated core-platform milestone

The current Developer 1 assignment supersedes the bootstrap event-persistence work above: migration v2, event/context/handoff repositories, MCP inventory and completed validation-result storage are implemented on feat/core-platform. Do not duplicate persistence or introduce another migration v2. Your intelligence, MCP execution and validation algorithms remain unchanged in ownership. See [persistence integration](INTEGRATION_PERSISTENCE.md), [ADR 0002](ADR/0002-persistence.md), and the new API_CONTRACTS section for exact ports and SDK write methods. Existing EventStore and ContextRepository interfaces remain structurally compatible. Coordinate integration with the lead; do not merge teammate branches without approval.

## Integration readiness follow-up

Persistence is now merged into main (cb848d5). See [integration readiness](INTEGRATION_READINESS.md) for the actual production composition, completed-event/context publication, current-job discovery, exact stdio entry point and fixture requirements, and [demo plan](DEMO_PLAN.md) for release gates. The fetched intelligence branch is still at bootstrap; unpublished local work was not reviewed. No competing persistence or migration implementation is required.
