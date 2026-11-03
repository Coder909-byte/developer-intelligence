# Universal Developer-Tool MCP Aggregator & Intelligence Layer

**Universal Developer Intelligence Platform** · Hackathon Product Pivot & Platform Aggregator Baseline

---

## 1. Executive Summary & Product Direction

The Universal Developer Intelligence Platform is a **central developer-tool aggregation, MCP gateway, and cross-agent intelligence platform**. Rather than being exclusively an electronics validator, the platform centrally manages:

- External and internal MCP servers.
- Dynamic tool discovery and namespaced central routing.
- Real-time tool execution audit history.
- Unified project memory shared across heterogeneous AI coding agents.
- Specialist tool packs (with **Electronics & Firmware Intelligence** as our first production specialist pack).
- Host IDE configurations (VS Code, OpenCode, Claude Desktop, and Antigravity).

---

## 2. Unified Integration Inventory

The platform models all integrations through a unified schema (`IntegrationItemSchema` in `@udi/contracts`), surfaced via `GET /api/v1/integrations`:

| Integration ID                    | Type              | Transport  | Status    | Configuration Status | Available Capabilities / Tools                                                                                                      |
| :-------------------------------- | :---------------- | :--------- | :-------- | :------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| **`code-intelligence-pack`**      | `mcp_server`      | `stdio`    | `healthy` | `configured`         | `analyze_code_metrics`, `format_code_snippet`, `inspect_environment`                                                                |
| **`code-intelligence-pack__*`**   | `discovered_tool` | `stdio`    | `healthy` | `configured`         | Individual executable tool units                                                                                                    |
| **`specialist-pack:electronics`** | `specialist_pack` | `internal` | `healthy` | `configured`         | `pin_consistency_validator`, `platformio_build_runner`, `rtl_simulation_runner`, `safe_correction_preview`, `safe_correction_apply` |
| **`host-adapter:vscode`**         | `host_adapter`    | `internal` | `healthy` | `configured`         | Native in-editor diagnostics, `.vscode/mcp.json` generation                                                                         |
| **`host-adapter:opencode`**       | `host_adapter`    | `stdio`    | `healthy` | `configured`         | `opencode.json` generation, CLI stdio interoperability                                                                              |
| **`host-adapter:claude-desktop`** | `host_adapter`    | `stdio`    | `healthy` | `configured`         | `claude_desktop_config.json` generation                                                                                             |
| **`host-adapter:antigravity`**    | `host_adapter`    | `none`     | `unknown` | `manual_setup`       | Explicit manual setup status; no automated configuration rewrite claimed                                                            |

---

## 3. Real MCP Tool Discovery & Central Routing

### Tool Discovery (`POST /api/v1/mcp/servers/:id/discover`)

- Launches the target MCP server in a bounded process.
- Performs protocol handshake (`initialize` / `notifications/initialized`).
- Calls `tools/list` to extract available tools and schemas.
- Caches discovered tools in the daemon for dynamic gateway aggregation.

### Central Routing (`POST /api/v1/mcp/servers/:id/tools/:toolName/call`)

- Authenticates caller and enforces project scope.
- Routes execution request to the target MCP server with argument validation.
- Enforces execution timeouts and signal cancellation.
- Automatically records execution telemetry:
  - Appends `mcp.tool.executed` activity event.
  - Injects `observed_tool` context record into project memory.
  - Surfaces records via `GET /api/v1/projects/:id/mcp-executions`.

### Multi-Server Gateway Aggregation

When external AI clients (OpenCode, Claude) connect to our Gateway (`packages/mcp-gateway/dist/cli.js`), the gateway presents:

1. Core Platform Tools (`get_project_context`, `list_project_events`, `get_validation_results`, `record_decision`, `list_available_tools`).
2. Discovered External Tools (`code-intelligence-pack__analyze_code_metrics`, etc.).
   Calls made to aggregated tools are transparently routed, audited, and persisted.

---

## 4. Cross-Agent Intelligence Workflow

```text
[Agent A (e.g. VS Code / Terminal)]
       │
       ▼ Invokes MCP Tool (e.g. analyze_code_metrics or run_validation)
[Universal Gateway & Core Daemon]
       │
       ├─► 1. Routes execution to target MCP server over stdio
       ├─► 2. Captures real output and execution duration
       ├─► 3. Records activity event: mcp.tool.executed (observed_tool)
       └─► 4. Appends verified fact into Project Context
       │
       ▼ Shared SQLite Context Store
[Agent B (e.g. OpenCode / Claude CLI)]
       │
       ▼ Calls get_project_context() or list_project_events()
Retrieves:
- Which tool was called
- Who invoked it
- Timestamp and execution duration
- Verified output with strict observed_tool provenance
```

---

## 5. Host Compatibility & Antigravity Assessment

- **VS Code**: Fully configured via `.vscode/mcp.json` and native extension.
- **OpenCode**: Fully configured via `opencode.json` (`type: "local"`, `command`, `environment`).
- **Claude Desktop**: Fully configured via `claude_desktop_config.json`.
- **Google Antigravity**:
  - _Assessment_: Documented MCP connection requires setting environment variables (`UDI_DAEMON_URL` and `UDI_TOKEN`) or manual agent configuration.
  - _Policy_: Reported honestly as `configurationStatus: "manual_setup"` with explicit instructions; no speculative automatic config rewriting is claimed.

---

## 6. Frontend Integration Guide (For Developer 3)

### New Typed SDK Methods (`@udi/client-sdk`)

```ts
// 1. Fetch unified inventory across servers, discovered tools, packs, and host targets
const { items: integrations } = await client.listIntegrations();

// 2. Trigger dynamic discovery on a registered MCP server
const { items: discoveredTools } = await client.discoverServerTools(serverId);

// 3. Route a tool call centrally through the platform
const response = await client.callMcpTool(serverId, 'analyze_code_metrics', {
  projectId: currentProjectId,
  agentId: 'vscode-agent',
  arguments: { path: 'src' },
});

// 4. Query tool execution audit history for the active project
const { items: executions } = await client.listMcpExecutions(projectId);
```

---

## 7. Runnable Two-Server Demonstration

Run the automated aggregator test demonstrating multi-server discovery, routing, and context recording:

```bash
pnpm vitest run apps/core-daemon/src/aggregator-api.test.ts
```
