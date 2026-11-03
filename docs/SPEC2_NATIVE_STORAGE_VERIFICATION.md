# Spec 2: actual Codex and Claude Code storage experiment

Result: shared context storage and MCP retrieval work **after explicit test-only
normalization**. Native Codex-to-Claude/Claude-to-Codex session conversion is not
implemented or proven by the Spec 2 extension-command bridge.

## Actual sources and scope

The experiment read Codex VS Code's `$HOME/.codex/state_5.sqlite` to identify a
thread with `source = vscode` and `originator = codex_vscode`. It read actual
`thread_items.item_json` rows from `$HOME/.codex/thread_history_1.sqlite`.

Claude Code had useful `$HOME/.claude/history.jsonl` entries. Full conversation
JSONL files were absent from its local projects/sessions directories. The sampled
Claude data therefore contains saved user prompts, not assistant/tool responses.
VS Code's Claude extension state contained configuration/session UI metadata,
which was not misrepresented as a conversation transcript.

The script selected one existing project shared by both stores, sampled one Codex
session and one Claude session, and kept other workspaces out of the experiment.
It used 20 real Codex records (12 user messages, four assistant messages and four
command results), plus six real Claude Code user prompts. Personal project names,
session text, identifiers and source database copies are not included in this
report or committed fixtures.

Both source SQLite connections use `mode=ro` and `PRAGMA query_only=ON`. Claude
history is read-only. An isolated temporary daemon database receives the samples;
test-owned daemon/MCP processes and temporary data are removed at completion.
The selected original rows/history entries were checked again after testing.

## Mapping and actual test results

A Python **test helper** extracts selected text, roles, original timestamps and
session/message identity into an explicit JSON envelope stored as a standard
context record. User messages retain `user_entered`, assistant replies retain
`agent_summary`, and command observations retain `observed_tool` provenance.
Conversation messages are summaries, not automatically asserted decisions.
Attachments, pasted-content expansions and all native format metadata are not
converted. This helper is not a shipped source adapter or classifier.

The final behavioral run passed 14 assertions in 2.53 seconds:

| Check                                                                                                            | Actual outcome                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Two independent real MCP stdio reader processes retrieve both sources                                            | Passed                                                                         |
| Sampled text, roles, session/message identity, timestamps and provenance survive normalization/storage/retrieval | Passed, exact envelope text hashes and provenance compared                     |
| Each reader writes through MCP; the other retrieves the write                                                    | Passed in both directions; writes remain `agent_summary`                       |
| Another project stays isolated                                                                                   | Passed; no sampled records returned                                            |
| Both native source samples survive daemon restart                                                                | Passed                                                                         |
| Sampled native database rows and history entries remain unchanged                                                | Passed                                                                         |
| Historic text does not manufacture a current engineering pass or authoritative agent decision                    | Passed                                                                         |
| AI mode with 18 real user messages but no classifier annotations                                                 | Explicit HTTP 501 `NOT_IMPLEMENTED`, as required by the missing input boundary |

The two readers are actual independent **Python MCP reference clients**. They are
not live Codex/Claude Code applications, and the test does not claim those apps
consumed new context or resumed a native session.

## Compression finding: transport success is not semantic conversion

Mode A returned 26 estimated tokens from 11,722 estimated raw tokens (99.78%
reduction), but **zero of the 26 sampled source messages appeared verbatim in the
compressed block**. Its output contained the project heading and the honest
"No verified current validation pass" status.

That number is not evidence of useful conversational compression. The current
deterministic pipeline deliberately keeps hardware bindings, current findings and
authoritative decisions. These imported conversational summaries were none of
those. Their complete sampled content remained retrievable through
`get_project_context`; `get_compressed_context` did not preserve their meaning as
a conversational handoff. Raw-token estimates include both stored records and
activity metadata and are not billing token counts.

AI mode could not fix this without real classified events: the source data did not
contain the teammate's `signalScore`, `category`, `decision` and `distilledFact`
annotations. The test supplied no invented annotations and no model output.

## Remaining requirements for actual cross-storage context transfer

These are findings from the separately requested native-storage experiment, not
additional deliverables in `SPEC_BACKEND_CONTEXT_MCP_BRIDGE.md`. Spec 2 defines an
extension-command MCP bridge. Its latest completion matrix is in
[SPEC2_ACCEPTANCE.md](SPEC2_ACCEPTANCE.md).

1. Product source adapters must read supported native formats and map their
   workspace/session identity, original chronology, message roles, attachments and
   tool-result semantics. The current Spec 2 bridge registers/exposes extension
   commands; it does not ingest session databases automatically.
2. The teammate's Spec 1 classifier must produce real classified activity for the
   Spec 2 rollup. The proxy/injection integration must actually deliver the
   compressed block to the next harness; that is not supplied by this test helper.
3. Native session export/writing or live application consumption must be verified
   separately. No Codex or Claude native database/JSONL file was modified, and no
   working Claude runtime is claimed.

## Reproduce

From the `feat/compressor-mcp-bridge` worktree, using the already-built packages:

```sh
python3 -B scripts/verify_native_context_stores.py
```

Optional `--codex-home`, `--claude-home` and `--project-root` arguments restrict the
source locations/project. Missing readable native data or no shared project fails
explicitly. No dependencies, GUI automation, cloud calls or broad test reruns are
needed. Console output contains aggregate results, not private session text.
