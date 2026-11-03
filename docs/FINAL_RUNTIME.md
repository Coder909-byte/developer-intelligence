# Final Mac runtime and VSIX demonstration

Verified 3 November 2026 on macOS, VS Code 1.143.0 (x64), Node 24.14.1 and pnpm 11.10.0. Branch feat/final-runtime started at merged main b798354, then synchronized with approved main merges b0bb76c (correction) and 5c2a68d (frontend/reliability). The workspace was clean; no previous changes were discarded, no teammate branch was merged, and main was not modified. This report supersedes the older GUI-unverified notes in RUNTIME_DEMO and the historical readiness audit.

## Actual results

Both an actual Extension Development Host and the installed VSIX in an independent VS Code profile completed the workflow. Tests drove native command-palette entries, input boxes, approval dialogs, source editors, sidebar and Problems panel through the real Electron renderer. They do not substitute a mocked VS Code module. Existing mocked-host unit tests remain separate evidence.

- Activation is present in real extension-host logs. The installed identity is developer-intelligence.developer-intelligence; its activation event was onCommand:udi.setToken. The real palette contains all 17 manifest commands plus the contributed view-focus command.
- The rover workspace was registered through the actual extension, authenticated with the local daemon and selected by its canonical path. Project: 98623d1d-deb9-49de-b7ef-abfd6eee51e3.
- Actual pin_consistency execution against rover.net, src/pins.h and engineering-map.json returned failed, exitCode 1, one finding: MOTOR_EN expected GPIO14, observed GPIO26. VS Code displayed two native source-linked diagnostics, rover.net:28 and src/pins.h:7, attributed to engineering-core/pin-validator 1.0.0. The evidence command opened the actual pins.h editor with the cursor on line 7.
- The same real command against src/pins_corrected.h returned succeeded, exitCode 0, zero findings and all three signals matching. The actual Problems panel cleared to “No problems have been detected in the workspace.” Historical failed results remain stored and are not current diagnostics.
- User decisions and explicitly reviewed handoffs were written through the real commands. Latest-handoff and context commands opened the stored entities with original provenance. Open Desktop Dashboard opened the local dashboard.
- The actual browser dashboard authenticated to the same daemon and displayed the same rover UUID, failed/successful job UUIDs and user-entered/observed context. This is the browser dashboard, not a native Tauri package.
- A separate Node process ran Developer 2's packages/mcp-gateway/dist/cli.js. The reference client negotiated MCP 2025-11-25, discovered all five tools, and retrieved exactly the same context record IDs and failed/corrected results. A reference client is not a commercial agent session.
- The live daemon was gracefully restarted with the same SQLite directory/token, separately from the automated restart test. The same project, context, jobs and handoff remained retrievable.

Captured strict GUI replay (IDs change on subsequent runs):

| Runtime          | Failed job                           | Corrected job                        | Handoff                              |
| ---------------- | ------------------------------------ | ------------------------------------ | ------------------------------------ |
| Development Host | ac5e9f4f-6f0f-4b16-93fc-748906fcad89 | 8b9cce1f-f86b-4eca-9bff-157fc6b0a58e | b269b3de-6b7b-447d-9994-15ddefa3d6a0 |
| Installed VSIX   | 393492ad-bc20-4f8b-a9ab-4a4b1f093a11 | 81d28e3b-a2ec-41e3-ba27-22c0db6b324d | d12a31f8-cdbf-41b9-864c-f1903a8be306 |

Screenshots, actual rendered UI text and JSON results are local ignored artifacts in .data/final-runtime/evidence. Files are prefixed 9334 for development and 9335 for installed VSIX: commands, mismatch, source-evidence, corrected, handoff and result.json. desktop-shared-context and shared-state-result document browser/MCP agreement. These artifacts contain demo project data and are deliberately not committed. Tokens are never printed or included in screenshots.

## Build and checks

