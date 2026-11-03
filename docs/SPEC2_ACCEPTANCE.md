# Backend Spec 2 acceptance and remaining gaps

The later user-requested frontend conversion feature is tracked separately in
[CODEX_CLAUDE_CONTEXT_BRIDGE.md](CODEX_CLAUDE_CONTEXT_BRIDGE.md). It adds a real
Codex reader and Claude Markdown handoff without changing this original Spec 2
acceptance boundary.

Scope is `SPEC_BACKEND_CONTEXT_MCP_BRIDGE.md`: the dual-mode compressor,
categorical single MCP gateway and extension-command bridge. Native Codex/Claude
database import/export, proxy interception, classification and automatic injection
are not additional Spec 2 implementations.

## Requirement-by-requirement result

| Spec clause                                                                                   | Implementation and verification                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2: five exact shared schemas                                                                 | Implemented additively in `@udi/contracts`; existing entity/envelope schemas remain compatible.                                                                                                                                                                                                         |
| §3 Mode A: fetch all project context/findings                                                 | Authenticated daemon adapter pages the existing store, keeping SQLite ownership in the daemon.                                                                                                                                                                                                          |
| §3 Mode A: remove noise, preserve hardware/components, open findings, authoritative decisions | Implemented. Fact-based mappings now retain component designations and source evidence, including ANSI-formatted facts. Non-pin findings retain their evidence too. Historical validator findings do not override a passed current job.                                                                 |
| §3 Mode A: reproducible dense snippet and token estimate                                      | Required fixture passes `<500` characters, `<150` estimated tokens, `>=90%` reduction and GPIO14/source preservation. Actual HTTP fixture measured 3,295 → 79 estimated tokens, 97.60% reduction. Empty input has zero raw tokens.                                                                      |
| §3 Mode A: `<1ms` latency target                                                              | Measured pure function over 200 warmed samples: median **0.0643 ms**, p95 **0.2040 ms**, maximum **2.8772 ms**. Typical latency meets the target; a strict every-call sub-millisecond bound is not established. HTTP and SQLite are excluded from this kernel measurement.                              |
| §3 Mode B: above ten turns, score >=0.70                                                      | Implemented for supplied classified activity. Rejects nonfinite/out-of-range scores, missing preserve decisions, blank facts, unknown categories and nested project mismatches. Short sessions return deterministic mode; missing classified input above the threshold returns explicit unavailability. |
| §3 Mode B: three chronological sections with provenance                                       | Implemented. Uses original classifier timestamps when supplied, retains source references, and now carries authoritative decisions/current findings into the handoff instead of dropping them. Classification is consumed, not duplicated.                                                              |
| §4: one MCP connection and four category mappings                                             | Implemented over the official v2 server and existing authenticated SDK/aggregator. All four categories are checked on listing and invocation.                                                                                                                                                           |
| §4: live tools/list filtering, friendly disabled-call errors                                  | Actual stdio checks cover hide/re-enable/cached-call denial without restarting. Both hardware tools are explicitly checked. Category state remains project-scoped and persists across daemon restart.                                                                                                   |
| §4: dynamically proxied external tools                                                        | Actual external discovery, invocation, error propagation and persistence pass. Advertised params now retain the upstream schema; local JSON Schema references are rebased under `params`. Existing stdio upstream support is preserved.                                                                 |
| §5: registerHostExtensionTool and activation registration                                     | Implemented through the authenticated instance method and minimal existing extension activation glue. Live registered command IDs are now exposed as MCP schema choices and in descriptions. Missing/ambiguous live hosts are described as unavailable.                                                 |
| §5: loopback relay and actual return over MCP                                                 | Actual daemon + independent MCP client + explicitly labelled protocol provider pass. The existing native provider reads VS Code diagnostics and executes allowlisted, approved commands. Native VS Code execution remains a manual verification item per the user's instruction.                        |
| §6: compressor.test.ts and gateway-toggle.test.ts                                             | Present and passing in focused checks; no mocked VS Code host is presented as native runtime proof.                                                                                                                                                                                                     |
| §6: existing eight-step MCP interop script                                                    | Available checks pass. Step 6 is explicitly skipped because OpenCode is not installed; no claim that all eight steps executed or a live OpenCode agent session succeeded.                                                                                                                               |

## Follow-up fixes in this revision

- Preserve authoritative fact evidence/components even when no mismatch is open.
- Preserve authoritative decisions, current open findings and provenance references
  in AI-mode handoffs; order classified entries by their original timestamps.
- Enforce the classifier's preservation/score/category boundary without building a
  second classifier. Fix empty raw-token estimates and avoid unnecessary scans of
  plain compiler scrollback.
- Expose live extension command IDs and real external parameter schemas through
  the existing gateway, retaining the current tool names and params wrapper.

No frontend redesign, native-store writer, firmware correction algorithm, proxy or
classification service was added. No user host configuration or source session
database was modified.

## Actual checks

```sh
pnpm build
pnpm --filter @udi/context-engine build
pnpm exec tsc --noEmit -p tsconfig.json
pnpm lint
python3 -B scripts/verify_spec2.py
pnpm exec vitest run packages/context-engine/src/compressor.test.ts packages/mcp-gateway/src/gateway-toggle.test.ts packages/mcp-gateway/src/index.test.ts
node scripts/verify-mcp-interop.mjs
```

The Python run passed **51 assertions in 6.06 seconds**. Final focused Vitest passed
**27 tests in three files in 14.44 seconds**, including the explicit checks for
both hardware tools and ANSI regression. Build, root typecheck and lint passed.
The changed context package was rebuilt after the scrollback fast-path adjustment.
Broad/full-suite and GUI reruns were
avoided as requested. A first latency probe under concurrent checks exceeded the
target; the reported final sample used the optimized pure kernel in an isolated
run. Neither a universal latency guarantee nor zero scheduling/GC outliers is
claimed.

## Remaining gaps and ownership

1. **Spec 1 integration dependency:** the teammate must supply actual classified
   activity and wire the returned block into the proxy. These ports and missing
   input behavior are implemented and tested; real Laya output/injection has not
   been fabricated. See `BACKEND_SPEC2_HANDOFF.md` for the exact input fields.
2. **Native host verification:** in the real development host, verify that
   `vscode_list_diagnostics` matches Problems and that
   `vscode_execute_command` returns the real result after approval and an error
   after cancellation. This remains user-owned verification under the instruction
   to avoid GUI automation.
3. **OpenCode prerequisite:** install/configure it separately if that optional
   host step is required for a demonstration. The test does not install it or
   equate a reference client with a working commercial-agent conversation.
4. **Hard latency interpretation:** the median/p95 target is met on this workload;
   a strict maximum below 1 ms remains unproven, with a measured outlier above 1 ms.

The separate native-store experiment documents transport after test-only
normalization. Its absent native import/export adapters are outside this spec's
extension-command bridge; they are not silently presented as pending Spec 2 work.
