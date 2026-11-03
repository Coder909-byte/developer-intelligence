# Repository instructions

Read `docs/PRD.md`, `docs/TECHNICAL_SPEC.md`, and `docs/ADR/0001-architecture.md` before implementing features. The ADR records the user's three-person team and bootstrap decisions where the original four-person documents differ.

1. Respect ownership: Developer 1 owns contracts, daemon, SDK, database foundation, CI and integration; Developer 2 owns context, MCP, adapters, engineering and runners; Developer 3 owns desktop, extension and UI. Coordinate cross-owner edits.
2. Never duplicate shared contracts. Import schemas/types from `@udi/contracts`; use `@udi/client-sdk` for frontend and MCP HTTP access.
3. Never introduce an additional backend without approval. Only the loopback daemon owns SQLite.
4. Never commit secrets, local tokens, personal workspaces, telemetry captures or database files.
5. Never force-push. Use feature branches after bootstrap: `feat/core-platform`, `feat/intelligence-engine`, `feat/frontend`.
6. Include meaningful happy/failure path tests for all new business logic.
7. Verify `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` before merging. Use `pnpm smoke` for daemon/SDK changes.
8. Keep the architecture local-first and offline-capable. Avoid unnecessary cloud dependencies.
9. Do not silently change published API contracts. Agree schema changes with Developer 1, update docs and consumers, and version breaking changes.
10. Never fabricate successful integrations or tool output. Return explicit unavailable/not-implemented errors.
11. Preserve provenance, project scope, workspace boundaries, allowlists, timeouts, and explicit approval before applying file patches or host config changes.
12. Keep frontend scaffolds minimal until Developer 3 implements them. Developer 2's business logic is deliberately absent from bootstrap.

Run commands from the repository root. Follow `docs/API_CONTRACTS.md` for the current frozen bootstrap surface. SDK v2 imports use `@modelcontextprotocol/server`, not the legacy `@modelcontextprotocol/sdk` package.
