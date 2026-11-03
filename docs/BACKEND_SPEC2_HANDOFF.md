# Backend Spec 2: compressor and categorical MCP bridge

This implementation follows `SPEC_BACKEND_CONTEXT_MCP_BRIDGE.md`. Backend Spec 1
(OpenAI-compatible proxy, interception, Laya classification and automatic injection)
belongs to the teammate. This branch supplies its compression interfaces; it does
not implement those services. No desktop redesign, firmware patch engine, second
backend, SQLite migration, or normal-editor configuration change is included.

## Delivered interfaces

Import all shared schemas and types from `@udi/contracts`. The five required Spec 2
schemas are additive and retain their exact requested fields. Existing endpoints,
context response shape, and MCP tool names remain available.

`@udi/context-engine` exports:

```ts
buildDeterministicDelta(input: CompressionInput): CompressedContextResult;
buildDistilledRollup(input: CompressionInput): CompressedContextResult;
estimateTokens(text: string): number;
```

`CompressionInput` contains `projectId`, optional `projectName`, all project
`records`, all `findings`, optional classified `events`, optional `latestJob`, and
optional `sessionTurns`. Mixed-project inputs are rejected. Pass the latest real
validation job so historical open findings do not become current errors.

Mode A removes log text, keeps explicit authoritative hardware bindings and
decisions, and preserves current finding evidence. A current validation's expected
binding overrides older narrative mappings. Otherwise the latest authoritative
binding for a signal wins. Unverified agent decisions are omitted. An empty finding
list does not establish a validation pass. Determinism applies to `injectedBlock`;
`generatedAt` is a fresh timestamp. Token counts use `ceil(chars / 4)`, not billing
tokens. No hard sub-millisecond HTTP/SQLite latency guarantee has been established.

Mode B consumes existing classified `ActivityEvent.payload` fields:

```json
{
  "sourceType": "tool_result",
  "signalScore": 0.95,
  "decision": "preserve",
  "category": "HARDWARE_SPEC",
  "distilledFact": "MOTOR_EN=GPIO14"
}
```

The event's original `sourceKind`, `actor` and optional `sourceRef` supply provenance;
classifier text cannot promote an agent claim into observed hardware evidence.
`assistant_thought` is labelled `agent_summary`. Categories `VALIDATED_OUTCOME` and
`HARDWARE_SPEC` feed completed and verified-ground-truth sections; other preserved
events feed blocked/next steps. Entries retain chronological order within each
section. Low scores, discarded events and `EPHEMERAL_NOISE` are omitted.

At ten turns or fewer, Mode B honestly returns `mode: deterministic_delta`.
Above ten turns it requires classified, high-signal input. Missing input raises
`CompressionUnavailableError` (HTTP 501), rather than inventing model results.
The HTTP adapter counts events whose payload has `sourceType: user_message`.
The teammate can supply an explicit `sessionTurns` to the pure function.

## Authenticated daemon APIs and SDK

All paths below start with `/api/v1/projects/:id`. Use the existing bearer token.
Only the daemon accesses the existing SQLite database.

| Method and path                                    | SDK method                                                        | Result or behavior                                 |
| -------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `GET /compressed-context?mode=deterministic_delta` | `getCompressedContext(projectId, mode?)`                          | Exact `CompressedContextResult`                    |
| `GET /tool-categories`                             | `getToolCategories(projectId)`                                    | Exact `ToolCategoryList`                           |
| `PUT /tool-categories`                             | `toggleToolCategory({projectId, category, enabled})`              | Validated toggle; rejects path/body scope mismatch |
| `POST /extension-tools`                            | `registerHostExtensionTool(definition)`                           | Register/refresh live project/host/tool lease      |
| `GET /extension-tools`                             | `listHostExtensionTools(projectId)`                               | Currently live registrations                       |
| `GET /extension-hosts/:hostId/requests`            | `pollHostExtensionRequests(projectId, hostId)`                    | Deliver pending requests once                      |
| `POST /extension-hosts/:hostId/results/:callId`    | `completeHostExtensionRequest(projectId, hostId, callId, result)` | Complete only matching pending request             |
| `POST /extension-tools/call`                       | `callHostExtensionTool(projectId, input)`                         | Await actual provider result or bounded timeout    |

