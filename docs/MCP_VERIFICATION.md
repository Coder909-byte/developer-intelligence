# MCP Interoperability & Second-Agent Verification

**Universal Developer Intelligence Platform** · Hackathon Demo Specification & Verification Baseline

This document records the exact setup, commands, and verified protocol interoperability for demonstrating cross-agent context sharing and engineering intelligence between VS Code and external AI coding agents (such as OpenCode and Claude Desktop).

---

## 1. Quick Verification Command

To run the automated, end-to-end MCP interoperability and second-agent test suite:

```bash
pnpm test:mcp
```

_(Runs `pnpm build && node scripts/verify-mcp-interop.mjs`)_

### What it proves:

1. Core Daemon boots with real intelligence capabilities enabled (`projects`, `context`, `mcp`, `engineering`).
2. Primary Agent runs deterministic KiCad-to-firmware validation on `examples/rover`: detects `MOTOR_EN` mismatch (`GPIO14` expected vs `GPIO26` configured in `src/pins.h`).
3. Primary Agent records architectural decision in daemon SQLite database with `user_entered` provenance.
4. Host configuration for OpenCode is generated and safely applied with `.bak` backup creation.
5. Real MCP stdio process (`packages/mcp-gateway/dist/cli.js`) launches with authenticated daemon client.
6. Second Agent connects via JSON-RPC protocol over stdio, performs protocol handshake, discovers all 5 MCP tools, retrieves the exact project memory and validation diagnostics recorded by Primary Agent, and records a new decision via `record_decision`.
7. Daemon persistence re-check proves Second Agent's decision is permanently stored in SQLite and retrievable by all connected agents with `agent_summary` provenance.
8. Unauthenticated requests are rejected; corrected fixture (`src/pins_corrected.h`) validates with 0 errors.

---

## 2. Manual Step-by-Step Hackathon Demo Setup

### Step 1: Start the Local Core Daemon

In terminal 1:

```bash
export UDI_PORT=4317
export UDI_INTEGRATIONS=true
pnpm dev:core
```

The daemon will create `.data/token` and `.data/platform.sqlite` at the repository root with secure file permissions (`0600` / `0700`).

Check health:

```bash
curl http://127.0.0.1:4317/api/v1/health
```

Expected response:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "version": "0.1.0",
    "apiVersion": "v1",
    "database": "ready",
    "capabilities": {
      "projects": true,
      "context": true,
      "mcp": true,
      "engineering": true
    }
  }
}
```

---

### Step 2: Open VS Code & Run Engineering Validation

1. Launch VS Code with the extension:
   ```bash
   pnpm dev:extension
   ```
2. Open `examples/rover` in the Extension Development Host.
3. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run:
   - `Developer Intelligence: Register Active Workspace as Project`
   - `Developer Intelligence: Validate Engineering Project`
4. The deterministic mismatch is immediately reported as a diagnostic on `examples/rover/src/pins.h` line 6:
   - **Message**: `Signal MOTOR_EN pin mismatch: netlist specifies GPIO14 but firmware configures GPIO26`
   - **Evidence**: `rover.net:29` and `src/pins.h:6`
   - **Suggested fix**: `#define MOTOR_EN GPIO14`

---

### Step 3: Configure OpenCode (Second Agent Host)

Generate OpenCode configuration targeting our MCP server gateway:

