# Four-Developer Execution Plan — UPSIDE DOWN.EXE

**Read after PRD + TECHNICAL_SPEC.** All four Codex agents must follow this plan. Each person clones the same GitHub repository and works on a separate branch. No blind parallel edits to shared contracts.

## 1. Immediate setup

1. Integrator creates GitHub repository only after the team agrees on repo name, visibility, license. Repo must not contain secrets.
2. Paste `04_CODEX_BOOTSTRAP_PROMPT.md` into Codex in the EMPTY local repository.
3. Bootstrap Codex creates scaffold, docs, lockfile, smoke tests, CI, AGENTS.md. Review generated diffs and run scripts locally before first push.
4. Make the **first working `main` commit**. Invite three teammates. Protect `main` if convenient; PR merges only.
5. Each developer creates own feature branch and reads `AGENTS.md`, `docs/PRD.md`, `docs/TECHNICAL_SPEC.md`.
6. Agree on contracts & demo fixture before writing separate apps.

## 2. Division of ownership

| Owner             | Branch                 | Write-owned paths                                                                           | Delivered acceptance                                                                   |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A Integrator/Core | `feat/core-daemon`     | `apps/core-daemon`, `packages/contracts`, `packages/event-store`, `packages/client-sdk`, CI | daemon health; projects/events/context; SQLite restart persistence; frozen schemas     |
| B Product UX      | `feat/host-interfaces` | `apps/vscode-extension`, `apps/desktop`, `packages/ui`                                      | real VS Code command and diagnostics + unified dashboard using daemon API              |
| C MCP/Context     | `feat/mcp-context`     | `packages/mcp-gateway`, `packages/context-engine`, host adapter subfolders                  | stdio MCP read tools; context handoff; second-host test                                |
| D Engineering     | `feat/engineering`     | `packages/engineering-core`, `packages/tool-runners`, `examples`                            | deterministic KiCad/firmware GPIO comparison, fixtures, optional PlatformIO real build |

**Shared contracts rule:** A owns schemas. Other teammates propose changes as a short request in the team chat or PR. A publishes the update; everyone rebases. Never independently invent API response types.

## 3. Canonical integration contract

- Project ID: `rover-demo` in test fixtures.
- Endpoint root: `http://127.0.0.1:<assigned-port>/v1` with token header; port configured from daemon discovery file (no hardcoded port inside extensions).
- Validation job submitted to `/v1/projects/:id/validation-jobs`; status read through `/v1/jobs/:id`.
- Findings carry source filename + expected/observed pin; result is **not** an electrical-safety certification.
- MCP server reads daemon via scoped loopback client and exposes context.
- Do not use fabricated live test results; demo fixtures must be labeled.

## 4. Recommended dependency sequence

**Parallel at start:** A contracts/core skeleton; D parser/fixtures using shared interface; B visual components + extension commands using a mocked typed API; C MCP server using a mocked typed client.

**Integration after baseline:** A publishes client SDK → D wires job service → B wires VS Code diagnostics + desktop → C wires real daemon context and second host.

## 5. Definition of done (each PR)

- Owner's scope only unless explicit approval; no broken root scripts; README/docs updated when behavior changes.
- TypeScript strict typecheck passes. Unit tests cover happy and failure paths. No unchecked `any`, no hard-coded credentials, no arbitrary shell execution.
- Emits structured errors and respects cancellation/timeouts.
- Real/fixture/simulated results clearly distinguished.
- PR includes short demo steps and screenshot/log evidence.

## 6. First five decisions — agree immediately

1. Repo name and product label (placeholder allowed).
2. Single demo host platform and verified Node/pnpm versions.
3. VS Code as canonical PS-01 host; OpenCode as secondary host **only if MCP setup works locally**.
4. Fixed demo project artifact schema: netlist + firmware mapping with a known `MOTOR_EN` mismatch.
5. Desktop packaging policy: Tauri if stable; local React dashboard if packaging threatens integration.

## 7. Demo priority ladder

**P0** VS Code extension → validation → findings → persistence → second-agent MCP retrieval.
**P1** Desktop Tauri packaging; config exporter; PlatformIO real build; automatic netlist export.
**P2** Verilog simulator; serial hardware; more IDE adapters; broad tool directory.

## 8. Suggested timebox from remaining hackathon period

- First working hour: contracts, repository bootstrap, reproducible fixtures, daemon health, task ownership.
- Next 3 hours: four workstreams produce isolated green tests; integration checks begin early.
- Next 3 hours: connect VS Code ↔ daemon ↔ engineering ↔ MCP; fix only blockers.
- Remaining time before 7:30 AM judging: stabilize, repeat demo, collect evidence, pitch; freeze features ahead of scoring.
  **Hard event constraints:** 4 Nov 2026, 08:30 IST coding freeze; 08:45 IST submit. Verify evaluation time on event page or announcements.

## 9. Integration meeting agenda (10 minutes)

- Can daemon persist a project event and return it after restart?
- Can engineering-core parse the fixture and issue exact expected mismatch?
- Can VS Code extension call the real daemon and display the finding?
- Can a separate MCP client request project context from the daemon?
- What failed today, and which owner fixes it?

## 10. Fallback plan

If desktop packaging fails → run dashboard in browser; if KiCad CLI absent → parse exported actual fixture and label it; if OpenCode integration fails → demonstrate MCP with a separate compatible host/client, but do not claim OpenCode proven; if ESP32 absent → skip serial demo; if PlatformIO absent → show validation only, never claim compile passed.

## 11. Safe GitHub routine

`git checkout -b feat/your-area` → implement small milestone → `pnpm typecheck && pnpm test && pnpm build` → commit → push own branch → PR into main → reviewer checks interface changes → merge → teammates pull/rebase. Avoid force pushing shared branches. Integrator tags stable demo commit `demo-v1`.

## 12. Judge-facing 15-second explanation

“We're extending VS Code with a shared intelligence layer that connects coding agents and engineering tools. We detect firmware-to-schematic mismatches, validate fixes, and transfer verified project context between supported AI development environments—without repeatedly setting everything up.”
