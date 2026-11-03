# Backend Spec 1: Core Proxy, OpenAI Interception & Laya Classifier Pipeline

**Owner:** Backend Developer 1 (Core & Integration)  
**Target Paths:** `apps/core-daemon`, `packages/contracts`, `packages/client-sdk`  
**Branch:** `feat/proxy-laya-classifier`  
**Dependencies:** Fastify daemon, `packages/event-store` (SQLite), upstream LLM / Laya endpoint

---

## 1. Executive Summary & Objective

In order to bridge the gap between user prompts and AI coding systems (VS Code extensions, OpenCode, Claude Code, Codex CLI) without fragile disk scraping:
1. Provide an **OpenAI-compatible HTTP Proxy** (`POST /api/v1/chat/completions`) inside the local core daemon. Any harness can point its `baseURL` / `OPENAI_BASE_URL` to `http://127.0.0.1:4317/api/v1`.
2. Intercept outgoing user prompts to **inject compressed, verified project context** (active hardware invariants, pinouts, decisions) directly into the prompt system message.
3. Pass all agent turns and tool outputs through a **Two-Stage Classifier Pipeline** powered by **Laya (semantic classifier)**:
   - **Stage 1 (Deterministic Scrub):** Instantly strips ANSI codes, base64 strings, progress bars, and high-frequency noise.
   - **Stage 2 (Laya Semantic Classification):** Evaluates remaining text for semantic signal (0.0 to 1.0) and assigns a category (`HARDWARE_SPEC`, `ARCHITECTURAL_DECISION`, `VALIDATED_OUTCOME`, `EPHEMERAL_NOISE`).
   - High-signal entries are distilled and persisted to SQLite `context_records` with verifiable provenance.
   - Ephemeral noise (>0.85 noise score) is pruned before entering long-term project memory.
4. Expose live compression telemetry (`/api/v1/projects/:id/compression-metrics`) and the classified event stream (`/api/v1/projects/:id/classifier-stream`) for the frontend inspector.

---

## 2. Shared Contracts & Schemas (`packages/contracts`)

Add the following schemas to `packages/contracts/src/index.ts`:

```typescript
// 1. Classifier Categories
export const ClassifierCategorySchema = z.enum([
  'HARDWARE_SPEC',          // Pinouts, buses, baud rates, voltage (Must keep)
  'ARCHITECTURAL_DECISION', // Human / lead constraints and decisions (Must keep)
  'VALIDATED_OUTCOME',      // Tool passes, fails, patches, regressions (Must keep)
  'EPHEMERAL_NOISE',        // Build scrollbacks, retries, exploratory chatter (Drop)
]);
export type ClassifierCategory = z.infer<typeof ClassifierCategorySchema>;

// 2. Laya Classifier Result
export const LayaClassificationResultSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  timestamp: TimestampSchema,
  rawLengthChars: z.number().int().nonnegative(),
  signalScore: z.number().min(0).max(1), // 0.0 = total noise, 1.0 = vital invariant
  category: ClassifierCategorySchema,
  decision: z.enum(['preserve', 'discard']),
  distilledFact: z.string().optional(),
  sourceActor: z.string(),
  sourceType: z.enum(['user_message', 'assistant_thought', 'tool_output', 'system_message']),
});
export type LayaClassificationResult = z.infer<typeof LayaClassificationResultSchema>;

// 3. Compression & Quality Telemetry
export const CompressionMetricsSchema = z.strictObject({
  projectId: IdSchema,
  totalRawTokens: z.number().int().nonnegative(),
  totalCompressedTokens: z.number().int().nonnegative(),
  compressionRatio: z.number().min(0).max(1), // e.g. 0.976 = 97.6% reduction
  preservedFactsCount: z.number().int().nonnegative(),
  prunedNoiseCount: z.number().int().nonnegative(),
  lastInjectedAt: TimestampSchema.optional(),
});
export type CompressionMetrics = z.infer<typeof CompressionMetricsSchema>;

// 4. OpenAI Chat Completion Envelope (subset required for proxying)
export const ChatCompletionMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.record(z.string(), JsonValueSchema)).optional(),
});
export type ChatCompletionMessage = z.infer<typeof ChatCompletionMessageSchema>;

export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatCompletionMessageSchema),
  temperature: z.number().optional(),
  stream: z.boolean().optional().default(false),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
```

---

## 3. Architecture & Data Flow

```
                      ┌────────────────────────────────────────┐
                      │ External Agent / Harness / VS Code Ext │
                      │ (OpenCode, Claude, Codex, Cursor, etc) │
                      └──────────────────┬─────────────────────┘
                                         │
                 POST /api/v1/chat/completions (header: x-project-id)
                                         ▼
                      ┌────────────────────────────────────────┐
                      │    Core Daemon Proxy (:4317)           │
                      │                                        │
                      │  1. Extract Project ID                 │
                      │  2. Fetch Compressed Context from DB   │
                      │  3. Inject into messages[0] (System)   │
                      └──────────────────┬─────────────────────┘
                                         │
                         Forward (or Mock) to Upstream LLM
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │  Laya Semantic Classifier Pipeline     │
                      │                                        │
                      │  • Stage 1: Deterministic Regex Scrub  │
                      │  • Stage 2: Laya Classifier Model      │
                      │    - Categorize: HARDWARE_SPEC / NOISE │
                      │    - Calculate Signal Score (0.0-1.0)  │
                      └──────────────────┬─────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
          [Signal >= 0.70]                            [Signal < 0.70]
       Store in SQLite as Fact                     Discard Ephemeral Log
     (provenance: observed_tool)                  (Log to Telemetry Counter)
```

