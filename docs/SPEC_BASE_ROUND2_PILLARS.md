# Universal Developer Intelligence Platform — Base Specification (Round 2 Architecture)

**Competition:** UPSIDE DOWN.EXE · **Track:** PS-01 Beyond the App  
**Document:** Foundational Architecture & Validated Product Pillars  
**Linked Sub-Specs:**

1. [Backend Spec 1 — Proxy, Interception & Laya Classifier](SPEC_BACKEND_PROXY_CLASSIFIER.md)
2. [Backend Spec 2 — Context Compressor & Categorical MCP Bridge](SPEC_BACKEND_CONTEXT_MCP_BRIDGE.md)
3. [Frontend Spec — Mission Control, Compression Inspector & Switchboard UI](SPEC_FRONTEND_MISSION_CONTROL.md)

---

## 1. Executive Summary & Round 1 Validated Direction

In Round 1, the judging panel strongly validated five core architectural breakthroughs that differentiate this platform from generic chat wrappers and isolated dashboards:

1. **Cross-Session, Cross-Harness Context Preservation:**  
   Persisting verifiable project memory in local SQLite so that context survives across multiple independent AI harnesses (VS Code extensions, OpenCode, Claude Code, Codex CLI) and daemon restarts.
2. **Dual-Mode Context Compression (Deterministic + Laya Classifier):**  
   Compressing context so new sessions never need to re-scout the entire codebase, achieving a 95%+ token reduction without losing critical invariants.
3. **The Man-in-the-Middle Interception Layer:**  
   Positioning our local engine directly between user messages and the AI system via an OpenAI-compatible proxy (`POST /api/v1/chat/completions`), injecting live verified ground truth on the fly.
4. **Universal Extension & MCP Aggregation:**  
   Unifying fragmented registries (VS Code Marketplace vs Open VSX vs custom harnesses) and exposing native VS Code extensions as standardized MCP tools.
5. **Single Gateway MCP with Categorical Tool Toggles:**  
   Letting agents connect to a single gateway endpoint while giving developers a live UI switchboard to toggle tool categories on and off dynamically.

---

## 2. The Core Problem Statement & PS-01 Compliance

- **The Problem:** Modern engineering workflows suffer from three distinct silos:
  - **The Hardware Silo:** Firmware code and circuit schematics live in isolation. When pin definitions drift, the compiler gives zero warnings until physical hardware fails.
  - **The Agent Amnesia Silo:** Switching between IDEs and agents resets context to zero. Developers burn thousands of tokens and minutes watching agents repeatedly search files for basic facts.
  - **The Tool Fragmentation Silo:** Mature IDE extensions are locked inside specific editors. External CLI agents cannot touch them, and configuring multiple independent MCP servers bloats model context.
- **The PS-01 Solution:** We extend **VS Code** into a hardware-aware, cross-agent mission control. The extension provides native in-editor diagnostics and repairs, while the local daemon coordinates persistent memory, intelligent proxy interception, and unified MCP routing.

---

## 3. The Five Core Pillars (Detailed Architecture)

```
                            ┌──────────────────────────────────────────────┐
                            │                USER INTERFACE                │
                            │  VS Code Host Extension  │  Desktop Mission  │
                            │  Diagnostics & Commands  │  Control Center   │
                            └──────────────────────┬───────────────────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                             LOCAL CORE DAEMON (:4317)                                    │
│                                                                                          │
│  ┌──────────────────────────────┐              ┌──────────────────────────────────────┐  │
│  │ 1. Man-in-the-Middle Proxy   │              │ 2. Laya Semantic Classifier Pipeline │  │
│  │ (POST /v1/chat/completions)  ├─────────────▶│                                      │  │
│  │ • Intercepts user prompt     │              │ • Stage 1: Deterministic Scrub (<1ms)│  │
│  │ • Injects compressed context │              │ • Stage 2: Laya Signal-Noise Scoring │  │
│  │ • Captures response & tools  │              │ • Distills & categorizes invariants  │  │
│  └──────────────┬───────────────┘              └──────────────────┬───────────────────┘  │
│                 │                                                 │                      │
│                 ▼                                                 ▼                      │
│  ┌──────────────────────────────┐              ┌──────────────────────────────────────┐  │
│  │ 3. Dual-Mode Context Engine  │              │ 4. Single Gateway MCP & Switchboard  │  │
│  │ • Mode A: Deterministic Delta│              │ (developer-intelligence-gateway)     │  │
│  │ • Mode B: AI Rollup Punchlist│◀─────────────┤ • Dynamic Categorical Tool Toggles   │  │
│  │ • 95%+ Token Compression     │              │ • Bridges VS Code Extensions to MCP  │  │
│  └──────────────┬───────────────┘              └──────────────────┬───────────────────┘  │
│                 │                                                 │                      │
│                 └───────────────────────┬─────────────────────────┘                      │
│                                         ▼                                                │
│                        ┌─────────────────────────────────┐                               │
│                        │   5. Persistent SQLite Store    │                               │
│                        │   (Projects, Events, Context,   │                               │
│                        │    Findings, Provenance Tags)   │                               │
│                        └─────────────────────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Pillar 1: Cross-Session, Cross-Harness Context Preservation

- **Mechanism:** Single authoritative SQLite event store owned exclusively by the daemon (`packages/event-store`).
- **Multi-Host Compatibility:** Tested across VS Code extension, OpenCode CLI, and standalone reference clients.
- **Strict Provenance:** Every preserved record carries an explicit provenance tag (`observed_tool`, `user_entered`, `agent_summary`, `imported`). AI summaries are never falsely marked as verified tool observations.

### Pillar 2: Dual-Mode Context Compression & Laya Classifier

- **Stage 1 (Deterministic Scrub):** Instantly strips ANSI codes, repetitive progress bars, compiler warning spam, and raw binary/base64 blobs in <1ms.
- **Stage 2 (Laya Semantic Classification):**
  - Evaluates text for semantic signal (0.0 to 1.0) and assigns one of four taxonomy buckets:
    1. `HARDWARE_SPEC` (Pins, buses, baud rates, voltage — **Must Keep**).
    2. `ARCHITECTURAL_DECISION` (User constraints and lead decisions — **Must Keep**).
    3. `VALIDATED_OUTCOME` (Deterministic tool passes, fails, and applied patches — **Must Keep**).
    4. `EPHEMERAL_NOISE` (Trial-and-error chatter, obsolete warnings — **Pruned**).
  - High-signal items (score ≥ 0.70) are distilled into single-line facts and persisted to SQLite.
  - Ephemeral noise (>0.85 noise score) is pruned before entering long-term memory.
  - **Offline Fallback:** If the Laya model endpoint is unavailable, a deterministic regex rule-engine seamlessly takes over without failing the pipeline.

### Pillar 3: Man-in-the-Middle OpenAI Interception Layer

- **The Route:** `POST /api/v1/chat/completions`.
- **Universal Drop-In:** Any agent (OpenCode, Claude Code, Codex, Cursor, VS Code extension) sets `baseURL: http://127.0.0.1:4317/api/v1`.
- **Zero Configuration Scraping:** Avoids brittle, proprietary database scraping of IDE internal state (`workspaceStorage`).
- **Live Context Injection:** Injects the current, compressed project memory into `messages[0]` (system prompt) right before forwarding to the LLM.

