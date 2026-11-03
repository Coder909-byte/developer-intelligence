# Technical Specification — Universal Developer Intelligence Platform

**Version:** 1.0 · **Architecture baseline:** local-first modular monorepo · **Workstation:** developer laptop (Mac/Linux/Windows support is aspirational; demo host verified first)

## 1. Architecture

```
 VS Code Extension ──HTTP loopback──┐
                                    ├── Local Core Daemon ── SQLite
 Tauri React Desktop ─HTTP loopback─┘          │
                                               ├── Projects + Event Store + Context Builder
 Second MCP-compatible agent ──stdio── MCP Server ───┤ (scoped calls)
                                               ├── MCP Registry / Config Adapters
                                               └── Engineering Job Runner
                                                     ├── KiCad exported netlist
                                                     ├── firmware pin config + PlatformIO CLI
                                                     ├── Icarus Verilog [P1]
                                                     └── Serial telemetry [P1]
```

**One source of truth:** daemon SQLite. CLI tools run via narrow allowlisted runners. No direct database access from UI/extension/MCP bridge. Stdio MCP server calls daemon via loopback API with a local per-session token. Do not expose daemon on LAN.

## 2. Stack and rationale

- **Package manager:** pnpm workspaces; **language:** TypeScript strict; Node.js supported LTS pinned in `.nvmrc` and CI.
- **Desktop:** Tauri 2 + React + Vite + Tailwind; window shell may be deferred behind local React dashboard if packaging fails.
- **VS Code:** official extension API, native commands/diagnostics/tree views; webview only for complex detail screen.
- **Core:** Fastify (or lightweight HTTP equivalent, choose once), SQLite + migration package, Zod validation.
- **MCP:** official **v2** `@modelcontextprotocol/server` / `@modelcontextprotocol/client`, Zod v4; stdio for local second-host interoperability. **Do not copy SDK v1 imports.**
- **Engineering:** KiCad exported netlist parser (document expected format), PlatformIO CLI job runner, optional Icarus Verilog, serial port adapter only if supported.
- **Tests:** Vitest (units/integration), optional Playwright UI and VS Code extension harness; CI lint/typecheck/test/build.

## 3. Monorepo folder tree (create as shown)

```
developer-intelligence/
├── apps/
│   ├── desktop/                 # Tauri + React UI; thin client
│   ├── vscode-extension/        # native VS Code PS-01 host integration
│   └── core-daemon/             # loopback API + bootstrap + app services
├── packages/
│   ├── contracts/               # frozen Zod schemas, TS types, API models
│   ├── client-sdk/              # typed fetch client for all frontends
│   ├── event-store/             # SQLite migrations/repositories
│   ├── context-engine/          # summarize/handoff/provenance logic
│   ├── mcp-gateway/             # MCP stdio server + registry + host adapters
│   ├── engineering-core/        # deterministic cross-artifact validator
│   ├── tool-runners/            # scoped/allowlisted process execution
│   └── ui/                      # small shared presentational components
├── examples/
│   ├── rover/                   # minimal real KiCad netlist + firmware fixture
│   └── rtl-alu/                 # optional working Verilog testbench
├── docs/
│   ├── PRD.md
│   ├── TECHNICAL_SPEC.md
│   ├── TEAM_PLAN.md
│   ├── ADR/0001-architecture.md
│   ├── DEMO.md
│   └── SECURITY.md
├── scripts/
│   ├── doctor.mjs
│   └── demo-reset.mjs
├── .github/workflows/ci.yml
├── .vscode/extensions.json
├── .gitignore
├── .editorconfig
├── .env.example
├── .nvmrc
├── AGENTS.md
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── README.md
```

## 4. Contract-first rules

