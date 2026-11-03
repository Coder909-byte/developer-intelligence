# Universal Developer Intelligence Platform

UPSIDE DOWN.EXE · PS-01 — Beyond the App. Local-first VS Code enhancement, shared agent context, and engineering validation. The backend now persists project events, context records, handoffs, MCP inventory and validation results, alongside projects and daemon connectivity. The merged desktop and VS Code extension use the shared SDK; see the runtime demo guide for current verification limits.

## Start

Use Node **24.14.1** (`nvm use`) and pnpm **11.10.0**. Install the package manager with `npm install --global pnpm@11.10.0` if needed.

```bash
pnpm install
UDI_INTEGRATIONS=true pnpm dev
```

The daemon listens only on `http://127.0.0.1:4317`; Vite serves the desktop control center at `http://127.0.0.1:5173`. Health is public; every other API route requires a bearer token. The daemon creates `.data/token` with mode 0600 and `.data/platform.sqlite` under a mode 0700 directory at the repository root. These files are ignored by Git. The token survives restarts; it is not printed or embedded in frontend bundles.

```bash
curl http://127.0.0.1:4317/api/v1/health
```

Configure `UDI_PORT`, `UDI_DATA_DIR` (prefer an absolute path), or `UDI_TOKEN` (at least 32 characters) in your shell. `.env` files are not automatically loaded. Set `VITE_UDI_URL` or VS Code setting `udi.daemonUrl` when changing the port; native Tauri CSP must also be updated to allow that origin. The desktop keeps the token in session memory; the extension uses SecretStorage. Do not put tokens in Vite variables or localStorage. Set UDI_INTEGRATIONS=true (or UDI_ENABLE_INTEGRATIONS=1) when launching the daemon to enable the merged intelligence services.

## Commands

| Command                                   | Behavior                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                            | Install all workspaces using the committed lockfile                                                           |
| `pnpm dev`                                | Build shared packages, then run daemon + desktop Vite server                                                  |
| `pnpm dev:daemon`                         | Build shared packages and watch daemon (`dev:core` alias)                                                     |
| `pnpm dev:desktop`                        | Build shared packages and run Vite browser dashboard                                                          |
| `pnpm dev:extension`                      | Build shared packages and watch the VS Code extension bundle; use F5 to launch the Extension Development Host |
| `pnpm build`                              | Build all eight packages, daemon, desktop web assets, extension CJS bundle                                    |
| `pnpm typecheck`                          | Build shared declarations and typecheck source, tests, and configs                                            |
| `pnpm lint`                               | ESLint                                                                                                        |
| `pnpm test`                               | Contract, SDK, daemon and persistence tests                                                                   |
| `pnpm test:integration`                   | Daemon integration tests                                                                                      |
| `pnpm smoke`                              | Build and test HTTP + SDK persistence for all record types across daemon restart                              |
| `pnpm format:check`                       | Verify formatting                                                                                             |
| `pnpm doctor`                             | Report local toolchain and optional engineering/native tools                                                  |
| `pnpm --filter @udi/desktop dev:native`   | Run Tauri 2 (requires Rust and platform prerequisites)                                                        |
| `pnpm --filter @udi/desktop build:native` | Build native shell; separate from portable root build                                                         |

Shared package edits require rebuilding (`pnpm build:packages`); the dev commands do this once at startup. App source changes are watched. No command claims to run VS Code when only a bundle watcher is active.

Run `node scripts/demo-e2e.mjs --keep` after building to retain private demo data. For a host process, use `node scripts/mcp-stdio.mjs` with UDI_PROJECT_ID, UDI_DATA_DIR and UDI_DAEMON_URL; it launches Developer 2's gateway and keeps stdout protocol-only.

## Repository

```text
apps/        core-daemon · desktop (React/Vite/Tailwind/Tauri 2) · vscode-extension
packages/    contracts · client-sdk · event-store · context-engine · mcp-gateway
             engineering-core · tool-runners · ui
examples/    rover · rtl-alu (documented fixture slots)
docs/        original specs · architecture decisions · contracts · demo · handoffs
scripts/     doctor.mjs · smoke.mjs
.github/     CI workflow
```

Developer 1 owns core/contracts/SDK/SQLite/CI. Developer 2 owns intelligence, adapters and validation; Developer 3 owns frontend packages. See [architecture](docs/ARCHITECTURE.md), [API contracts](docs/API_CONTRACTS.md), [Developer 2 handoff](docs/HANDOFF_DEVELOPER_2.md), and [Developer 3 handoff](docs/HANDOFF_DEVELOPER_3.md). Existing source specs are preserved; [ADR 0001](docs/ADR/0001-architecture.md) resolves bootstrap differences.

## Verification and boundaries

`pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build` is the CI gate. `pnpm smoke` additionally exercises sockets and process restart. Native builds require [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Node 24.14.1's built-in SQLite emits an experimental API warning; avoiding a native SQLite addon makes bootstrap portable, but runtime upgrades must retain the persistence tests.

With intelligence integrations enabled, validation-jobs executes the real validator, persists results/events and publishes observed context. With integrations disabled, execution routes still return structured 501 errors. Run `pnpm demo:verify` for real rover validation, SQLite restart persistence and actual stdio MCP requests. This does not verify a commercial agent host, native UI execution, firmware build or hardware operation. See [runtime demo](docs/RUNTIME_DEMO.md) for exact commands, results and the unmerged frontend job-scoping fix.

See [persistence integration](docs/INTEGRATION_PERSISTENCE.md) for backend interfaces and shared SDK examples, [integration readiness](docs/INTEGRATION_READINESS.md) for teammate actions and blockers, and [demo plan](docs/DEMO_PLAN.md) for deterministic end-to-end acceptance gates.

See [GitHub setup](docs/GITHUB_SETUP.md) for initial-push recovery when local authentication is unavailable.