Category toggles persist as existing append-only `mcp.category.configured` activity
events; all four categories default enabled. The adapter pages all records, findings
and events instead of truncating compression to the first result page. Existing
outer success/error envelopes remain unchanged. The existing MCP call endpoint now
correctly sets its nested `data.ok` false when a provider returns `isError: true`;
the shape is unchanged, and the stored outcome is now `failed`.

Category `toolCount` reports registered tool inventory, including the two bridge
entry points. It does not assert that a VS Code host or external tool is currently
executable. Check live registrations separately.

## One gateway, four live categories

`getFilteredTools(activeCategories)` and `ALL_TOOLS` are exported by
`@udi/mcp-gateway`. The running gateway reads category state on each `tools/list`
and each call. Disabled cached tool calls return a friendly MCP `isError` response.
Re-listing reflects toggles without restarting the gateway. No unsolicited
`notifications/tools/list_changed` push guarantee is made by this implementation.

| Category               | Tools                                                                            |
| ---------------------- | -------------------------------------------------------------------------------- |
| `hardware_validation`  | `run_engineering_validation`, `get_validation_results`                           |
| `context_memory`       | Existing context/decision/event/tools-list methods plus `get_compressed_context` |
| `ide_extension_bridge` | `vscode_execute_command`, `vscode_list_diagnostics`                              |
| `external_servers`     | Namespaced discovered tools from enabled stdio inventory                         |

External discovery and execution use the existing authenticated SDK/daemon
aggregator APIs. External calls use `{params: {...}, projectId?, agentId?}`.
No duplicate router is created. HTTP upstream MCP transport remains unsupported
by the existing aggregator and is not advertised as functional. Unavailable
upstreams do not suppress working core tools.

Configure one MCP entry, using absolute paths and the actual selected project ID:

```json
{
  "mcpServers": {
    "developer-intelligence": {
      "command": "node",
      "args": ["<repo>/packages/mcp-gateway/dist/cli.js"],
      "env": {
        "UDI_DAEMON_URL": "http://127.0.0.1:4317",
        "UDI_DATA_DIR": "<repo>/.data",
        "UDI_PROJECT_ID": "<actual-project-id>"
      }
    }
  }
}
```

The CLI can read the private token from `UDI_DATA_DIR/token`; never commit the
token or populated personal host configuration. Host-specific generated config
compatibility is outside this change. Do not use this generic JSON as proof of
every harness's configuration format.

## Actual extension provider and safety

Minimal VS Code activation glue registers the two bridge tools for the selected
project and polls the daemon every second. It uses the existing SDK and no local
callback server. `HostExtensionBridge(client).registerHostExtensionTool(definition)`
is the one-argument registration interface for other native adapters.

The provider detects installed commands from the explicit list
`vscode.executeDocumentSymbolProvider`, `editor.action.formatDocument`,
`platformio-ide.build`, `kicad.inspectNetlist`. Missing commands are not registered
as executable, and no toolchain is installed. Commands require a real native modal
approval, a current selected project, and an active document in that project.
Arbitrary caller-supplied arguments are rejected. Project, origin, expiry and
category are rechecked after approval. Diagnostics use the actual VS Code API,
project-scoped paths and one-based line/column numbers.

Host leases expire after ten seconds; calls time out after twenty seconds. Use a
caller timeout over twenty seconds for native approval. Do not automatically retry
commands after a timeout: a provider may already have executed an action. Multiple
live hosts for one project fail explicitly until only one remains. Registrations
are deliberately ephemeral across daemon restart. Completion records a redacted
`mcp.extension.executed` event and context fact with `observed_tool` provenance;
raw diagnostics/command results are returned to the caller, not persisted as logs.

## Verification and remaining manual checks

Fast checks after a build, using only Python's standard library:

```sh
python3 scripts/verify_spec2.py
```

