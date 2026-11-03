# Developer Intelligence VS Code extension

Run `pnpm dev:extension` from the repository root. Press F5 in VS Code using the repository launch configuration. Open the **Developer Intelligence** activity-bar sidebar. Start the daemon separately; this extension does not launch a second backend.

Use **Set Daemon Token** to enter the existing `.data/token` credential. It is stored in VS Code SecretStorage per daemon origin. Daemon and dashboard origins are user/machine configuration, not workspace-overridable token destinations. Use **Register Workspace** to explicitly register an open trusted folder, or select its existing project. Nonmatching daemon workspaces are not offered.

## Commands

| ID                  | Behavior                                                        |
| ------------------- | --------------------------------------------------------------- |
| udi.health          | Check real daemon health and refresh                            |
| udi.refresh         | Reload workspace state                                          |
| udi.setToken        | Store existing token or forget with blank input                 |
| udi.selectProject   | Select registered project matching an open folder               |
| udi.registerProject | Confirm and register an open trusted workspace                  |
| udi.context         | Retrieve scoped context and provenance as a JSON document       |
| udi.findings        | Inspect findings and choose source evidence                     |
| udi.openEvidence    | Open canonical in-workspace source path and API position        |
| udi.mcp             | Inspect recorded MCP inventory; secretRef omitted               |
| udi.validate        | Explain unavailable validation job API; no fake run             |
| udi.createHandoff   | Review/copy explicitly UNSAVED local draft, when context exists |
| udi.latestHandoff   | Explain unavailable handoff retrieval API                       |
| udi.openDashboard   | Open configured loopback dashboard; it must already be running  |

Diagnostics convert positive 1-based API line/column to 0-based VS Code positions. Missing positions are marked file-level. Resolved findings are excluded. Project scope is checked, source paths are realpath-resolved and escapes/missing files are ignored for diagnostics. Selecting evidence reports a useful error if it cannot be safely opened.

Context, MCP and findings return 501 in the bootstrap daemon. The sidebar keeps connection/project status and navigation usable and displays this honestly. Build, handoff storage, patch application and host-config writes are not implemented in the SDK, so the extension does not invent requests for them.

Tests exercise the actual bundled activation function in a mocked VS Code API with SDK HTTP responses, plus evidence scope/path tests. An actual Extension Host session is still a separate verification gate. No webview or duplicate full desktop application is embedded. No private agent conversations are scraped.

See `../desktop/FRONTEND_HANDOFF.md` for integration requirements and current verification evidence.
