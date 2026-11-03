# Aggregator release readiness and operator plan

Reviewed 4 November 2026 IST, before the 08:30 coding freeze. Branch `feat/aggregator-integration`, created from main `24475d4`. GitHub confirmed PR #11 merged into that commit; its real Extension Host/installed VSIX foundation is preserved. Working tree was initially clean. No main/teammate branch was modified or merged here.

## Actual readiness

| User action                                        | Evidence / state                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open current command center                        | Actual browser dashboard on 5173, authenticated against existing daemon 4317; same rover UUID/state as VS Code. Redesigned unmerged frontend is not claimed verified.                                                                                                                                                    |
| Register/list integrations                         | Real inventory HTTP/SQLite/SDK passes in isolated acceptance store. Actual browser Add MCP created the safe fixture as disabled, SDK readback matched its command/args, details showed unavailable tool/host controls, and confirmed removal deleted only that test record. Registration is not discovery or permission. |
| Discover external tools / invoke via platform      | **BLOCKED:** no external discovery, routed execution, grant or invocation-history API/export in main. D2's five-tool project-memory CLI is a different capability.                                                                                                                                                       |
| Configure hosts                                    | **BLOCKED:** actual VS Code/OpenCode generators fail destination-format checks; raw apply lacks safe orchestration. Preview leaves seeded existing files untouched. No personal config written.                                                                                                                          |
| Review activity / retrieve through another process | Real engineering observations/context and saved handoff work. Live browser + real D2 CLI matched 34 VS Code-created records and original provenance. External invocation activity remains unavailable.                                                                                                                   |
| Engineering integration                            | Actual GPIO14/GPIO26 mismatch: failed/exit 1/one finding, `rover.net:28`, `src/pins.h:7`. Corrected fixture: succeeded/exit 0/zero findings. Separate MCP retrieval and restart persistence pass. No hardware/build claim.                                                                                               |
| Full aggregator-first demonstration                | **NOT READY.** Existing engineering/context fallback remains usable. No fabricated catalog/history, direct-provider bypass or substitute router was added.                                                                                                                                                               |

Reports: ignored `.data/aggregator-integration/aggregator-result.json`, `hosts-result.json`; dashboard evidence in the same directory. Existing native GUI/VSIX evidence and exact launch flags remain in [FINAL_RUNTIME](FINAL_RUNTIME.md). This task did not repeat completed native editor commands or repackage the unchanged extension.

## Required teammate actions and review order

1. **D2 + D1:** agree [AGGREGATOR_CONTRACT](AGGREGATOR_CONTRACT.md), then publish actual schemas/exports for discovery, scoped grants, invocation, redacted persistent history and observed context. Fix the two host-map formats and safe apply orchestration in the existing adapters; do not create another gateway. Prove protocol success/failure/timeouts and recent activity retrieval. D2's active branch was not edited here.
2. **D1:** after review approval, compose those real exports in the existing daemon and extend the shared contracts/SDK additively. Bind the deferred steps in `verify-aggregator-e2e.mjs`; require all [12 acceptance stages](AGGREGATOR_ACCEPTANCE.md) to pass, including restart and control-project isolation. Current preparation gate deliberately exits 2. No automatic unfinished-PR merge.
3. **D3:** consume the agreed SDK only; wire real catalog, host previews/approval, invocation/results and history. Preserve unknown/disabled/unavailable distinctions and existing project/job scoping. Keep these controls disabled with reasons while services are absent; no optimistic execution/activity. Review the redesigned dashboard against the integrated backend, then run real browser/VS Code verification. No frontend source was edited here.
4. Review/merge order: this independent fixture/contract/acceptance preparation → reviewed D2 aggregator plus D1 composition/contracts/SDK → D3 real aggregator consumers → full host/browser/native replay twice on the final integrated commit. Each merge still requires the lead's approval; independent visual work may be reviewed separately but does not satisfy aggregator gates.

No HTTP contract, shared schema, SDK method or migration changed in this preparation. Proposed names in the contract are **not available APIs**. The only existing helper signature change is an optional test-client launch/client-name override, preserving its default D2 CLI behavior. No dependency installation was needed.

## Startup and verification commands

Run from the repository root. Use Node 24.14.1 / pnpm 11.10.0. The existing demo daemon, Vite server, isolated VS Code windows and Chrome were left running; inspect their ports/processes before launching duplicates. Do not terminate unrelated processes or overwrite the existing demo store.

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
pnpm smoke
pnpm demo
pnpm test:mcp
pnpm test:aggregator:fixture
node scripts/verify-aggregator-e2e.mjs  # expected exit 2 until D2 APIs are bound
node scripts/verify-host-setup.mjs     # expected exit 2 until adapters are fixed
pnpm format:check
pnpm doctor
```

Use [FINAL_RUNTIME](FINAL_RUNTIME.md#live-launch-real-extension-development-host) for the existing isolated real VS Code launch and VSIX installation. Do not treat `pnpm dev:extension` (a bundle watcher) as launching VS Code. No OpenCode binary is installed on this Mac; actual OpenCode-agent consumption is NOT RUN. Antigravity, proprietary chat capture, native Tauri packaging, firmware compilation, live KiCad export and hardware operation remain unverified/unavailable here.

If the known demo listeners are absent, start these in separate terminals:

```sh
pnpm build
UDI_DATA_DIR="$PWD/.data/final-runtime/daemon" UDI_INTEGRATIONS=true UDI_PORT=4317 \
  node apps/core-daemon/dist/main.js
