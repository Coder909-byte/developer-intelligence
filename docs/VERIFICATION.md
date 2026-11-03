# Bootstrap verification — 3 November 2026

Environment: macOS, Node 24.14.1, pnpm 11.10.0. The current workspace is the single repository root.

| Check                                     | Result                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install`                            | Passed after resolving peer compatibility and pnpm 11 build approvals                                                                                        |
| `pnpm install --frozen-lockfile`          | Passed                                                                                                                                                       |
| `pnpm typecheck`                          | Passed; source, tests and configs                                                                                                                            |
| `pnpm lint`                               | Passed                                                                                                                                                       |
| `pnpm test`                               | Passed: 31 tests across 3 files                                                                                                                              |
| `pnpm build`                              | Passed: all 8 packages, daemon, desktop web assets, extension bundle                                                                                         |
| `node scripts/smoke.mjs`                  | Passed: actual loopback HTTP health; authenticated SDK CRUD; generated token reuse and SQLite persistence after daemon process restart; explicit context 501 |
| `pnpm --filter @udi/desktop build:native` | Blocked: cargo/rustc not installed; Tauri could not execute cargo metadata                                                                                   |

The smoke test used a temporary private data directory and ephemeral loopback port, then removed test data. It did not leave a daemon running or insert demo projects into a production database. Tests cover input/response schemas, token/Host/Origin checks, project persistence/CRUD/conflicts, structured errors, malformed/oversized requests, SDK connection/timeout handling and unimplemented module responses. A regression test verifies that project PATCH preserves omitted fields and rejects empty updates.

Node's built-in SQLite emits an experimental API warning on the pinned runtime. Native Tauri compilation, VS Code Extension Host execution and VSIX packaging remain unverified. `code`, `platformio`, `kicad-cli`, and `iverilog` are unavailable on PATH; no engineering integrations or second-agent MCP session are claimed. Native/engineering tool installation was not performed.

GitHub identity was verified as Coder909-byte using the system Git credential without printing or saving the secret. The connected GitHub app lacks repository creation, so the GitHub REST API is used for the authorized private repository creation after checks. See Git history and the final handoff for the resulting commit/remote; no commit identifier is embedded here to avoid a self-referential commit hash.

## Core-platform persistence milestone — 3 November 2026

Verified on feat/core-platform after the bootstrap:

- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm format:check` passed. Tests: 50 passing across 6 files, including the original project/SDK tests with former stub expectations updated for real persistence.
- `node scripts/smoke.mjs` passed against the actual daemon over loopback HTTP. Events, context records, handoffs, MCP inventory, jobs and findings survived process stop/restart with the generated token reused. All engineering records in this test are explicitly synthetic storage fixtures, not executed tool results.
- Migration tests upgrade a standalone legacy v1 database while retaining original projects/events and migration timestamps; repeated reopen is idempotent. Unknown/noncontiguous migration history is refused.
- Tests verify authentication, schema/input validation, bounded pagination/filtering, project isolation, scoped references, duplicate conflicts, atomic rollback, provenance retention, and injected context output scope/size checks.
- No desktop, extension, UI, context-engine, MCP gateway, engineering-core or tool-runner source files were modified. Existing native/toolchain limitations from bootstrap remain unchanged.

Storage and additive contracts are committed separately from routes/SDK/integration documentation. Git push is limited to feat/core-platform; main and teammate branches are not merged or pushed by this milestone.

## Post-merge integration readiness audit — 3 November 2026