Run from the repository root. Existing dependencies suffice except for the official VSIX packager, which package:extension runs ephemerally at pinned @vscode/vsce 4.1.0. No dependency/lockfile changes, downloaded VS Code distribution, large toolchain installation, firmware flashing or hardware operation are needed.

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
pnpm smoke
pnpm test
pnpm demo
pnpm test:mcp
pnpm package:extension
pnpm format:check
pnpm doctor
```

Typecheck, lint, formatting, portable builds, smoke and both test runs passed: 156 tests in 23 files each run on the final combined main snapshot. pnpm demo aliases demo:verify: it runs the real-process backend/validator/SQLite-restart/MCP test; it does not launch a graphical editor. test:mcp also passed on this Mac. OpenCode is unavailable and its optional host check is explicitly SKIP. Integration scripts now report the actual platform/reference client, use bounded requests, and do not claim source edits or impersonate OpenCode. demo-e2e uses Developer 2's merged CLI rather than the earlier thin process launcher.

## Live launch: daemon and dashboard

Build first with pnpm build. Keep the following terminals running. For a new demonstration, choose a fresh data/profile directory; the paths below reuse this verified session without deleting history.

Terminal 1:

```sh
export UDI_DATA_DIR="$PWD/.data/final-runtime/daemon"
export UDI_INTEGRATIONS=true
export UDI_PORT=4317
node apps/core-daemon/dist/main.js
```

Terminal 2:

```sh
pnpm dev:desktop
```

The dashboard is http://127.0.0.1:5173. Its Settings accepts the token from UDI_DATA_DIR/token for the current session only. Choose the same rover project. A port-in-use error means the earlier demo process may still be running; inspect it rather than starting another authority on a different unnoticed port.

## Live launch: real Extension Development Host

Use a dedicated profile. The custom dialog setting makes review prompts visible in the renderer; it is an ordinary VS Code setting, not a replacement API. The trust-disable flag applies only to this isolated known demo workspace/profile.

```sh
mkdir -p .data/final-runtime/profile/User .data/final-runtime/extensions
node --input-type=module <<'JS'
import { readFile, writeFile } from 'node:fs/promises';
const file = '.data/final-runtime/profile/User/settings.json';
let existing = {};
try { existing = JSON.parse(await readFile(file, 'utf8')); } catch {}
await writeFile(file, JSON.stringify({ ...existing, 'window.dialogStyle': 'custom', 'workbench.startupEditor': 'none' }, null, 2));
JS
env -u ELECTRON_RUN_AS_NODE "/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
  --user-data-dir="$PWD/.data/final-runtime/profile" \
  --extensions-dir="$PWD/.data/final-runtime/extensions" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --remote-debugging-port=9334 \
  --extensionDevelopmentPath="$PWD/apps/vscode-extension" \
  "$PWD/examples/rover"
```

The source extension's scoped workspace identity is unchanged. Its development-host ID is developer-intelligence.@udi/vscode-extension. Unsetting ELECTRON_RUN_AS_NODE matters when launching the GUI executable from a coding-agent environment. The short code alias is absent from this Mac's PATH; the absolute paths above were actually used.

## VSIX package, install and activation

```sh
pnpm package:extension
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  --user-data-dir "$PWD/.data/final-runtime/installed-profile" \
  --extensions-dir "$PWD/.data/final-runtime/installed-extensions" \
  --install-extension "$PWD/dist/developer-intelligence-0.1.0.vsix" --force
```

The existing scoped pnpm package name is invalid for VSIX. The packaging script stages a VSIX-only unscoped name, preserves all contributions/engine/main metadata, and includes only the existing bundle, README and icon. Workspace package identity, contracts and frontend source remain unchanged. Archive inspection verified extension.vsixmanifest, [Content_Types].xml, extension/package.json, extension/dist/extension.cjs, README and icon; the bundle is self-contained except for the host-provided vscode module. Installation succeeded using the official CLI.

Launch the installed copy without any extensionDevelopmentPath override:

```sh
mkdir -p .data/final-runtime/installed-profile/User
cp .data/final-runtime/profile/User/settings.json .data/final-runtime/installed-profile/User/settings.json
env -u ELECTRON_RUN_AS_NODE "/Applications/Visual Studio Code.app/Contents/MacOS/Code" \
  --user-data-dir="$PWD/.data/final-runtime/installed-profile" \
  --extensions-dir="$PWD/.data/final-runtime/installed-extensions" \
  --disable-workspace-trust --skip-welcome --skip-release-notes \
  --remote-debugging-port=9335 "$PWD/examples/rover"
