# Frontend Spec: Context Compression Inspector, Classifier Stream & MCP Tool Hub

**Owner:** Frontend Developer 3 (Desktop Mission Control, VS Code Host UX & Shared UI)  
**Target Paths:** `apps/desktop`, `apps/vscode-extension`, `packages/ui`  
**Branch:** `feat/frontend-compression-hub`  
**Dependencies:** `@udi/contracts`, `@udi/client-sdk`, `@udi/ui`, React 19, Tailwind CSS v4, VS Code Extension API

---

## 1. Executive Summary & Objective

In Round 1, the judges loved:
1. Cross-session context preservation with intelligent compression.
2. The single unified platform housing all MCPs, plugins, and bridged extensions.
3. The ability to categorically toggle tools on and off for connected agents.

To turn these capabilities into an unforgettable, visual demonstration in Round 2:
1. Build a **Live Context Compression & Quality Inspector** in the Desktop Dashboard:
   - Visual 3-panel split: **Raw Stream** ➔ **Laya Classifier Stream** ➔ **Injected Compressed Context**.
   - **Token Savings Gauge** displaying raw tokens vs. injected tokens (e.g. 14,250 ➔ 340 tokens, **97.6% savings**).
2. Build an interactive **Categorical MCP Switchboard**:
   - Live toggles for tool categories (`Hardware & Embedded`, `Context Memory`, `VS Code Extension Bridge`, `External MCPs`).
   - Visual feedback showing the active tool list dynamically updating as switches flip.
3. Upgrade the **VS Code Extension Host Integration**:
   - Status bar item showing current compressed context size and proxy status (`$(database) UDI: 340 tokens (97.6% saved)`).
   - Quick-pick command menu to inspect distilled hardware facts without leaving the editor.

---

## 2. Shared Contracts & Types Consumed

From `@udi/contracts` (via `@udi/client-sdk`):
- `LayaClassificationResult` (id, timestamp, signalScore, category, decision, distilledFact, sourceActor)
- `CompressionMetrics` (totalRawTokens, totalCompressedTokens, compressionRatio, preservedFactsCount, prunedNoiseCount)
- `ToolCategoryConfig` (category, enabled, name, description, toolCount)
- `ToolCategoryList` / `ToggleCategoryRequest`
- `CompressedContextResult` (injectedBlock, savingsPercent, activeInvariants)

---

## 3. UI Component Architecture (`apps/desktop`)

```
App.tsx
├── Header (Project Selector, Health Pill, Token Savings Badge)
├── Navigation Tabs:
│   ├── [Overview] (Mission Control & Spaceship Deck)
│   ├── [Engineering] (KiCad netlist vs firmware, Safe Correction Diff)
│   ├── [Context Inspector] ◄── NEW TAB (Core Round 2 Showcase)
│   │   ├── Metrics Banner (Raw vs Injected Tokens, Compression Gauge)
│   │   └── 3-Column Inspection View:
│   │       ├── Column 1: Raw Agent Interaction Stream (Raw input/bash logs)
│   │       ├── Column 2: Laya Classifier Decision Stream (Signal score & badges)
│   │       └── Column 3: Injected Compressed Payload (Live prompt preview)
│   ├── [MCP Hub & Toggles] ◄── ENHANCED TAB
│   │   ├── Categorical Switchboard (Hardware, Context, VS Code Bridge, External)
│   │   └── Dynamic Active Tool Registry List
│   └── [Settings / Connections]
```

---

## 4. Detailed Component Specifications

### Component 1: `ContextCompressionInspector.tsx`
* **Route / Tab:** `Context Inspector`
* **Layout:**
  - **Top Bar (Token Economy Gauge):**
    - High-contrast stat cards:
      - **Raw Session Footprint:** e.g. `14,250 tokens` (orange text).
      - **Injected Context Payload:** e.g. `340 tokens` (neon cyan text).
      - **Efficiency Gain:** `97.6% Reduction` (neon green badge with arrow).
      - **Preserved Facts vs Pruned Noise:** `8 preserved / 142 pruned`.
    - Animated progress bar visualizing the massive token reduction.
  - **Three-Column Stream Comparison (Side-by-Side):**
    - **Left Column: Raw Interaction Stream (Scrollable)**
      - Displays real-world raw interactions: verbose `npm`/compiler outputs, terminal scrollbacks, exploratory tool responses.
      - Styled in terminal monospace with subtle dark background.
    - **Middle Column: Laya Semantic Classifier Stream**
      - Displays chronological classification cards:
        - Header: Timestamp + Source (`tool_output:engineering-core`, `user_message:fev`).
        - **Signal Meter:** Circular or progress meter showing score (e.g. `0.95 HIGH SIGNAL` in emerald, or `0.12 NOISE` in muted red).
        - **Category Badge:**
          - `HARDWARE_SPEC` (Cyan border & glow)
          - `ARCHITECTURAL_DECISION` (Purple border)
          - `VALIDATED_OUTCOME` (Green border)
          - `EPHEMERAL_NOISE` (Dim gray border)
        - **Decision Tag:** `PRESERVE TO MEMORY` vs `PRUNE / DISCARD`.
        - **Distilled Fact Output:** The exact single-line invariant Laya extracted.
    - **Right Column: Injected Context Payload**
      - Displays the exact, syntax-highlighted Markdown block injected into the user's prompt by the proxy.
      - Shows the active hardware facts (`MOTOR_EN = GPIO14`), decisions, and current zero-finding health.
      - Includes a "Copy Injection Block" button for easy demonstration to judges.