Create or update `opencode.json` in your workspace:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "udi-gateway": {
        "type": "local",
        "command": ["node", "<ABSOLUTE_PATH_TO_REPO>/packages/mcp-gateway/dist/cli.js"],
        "environment": {
          "UDI_DAEMON_URL": "http://127.0.0.1:4317",
          "UDI_TOKEN": "<TOKEN_FROM_.data/token>"
        }
      }
    }
  }
}
```

Verify that OpenCode recognizes the MCP server:

```bash
opencode mcp list --print-logs
```

---

### Step 4: Configure VS Code / Claude Desktop MCP Hosts

#### VS Code (`.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "udi-gateway": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/packages/mcp-gateway/dist/cli.js"],
      "env": {
        "UDI_DAEMON_URL": "http://127.0.0.1:4317",
        "UDI_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

#### Claude Desktop (`~/.config/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "udi-gateway": {
      "command": "node",
      "args": ["<ABSOLUTE_PATH_TO_REPO>/packages/mcp-gateway/dist/cli.js"],
      "env": {
        "UDI_DAEMON_URL": "http://127.0.0.1:4317",
        "UDI_TOKEN": "<TOKEN>"
      }
    }
  }
}
```

---

## 3. Verified MCP Tool Surface

The MCP Gateway implements official MCP SDK v2 (`@modelcontextprotocol/server`) and registers the following 5 tools:

| Tool Name                    | Parameters                                                               | Purpose                                                                      | Provenance Behavior                                                                          |
| :--------------------------- | :----------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| **`get_project_context`**    | `{ projectId?: UUID, maxItems?: number }`                                | Retrieves unified project memory (facts, decisions, open issues, timestamps) | Preserves original sourceKind (`observed_tool`, `user_entered`, `agent_summary`, `imported`) |
| **`list_project_events`**    | `{ projectId?: UUID, limit?: number, type?: string }`                    | Returns chronological activity feed                                          | Shows real actor, timestamp, and event payloads                                              |
| **`get_validation_results`** | `{ projectId?: UUID, jobId?: UUID }`                                     | Retrieves genuine engineering validation findings and evidence               | Sourced from `engineering-core/pin-validator`, never LLM guesswork                           |
| **`record_decision`**        | `{ projectId?: UUID, text: string, actor?: string, sourceRef?: string }` | Persists a decision into shared project memory from any agent                | Strictly recorded with `agent_summary` provenance                                            |
| **`list_available_tools`**   | `{ projectId?: UUID }`                                                   | Reports active daemon capabilities and registered MCP servers                | Reads daemon health and server registry live                                                 |

---

## 4. Cross-Agent Data Flow

```text
       ┌────────────────────────┐
       │   VS Code (Host 1)     │
       │   Primary Developer    │
       └───────────┬────────────┘
                   │
                   │ 1. Runs Engineering Validation (rover.net vs src/pins.h)
                   │ 2. Stores decision: "Update firmware to GPIO14" (user_entered)
                   ▼
┌──────────────────────────────────────────────┐
│           Core Daemon (Fastify)              │
│       SQLite Event & Context Store           │
└──────────────────▲───────────────────────────┘
                   │
                   │ 3. Stdio JSON-RPC over loopback client
                   │
┌──────────────────▼───────────────────────────┐
│        UDI MCP Gateway (SDK v2)              │
│      packages/mcp-gateway/dist/cli.js        │
└──────────────────▲───────────────────────────┘
                   │
                   │ 4. Calls get_project_context() & get_validation_results()
                   │ 5. Calls record_decision("Patch applied: MOTOR_EN set to GPIO14")
                   │
       ┌───────────┴────────────┐
       │   OpenCode (Host 2)    │
       │   Secondary Agent      │
       └────────────────────────┘
```

---

## 5. Security & Isolation Boundaries

1. **Loopback Only**: Daemon binds strictly to `127.0.0.1`. Non-loopback Host headers are rejected with HTTP 403.
2. **Token Security**: Every request outside `/api/v1/health` requires `Authorization: Bearer <token>`. Unauthenticated requests are rejected with 401.
3. **Stdio Protocol Hygiene**: The MCP server emits only valid JSON-RPC frames on stdout. Informational logs, warnings, and errors are redirected to stderr to prevent protocol corruption.
4. **Tool Allowlist & Workspace Bounds**: Process executions via `tool-runners` enforce strict executable allowlists (`kicad-cli`, `platformio`, `iverilog`, `vvp`), reject shell metacharacters, and ensure file paths cannot escape the canonical workspace root.
5. **Config Mutation Safety**: Host configuration updates use `applyHostConfig` which creates a timestamped/`.bak` snapshot of the target configuration file before writing.
