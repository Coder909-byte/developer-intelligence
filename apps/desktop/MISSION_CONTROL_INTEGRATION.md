# Mission Control frontend integration

## Session Library

The Library ship compartment opens a bookshelf of actual persisted project handoffs. Each book opens `getHandoff(projectId, handoffId)` through the existing reviewed handoff detail view; Save session handoff uses the existing preview/approval flow. Shelves use `listHandoffs` with 50-item limit/offset pagination and a search of the loaded page. Incoming records are scope checked. This is saved session handoff information, not automatic chat capture. The librarian is decorative artwork, not a claimed running agent. No new backend contracts, seed records or local storage were added.

The Context Inspector and MCP Hub → Tools screens follow the supplied three-column compression inspector and categorical switchboard design. Production code contains no demo metrics, classification records, tool categories, or injection payloads. Numeric fixtures exist only in tests.

## Connect the backend

`App` accepts an optional `missionControl` factory. The factory receives the current authenticated `DaemonClient` and returns a `MissionControlSource` (see `src/mission-control.ts`). Wire the factory in `src/main.tsx` after the backend owner publishes the shared contracts and SDK operations.

The factory is recreated when connection credentials change. Its methods receive the selected project UUID:

- `inspect(projectId)` supplies presentation inputs to `ContextCompressionInspector`: measured token counts, preserved/pruned counts, classifier cards and the exact injected Markdown block.
- `tools(projectId)` supplies presentation inputs to `CategoricalToolHub`: categories, confirmed active tools and optional verified host visibility text.
- `toggle(projectId, category, enabled)` persists the policy through the approved SDK method. Reject on failure. After success the UI reloads the authoritative snapshot; it never simulates tool removal by filtering locally.

These are frontend component inputs, **not new API contracts**. Map from types imported from `@udi/contracts` inside the adapter. Use `@udi/client-sdk` for HTTP; do not add fetch calls or guessed routes. The current shared SDK does not publish compression/category methods, so this factory remains unbound by default.

Current SDK-backed reads already work: the inspector reads the first 100 stored project events, and Tools reads `listIntegrations()`. The raw column is explicitly labeled stored activity, not captured private conversation. Refresh buttons fetch a new snapshot. This version does not claim a live subscription.

The classifier's `preserve` input is the backend's decision. The frontend displays scores without overriding that decision using a separate threshold. Use the same tokenizer and scope for both token counts. Zero/unknown raw input produces no savings percentage. The injection block is copied exactly, without serialization or Markdown rewriting. Host visibility text should only be supplied after host verification.

Category names, IDs, counts and tool rows are backend supplied. A missing source shows waiting states and disables unsupported actions. No data is seeded automatically. Incoming project events are scope checked; the adapter must verify project scope on the new contract responses as well. Project/client identity changes isolate outstanding reads.

## Pending backend and editor integration

The spec's compression schemas, category schemas, persistence, classification, proxy injection and gateway enforcement remain backend work. VS Code's token status and `udi-context://preview` should use those same published SDK responses once available; the existing editor behavior is preserved for now. A rendered preview is not evidence of an actual prompt injection or connected agent tool scope.

New component tests cover measured savings, zero/unknown input, exact clipboard output and clipboard failure, acknowledged category scope updates, rejected changes, and unavailable writes. Existing App tests now exercise the real gateway inventory read.
