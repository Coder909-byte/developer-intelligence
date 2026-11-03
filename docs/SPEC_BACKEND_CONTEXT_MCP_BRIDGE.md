# Backend Spec 2: Dual-Mode Context Compressor & Unified Multi-Tool MCP Bridge

**Owner:** Backend Developer 2 (Context Engine, MCP Gateway & Engineering Adapters)  
**Target Paths:** `packages/context-engine`, `packages/mcp-gateway`, `packages/contracts`  
**Branch:** `feat/compressor-mcp-bridge`  
**Dependencies:** `@udi/contracts`, `packages/event-store`, official `@modelcontextprotocol/server` (v2)

---

## 1. Executive Summary & Objective

The judges specifically praised two breakthrough features:

1. **Preserving while Compressing Context:** Preventing secondary AI sessions from blindly re-scouting the codebase by injecting a hyper-dense, verified ground-truth context block.
2. **Single Unified MCP Gateway with Categorical Toggles:** Giving external agents (OpenCode, Claude, Codex) access to multiple tool domains (hardware checks, context memory, and bridged VS Code extensions) through **one single MCP connection**, where tool categories can be turned on or off in real-time.

This spec details the implementation of:

- **Dual-Mode Context Compression Engine** (`packages/context-engine`).
- **Dynamic Categorical Tool Filtering in MCP Gateway** (`packages/mcp-gateway`).
- **VS Code Extension ↔ MCP Tool Bridging Protocol**.

---

## 2. Shared Contracts & Schemas (`packages/contracts`)

Add the following schemas to `packages/contracts/src/index.ts`:

```typescript
// 1. Tool Category Definition
export const ToolCategorySchema = z.enum([
  'hardware_validation', // KiCad netlists, GPIO pin consistency, PlatformIO builds
  'context_memory', // get_project_context, record_decision, list_project_events
  'ide_extension_bridge', // Tools dynamically exposed from VS Code extensions
  'external_servers', // Aggregated external MCP servers
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

// 2. Category Toggle State
export const ToolCategoryConfigSchema = z.strictObject({
  category: ToolCategorySchema,
  enabled: z.boolean(),
  name: z.string(),
  description: z.string(),
  toolCount: z.number().int().nonnegative(),
});
export type ToolCategoryConfig = z.infer<typeof ToolCategoryConfigSchema>;

export const ToolCategoryListSchema = z.strictObject({
  projectId: IdSchema,
  categories: z.array(ToolCategoryConfigSchema),
});
export type ToolCategoryList = z.infer<typeof ToolCategoryListSchema>;

export const ToggleCategoryRequestSchema = z.strictObject({
  projectId: IdSchema,
  category: ToolCategorySchema,
  enabled: z.boolean(),
});
export type ToggleCategoryRequest = z.infer<typeof ToggleCategoryRequestSchema>;

// 3. Compressed Context Payload
export const CompressedContextResultSchema = z.strictObject({
  projectId: IdSchema,
  mode: z.enum(['deterministic_delta', 'ai_distillation']),
  rawTokensEstimate: z.number().int().nonnegative(),
  compressedTokensEstimate: z.number().int().nonnegative(),
  savingsPercent: z.number().min(0).max(100),
  injectedBlock: z.string(),
  activeInvariants: z.array(z.string()),
  openIssuesCount: z.number().int().nonnegative(),
  generatedAt: TimestampSchema,
});
export type CompressedContextResult = z.infer<typeof CompressedContextResultSchema>;
```

---

## 3. Dual-Mode Context Compression Engine (`packages/context-engine`)

Refactor / expand `packages/context-engine/src/index.ts` to implement two distinct compression pipelines:

### Mode A: Deterministic Delta Compression (`buildDeterministicDelta`)

- **Purpose:** Zero-latency (<1ms), mathematically reproducible context distillation for code & hardware integrity.
- **Algorithm:**
  1. Fetch all SQLite `context_records` and `validation_findings` for `projectId`.
  2. Strip all transient compiler logs, stdout scrollbacks, and conversational filler.
  3. Extract **Hardware Ground Truth**:
     - Current pin mapping bindings (`MOTOR_EN=GPIO14` confirmed).
     - Component designations (`U2 pin 12`).
  4. Extract **Unresolved Findings**:
     - Only active findings where `status === 'open'`.
  5. Extract **Authoritative Decisions**:
     - Only records where `kind === 'decision'` and `provenance.sourceKind IN ('user_entered', 'observed_tool')`.
  6. Assemble into an ultra-dense Markdown snippet:
     ```markdown
     ## Active Project State: rover-demo

     - [HW] Pin Mapping: MOTOR_EN -> GPIO14 (Schematic: rover.net:28, Firmware: src/pins.h:7)
     - [DECISION] (user): Patch pins.h without altering schematic netlist.
     - [STATUS] Zero active validation errors. Ready for PlatformIO build.
     ```