```

```sh
pnpm dev:desktop
```

Authenticate dashboard Settings from that private directory's token file without exposing it on screen, then select the existing rover. The separate MCP process reads the same token file:

```sh
UDI_DATA_DIR="$PWD/.data/final-runtime/daemon" \
UDI_DAEMON_URL=http://127.0.0.1:4317 \
UDI_PROJECT_ID=98623d1d-deb9-49de-b7ef-abfd6eee51e3 \
node packages/mcp-gateway/dist/cli.js
```

This CLI waits for an MCP client; that is normal server behavior, not a hanging test. For a fresh store, use its actual new project UUID rather than this captured session UUID. For the existing isolated Chrome CDP profile on 9336, `pnpm test:demo-state` performs real browser/MCP same-project assertions using the saved installed-VSIX evidence. Do not run it against a personal browser profile.

## Five-minute aggregator-first plan — conditional on full acceptance

| Time      | Action and proof                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:45 | Open actual redesigned command center. Show real integrations and clearly labeled supported/disconnected/future states.                                                                                                          |
| 0:45–1:30 | Add the safe local MCP fixture through real SDK-backed UI. Review launch command; approve connection; actual initialize/tools-list populates its two tools.                                                                      |
| 1:30–2:15 | Preview VS Code/OpenCode configuration preserving existing entries. Cancel proves no write; approve only a reviewed isolated target, then verify actual host consumption if installed. Label absent OpenCode runtime explicitly. |
| 2:15–3:00 | Select rover and approved `fixture_sum`, 14 + 26 with fresh nonce. Real platform-routed response sum 40 and correlated persistent invocation appear. Show actual tool failure separately.                                        |
| 3:00–4:00 | A separate supported MCP client/process retrieves the same invocation event/context ID with provenance and redacted summary. Restart persistence was established by automated acceptance, not a scripted fake.                   |
| 4:00–5:00 | Open engineering integration/native VS Code. Real GPIO mismatch/evidence, corrected fixture success, old failures remain history. Explain one daemon/database and separately owned modules.                                      |

Do not perform this script while routing/configuration gates are blocked. Inventory registration or standalone fixture success cannot stand in for it.

## Verified fallback for this baseline

0:00–0:45 show the actual dashboard/MCP inventory and explain its present limits; 0:45–1:45 run real VS Code validation with `rover.net; src/pins.h; engineering-map.json`, approve and show GPIO14/GPIO26 source-linked Problems; 1:45–2:45 validate `rover.net; src/pins_corrected.h; engineering-map.json`, show actual success and cleared current diagnostics; 2:45–3:30 show saved user decision/handoff/context; 3:30–4:30 run `pnpm test:demo-state` with the existing isolated browser/daemon to prove the separate MCP CLI retrieves those same records; 4:30–5:00 explain the aggregator roadmap and explicitly identify external routing as unavailable. This fallback is engineering plus shared memory, **not a finished external MCP aggregator**.

## Executed verification on this branch

| Exact command / check                                                        | Result                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                             | PASS                                                                                                                                                                                                     |
| `pnpm lint`                                                                  | PASS                                                                                                                                                                                                     |
| `pnpm format`                                                                | PASS; no frontend or package source changed                                                                                                                                                              |
| `pnpm test`                                                                  | PASS: 156 tests in 23 files                                                                                                                                                                              |
| `pnpm build`                                                                 | PASS: all packages, daemon, browser assets, extension bundle                                                                                                                                             |
| `node scripts/smoke.mjs` after build                                         | PASS: persistence/auth/isolation/restart; synthetic storage inputs are explicitly labeled                                                                                                                |
| `node scripts/demo-e2e.mjs` after build                                      | PASS: real validator, MCP, saved handoff, independent SQLite checks and process restart                                                                                                                  |
| `node scripts/verify-mcp-interop.mjs` after build                            | PASS: real five-tool MCP reference-client round trip; OpenCode application SKIP. Temporary adapter IO does not validate host schema or safe real config apply; corrected its misleading success wording. |
| `pnpm test:aggregator:fixture`                                               | PASS: 5 real protocol/fixture cases, MCP 2025-11-25, 2 fixture tools                                                                                                                                     |
| `node scripts/verify-aggregator-e2e.mjs`                                     | BLOCKED / exit 2: 6 foundation stages passed; 5 groups of external-aggregation requirements unavailable. No routed call/history claimed.                                                                 |
| `node scripts/verify-host-setup.mjs`                                         | BLOCKED / exit 2: both previews preserve original bytes and omit disabled servers; both target-format checks fail; real config apply NOT RUN                                                             |
| `node scripts/verify-demo-state.mjs` against existing isolated Chrome/daemon | PASS: same rover UUID, 34 context records, persisted handoff, 1 failed-job finding / 0 corrected-job findings, browser/real CLI agreement                                                                |
| Actual browser MCP Hub through CDP                                           | PASS: disabled fixture registration, SDK readback, details, approved inventory removal; screenshot and report kept locally. No external routing/host-write claim.                                        |

`pnpm format:check` and `git diff --check` passed. `pnpm doctor` passed on darwin with Node 24.14.1 / pnpm 11.10.0; optional cargo/rustc/PlatformIO/KiCad/Icarus and the short `code` PATH alias are unavailable. Actual VS Code is installed at the absolute application path documented in FINAL_RUNTIME.

The smoke/demo/interoperability scripts were run directly after the successful root build, avoiding redundant wrapper rebuilds. Native extension activation/diagnostics were already verified in merged PR #11 and were preserved, not rerun as a claim of new aggregation. Fixture/check harness development initially exposed an expected unknown-tool RPC error and richer real finding evidence; assertions were corrected to match actual SDK semantics. The ad hoc browser driver needed selector/session and transient-message corrections; final state assertions passed. No implementation result was fabricated to clear a gate.