The first run passed 45 assertions in 4.13 seconds. The measured real rover case
compressed 3,295 estimated tokens to 79 (97.60% reduction). Checks cover actual
HTTP authentication, real mismatch/corrected validation, evidence, deterministic
compression, classified-input rollup, all four categories over one live MCP
process, external discovery/success/failure persistence, cross-process context,
bridge relay/scope/replay rejection, and restart persistence. The Python bridge
provider and classified events are explicitly fixtures, not native VS Code or
real Laya executions. The existing eight-step MCP script ran; its available checks
passed, with OpenCode explicitly skipped because it is not installed.

An earlier full suite passed 175 tests in 27 files. A subsequent regression test
adds latest-binding precedence. After isolating this change on the fetched main
base, final focused verification passed:

| Command                                                                                                                                                      | Actual result                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `python3 scripts/verify_spec2.py`                                                                                                                            | 45 assertions passed in 7.52 seconds while other focused checks ran concurrently; 79 estimated compressed tokens / 97.60% savings |
| `pnpm exec vitest run packages/context-engine/src/compressor.test.ts packages/mcp-gateway/src/gateway-toggle.test.ts packages/mcp-gateway/src/index.test.ts` | 21 tests / 3 files passed in 8.65 seconds                                                                                         |
| `pnpm exec tsc --noEmit -p tsconfig.json`                                                                                                                    | Passed, after building workspace packages                                                                                         |
| `pnpm lint`                                                                                                                                                  | Passed                                                                                                                            |
| `pnpm build`                                                                                                                                                 | All workspace package and application builds passed                                                                               |
| `node scripts/smoke.mjs`                                                                                                                                     | Actual HTTP auth, persistence-only API compatibility and restart checks passed                                                    |
| `pnpm exec prettier --check` with the changed implementation files and new handoff document                                                                  | All selected files passed                                                                                                         |

The existing MCP interop command was `node scripts/verify-mcp-interop.mjs`, using
the already-built packages rather than repeating its build prelude. Its OpenCode
step was skipped, so this is not a claim that all eight steps executed. Per the
user's request, no native GUI automation or repeat of the long full suite was run
for final verification. Test-owned daemon/MCP processes were closed; unrelated
development servers were left alone.

Please verify these in real VS Code:

1. From this worktree, start the already-built daemon with
   `UDI_INTEGRATIONS=true node apps/core-daemon/dist/main.js`. Build the extension
   if needed with `pnpm --filter @udi/vscode-extension build`.
2. Open this repository in VS Code and launch **Developer Intelligence Extension**
   from Run and Debug (F5). In that separate development host, open `examples/rover`.
3. Run **Developer Intelligence: Set Daemon Token**, entering the token privately
   from `.data/token`. Register/select the rover project. Check daemon connectivity.
   Use the resulting project ID in the MCP entry above. Do not open a second host
   for the same project during the bridge check.
4. In the external MCP client, re-list tools. Call `vscode_list_diagnostics` and
   compare actual results to VS Code's Problems panel. Run real engineering
   validation first if you want the GPIO mismatch present in both.
5. With `src/pins.h` active, call `vscode_execute_command` with
   `{"commandId":"vscode.executeDocumentSymbolProvider"}`. Approve promptly in the
   native modal. Confirm the actual result returns to the external client (null
   is valid when no language provider supplies symbols). Repeat and cancel;
   confirm an error returns and no file is changed.
6. Disable `ide_extension_bridge` through the SDK/API or a teammate's implemented
   control. Re-list: both bridge tools disappear. A cached call must fail; re-enable
   and re-list without restarting the gateway.
7. Close the development host, wait over ten seconds, and call the bridge again:
   it must fail as unavailable. Reopen/reselect and confirm registration recovers.

The teammate still needs to wire the actual classifier output/session count into
these ports and inject the returned block in the proxy. The frontend teammate needs
to connect category controls and the compression inspector to these validated SDK
methods. Neither that UI nor automatic injection has been fabricated here.

The follow-up [actual native-storage experiment](SPEC2_NATIVE_STORAGE_VERIFICATION.md)
used real Codex SQLite rows and Claude Code JSONL history. It verifies shared-memory
transport after test-only normalization, and documents why native session conversion
and semantic handoff are still incomplete.
