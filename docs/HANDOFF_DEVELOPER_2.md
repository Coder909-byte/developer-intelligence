# Developer 2 handoff — intelligence engine

## Branch and ownership

After bootstrap reaches origin/main:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/intelligence-engine
pnpm install --frozen-lockfile
```

Own `context-engine`, `mcp-gateway`, `engineering-core`, `tool-runners`, event operations in `event-store`, host/agent adapters and engineering fixtures. Developer 1 owns existing project persistence/migrations and daemon routes; coordinate additional migrations and route composition. Read PRD, technical spec, ADR 0001 and API_CONTRACTS first. The original documents describe four owners; this handoff is the active three-person assignment.

## Ports to implement

- `EventStore.append/list`: validate ActivityEventSchema; enforce project scope; persistence/order/limits/provenance. Extend migration v1 with new numbered migrations, never erase existing project data.
- `ContextEngine.getContext/createHandoff` and injected `ContextRepository`: return ProjectMemorySchema/AgentHandoffSchema; retain provenance and evidence; bound maxItems and avoid implicit global state.
- `McpRegistry` and `McpGateway`: official v2 `@modelcontextprotocol/server` + `/stdio`; GatewayOptions receives shared DaemonClient and projectId. All data access goes through authenticated daemon APIs. Route and SDK methods for future event/decision writes must be reviewed with Developer 1.
- `EngineeringValidator.validate`: accept ValidationRequest and return actual Job + findings. Fail unavailable tools explicitly. `EngineeringDependencies` provides ToolRunner and workspace resolution.
- `ToolRunner`: fixed executable IDs (`kicad-cli`, `platformio`, `iverilog`), argument allowlists, no shell strings, canonical authorized workspace, timeout/cancellation/output limits. Never flash/energize automatically.

## Integration and order

1. Implement persisted scoped events and provenance, then context/handoffs; coordinate routes and SDK methods with Developer 1.
2. Replace context 501 through injected implementation. Add tests before enabling health capability.
3. Build real MCP tools: get_project_context, list_project_events, get_validation_results, list_available_tools; record_decision is a reviewed write. Keep stdio stdout protocol-only, logs on stderr. Test a real second host before naming it supported.
4. Add sourced KiCad-exported fixture and firmware pin map in examples/rover; deterministic mismatch and corrected comparison with both file references. Fixtures are intentionally absent; never relabel a hand-authored synthetic file as exported KiCad output.
5. Implement findings/job persistence and daemon integration. PlatformIO, RTL and serial are real integrations only when tools/hardware exist; unavailable is never success.

Current frozen reads: `/api/v1/projects/:id/context`, `/api/v1/mcp/servers`, `/api/v1/engineering/findings?projectId=UUID` return 501. Import all shapes from contracts. Add write schemas with Developer 1; never invent private frontend/adapter payloads.

## Required tests

Scoped storage isolation, restart persistence, migration preservation, provenance round trips; handoff validation; real SDK ↔ daemon ↔ MCP retrieval; deterministic mismatch/corrected pass/missing or ambiguous signal; unavailable tool, nonzero exit, timeout, cancellation, output truncation; path traversal and symlink escape denial; config preview without writes and approved apply with backup/rollback. Run root typecheck/lint/test/build and smoke after daemon integration.