### Pillar 4: Universal Extension & MCP Aggregation

- **Marketplace Bridge:** Solves the fragmentation where VS Code forks (Cursor, VSCodium, Positron) cannot access the official VS Code Marketplace.
- **Extension-to-MCP Provider:** VS Code extensions can register their internal commands and language server symbols with our daemon. The daemon surfaces them outward over standard MCP stdio/HTTP. Any external agent can now use VS Code extensions.

### Pillar 5: Single Gateway MCP with Categorical Toggles

- **The Single Connection Contract:** External agents only need to configure one server:
  `command: "node packages/mcp-gateway/dist/cli.js"`.
- **Dynamic Categorical Switchboard:**
  - Four toggles in Desktop UI / VS Code:
    1. `hardware_validation` (KiCad S-expression parser, PlatformIO runner).
    2. `context_memory` (`get_project_context`, `record_decision`, `list_project_events`).
    3. `ide_extension_bridge` (Bridged VS Code extension tools).
    4. `external_servers` (Third-party aggregated MCP servers).
  - Flipping a toggle dynamically alters the `tools/list` response returned by the MCP gateway in real-time, preventing context bloat in connected agents.

---

## 4. Key Metrics & Evaluation Targets for Round 2

| Metric                            | Target Baseline                           | Verification Method                                                         |
| :-------------------------------- | :---------------------------------------- | :-------------------------------------------------------------------------- |
| **Context Compression Ratio**     | **≥ 90% token reduction**                 | Compare raw conversation/tool bytes vs. injected prompt payload             |
| **Hardware Pin Accuracy**         | **100% deterministic (0 hallucinations)** | Unit tests on `examples/rover` KiCad netlist vs C++ `#define`               |
| **Cross-Agent Memory Round-Trip** | **< 10ms SQLite recall**                  | Agent 1 records decision ➔ Agent 2 queries `get_project_context`            |
| **MCP Categorical Filtering**     | **Zero client restarts required**         | Toggle category via UI ➔ `tools/list` on client immediately reflects change |
| **Proxy Overhead**                | **< 5ms added latency**                   | Benchmark `POST /api/v1/chat/completions` with context injection            |

---

## 5. Team Execution & Ownership Matrix

| Workstream                           | Owner      | Primary Deliverable                                                       | Detailed Spec File                                                              |
| :----------------------------------- | :--------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------------------ |
| **Core Proxy & Laya Classifier**     | Backend 1  | OpenAI Proxy endpoint, Two-Stage Classifier pipeline, Telemetry APIs      | [`docs/SPEC_BACKEND_PROXY_CLASSIFIER.md`](SPEC_BACKEND_PROXY_CLASSIFIER.md)     |
| **Context Engine & MCP Bridge**      | Backend 2  | Dual-mode compressor, Dynamic Categorical Gateway, Extension adapter      | [`docs/SPEC_BACKEND_CONTEXT_MCP_BRIDGE.md`](SPEC_BACKEND_CONTEXT_MCP_BRIDGE.md) |
| **Mission Control & Switchboard UI** | Frontend 3 | Compression Inspector (3-column view), Live Savings Gauge, Switchboard UI | [`docs/SPEC_FRONTEND_MISSION_CONTROL.md`](SPEC_FRONTEND_MISSION_CONTROL.md)     |