---

### Component 2: `CategoricalToolHub.tsx`
* **Route / Tab:** `MCP Hub`
* **Functionality:**
  - Displays a clean switchboard of tool categories:
    1. **Hardware & Embedded Tools** (KiCad netlist validator, PlatformIO runner) — `[Toggle Switch: ON/OFF]`
    2. **Core Project Memory** (`get_project_context`, `record_decision`, `list_events`) — `[Toggle Switch: ON/OFF]`
    3. **VS Code Extension Bridge** (Language server symbols, VS Code diagnostics) — `[Toggle Switch: ON/OFF]`
    4. **External MCP Servers** (Bridged third-party tools) — `[Toggle Switch: ON/OFF]`
  - **Live Client Interaction:**
    - Flipping a toggle calls `client.toggleToolCategory({ projectId, category, enabled })`.
    - The tool list below immediately filters with a smooth animation showing tools entering/exiting the active scope.
    - Live badge indicates: *"OpenCode / Claude currently sees N active tools"*.

---

### Component 3: VS Code Extension Host Integration (`apps/vscode-extension`)

1. **Status Bar Widget (`src/status-bar.ts`):**
   - Renders in the bottom right: `$(chip) UDI: 340 tok (97.6% saved) | 5 MCP Tools`.
   - Tooltip: *"Universal Developer Intelligence: Compressed context injected. Click to inspect memory."*
   - Clicking opens the Desktop Dashboard or VS Code Webview panel directly on the Context Inspector tab.
2. **Command Palette Integration (`src/extension.ts`):**
   - `Developer Intelligence: View Injected Context Payload`
     - Displays an in-editor read-only virtual document (`udi-context://preview`) showing the exact compressed markdown payload.
   - `Developer Intelligence: Toggle Tool Categories`
     - Opens a QuickPick menu allowing the user to toggle categories directly from the editor without switching windows.

---

## 5. UI/UX Style & Visual Polish

* Maintain the established **dark, retro-futuristic pixel-art and sci-fi aesthetic**:
  - Backgrounds: Dark slate / obsidian (`#0b0d13`, `#131722`).
  - Borders: Crisp 1px neon borders with subtle box-shadows.
  - Accent colors:
    - Neon Cyan (`#00f0ff`) for Hardware / Invariants.
    - Neon Emerald (`#10b981`) for Validated Passes and High Signal.
    - Neon Amber (`#f59e0b`) for Decisions.
    - Dim Slate (`#475569`) for Pruned Noise.
  - Typography: Monospace accents (`Fira Code` / `JetBrains Mono`) for all code, pin numbers, and token metrics.

---

## 6. Definition of Done & Test Plan

1. **Component Unit Tests (`apps/desktop/src/ContextCompression.test.ts`):**
   - Mounts `ContextCompressionInspector` with mock metrics (14,250 raw ➔ 340 compressed).
   - Verifies the savings percentage (`97.6%`) renders correctly.
   - Verifies that cards with `signalScore >= 0.70` display green `PRESERVE` tags.
   - Verifies that cards with `signalScore < 0.70` display muted `PRUNE` tags.
2. **Category Switchboard Test (`apps/desktop/src/CategoricalToolHub.test.ts`):**
   - Mounts category list with 4 toggles.
   - Clicks toggle for `hardware_validation` to OFF.
   - Verifies `client.toggleToolCategory` was called with `{ category: 'hardware_validation', enabled: false }`.
   - Confirms tool count badge decrements.
3. **VS Code Extension Test (`apps/vscode-extension/src/status-bar.test.ts`):**
   - Verifies status bar item creates cleanly and registers click command.
