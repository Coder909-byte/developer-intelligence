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