- All endpoints versioned `/v1`; all inputs/outputs validated through shared Zod schemas in `packages/contracts`.
- `projectId` is required for all context and tool actions; don't fall back to an implicitly global project.
- Event envelope: `id`, `projectId`, `type`, `actor`, `sourceKind`, `sourceRef?`, `createdAt`, `payload`, `schemaVersion`.
- `sourceKind`: `observed_tool`, `user_entered`, `agent_summary`, `imported`; surface this in UI.
- `Job`: `queued|running|succeeded|failed|cancelled`, `startedAt`, `completedAt`, `exitCode?`, `stdoutTail`, `stderrTail`, `artifacts[]`.
- Engineering `Finding`: `ruleId`, `severity`, `message`, `expected`, `observed`, `evidence[]`, `suggestedFix?`, `status`; evidence includes file path and optional line/column; `verifiedBy` includes exact tool.
- Use UUIDs and ISO UTC timestamps. No `any` across public boundaries.

## 5. Initial REST surface

| Method   | Path                               | Purpose                                      |
| -------- | ---------------------------------- | -------------------------------------------- |
| GET      | `/v1/health`                       | daemon status/version/capabilities           |
| GET/POST | `/v1/projects`                     | list/create workspace project                |
| GET      | `/v1/projects/:id/overview`        | project status/counts/recent events          |
| GET/POST | `/v1/projects/:id/events`          | fetch/append approved scoped events          |
| GET/POST | `/v1/projects/:id/handoffs`        | list/create structured handoffs              |
| GET      | `/v1/projects/:id/context`         | current verified context by provenance       |
| POST     | `/v1/projects/:id/validation-jobs` | run engineering comparison/build (async job) |
| GET      | `/v1/jobs/:id`                     | job progress/result and output               |
| GET/POST | `/v1/mcp/servers`                  | registry list/register                       |
| POST     | `/v1/mcp/servers/:id/health-check` | check server safely                          |
| POST     | `/v1/host-configs/preview`         | generate host diff, no write                 |
| POST     | `/v1/host-configs/apply`           | apply only after explicit approval           |

**Sample event JSON:**

```json
{
  "id": "evt_001",
  "projectId": "rover-demo",
  "type": "engineering.validation.completed",
  "actor": "engineering-core",
  "sourceKind": "observed_tool",
  "sourceRef": "job_123",
  "createdAt": "2026-11-03T13:00:00Z",
  "schemaVersion": 1,
  "payload": { "findingCount": 1, "status": "failed" }
}
```

**Example context JSON:**

```json
{
  "projectId": "rover-demo",
  "generatedAt": "2026-11-03T13:01:00Z",
  "facts": [
    {
      "text": "Motor EN pin mismatch was detected",
      "sourceKind": "observed_tool",
      "sourceRef": "job_123"
    }
  ],
  "decisions": [
    { "text": "Review firmware map before changing hardware", "sourceKind": "user_entered" }
  ],
  "openIssues": ["Pin mismatch needs reviewed patch"]
}
```

## 6. MCP tool contract

Tools (server-side implementation calls the daemon, with scoping and per-tool permissions):

1. `get_project_context({projectId, maxItems?})` → structured context with provenance.
2. `list_project_events({projectId, limit?, types?})` → paged events.
3. `get_validation_results({projectId, jobId?})` → genuine tool results and evidence.
4. `record_decision({projectId, text, evidenceRefs?})` → user/agent decision clearly labeled; never treat agent assertion as observed fact.
5. `list_available_tools({projectId})` → enabled capabilities and health status.
   Add `run_engineering_validation` only if scoped, allowlisted, and explicit user permission is guaranteed. Read tools come first.

## 7. Engineering data model and algorithm

**Input:** normalized netlist JSON extracted from a known KiCad-exported file + `pinmap.json` derived from supported firmware configuration. E.g.

```json
{
  "board": "esp32",
  "signals": [
    { "name": "MOTOR_EN", "net": "Net-MOTOR_EN", "gpio": "GPIO14", "sourceFile": "rover.net" }
  ]
}
```

```json
{ "board": "esp32", "pins": { "MOTOR_EN": "GPIO26" }, "sourceFile": "src/pins.h" }
```

