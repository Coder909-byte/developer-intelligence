# Deterministic aggregator acceptance

Run from the repository root, on `feat/aggregator-integration` or its reviewed merge. No external toolchains, hardware, model accounts or new dependencies are required for the fixture.

```sh
pnpm build
pnpm test:aggregator:fixture
node scripts/verify-aggregator-e2e.mjs
node scripts/verify-host-setup.mjs
```

Convenience aliases: `pnpm test:aggregator` builds then runs the readiness gate; `pnpm test:hosts` builds packages then checks host previews. **Exit 0 = success only for a fully implemented gate; exit 1 = test failure; exit 2 = BLOCKED.** On this baseline, aggregator and host gates intentionally exit 2. They must never be advertised as end-to-end aggregator passes. Current scripts are acceptance preparation, not a completed external-routing harness. Actual D2 API bindings are deferred until its implementation is published and agreed in [the contract](AGGREGATOR_CONTRACT.md).

## Executable now

`scripts/fixtures/aggregator-mcp.mjs` is a real official-SDK v2 stdio server with two tools:

- `fixture_sum({a,b,nonce})`: bounded integers in [-1000,1000], nonce `demo-` plus 1–64 lowercase letters/digits/hyphens; returns real sum, nonce and SHA-256(JSON.stringify([a,b,nonce])). Use 14 + 26 = 40 and a fresh nonce to correlate genuine response bytes.
- `fixture_failure({})`: returns `isError=true`, `FIXTURE_EXPECTED_FAILURE`. It never echoes arbitrary arguments.

No file access, shell, network or hardware operations are implemented by these tools. The independent reference client performs initialize/initialized/tools-list/call using real subprocess stdio. It checks five cases: successful catalog/result, bad argument bounds, genuine tool failure and unknown tool (MCP protocol error). This proves fixture/protocol availability **only**, not platform routing. CI runs this prerequisite.

The readiness script starts the actual integrated daemon on a random IPv4 loopback port with private temporary SQLite/token storage. It checks authentication, actual inventory registration, standalone fixture compatibility, real engineering mismatch with source positions, corrected zero findings, job/context isolation, separate D2 MCP CLI retrieval matching REST and daemon/CLI restart persistence. All test-owned processes have bounded startup/RPC/shutdown deadlines and are stopped; the existing demo daemon/editor/browser are untouched. Temporary data is removed. Sanitized reports are ignored at `.data/aggregator-integration/aggregator-result.json` and `hosts-result.json`; no tokens are printed.

The script does **not** call an external tool directly and then insert its response into platform history. Direct fixture checks remain isolated prerequisites. No synthetic invocation event or agent statement can satisfy a gateway gate.

## Remaining full acceptance sequence — D2 implementation required

| Step | Required real observation                                                                                                                                         | Current baseline                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1    | Start actual daemon, authenticate; bad token gives 401                                                                                                            | Implemented/run                                                                 |
| 2    | Register fixture through inventory SDK, record server UUID                                                                                                        | Implemented/run; unknown state is correct                                       |
| 3    | Authorize project/server/fixture tools; platform connects and initializes MCP                                                                                     | BLOCKED; direct fixture handshake is only prerequisite                          |
| 4    | Platform executes tools/list, persists tool descriptors                                                                                                           | BLOCKED                                                                         |
| 5    | SDK retrieves discovered `fixture_sum` and `fixture_failure` schemas                                                                                              | BLOCKED                                                                         |
| 6    | Approved platform gateway call: 14 + 26 + fresh nonce                                                                                                             | BLOCKED; no direct-spawn substitute                                             |
| 7    | Returned sum/nonce/receipt match actual provider response                                                                                                         | BLOCKED                                                                         |
| 8    | Query persisted invocation and automatic observed event; correlate IDs/time/outcome                                                                               | BLOCKED                                                                         |
| 9    | Start **another** platform MCP CLI connection; retrieve same event/context sourceRef                                                                              | BLOCKED for external invocation; engineering observations work                  |
| 10   | Wrong/missing project, cross-project invocation ID, disabled server, denied/unknown tool, bad schema, unavailable executable, timeout/disconnect and tool failure | Existing job/context/auth isolation run; invocation cases BLOCKED               |
| 11   | Gracefully restart daemon and second CLI, same private store/token; compare same invocation/event IDs and redacted summaries; control project remains empty       | Existing inventory/jobs/events/context run; external invocation history BLOCKED |
| 12   | Existing engineering mismatch one finding GPIO14/GPIO26, corrected succeeds/zero; old finding remains history; original fixtures unchanged                        | Implemented/run; existing native GUI proof in FINAL_RUNTIME                     |

For step 10, register a second control project, grant only the primary project, and verify denied calls never launch the provider. Timeout/disconnect fixtures must use bounded test-controlled behavior implemented only after D2's cancellation lifecycle is known. Verify both tool `isError` and protocol errors record failure without leaking secrets. Put a sentinel credential in test-only arguments/environment and assert it is absent from persisted history, events/context and MCP output. Test redaction before accepting arbitrary real integrations. No insecure auto-grant endpoint should be added just for this script.

When D2 publishes: inspect actual exports/shared schemas → agree SDK methods → compose in existing daemon → replace the explicit blocked stages with those real SDK calls → run all 12 gates twice from fresh stores. Overall exit 0 is forbidden until all 12 pass. Remove the fixed preparation-only BLOCKED result only in that integration commit; inventory/MCP capability flags are insufficient feature detection.

## Host verification

`verify-host-setup.mjs` imports D2's actual generators. It seeds existing unrelated configuration in private temporary files, previews each host, confirms bytes did not change and disabled servers are omitted, then checks the host-specific server-map shape. Current outputs are incompatible with both target formats. Applying either is NOT RUN. No real host configuration, editor profile, repo workspace config or `.bak` is changed.

After D2's adapter fix, expand this flow: preview a merged file preserving existing server/settings → cancel leaves identical bytes → explicit approval of that file/hash → safe apply → backup byte equality → stale/concurrent edit rejection → malformed/JSONC/symlink/out-of-bound/backup failure rejection → load in the actual host → real tools-list and call. Use isolated profiles/workspaces and explicit approval for the real config write. OpenCode application proof remains unavailable until the binary is present; configuration-schema evidence and protocol-client evidence must be labeled separately.
