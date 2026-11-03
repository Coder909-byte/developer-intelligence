# Universal Developer Intelligence Platform

UPSIDE DOWN.EXE · PS-01 — Beyond the App. Local-first VS Code enhancement, shared agent context, and engineering validation. This repository is the team bootstrap; only project persistence and daemon connectivity are implemented. The dashboard and VS Code command are minimal integration entry points.

## Start

Use Node **24.14.1** (`nvm use`) and pnpm **11.10.0**. Install the package manager with `npm install --global pnpm@11.10.0` if needed.

```bash
pnpm install
pnpm dev
```

The daemon listens only on `http://127.0.0.1:4317`; Vite serves the desktop scaffold at `http://127.0.0.1:5173`. Click **Check connection**. Health is public; every other API route requires a bearer token. The daemon creates `.data/token` with mode 0600 and `.data/platform.sqlite` under a mode 0700 directory at the repository root. These files are ignored by Git. The token survives restarts; it is not printed or embedded in frontend bundles.

```bash
curl http://127.0.0.1:4317/api/v1/health
```

Configure `UDI_PORT`, `UDI_DATA_DIR` (prefer an absolute path), or `UDI_TOKEN` (at least 32 characters) in your shell. `.env` files are not automatically loaded. Set `VITE_UDI_URL` or VS Code setting `udi.daemonUrl` when changing the port; native Tauri CSP must also be updated to allow that origin. UI token onboarding is Developer 3's next task: VS Code SecretStorage or an OS-backed store; do not put tokens in Vite variables or localStorage.

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
| `pnpm smoke`                              | Build and test actual HTTP + SDK CRUD + daemon restart in a temporary data directory                          |
| `pnpm format:check`                       | Verify formatting                                                                                             |
| `pnpm doctor`                             | Report local toolchain and optional engineering/native tools                                                  |
| `pnpm --filter @udi/desktop dev:native`   | Run Tauri 2 (requires Rust and platform prerequisites)                                                        |
| `pnpm --filter @udi/desktop build:native` | Build native shell; separate from portable root build                                                         |

Shared package edits require rebuilding (`pnpm build:packages`); the dev commands do this once at startup. App source changes are watched. No command claims to run VS Code when only a bundle watcher is active.

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

Context, registry and engineering routes return structured **501** errors. No MCP server, validator, firmware compilation, telemetry capture, second-agent interoperability, packaged `.vsix`, or full UI is claimed by this bootstrap. Subsequent planned endpoints in the original spec return 404 until their shared contracts and implementations are agreed.

See [GitHub setup](docs/GITHUB_SETUP.md) for initial-push recovery when local authentication is unavailable.
