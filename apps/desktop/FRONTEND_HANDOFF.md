# Frontend milestone — Developer 3

Branch: `feat/frontend`. Backend contracts and services remain owned by Developers 1 and 2.

## Implemented

- React/Tauri frontend with Overview, Agent Workspace, MCP Hub, Engineering, Devices and Settings; responsive dark styling and keyboard focus states.
- Workspace registration/selection through the shared SDK. Local token onboarding is memory-only in desktop; credentials are never saved to browser storage or bundled in environment variables.
- Context memory/timeline with source provenance, explicit retrieval and structured-context copying when the daemon returns records.
- MCP registry rendering and server detail inspection; engineering findings with severity, expected/observed values, source evidence and verification tool.
- Loading, empty, 401, 501, disconnected and retry states. Request generations prevent late reads from replacing current project state.
- In-app integration guide under Settings explains shared daemon, VS Code, MCP hosts and planned open-source engineering adapters, with availability boundaries.
- Native VS Code activity-bar sidebar, 13 commands, status bar, SecretStorage, canonical workspace/project matching, diagnostics, source navigation, MCP inventory and explicitly unsaved handoff draft review/copy.
- Shared UI: tokens, restrained SVG icons, buttons, cards, badges, fields, dialogs, empty states, skeletons, timeline, finding detail panel and log viewer.

## Run

From repository root on the pinned Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm dev:daemon
# In a separate terminal:
pnpm dev:desktop
```

Open `http://127.0.0.1:5173`. Use Settings to enter the daemon token from `.data/token`, then register an existing workspace directory. The token is cleared on reload. The current scaffold has no OS-backed desktop credential store; this is an explicit limitation.

For VS Code: run `pnpm dev:extension`, open the repository in VS Code and press F5 using the existing launch configuration. The watcher does not launch VS Code itself. Open the Developer Intelligence activity-bar view, run Set Daemon Token, and register/select an open workspace. Multiple open roots require selection; unrelated daemon projects are never silently selected.

Native desktop: `pnpm --filter @udi/desktop build:native` requires Rust/Cargo and platform prerequisites. Root build verifies web and extension bundles separately from native packaging.

## API integration

All HTTP is through `@udi/client-sdk`, using contract types from `@udi/contracts`. Canonical prefix is `/api/v1`.

| SDK method     | Route                                    | Frontend use                     | Bootstrap result            |
| -------------- | ---------------------------------------- | -------------------------------- | --------------------------- |
| health         | GET /health                              | Desktop/extension status         | Implemented                 |
| listProjects   | GET /projects                            | Selection and workspace matching | Implemented; token required |
| createProject  | POST /projects                           | Explicit workspace registration  | Implemented; token required |
| getContext     | GET /projects/:id/context                | Memory/timeline/context document | 501 until service lands     |
| listMcpServers | GET /mcp/servers                         | Registry and inventory document  | 501 until service lands     |
| listFindings   | GET /engineering/findings?projectId=UUID | Findings and native diagnostics  | 501 until service lands     |

No new API schemas, routes or intelligence algorithms were introduced.

## Developer 1 / Developer 2 integration requirements

1. Implement existing context, MCP and findings response contracts. Findings must include actual evidence and verification tool; all returned project IDs must match the requested scope.
2. Publish frozen SDK methods and request schemas for validation submission/job progress, handoff create/list/latest, MCP mutation/health/tools/permissions/config preview/apply. The entity schemas are not sufficient to infer safe write payloads.
3. Publish optional artifact/toolchain/build-log, devices/telemetry, agents/environments and storage APIs before enabling corresponding controls.
4. Provide a reviewed correction preview/approval/apply/rollback protocol. Frontend does not locally patch files or invoke engineering tools.
5. Agree daemon discovery and OS-backed desktop credential storage before persistent credential onboarding. Default origin follows the bootstrap; non-default native ports also need Tauri CSP changes.
6. Verify a real VS Code Extension Host run, native shell packaging and the second MCP host end-to-end. Compilation and mocked-host activation are not proof of those integrations.

## Verification evidence

Full milestone check: `pnpm typecheck`, `pnpm lint`, `pnpm test` (51 tests; 20 frontend-specific) and `pnpm build` passed. Frontend tests cover navigation, SDK loading/401/offline/501 states, project selection, provenance, MCP inventory, finding evidence, form validation, stale requests, evidence containment/position conversion and mocked-host extension activation/command execution.

Real browser against the actual local daemon: health connected; missing-token state shown; token entry succeeded without browser persistence; rover fixture registered via POST /projects; active workspace selected; context/findings 501 responses shown as unavailable. Disconnected/retry behavior and narrow-window layout were also verified in the real browser. No fake live data or simulated success mode exists.

Environment limitations: pnpm workspace symlinks are denied by this Windows sandbox. Registry dependencies were installed with a local hoisted store and shared package build outputs copied into ignored node_modules for verification. No package-manager workaround or vendored dependency is committed. Standard install must still be checked in normal CI. VS Code CLI launch was blocked by sandbox EPERM while changing into the installed application directory, so actual Extension Host activation is pending. Native build was attempted and is blocked because Cargo is not installed. VSIX packaging is not yet configured.

The final handoff report records the final verification count and published commit/PR after the last changes.