---

## 4. REST API Endpoints (`apps/core-daemon`)

### A. `POST /api/v1/chat/completions`
* **Headers:** `Authorization: Bearer <token>`, `x-project-id: <uuid>` (or query param `?projectId=<uuid>`).
* **Behavior:**
  1. Validate incoming payload against `ChatCompletionRequestSchema`.
  2. Query `store.context.getMemory(projectId)` to retrieve active facts and decisions.
  3. Format the injected header:
     ```markdown
     [PROJECT INTELLIGENCE: <projectName> (Compressed Context)]
     • Active Hardware Invariants: MOTOR_EN = GPIO14 (per rover.net:28)
     • Key Decisions: [user_entered] Do not modify PCB schematic; patch firmware header
     • Verified Status: pin_consistency passed (0 active issues)
     ```
  4. If `messages[0].role === 'system'`, prepend the context block. If not, insert a new `system` message at index 0.
  5. If an upstream LLM is configured (e.g. `UPSTREAM_OPENAI_URL`), forward the request.
     *If running in offline / demo mode*, synthesize a contextual response referencing the injected hardware facts.
  6. Pass the user prompt and model response asynchronously through the **Laya Classifier**.
  7. Return standard OpenAI completion JSON.

### B. `GET /api/v1/projects/:id/compression-metrics`
* **Response:**
  ```json
  {
    "projectId": "a50eebbb-ae4d-4f5f-b88f-ee048ba0227e",
    "totalRawTokens": 14250,
    "totalCompressedTokens": 340,
    "compressionRatio": 0.976,
    "preservedFactsCount": 8,
    "prunedNoiseCount": 142,
    "lastInjectedAt": "2026-11-03T18:40:00Z"
  }
  ```

### C. `GET /api/v1/projects/:id/classifier-stream`
* **Query Params:** `limit` (default: 50).
* **Response:** Array of `LayaClassificationResult` records in newest-first order, powering the middle classifier stream panel in the UI.

---

## 5. Laya Classifier Implementation Details

Create `apps/core-daemon/src/classifier/laya-classifier.ts`:

```typescript
export interface ClassifierService {
  classify(input: {
    projectId: string;
    text: string;
    sourceType: 'user_message' | 'assistant_thought' | 'tool_output' | 'system_message';
    actor: string;
  }): Promise<LayaClassificationResult>;
}
```

### Deterministic Pre-Scrub (Stage 1):
* Strip ANSI escape codes (`\u001b\[[0-9;]*m`).
* Strip long hex/base64 blobs (>64 chars without spaces).
* Detect repetitive progress bars (e.g., `[=========>   ] 45%`).
* If output is pure noise (e.g. standard empty tool responses), assign `EPHEMERAL_NOISE` immediately with `signalScore: 0.05` without calling Laya.

### Laya Classifier Prompt (Stage 2):
If local Laya / Ollama model is available (`LAYA_MODEL_URL`):
* Send compact system prompt asking for structured JSON:
  ```json
  {
    "signalScore": 0.95,
    "category": "HARDWARE_SPEC",
    "distilledFact": "MOTOR_EN signal is mapped to GPIO14"
  }
  ```
* **Offline Fallback (Deterministic Rule Engine):**
  If Laya endpoint is unreachable or disabled:
  - Text matching `#define`, `GPIO\d+`, `baud`, `0x[0-9A-Fa-f]+` ➔ `HARDWARE_SPEC` (signal: 0.90).
  - Text matching `decision:`, `constraint:`, `will use`, `do not change` ➔ `ARCHITECTURAL_DECISION` (signal: 0.85).
  - Text matching `validation:`, `passed`, `failed: \d+ findings` ➔ `VALIDATED_OUTCOME` (signal: 0.92).
  - All other verbose logs ➔ `EPHEMERAL_NOISE` (signal: 0.20).

---

## 6. Definition of Done & Test Plan

1. **Unit Test (`apps/core-daemon/src/classifier.test.ts`):**
   - Classifies raw KiCad pin mismatch output as `HARDWARE_SPEC` (signal > 0.85).
   - Classifies verbose `npm install` log as `EPHEMERAL_NOISE` (signal < 0.30).
   - Fallback engine activates cleanly when Laya endpoint is offline.
2. **Integration Test (`apps/core-daemon/src/proxy-api.test.ts`):**
   - Spins up daemon on ephemeral port.
   - Sends `POST /api/v1/chat/completions` with user message *"What is the motor pin?"*.
   - Verifies that outgoing message contains the injected compressed context.
   - Verifies `GET /api/v1/projects/:id/compression-metrics` increments raw and compressed token counters.
   - Verifies `GET /api/v1/projects/:id/classifier-stream` contains the classified records.
3. **Smoke Verification:**
   - Execute test with `curl`:
     ```bash
     curl -s http://127.0.0.1:4317/api/v1/chat/completions \
       -H "Authorization: Bearer $(cat .data/token)" \
       -H "x-project-id: <uuid>" \
       -H "Content-Type: application/json" \
       -d '{"model":"default","messages":[{"role":"user","content":"Status check"}]}'
     ```