- Started from clean feat/core-platform at fa048ec. Fetched refs, confirmed HEAD was an ancestor of merged main cb848d5, and fast-forwarded the feature branch with no content changes. Local main and teammate branches were preserved.
- Read-only review covered frontend d1ce340 and the fetched intelligence branch at bootstrap 9c233ba. Unpublished local teammate code and a combined frontend/intelligence runtime were not evaluated.
- On the synchronized backend baseline, pnpm typecheck/lint/test/build/format:check passed; 50 tests passed in 6 files. Portable web/extension builds do not verify the unmerged frontend branch or native runtime.
- Expanded actual loopback HTTP smoke passed: missing/wrong-token 401, rejected write leaves no project, authenticated project creation, protected-resource checks, browser PUT preflight, context/event/handoff/inventory/results persistence, cross-project read/write rejection, no partial handoff, generated token reuse and all stored IDs after graceful process restart. Execution still returns truthful 501 responses. All validation records here are synthetic storage fixtures.
- Startup, HTTP assertions and shutdown have deadlines so failed integration checks do not wait indefinitely. Temporary data is removed; no daemon or demo data is left running in the real workspace.
- No entity schemas, shared SDK signatures, endpoint behavior, database migration, frontend or intelligence algorithm implementation changed. Necessary updates are the stronger smoke test, current integration documentation and deterministic demo gates.
- Doctor still reports missing code, cargo/rustc, platformio, kicad-cli and iverilog on this machine. Actual VS Code activation, native packaging, real engineering comparison and second-host MCP retrieval remain NOT RUN/BLOCKED, not inferred from persistence success.

## Real merged intelligence runtime — 3 November 2026

Synchronized feat/core-platform to merged main 2e52ced, preserving the initially clean workspace. Inspected actual DefaultEngineeringValidator, DefaultContextEngine, DefaultMcpGateway and daemon composition before testing. The baseline HTTP probe genuinely detected GPIO14/GPIO26 at rover.net:28 and src/pins.h:7 and passed the corrected fixture, but returned empty context. The daemon now bridges verified validator output into persisted observed facts; algorithms/gateway/frontend files remain unchanged.

Final gate passed on macOS Node 24.14.1 / pnpm 11.10.0: install --frozen-lockfile, typecheck, lint, 126 tests in 16 files, build, node scripts/smoke.mjs, node scripts/demo-e2e.mjs, format:check. The full test suite needed loopback access and canonical temporary paths for macOS symlink aliases; no frontend test source was edited.

The real-process test proves authenticated rover registration → actual mismatch/corrected comparison → persisted job/findings/events and observed context → actual MCP stdio initialization/tool requests → saved/retrieved handoff → independent SQLite reads → daemon and MCP process restart with the same records/provenance. It also exercises agent_summary writes through the real MCP tool. No mocked validator results or in-memory MCP transport is used by this test.

See RUNTIME_DEMO for captured IDs, exact commands, fixture evidence, retained-data reproduction, unmerged frontend job-scoping/disabled-control limitations and host/toolchain prerequisites. Backend/MCP current-job reads correctly exclude historical errors when jobId is supplied; unfiltered findings remain history. A real commercial agent/GUI Extension Host session and native Tauri packaging are not claimed.

## Final Mac host and VSIX runtime — 3 November 2026

feat/final-runtime starts at merged main b798354. All pre-existing work was preserved. Actual VS Code 1.143.0 Development Host and a separately installed VSIX both activated and exposed 17 manifest commands. Native UI-driven runs performed authenticated project selection, real mismatch/corrected validation, two source-linked diagnostics, opening pins.h at line 7, complete current-diagnostic clearing, user decision storage, reviewed handoff creation/retrieval and dashboard opening. No mocked VS Code module supplied this proof.

The real dashboard and a separate Developer 2 MCP CLI process retrieved the same VS Code-created rover state. MCP negotiated 2025-11-25 and exposed five tools. Actual failed results contained one finding; corrected results contained zero. SQLite and provenance survived a graceful live daemon restart. pnpm demo additionally verified independent database reads and daemon/MCP restarts in a fresh store.

The requested typecheck, lint, format, test, build, smoke, test, demo and additional test:mcp sequence passed. Both test runs passed 137 tests across 19 files. Packaging used official vsce 4.1.0 with staged VSIX-valid metadata; install succeeded in a separate profile. No frontend source, validator, patch algorithm, gateway implementation, shared schema or normal editor configuration was changed.

See FINAL_RUNTIME for exact launch/test/package commands, captured UUIDs and local screenshots. OpenCode is unavailable, so the script explicitly skips that host and identifies the real protocol reference client. Native Tauri, firmware compilation, KiCad export, hardware and Developer 2's independent correction flow remain unclaimed. Developer 3's completion notification currently delays refresh until dismissal; the actual UI workaround is documented.
