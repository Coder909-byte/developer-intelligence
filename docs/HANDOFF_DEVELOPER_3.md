# Developer 3 handoff — frontend

Current aggregator assignment: read [AGGREGATOR_CONTRACT](AGGREGATOR_CONTRACT.md) and [AGGREGATOR_READINESS](AGGREGATOR_READINESS.md). Main `24475d4` already contains the verified native extension and initial dashboard; bootstrap gaps below are historical. Use agreed SDK methods for the new MCP Hub; external discovery/routing/history and safe host setup are not available in this baseline.

## Branch and ownership

After bootstrap reaches origin/main:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/frontend
pnpm install --frozen-lockfile
```

Own apps/desktop, apps/vscode-extension and packages/ui. Read PRD, technical spec, ADR 0001 and API_CONTRACTS first. VS Code is the primary PS-01 host integration; desktop is the shared control center. No frontend may access SQLite or introduce a second backend.

## Architecture and SDK

Desktop: React 19 + Vite 8 + Tailwind 4 with minimal Tauri 2 Rust shell. `pnpm dev:desktop` runs the browser fallback; `pnpm --filter @udi/desktop dev:native` needs Rust/system prerequisites. `build:native` is separate from root build. Changing daemon port also requires Tauri CSP connect-src adjustment.

Extension: TypeScript, bundled CJS with vscode external. `pnpm dev:extension` builds shared packages and watches the extension bundle; press F5 in the root workspace to launch the configured Extension Development Host, then run **Developer Intelligence: Check Daemon Connection**. Watcher alone does not launch VS Code. No VSIX is built yet.

```ts
import { createClient, DaemonClientError } from '@udi/client-sdk';
const client = createClient({
  baseUrl: 'http://127.0.0.1:4317',
  token: () => currentToken,
  timeoutMs: 5000,
});
try {
  const { items } = await client.listProjects();
  // Render items with explicit empty/loading states.
} catch (error) {
  if (error instanceof DaemonClientError) {
    // Handle UNAUTHORIZED, CONNECTION_ERROR, TIMEOUT and NOT_IMPLEMENTED by code.
  }
}
```

SDK returns validated **data** (it unwraps the API envelope); SDK errors carry code/status/details. Project mutation methods validate inputs before HTTP. Use health without a token; onboard the local daemon token for authenticated reads/writes. Token file is `.data/token` at repo root. Use SecretStorage for VS Code and OS-backed storage for desktop; do not embed in source/Vite env, query parameters or localStorage. Do not create a frontend-specific API transport.

`packages/ui` contains presentational React only (`StatusPanel` seed), no fetching/daemon state/native calls. Centralize API state in app hooks/controllers; share view components when appropriate. Frontend interfaces use contracts directly.

## Next UI work and required tests

Implement project selection, connection/token onboarding, loading/empty/offline/error states, context provenance, registry status, and activity/validation views after corresponding APIs land. Context/MCP inventory/findings reads now return stored data. Validation execution and MCP health checks remain 501; show unavailable, never fake green results.

VS Code must add native diagnostics from finding evidence (1-based API lines/columns convert to VS Code 0-based ranges), command palette actions, status view, safe project scoping, reviewed handoff creation and validation commands. Validate webview messages and CSP; use native APIs for simple surfaces. Any file/config patch requires diff preview and explicit approval. Coordinate new endpoint schemas/methods with Developer 1 before consuming them.

Test SDK-based loading/error/401/501 flows, project selection/isolation, no accidental secret persistence/logging, diagnostics file/range mapping, approved versus cancelled patch behavior. Verify a real extension command in VS Code and compare desktop state against the same daemon. Run root typecheck/lint/test/build. Native shell and Extension Host execution require local runtime verification and are not implied by a successful portable build.

## Updated core-platform milestone

Context, MCP inventory and findings reads now return persisted data rather than bootstrap 501s. Events, context records, handoffs, inventory and completed validation-result writes have typed SDK methods. Existing successful project/health APIs and entity shapes remain unchanged. See [persistence integration](INTEGRATION_PERSISTENCE.md) for examples and API_CONTRACTS for the full route table, pagination and create-versus-snapshot request rules. Validation execution and MCP health checks remain explicit 501s. Persistence is merged into main (cb848d5); no frontend files were changed by that milestone.

## Integration readiness follow-up

Read-only review of frontend d1ce340 confirms compatible existing read calls, but validation/handoff commands and unavailable copy still target the bootstrap baseline. Wire the existing handoff SDK, select findings by current job ID, clear historical diagnostics after correction and verify real Extension Host behavior. See [integration readiness](INTEGRATION_READINESS.md) and [demo plan](DEMO_PLAN.md) for exact requirements. This audit did not merge or modify your branch.