### Mode B: AI Distillation Rollup (`buildDistilledRollup`)

- **Purpose:** Condenses long multi-turn sessions into a chronologically ordered executive summary when session history exceeds 10 turns.
- **Algorithm:**
  1. Reads classified events tagged by the Laya classifier with `signalScore >= 0.70`.
  2. Synthesizes a structured punch-list categorized into:
     - `What was completed`
     - `Current verified ground truth`
     - `What is blocked / next steps`
  3. Formats with explicit provenance tags (`[observed_tool:engineering-core]`, `[agent_summary:opencode]`).

### Token Estimation Helper

Provide `estimateTokens(text: string): number` (using a standard ~4 chars/token heuristic or BPE estimator) to calculate `rawTokensEstimate`, `compressedTokensEstimate`, and `savingsPercent`.

---

## 4. Single Unified MCP Gateway with Categorical Toggles (`packages/mcp-gateway`)

Update `packages/mcp-gateway/src/gateway.ts` and `cli.ts`:

### A. The Single Gateway Contract

External harnesses configure **one single entry in their MCP config**:

```json
{
  "mcpServers": {
    "developer-intelligence": {
      "command": "node",
      "args": ["<path-to-repo>/packages/mcp-gateway/dist/cli.js"],
      "env": {
        "UDI_PROJECT_ID": "<project-id>",
        "UDI_TOKEN": "<token>"
      }
    }
  }
}
```

### B. Categorical Tool Registry Mapping

Map internal tools to categories:

- `hardware_validation`:
  - `run_engineering_validation`
  - `get_validation_results`
- `context_memory`:
  - `get_project_context`
  - `record_decision`
  - `list_project_events`
- `ide_extension_bridge`:
  - `vscode_execute_command`
  - `vscode_list_diagnostics`
- `external_servers`:
  - Dynamically proxied tools discovered from external servers in `aggregator.ts`.

### C. Dynamic Tool Filter in `tools/list`

When an agent sends JSON-RPC `tools/list`:

1. Check category toggle state from `store.settings` or daemon API.
2. Filter the exposed tool array:
   ```typescript
   export function getFilteredTools(activeCategories: Set<ToolCategory>): McpToolDefinition[] {
     return ALL_TOOLS.filter((tool) => activeCategories.has(tool.category));
   }
   ```
3. If an agent calls a disabled tool via `tools/call`, return a friendly structured error:
   ```json
   {
     "isError": true,
     "content": [
       {
         "type": "text",
         "text": "Tool 'run_engineering_validation' is in category 'hardware_validation', which is currently toggled OFF in Mission Control."
       }
     ]
   }
   ```

---

## 5. VS Code Extension ↔ MCP Bridge Protocol

In `packages/mcp-gateway/src/host-adapters.ts`:

1. Expose an internal bridge registration method:
   `registerHostExtensionTool(toolDefinition: BridgedExtensionTool)`
2. When the VS Code extension activates, it registers available commands (e.g. `PlatformIO: Build`, `KiCad: Inspect Netlist`, language server symbols) as MCP tools under category `ide_extension_bridge`.
3. When an external agent calls `tools/call` for a bridged tool, the gateway relays the request over loopback HTTP / IPC to the extension, receives the extension's execution result, and returns it over MCP stdio to the caller.

---

## 6. Definition of Done & Test Plan

1. **Unit Test (`packages/context-engine/src/compressor.test.ts`):**
   - Ingests a mock event log containing 10,000 characters of terminal scrollback and 1 pin mismatch.
   - Outputs compressed context block under 500 characters (<150 tokens).
   - Validates `savingsPercent >= 90%`.
   - Confirms that key pin invariants (`GPIO14`) are strictly preserved.
2. **Gateway Toggle Test (`packages/mcp-gateway/src/gateway-toggle.test.ts`):**
   - Initializes MCP gateway over stdio.
   - Calls `tools/list` with all categories enabled ➔ returns all tools.
   - Toggles `hardware_validation` category to `false`.
   - Calls `tools/list` ➔ `run_engineering_validation` and `get_validation_results` are absent.
   - Re-enables category ➔ tools reappear without restarting the gateway process.
3. **End-to-End Interop Verification:**
   - Run `pnpm test:mcp` and ensure all 8 existing steps still pass with zero regressions.