**Rules:** (a) normalize `14`, `GPIO14`, casing; (b) match by stable signal alias; (c) missing/ambiguous signal → `unknown`, not invented; (d) mismatch → deterministic finding with both sources; (e) duplicate GPIO assignments → conflict if incompatible by rule; (f) successful comparison means **configuration consistency only**, not physical correctness.

**Important:** Extracting logical signal aliases from arbitrary netlists may require a project-specific mapping file; don't pretend a net label always reveals the firmware symbol. Starter demo may use `engineering-map.json` to bind `MOTOR_EN` ↔ actual net.

**Patch protocol:** preview diff → explicit user confirmation → create rollback snapshot → apply scoped file edit → rerun deterministic compare → optionally invoke `platformio run` with fixed working directory/timeout → store each result. Never auto-energize motors or flash firmware.

## 8. Local process security

- Bind to `127.0.0.1` only; randomly generated local token stored with restricted permissions; never put tokens in URL query or logs.
- Webview content security policy; validate postMessage commands; use official VS Code APIs where feasible.
- Command execution via fixed executable IDs and argument builders, never raw shell interpolation.
- Workspace path authorization, canonicalize paths to block traversal; no arbitrary write outside project.
- MCP config preview before applying; do not overwrite existing configs without backup and explicit consent.
- Child-process timeout, output truncation, cancellation, and event logging.
- Secrets stored via OS keychain/VS Code SecretStorage where possible; `.env.example` contains placeholders only.

## 9. Error handling

- No KiCad CLI installed → show `adapter_unavailable` and permit fixture-based netlist analysis.
- PlatformIO missing → `build_skipped_unavailable`, never `build_passed`.
- MCP server fails → health state `unreachable` + actionable diagnostics.
- Agent tool history unavailable → allow explicit decision/handoff; do not scrape private session state.
- Job times out → `failed` with timeout flag and safe cleanup.
- Schema mismatch → descriptive API error and version check.

## 10. Test matrix

**Unit:** pin normalization; signal alias comparison; conflicts; provenance serialization; schema validators; workspace path enforcement.
**Integration:** create project → append observed validation event → retrieve context via REST and MCP; restart daemon → verify persistence; run netlist fixture → finding → corrected fixture → pass; config preview has no side effect; forbidden path denied.
**UI:** VS Code command opens finding with file evidence; desktop and extension show matching status; empty/error/loading states.
**Demo E2E:** second-agent MCP invocation (actual tool), controlled failed build, successful validation, handoff retrieval.

## 11. CI and developer scripts

Root scripts: `dev:core`, `dev:desktop`, `dev:extension`, `build`, `typecheck`, `lint`, `test`, `test:integration`, `doctor`, `demo:reset`. CI runs install (frozen lockfile), typecheck, lint, unit tests, package builds. `doctor` checks Node/pnpm/platformio/kicad/iverilog and reports missing optional tools without failing base demo.

## 12. Integration gates

- **Gate 0:** bootstrap repo/pnpm/contracts & sample data, all packages install.
- **Gate 1:** daemon health and persistence + one client request.
- **Gate 2:** deterministic engineering finding visible in VS Code.
- **Gate 3:** MCP tool retrieves persisted validation/handoff from different host.
- **Gate 4:** desktop shows same state; safe preview/fix loop; optional real build.
- **Gate 5:** full five-minute run twice without manual database edits.

## 13. Packaging

**Demo deliverable:** working VS Code extension `.vsix`, local daemon launch command, locally served desktop dashboard or packaged Tauri app, seeded engineering fixture, README/demo script. If Tauri bundling fails, prioritize extension + daemon + browser dashboard. Do not make install-time privileged changes.

## 14. Documentation references

- https://ts.sdk.modelcontextprotocol.io/v2/
- https://code.visualstudio.com/api
- https://upsidedowntss.vercel.app/#problems