```

This separate-profile installed-copy test passed the full workflow, including actual activation and native diagnostics. The user's normal editor configuration/extensions were not changed.

## Five-minute operator script

1. In the real VS Code palette, run Developer Intelligence: Set Daemon Token; enter the local token without showing it on a recording. Run Register Workspace if needed, select rover, enter a project name and approve Register. Otherwise Select Project and choose the matching rover root.
2. Run Validate Engineering Project. Enter `rover.net; src/pins.h; engineering-map.json`. Review the request and click Run validation. The merged native completion poll refreshes the selected job within its five-second interval even while the notification is open. Close the notification if it obscures the presentation. Open Problems: show GPIO14 versus GPIO26 at netlist line 28 and header line 7. Review Engineering Findings → choose finding → choose src/pins.h; it opens the actual source at line 7.
3. Run validation again with `rover.net; src/pins_corrected.h; engineering-map.json`, approve, then dismiss the notification. Show succeeded / exitCode 0 / all three signals match and an empty Problems panel. This uses a pre-existing corrected fixture; it does not apply a source patch.
4. Record Project Decision, enter a factual decision and approve Save decision; dismiss the notification. Create Saved Handoff, select observed context/decision records, enter the team-agreed external agent UUID, summary and next steps, review and approve Save handoff. Retrieve Latest Handoff and Get Project Context to show stored IDs and provenance. External agent UUIDs are labels, not proof that another agent connected.
5. Open Desktop Dashboard, authenticate its session, choose the same rover project and open Agent Workspace → Project Memory / Agent Handoffs. Compare job IDs, summary and provenance. In another terminal, run test:demo-state as below to show a genuinely separate MCP process retrieving those exact records.

The intentional mismatch file remains unchanged. Developer 2's independently implemented safe correction workflow is a separate integration gate; this test neither implements nor claims to execute it.

## Repeatable actual-GUI and same-project MCP checks

With the real daemon/dashboard and debug-enabled VS Code windows already running:

```sh
pnpm test:vscode
UDI_VSCODE_CDP_PORT=9335 pnpm test:vscode
```

These commands perform genuine approved writes to the isolated demo store, save evidence locally, navigate the actual source editor, and assert native Problems clearing. Keep the dedicated editor windows available for testing; the integration driver waits for actual focused/visible dialogs. It does not operate on the user's normal profile.

For dashboard verification, start a separate Chrome profile:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PWD/.data/final-runtime/chrome-profile" \
  --no-first-run --no-default-browser-check --remote-debugging-port=9336 \
  http://127.0.0.1:5173
pnpm test:demo-state
```

test:demo-state authenticates that browser session, selects the exact project from the installed-VSIX result, compares displayed job IDs/context with REST, and starts/stops the real MCP CLI child. It asserts matching context record IDs, one failed-job finding and zero corrected-job findings. For another port/data directory, set UDI_VSCODE_CDP_PORT, UDI_BROWSER_CDP_PORT, UDI_DATA_DIR and UDI_DAEMON_URL. The CLI can also be launched directly:

```sh
UDI_DATA_DIR="$PWD/.data/final-runtime/daemon" \
UDI_DAEMON_URL=http://127.0.0.1:4317 \
UDI_PROJECT_ID=98623d1d-deb9-49de-b7ef-abfd6eee51e3 \
node packages/mcp-gateway/dist/cli.js
```

Use the newly printed project UUID on a fresh store. The CLI waits for an MCP client; its stdout is protocol-only. No commercial agent needs to be installed for the reference-client proof.

## Remaining coordination and prerequisites

- Developer 3’s approved completion polling follows real validation/correction observations every five seconds. The actual GUI check waits for job selection before dismissing the notification. Preserve this scope/provenance behavior. Rollback currently relies on the frontend’s extra real revalidation because the returned rollback job is not persisted; coordinate atomic rollback persistence with Developer 2 before demonstrating that separate flow. No frontend-owned source was edited here.
- Developer 2: integrate and test the independently owned correction flow separately. The existing MCP CLI consumes --url without applying it; the demonstrated commands use UDI_DAEMON_URL explicitly. OpenCode was not installed and no commercial-agent conversation was exercised.
- Cargo/rustc, PlatformIO, KiCad CLI and Icarus are absent from PATH. They are unnecessary for the deterministic KiCad-format fixture comparison. Native Tauri packaging, firmware compilation, live KiCad export and hardware actions are not claimed. The bundled fixture's export provenance was not independently re-established on this Mac.
- The parser's actual software comparison is verified; this does not certify electrical/hardware correctness. MCP inventory transport probes remain distinct from the actual protocol handshake tested here.
- No public API/schema/SDK/database migration changes were needed. All verification changes are integration tooling, packaging metadata staging and documentation. No automatic merge to main is authorized or performed.
