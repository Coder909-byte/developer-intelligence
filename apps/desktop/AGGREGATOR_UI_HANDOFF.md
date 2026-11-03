# Aggregator-first frontend handoff

## Product hierarchy

The first screen now states: **One command center for your IDEs, MCP servers, tools, and shared agent intelligence.**

MCP Hub is the first integration destination after Overview. The command center leads with actual registered-server counts, enabled configuration state and recorded transport observations; it does not count unknown hosts or unavailable tools as zero. Direct actions open MCP Registry, Host Setup or shared project intelligence. Source memory/activity precedes the collapsed specialist Engineering summary.

The existing ship is retained: original pixel art, typography, warm palette, enlarged roaming crew, animated monitors, cursor light, fullscreen mode, six workspaces and responsive behavior. The previously uncommitted literal-room floor plan was safely stashed, restored onto this branch and retained; the original stash remains a backup. Rooms retain their existing navigation, with MCP Hub and Shared intelligence floor signs for discoverability.

## Current functional scope

- Registry: shared SDK list/register/configure/remove, enabled/disabled configuration, real transport probes, search of the loaded page and pagination. Source status is explicitly a recorded transport observation, not a verified MCP handshake.
- Tools: honest unavailable state. No synthetic tools, successful calls or fabricated permissions.
- Host Setup: actual adapter targets audited from the existing backend source (VS Code, OpenCode, Claude Desktop). The UI separates implementation capability from live host status and actual graphical-host verification. Choose a target, read its manual connection path, and see the required review/approve/apply/verify stages. Automated stages remain disabled until supported by delivered SDK methods. Antigravity and arbitrary IDEs are not claimed as supported.
- Activity: actual project events with source/recorded actor, original payload and exact event-type filter. A server registration never becomes invented tool activity.
- Shared intelligence: existing context records, source evidence, original provenance, known recorded actor, reviewed decisions and handoff save/retrieval remain wired.
- Engineering: existing selected-job findings, preview diff, explicit Apply approval, automatic revalidation, diagnostic-event refresh and Undo remain intact. Undo consumes the newly persisted rollback job/findings from main, with a compatibility fallback for older daemon responses. No engineering engine code changed.

## Dependency on Developer 2 / Developer 1

At the branch baseline (main 8a0a0f1), the shared SDK exposes inventory and transport health but not tool discovery/routing, host capability/session listing, or host configuration preview/apply/verification. The user confirmed Developer 2 will supply the branch/commit when ready. Do not guess endpoint paths, duplicate contracts, import a backend configuration writer into React, scatter fetch calls or simulate success.

Please deliver typed SDK/contracts for:

1. Discovery and routing: per-server tool inventory, schemas, errors, namespacing and explicit permissions/approval requirements.
2. Host capabilities: implemented configuration targets versus verified host sessions; manual/unsupported states.
3. Host preview/apply: reviewed target path/configuration/diff, stale-preview binding, explicit approval, backup/result and no secret disclosure.
4. Host verification: real handshake/tool availability versus transport reachability, with errors and observation timestamps.
5. Recorded tool activity: project/server/tool/known actor or host, provenance and references to actual results.

The Tools and Host Setup components are the intended integration points once those methods land. Existing API contracts were not changed. D1 retains actual VS Code runtime verification responsibility.

## Verification

Use the existing root typecheck/lint/test/build commands. Frontend navigation tests cover the first-screen mission, MCP-first navigation, actual inventory counts, manual/unverified host targets, disabled unavailable operations and inventory filtering. Existing real-daemon safe-correction regression remains part of the frontend suite. Runtime screenshots and the final run report are supplied with the PR.

## Actual runtime verification (4 November 2026, IST)

Used an isolated daemon database at `.data/frontend-aggregator-qa` on loopback port 4320. The registered project is the actual repository workspace. No public token, fake MCP server or invented connected host was added.

- The repository's actual `developer-intelligence-gateway` process passed an independent MCP initialize handshake, exposed five tools to the reference client, and recorded a real decision. SDK context retrieval returned that same record with `agent_summary` provenance and actor `mcp-reference-client`. This reference-client test does not establish an OpenCode/VS Code GUI host session.
- The browser registered that actual gateway executable/configuration via Add MCP, enabled the inventory record, and performed the actual SDK transport probe. The UI correctly labels the resulting healthy value as recorded transport status rather than MCP tool discovery/host verification.
- Command-center counts read the persisted inventory: one registered, one enabled, one recorded healthy transport observation. Tool/host discovery is shown as unavailable rather than fabricated counts. The independent five-tool test is not substituted into the frontend API response.
- Host Setup shows actual implemented adapter targets, manual/unverified status and disabled automated review/apply/verify stages. No host configuration file was changed.
- The browser displayed the actual MCP-produced context record, reviewed and saved a handoff referencing it, and retrieved that saved handoff.
- Stopping the daemon produced explicit disconnected inventory state while navigation remained usable. Restart and Retry restored the same inventory from SQLite; the token was kept in session memory only.
- Existing real-daemon frontend correction tests still pass, preserving reviewed preview/apply/revalidation/rollback.

Local checks: typecheck, lint, builds and 53 frontend tests passed. Full Windows suite: 157/163 pass; six backend path/symlink tests fail from platform assumptions or denied file-symlink creation. Existing smoke/demo scripts pass their HTTP/MCP functional checks, then fail their Unix-style graceful SIGTERM exit assertion on Windows. Backend tests/scripts were not altered to hide these limitations. Linux CI is the complete-suite gate.
