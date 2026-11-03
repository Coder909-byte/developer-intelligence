# Developer 3 integration milestone

Desktop and the native VS Code sidebar use `@udi/client-sdk` exclusively. Context records, activity events, handoffs, MCP inventory, job details and findings consume persisted daemon data with original provenance. Reviewed decisions and handoffs require explicit save. MCP inventory configuration preserves secret references without displaying them.

## Validation and findings

Selected-job findings are requested with `jobId` after verifying the job belongs to the active project. Both returned findings and diagnostics are checked against that scope. History is separately labeled; an unselected job never supplies current failures. Starting validation clears the previous scope before submission. Only the returned job becomes current. Desktop scope is session-local; VS Code remembers a verified per-project job. Automatic latest-job discovery is not available.

The reviewed pin-consistency form accepts relative artifact paths, uses the shared request schema and calls `requestValidation`. Enable daemon execution with `UDI_ENABLE_INTEGRATIONS=1`; saved reads remain available without execution. No source modification or hardware control is performed. Timeouts do not automatically retry because the daemon may still complete the operation.

MCP connection checks call `checkMcpServerHealth` and explicitly report a transport probe. A successful transport probe does not establish MCP protocol/tool compatibility. Runtime browser verification against an unused loopback port returned unreachable and updated the persisted inventory without fabricating a connection.

## Runtime verification

A dedicated ignored SQLite QA directory was used, with a real authenticated daemon and browser SDK calls. Context/events/inventory reads, reviewed handoff save/latest retrieval, restart persistence and offline recovery were exercised. Historical failed/cancelled snapshots were explicitly labeled persistence fixtures.

After the intelligence engine merge, the actual pin-consistency adapter ran against the bundled rover files. Desktop mismatch job `e73f393f-59c5-4f90-b0c8-9a866e85be97` failed with GPIO14 versus GPIO26. Corrected-header job `d6a711d9-f9fd-4438-9868-cbb8f9997979` succeeded with no recorded findings. These are software checks on bundled fixtures, not electrical safety verification.

The compiled extension ran approved validation commands against actual daemon HTTP in a mocked VS Code host: mismatch job `205f0b16-0eac-4885-a6e0-8ea9f1c6092b` produced diagnostics in two evidence files; corrected job `d9eb858d-bd55-42b3-9f86-8abb46c40f75` succeeded and cleared all diagnostics. This does not establish actual Extension Host activation.

## Integration requirements and limits

- Developer 1: provide OS-backed desktop credential persistence. Current desktop token is session-memory only. VS Code uses SecretStorage.
- Developer 1/2: synchronize older handoff docs that still say all execution/probes return 501; main now supports opt-in services.
- Developer 2: enforce canonical workspace containment, including symlinks, inside engineering artifact readers. UI rejects absolute/parent paths but is not the backend security boundary.
- No latest-job endpoint exists. Users can select a stored job UUID or run the available check.
- Firmware/RTL adapters exist in main, but execution controls and tool prerequisites are not verified by this frontend milestone. Stored job logs/results remain inspectable.
- Device/serial telemetry, agent discovery, permission editing, arbitrary host setup and source corrections remain unavailable unless their contracts/services exist.
- Native Tauri packaging requires Cargo/system prerequisites; this environment has no Cargo. Portable builds pass separately.
- Actual VS Code Extension Host launch was blocked by this environment. Bundle and mocked-host integration are verified; local F5 verification is still required. VSIX packaging is not configured.

## Safe correction milestone

[Safe correction integration](SAFE_CORRECTION_INTEGRATION.md) supersedes the earlier source-correction and native latest-job limitations above. The reviewed preview/apply/rollback flow is now wired, with real daemon/React/browser verification and completion-event-driven diagnostic refresh. The rollback persistence gap and frontend workaround are documented there.
