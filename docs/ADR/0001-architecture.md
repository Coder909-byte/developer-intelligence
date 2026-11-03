# ADR 0001: bootstrap architecture and specification reconciliation

Status: accepted for bootstrap · 3 November 2026.

The user explicitly updated the original four-person plan to three developers. Preserve the original PRD/spec/team execution documents; apply this ADR and current handoffs for implementation ownership. Developer 2 combines original interop and engineering ownership. Developer 3 owns all frontend work. Developer 1 owns database foundation including the event-store migration and project repository; Developer 2 extends the EventStore interface through reviewed migrations.

The existing empty `aggregator ` workspace is the repository root (its name includes a trailing space). Do not create a nested `developer-intelligence` repository. GitHub repository name remains `developer-intelligence`.

Use Fastify 5 once as the HTTP backend. Canonical bootstrap routes are `/api/v1`, as requested by the user; the original `/v1` prose and non-UUID examples are illustrative and are superseded. All actual IDs are UUIDs. Public package scope is `@udi/`. Contract changes require review, versioning for breaking changes, documentation, and matching consumers.

Use Node 24.14.1 LTS, available on the workstation, pinned in `.nvmrc` and CI. Built-in `node:sqlite` avoids a native addon install; this Node patch emits an experimental API warning. Revisit API stability before a production release. SQLite migration v1 creates projects and an indexed, project-scoped activity event table, but event operations remain a Developer 2 interface. SQLite connections belong only to the daemon.

Pin pnpm 11.10.0. Use pnpm 11 `allowBuilds` for esbuild and Tailwind's native helper. Lock transitive versions in `pnpm-lock.yaml`; verify peers before checks. TypeScript 5.9 remains compatible with typescript-eslint's published range; ESLint 10 is supported. Use current stable official MCP **v2** `@modelcontextprotocol/server@2.4.0` and Zod 4; no legacy imports. Vite 8.3.5 / Vitest 5.1.0 require a compatible modern Node and accept the pinned Node 24 runtime.

Use emitted ESM JS + declarations for shared packages; root commands build packages before tests/dev/typecheck. Extension bundles its SDK and dependencies as CJS with `vscode` external. The dashboard shares the SDK and UI package, with Tauri as a minimal native shell. Native packaging is a separate command and gate. The root build verifies portable TypeScript/web/extension artifacts only.

All routes except health require the local token. Loopback binding, Host and Origin checks, no redirect-following in SDK, canonical existing project directory paths and request-size limits protect the initial API. Registering a workspace authorizes its path for future modules, not arbitrary process execution; tool allowlists/path authorization remain required before tool implementations ship.

No alternative backend, cloud service, private agent scraping, fake results, or automatic hardware actions are introduced.

Primary compatibility references checked during bootstrap:

- https://vite.dev/guide/
- https://github.com/modelcontextprotocol/typescript-sdk
- https://pnpm.io/blog/releases/11.0
- https://eslint.org/version-support/
- https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- https://v2.tauri.app/start/prerequisites/
