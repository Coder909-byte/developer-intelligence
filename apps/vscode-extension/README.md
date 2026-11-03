# Developer Intelligence VS Code extension

Build/watch from repository root with `pnpm dev:extension`, then press F5 in VS Code using the existing launch configuration. Start the local daemon separately. Use the Developer Intelligence activity-bar sidebar and **Set Daemon Token** to enter `.data/token` into SecretStorage. Register/select an open workspace; projects outside open canonical workspace roots are not selected.

## Persisted workflows

- Get scoped context and view its original provenance.
- View paged stored activity and explicitly record a user-entered project decision.
- Inspect findings and navigate to canonical in-workspace evidence. One-based API positions convert to zero-based VS Code ranges; missing positions are labeled file-level. Resolved findings are excluded from diagnostics.
- Inspect stored job output by project/job UUID.
- View persisted MCP inventory, separately from live MCP execution.
- Create a handoff by selecting up to the first 500 context records, entering an external agent UUID and summary/steps, reviewing the exact payload, and explicitly approving save. Cancelling makes no write. Agent IDs do not imply connected-agent discovery.
- Retrieve the latest stored handoff by traversing 500-record pages. Empty history is an honest empty state.

All communication uses `@udi/client-sdk`. Context/MCP/engineering capability flags describe execution/intelligence support and do not disable stored reads. Context/inventory/findings views label their bounded results. Event history offers next-page navigation. Source and project scope are checked before displaying returned records.

## Commands

udi.health, udi.refresh, udi.setToken, udi.selectProject, udi.registerProject,
udi.context, udi.events, udi.recordDecision, udi.findings, udi.openEvidence,
udi.jobLogs, udi.mcp, udi.createHandoff, udi.latestHandoff, udi.validate,
udi.openDashboard.

`udi.validate` reviews relative artifact paths and requires approval before a real pin-consistency request. It requires a trusted workspace and daemon engineering capability (`UDI_ENABLE_INTEGRATIONS=1`). The returned job becomes the findings/diagnostic scope; previous diagnostics are cleared before submitting. Disabled execution, adapter failures and timeouts remain explicit. A timeout never triggers an automatic retry. Handoffs now save real records and are no longer just local drafts. Decisions and handoffs require a trusted workspace and explicit save approval.

Daemon/dashboard origins are machine/user configuration, not workspace-controlled token destinations. The extension does not launch another daemon or read private agent conversations. No full desktop UI is embedded.

Tests execute actual bundled activation/commands against a mocked VS Code API, including cancelled/approved writes and diagnostic mapping. A separate QA run exercised compiled context/event/handoff commands against the actual daemon over HTTP and verified persistence after restart. Actual Extension Host execution and VSIX packaging remain separate gates. See `../desktop/FRONTEND_HANDOFF.md` for complete integration details.

## Validation job selection

Run **Developer Intelligence: Select Validation Job** (`udi.selectValidationJob`) and enter a recorded job UUID. The extension verifies that job against the active project and scopes findings using the SDK's jobId filter. Diagnostics clear before a job switch and only verified selected-job findings are published. No selected job means no current diagnostics; use the desktop History tab for older results. This intentionally avoids treating an old failure as the latest validation result.

There is no agreed backend current/latest-job pointer yet, so the extension does not guess from finding timestamps. A job returned by this extension is selected automatically. After restart, any other job with no findings must be selected explicitly; it cannot be discovered by looking only at old error records. Runtime QA verified one-to-zero diagnostic clearing over actual daemon HTTP using clearly imported failed/cancelled test snapshots and a mocked VS Code host. This is not an actual Extension Host or validator execution claim.

Current execution verification and limitations: see [integration status](../desktop/INTEGRATION_STATUS.md). It supersedes the older execution-unavailable notes in the original handoff.
