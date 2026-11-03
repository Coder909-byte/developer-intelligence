# Developer 3 — persisted platform frontend

Branch: `feat/frontend`. Synced with the project lead's persistence merge `cb848d5` from `origin/main` without discarding the earlier frontend milestone. No backend services or shared contracts were changed by this integration.

## Working screens

- Overview: actual selected project, bounded registry/finding summaries, stored context and paged activity events. Counts explicitly describe loaded records rather than inventing global totals or a validation pass.
- Agent Workspace: paged original context records, user-entered decision creation, event timeline with exact type filtering and payload inspection, and persisted handoffs.
- Handoffs: choose project-scoped records, enter external agent UUIDs/summary/next steps, review exact payload, explicitly confirm save, inspect saved details, copy JSON and retrieve latest across all pages. Backend-rejected input preserves the review form. No automated summary generation is claimed.
- MCP Hub: paged global inventory, configuration inspection, registration, full configuration replacement and confirmed inventory-record removal. Configuration changes use unknown/disabled status, preserve existing secret references and never imply server execution.
- Engineering: scoped stored findings/evidence, verification tool, and stored job status/exit code/stdout/stderr/artifacts. No findings is not a validation pass. Stored adapter output is not proof the daemon executed a tool.
- Devices and Settings: honest unsupported device/environment/storage states, session-only desktop token onboarding, loopback settings and updated integration guide.

The daemon's context/MCP/engineering capability flags indicate intelligence/execution integration, not storage availability. Stored reads work even while those flags are false. HTTP transport uses only `@udi/client-sdk`; type/schema definitions come from `@udi/contracts`.

## SDK methods used

Health/projects: health, listProjects, createProject.
Context/events: getContext, listContextRecords, createContextRecord, listEvents.
Handoffs: listHandoffs, getHandoff, createHandoff.
Inventory: listMcpServers, createMcpServer, replaceMcpServer, deleteMcpServer.
Engineering: listFindings, getJob.

Canonical HTTP prefix remains `/api/v1`. No new request bodies or response types were invented. Create bodies omit server-generated IDs/timestamps/project metadata. Handoff provenance is explicitly user_entered and record references are selected from that project.

Lists use bounded limit/offset navigation (50 records per desktop page). Overview reads are labeled first 100. Native context, inventory and findings views are bounded and labeled. Latest-handoff retrieval walks 500-record pages until a short page; offset paging is not a snapshot during concurrent writes. Desktop summaries do not pretend a partial page is a total.

## VS Code extension

Native sidebar/status/diagnostics remain in place. New commands access actual stored activity, record an explicitly approved decision, and inspect scoped job output. Handoff creation now uses the actual SDK: select records, enter an external from-agent UUID and summary/steps, review a JSON document, confirm save, and show the persisted record. Cancelled approval makes no write. Latest retrieval now reads persisted history instead of reporting unsupported.

Commands: udi.health, udi.refresh, udi.setToken, udi.selectProject, udi.registerProject, udi.context, udi.events, udi.recordDecision, udi.findings, udi.openEvidence, udi.jobLogs, udi.mcp, udi.createHandoff, udi.latestHandoff, udi.validate, udi.openDashboard.

Token storage uses SecretStorage per daemon origin. Desktop token remains memory-only. Reads are isolated by client/project identity; stale results cannot replace the active project. Desktop health is refreshed periodically and project connection failures update global status. No write is retried automatically. Source evidence remains canonicalized to the active workspace.

## Runtime verification

Using an isolated daemon database on loopback port 4318, QA explicitly created user-entered context, an imported event and disabled MCP inventory. All records were visibly labeled QA fixtures; no validator or live MCP connection was claimed. The real browser read these through the SDK, created a reviewed handoff with a selected stored record, retrieved it, showed a disconnected request after daemon stop, and retrieved it again after restart. Stored findings were genuinely empty and displayed as such.

The compiled extension's context/events/latest-handoff commands were also executed in a mocked VS Code host against this actual daemon over HTTP. Data matched the browser and survived restart. This is stronger than mocked HTTP but is still not an actual Extension Host run.

Automated tests cover pagination, project isolation, provenance, handoff review/approval/cancellation/failure, actual SDK command serialization in the mocked native host, latest-page traversal, inventory replacement without fake healthy status, authentication/offline/loading/empty states and native diagnostic mapping. See the final report for the final root check counts and published SHA.

## Run and remaining gates

Run `pnpm dev:daemon` and `pnpm dev:desktop` in separate terminals from the root. Use Settings to enter `.data/token`, then select/register a workspace. For VS Code run `pnpm dev:extension`, open the repository and press F5 using its existing launch configuration. The watcher does not launch VS Code itself.

Remaining backend gates: validation execution and MCP health checks still return 501; toolchain/artifact detection, patch preview/approval/apply/rollback, tool/permission discovery and host config application, device monitoring and live agent inventory remain unimplemented. Persistence is available; the UI no longer incorrectly marks it unavailable.

Remaining frontend/runtime gates: actual VS Code Extension Host execution, native Tauri packaging (Cargo absent), VSIX packaging and OS-backed persistent desktop credentials. The Windows sandbox restricts pnpm workspace symlinks; local checks use ignored copied shared build outputs, with standard installation covered by GitHub CI on the prior milestone and to be rechecked on this update.

## Validation-job scoping follow-up

Synced safely with merged main `423d5f8` after confirming a clean working tree. PR #1 was already merged externally; Developer 3 did not merge it. Further changes require a follow-up review diff.

The API has `getJob(projectId, jobId)` and findings filtering by jobId, but no frozen current/latest job pointer. Desktop and VS Code therefore require explicit selection of a recorded job UUID rather than inferring current health from historical failures. Desktop selection is session-scoped per project; native selection is stored per workspace/project and revalidated on refresh.

- Overview does not show historical finding counts as current health. It shows no job selected until a job is chosen.
- Engineering defaults to Selected job. It verifies job identity/project, then requests findings with that exact jobId and rejects mixed-job responses. History is a separate, explicitly labeled view with job IDs on each finding.
- Job changes clear old displayed results while reads are pending. Failed job selection leaves no active selection. Empty findings do not establish a pass, and persisted job status is not proof of live tool execution.
- VS Code adds udi.selectValidationJob, clears diagnostics before switching/refreshing and publishes only non-resolved findings from the verified selected job. With no selected job it does not read historical findings into diagnostics.

Verification: root typecheck, lint, 82 tests (32 frontend) and portable builds passed. Unit regression covers an old failing job followed by a newer successful fixture with no findings; this is test data, not a live validation claim. Runtime QA used explicitly imported failed/cancelled snapshots in the isolated QA database; no successful validation result was fabricated. The real browser separated history from the selected job, and actual compiled native commands over real daemon HTTP reduced diagnostics from one to zero when the selected job changed (mocked VS Code host).

Still needed from the project lead: an agreed completed-job event convention or a frozen current/latest-job API for automatic tracking after future execution. Until then users must select the job ID explicitly. Execution/health checks remain 501, and actual Extension Host/native packaging gates remain as documented above.
