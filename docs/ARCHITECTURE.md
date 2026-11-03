# Architecture

```mermaid
flowchart LR
  Desktop[React + Tauri] --> SDK[Shared client SDK]
  VSCode[VS Code extension] --> SDK
  MCP[MCP v2 stdio bridge: planned] --> SDK
  SDK --> API[127.0.0.1 Fastify daemon]
  API --> DB[(SQLite)]
  API -. planned .-> Context[Context engine]
  API -. planned .-> Engineering[Engineering validator]
  Engineering -. planned .-> Runner[Allowlisted tool runners]
```

`contracts` owns Zod schemas, types and API envelopes. `client-sdk` owns transport, validation, timeouts, token headers and errors. The daemon owns routing, startup, token lifecycle and project orchestration. `event-store` owns migration v1 and the project repository; it exports an EventStore port for Developer 2. `context-engine` depends on contracts and receives repositories through interfaces. `mcp-gateway` depends on contracts, the client SDK and official MCP v2 server SDK; it calls the daemon rather than SQLite. `engineering-core` depends on contracts and tool-runner interfaces. `tool-runners` has no network/UI dependency. `ui` is presentational React only; it never calls the API.

Dependency direction: apps → SDK/shared packages → contracts. Server-side modules may be composed in the daemon after review. Do not import apps from packages or frontend code into server packages. Context and engineering never obtain implicit global project state. Keep package dependency edges explicit in manifests.

The daemon binds 127.0.0.1, logs route templates/request UUID/status without bodies, query strings or tokens, and gracefully closes SQLite on SIGINT/SIGTERM. Existing workspace directories are canonicalized before insertion. SQLite enables WAL, foreign keys and a busy timeout; newer unknown migration versions refuse to open. Data persists through restarts. Deleting a project deletes its activity events by FK cascade; it never deletes workspace files.

Available integration: health and project CRUD over HTTP using one shared SDK. Planned integration: inject ContextEngine/EngineeringValidator/McpRegistry into daemon routes; add repository implementations and new migration versions, with persistence and provenance tests. Start with explicit 501s, then implement one end-to-end path at a time.
