# Codex → Claude Code context component

This user-requested addition extends the earlier Spec 2 work with a production
native Codex reader and an explicit frontend conversion/export flow. It lives in
**Agent Workspace → Context Bridge**, using the existing pixel typography,
purple panels, green action buttons and shared UI components.

## One-click flow

1. Select the registered workspace used by Codex.
2. Click **Convert to Claude Code**. This is the first point at which native
   session content is read. The daemon reads the latest matching Codex VS Code
   session and returns the actual source excerpts and a converted Markdown handoff.
3. Review source/output side by side, along with message counts, provenance,
   original times, output-token estimate and any declared truncation/omission.
4. Click **Copy for Claude Code** and paste into Claude Code in the same workspace,
   or download `codex-claude-context.md`. For project memory, put the downloaded
   file in the workspace and add `@./codex-claude-context.md` to an existing
   `CLAUDE.md`; start a new Claude Code session to load it.

The target uses Claude Code's documented Markdown context mechanism and file
imports: [official memory documentation](https://code.claude.com/docs/en/memory#import-additional-files).
The UI says **Ready to import**, not that Claude is connected or that a native
Claude conversation has been resumed. Claude's runtime is not needed to generate
the artifact, and no Claude response is fabricated while that application is
unavailable.

## API and implementation

`POST /api/v1/projects/:id/context-bridge/codex-to-claude`

The authenticated request body is `{}` for the latest session, or
`{"sessionId":"<uuid>"}` for an explicitly selected session in that same project.
`client.convertCodexContext(projectId, input?)` validates requests and responses
using additive schemas from `@udi/contracts`. Existing endpoints are unchanged.

The existing daemon reads native SQLite in read-only/query-only mode. It finds
top-level VS Code sessions in `state_5.sqlite`, then reads supported user,
assistant and command-result items in `thread_history_1.sqlite`. Active sessions
without a projected history use the indexed saved rollout under Codex's own
`sessions` directory. Reasoning/system/developer messages and mirrored event
notifications are excluded. Assistant messages explicitly marked as analysis are
excluded too.

Workspace matching uses canonical paths. A selected session from another project
is rejected even if it is the newest or only available session. Source file paths
cannot be supplied over HTTP; rollout paths escaping the native sessions directory
are rejected. `UDI_CODEX_HOME` can select the native installation directory at
daemon startup, primarily for isolated fixtures.

The source scan is bounded to 96 supported SQLite items plus the latest user
request when needed, or a four-MiB rollout window. The formatter retains up to
24 messages with a bounded excerpt budget, prioritizes the latest user intent,
and explicitly reports omissions and shortened excerpts. It preserves role/time/
source identity and labels assistant assertions as unverified historical summaries.
This is context formatting, not the teammate's classifier or an AI summary.

Native message text is inside Markdown code fences, including messages that
already contain fences or `@path` strings. Metadata containing project names or
source IDs uses code spans. Claude's documented import parser skips these spans
and fences, so history is not formatted as new file-import directives.

## State and file boundaries

The frontend uses the shared SDK. It never accesses SQLite or session files.
Changing projects or connection identity hides prior previews and invalidates
pending results. Repeat clicks are disabled while the request is active.
Missing sessions, authentication errors and offline/invalid responses display
failure states without a success preview.

The endpoint writes no Codex/Claude files, instructions, host configuration,
session databases, captured-context rows or private session logs. The complete
export is returned only in the authenticated response and held in the UI. Copy
and download occur on explicit user actions. Existing `CLAUDE.md` and `AGENTS.md`
files are preserved; importing the generated artifact is an explicit user step.
No model, classifier, firmware toolchain or live Claude connection is required.

## Verification

```sh
pnpm build
pnpm exec tsc --noEmit -p tsconfig.json
pnpm lint
pnpm exec vitest run packages/context-engine/src/claude-handoff.test.ts apps/core-daemon/src/codex-context.test.ts apps/desktop/src/ContextBridge.test.ts apps/desktop/src/App.test.ts
python3 -B scripts/verify_codex_claude_conversion.py
```

The first production-API real-data run passed 16 checks in 1.83 seconds. It
converted two actual native sources: 24 messages from a saved rollout and 24 from
SQLite history. Those cases used the production reader/formatter, not the earlier
test-only normalizer. No private text or database copies are committed; the script
prints aggregate counts and uses a temporary daemon database.

The frontend's mocked API fixtures test presentation and stale-result handling;
they are not claimed as native extension/runtime proof. Native source formats,
read-only behavior, workspace rejection, authentication, Markdown fencing and
bounded capture have independent backend/formatter tests. Live Claude consumption
still needs a working Claude Code application and the manual import step.

Final verification passed 15 new tests across the formatter, native-reader API and
component (4.78 seconds), plus the earlier 23 existing App regression tests. The
final real-data run passed 16 checks in 2.63 seconds: both supported native source
paths produced 24-message Markdown handoffs. Root build/typecheck/lint, changed-file
formatting, and the existing daemon smoke test passed. The final changed daemon
and desktop packages were also rebuilt after the last reader/UI adjustments.

Run the updated daemon and desktop from the feature worktree to see the component:

```sh
# Terminal 1, repository root (after pnpm build)
UDI_INTEGRATIONS=true node apps/core-daemon/dist/main.js
# Terminal 2, same repository root
pnpm --filter @udi/desktop dev
```

Use the existing Settings flow to authenticate to that daemon, register/select
the workspace actually used in Codex, then open Agent Workspace. An existing
daemon/frontend from another checkout must be updated/restarted by its owner;
this verification did not terminate unrelated processes or change their state.
