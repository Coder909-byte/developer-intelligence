# Real runtime verification and hackathon reproduction

Superseded runtime status: [FINAL_RUNTIME](FINAL_RUNTIME.md) records actual Mac Extension Development Host and installed-VSIX verification on merged main b798354, browser/MCP shared state and 137 passing tests. The earlier snapshot below remains historical evidence; its unmerged/GUI-unverified limitations are not the current final-runtime status.

Verified on macOS with Node 24.14.1 and pnpm 11.10.0, 3 November 2026, starting from merged main 2e52ced on feat/core-platform. The working tree was initially clean and the feature branch was fast-forwarded; main and teammate branches were not modified.

## Exact automated reproduction

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node scripts/smoke.mjs
node scripts/demo-e2e.mjs
pnpm format:check
pnpm doctor
```

After installation, `pnpm demo:verify` builds and runs the complete real-process verification. `node scripts/demo-e2e.mjs --keep` retains its private temporary data and prints dataDirectory, daemonUrl, projectId, failedJobId, passedJobId and handoffId. It does not print the token and stops the spawned daemon/gateway before exiting. The default without --keep removes test data. Both variants use real existing rover source files without editing them, and create a fresh isolated SQLite store. Do not substitute scripts/smoke.mjs's explicitly synthetic storage records for real validator results.

## Actual results

The retained runtime run registered examples/rover as project `a2cd517e-f2f9-4482-86d0-3553f553e512` and performed these genuine HTTP requests through the shared SDK:

1. GET /health reports projects/context/mcp/engineering enabled with UDI_INTEGRATIONS=true. Missing/wrong-token requests return 401 and cannot create projects.
2. POST /projects registers the actual existing rover directory. POST /projects/:id/validation-jobs with kind pin_consistency and artifactPaths `["rover.net","src/pins.h","engineering-map.json"]` returns a completed failed Job, exitCode 1, exactly one pin_consistency finding for MOTOR_EN: expected GPIO14, observed GPIO26. Evidence is rover.net line 28 and src/pins.h line 7. Validator identity is engineering-core/pin-validator 1.0.0.
3. The same endpoint with src/pins_corrected.h returns a distinct completed succeeded Job, exitCode 0 and zero findings. stdout reports all three firmware signals match. The failed job's one finding remains immutable history. The completed event identifies the current successful job. Filtering findings by that job returns zero, including after restart.
4. Context contains both real validation observations with observed_tool provenance, engineering-core actor, job UUID sourceRef and source evidence. It does not fabricate a hardware/build result or leave the old failed comparison as a synthetic open issue.
5. A distinct Node process runs scripts/mcp-stdio.mjs, which composes the existing DefaultMcpGateway. The test client performs actual newline-delimited MCP initialize/initialized, tools/list and tools/call requests over stdio, negotiating protocol 2025-11-25. It retrieves get_project_context, get_validation_results for failed and corrected jobs, and list_project_events from the actual daemon. MCP context record IDs match REST; failed results have one finding, corrected results have zero plus succeeded job status.
6. record_decision is called through MCP and stored as agent_summary, never observed_tool. A real handoff is saved referencing the real observed records and that decision; getHandoff retrieves the exact saved entity.
7. An independent read-only node:sqlite connection verifies actual job rows, failed/corrected finding counts and the handoff row. Both daemon and MCP process are stopped and restarted with the same data directory/token. The same job/handoff/context UUIDs, provenance and current successful result are retrieved again over HTTP and MCP.

Captured successful run IDs (new runs generate new IDs/timestamps):

- Failed job: 64c69301-b580-4814-b308-4cc7f566ef31.
- Corrected job: b4eee2eb-d06d-4685-a891-3a666ed325a9.
- Handoff: 6b0b2ef3-0b8f-4467-9fa5-4377b4ad1c81.

The test prints SHA-256 hashes of all four input files for reproducibility. The .net is the repository's KiCad-format demo fixture; no KiCad CLI export or schematic provenance was independently verified on this host. The comparison algorithm really ran on those bytes. No PlatformIO build, firmware flash, serial connection or hardware action was performed.

## Manual demo launch using retained data

Run `node scripts/demo-e2e.mjs --keep` and use its printed dataDirectory and projectId. In a terminal, substitute that directory:

```sh
export UDI_DATA_DIR='/absolute/private/demo/dataDirectory'
export UDI_PORT=4317
export UDI_INTEGRATIONS=true
node apps/core-daemon/dist/main.js
```

In separate terminals, from the repository root:

```sh
pnpm dev:desktop
pnpm dev:extension
```

Open http://127.0.0.1:5173. Enter the existing token from UDI_DATA_DIR/token into session settings without putting it in browser storage or logs. Select the retained rover project. In a real installed VS Code, open the repository and use the configured F5 Extension Development Host; open examples/rover, set the same daemon token and select its matching registered project. The extension watcher alone does not launch VS Code. VS Code 1.143.0 (x64) is installed in /Applications; its CLI reports a version when invoked by absolute path, although the short code command is not on PATH. For an operator-driven Extension Development Host launch, use:

```sh
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --new-window --extensionDevelopmentPath="$PWD/apps/vscode-extension" "$PWD/examples/rover"
```

This launch command is documented for reproduction; an authenticated graphical Extension Host session was not exercised by the automated HTTP/MCP test.

For an MCP host or reference client, start this exact gateway process with the same data directory and printed project UUID:

```sh
export UDI_DAEMON_URL=http://127.0.0.1:4317
export UDI_PROJECT_ID='the-printed-project-uuid'
node scripts/mcp-stdio.mjs
```

Use absolute Node/script paths in a GUI host configuration if it does not inherit the NVM PATH. Supply UDI_DATA_DIR, UDI_DAEMON_URL and UDI_PROJECT_ID through that host's supported environment configuration. Do not put tokens in URLs or the public repository. The process waits for an MCP handshake and writes protocol-only stdout; diagnostics use stderr. The actual reference-client handshake/calls are reproducible with scripts/demo-e2e.mjs. This run does not establish that Codex/OpenCode or another GUI agent's configuration is correct; verify that host separately before naming it supported.

Use the actual fixture request bodies above; do not edit the original tracked header automatically. For a visually reviewed one-line correction demo, operate on a temporary copied workspace with explicit operator review, as described in DEMO_PLAN. The provided corrected fixture demonstrates the comparison without writing the original file.

## Fixes within Developer 1 scope

- The merged validator already ran correctly, but the baseline HTTP probe returned empty context after two real validations. The daemon now publishes actual validator observations as stored facts for the existing context engine; it does not implement a new synthesizer.
- Provider result schema/project checks prevent wrong-project plugin output from being persisted. Default composition checks artifact realpaths and rejects traversal, external files, symlink escapes and an escaped implicit engineering map before invocation. Missing/invalid artifacts are 400; valid existing request/entity shapes are unchanged.
- scripts/mcp-stdio.mjs supplies executable process composition for the existing gateway; no duplicate gateway or engineering algorithm was introduced.
- Shared Vitest temp-directory environment is canonicalized. Two merged frontend test assumptions compared macOS /var paths with /private/var realpaths; tests now use canonical temp roots without modifying frontend files. Socket tests need ordinary loopback privileges; the restricted agent sandbox initially produced four EPERM failures, which were resolved by running with loopback access.
- Persistence smoke explicitly disables intelligence integrations even when the caller has integration environment flags set, preserving its independent 501-boundary assertions. A separate real-process demo test exercises integrations enabled.

## Verification limits and remaining work

- Full suite after these fixes: 126 passing tests in 16 files. Typecheck, lint and portable builds passed; storage and real runtime smoke both passed. CI now runs both real-process tests after build.
- Current merged frontend code still uses unfiltered historical findings in some desktop/VS Code views. Developer 3's d975ad1 job-scoping fix exists on feat/frontend but is not part of merged main 2e52ced. This task did not merge it or change frontend files. Approve/review that fix before claiming a corrected pass clears every GUI diagnostic; backend/MCP job-filtered correctness is already verified. Existing unfiltered API semantics remain historical for compatibility.
- The merged desktop Run validation button is disabled and the merged VS Code Validate command still reports the old 501-only behavior. Developer 3 must wire these to the now-working requestValidation SDK call; backend code cannot enable a frontend command without changing their files. Use the real-process script/HTTP path for the verified demo until that UI integration lands.
- Actual VS Code Extension Host interaction and browser/native UI demonstration were not performed by this protocol/HTTP run. GUI commands are documented, not claimed as executed. The CLI named code is not on this Mac's PATH.
- Cargo/rustc, kicad-cli, platformio and iverilog are absent from PATH. None is needed for the deterministic file parser/comparison or stdio gateway. Native Tauri packaging and optional external tool integrations remain unverified; no toolchain was installed.
- MCP inventory health's existing executable/HTTP reachability probe is not an MCP protocol handshake. The test leaves inventory status unknown and proves real connectivity through initialize/tools/call instead.
- Validation is synchronous; SDK default timeout is five seconds and request bodies are limited to 64 KiB. The rover comparison completes within that bound. Slow optional tool workflows are outside this demonstrated path.

## Remote coordination update before push

A final fetch found newer, unmerged teammate commits: Developer 3's feat/frontend is now 3573c5b (including d975ad1), and Developer 2's feat/intelligence-engine is now a0f6a5b. Main remains 2e52ced. Their new code was inspected read-only; this task did not merge or run those branch versions. The frontend follow-up supplies reviewed pin-validation controls and job-scoped diagnostics, so the UI limitations above describe the tested main-derived snapshot rather than missing work on Developer 3's branch.

Recommended review/merge order is this core integration branch, then Developer 2's MCP follow-up, then Developer 3's frontend follow-up, with a full gate and actual graphical Extension Host session on the combined result. Keep both demo:verify and test:mcp when resolving the additive root package.json scripts. Developer 2 now supplies packages/mcp-gateway/src/cli.ts; consolidate the thin scripts/mcp-stdio.mjs test launcher onto that entrypoint after its branch is approved, retaining the authenticated explicit-project startup and restart checks. The inspected CLI consumes --url without applying it, so use UDI_DAEMON_URL until that is corrected. Its OpenCode adapter still needs a real host session before claiming that host works. Developer 3 should verify corrected-job diagnostic clearing and handoff/context display in the actual installed VS Code against the combined branch. Native credential persistence/packaging remains separate from the verified session-token demo.
