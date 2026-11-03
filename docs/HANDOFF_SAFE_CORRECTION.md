# Developer 3 Handoff — Safe Engineering Correction Workflow

**Universal Developer Intelligence Platform** · Hackathon Milestone: Safe Firmware Correction

This handoff documents the newly implemented, end-to-end safe correction engine and its API/SDK methods for the frontend team (Developer 3).

---

## 1. Overview & Architectural Role

When engineering validation identifies a deterministic circuit-to-firmware discrepancy (such as `MOTOR_EN` on `GPIO14` in `rover.net` vs `GPIO26` in `src/pins.h`), the platform now provides a secure, two-stage **Preview → Explicit Approval & Apply** workflow with automatic revalidation and rollback.

### Key Security Invariants:

- **Zero-Write Preview**: Requesting a correction preview inspects the file, computes a cryptographic content hash (SHA-256), and produces a unified diff without touching the disk.
- **Strict Workspace Bounds**: All target paths are canonicalized (`realpath`) and verified against the registered project workspace. Path traversal (`..`) and symlink escapes are rejected with `400 VALIDATION_ERROR`.
- **Schematic Protection**: Hardware design files (`.net`, `.kicad_sch`, `.sch`, `.pcb`, `.kicad_pcb`, `.brd`) are strictly immutable. Only verified firmware source files (`.h`, `.hpp`, `.ino`, `.c`, `.cpp`) can be targeted.
- **Stale Preview Rejection**: The apply endpoint enforces `expectedOriginalHash`. If the file was edited or modified concurrently after preview generation, apply is rejected with `409 CONFLICT`.
- **Explicit Approval Mandate**: The apply schema requires `userApproved: true`. Without affirmative user approval, no modification occurs.
- **Automatic Rollback Snapshot**: A `.bak` snapshot is created immediately prior to modifying the target line.

---

## 2. API Contracts & Endpoints

All endpoints require `Authorization: Bearer <token>` and are scoped under `/api/v1/projects/:id/corrections`.

### 1. `POST /api/v1/projects/:id/corrections/preview`

- **Request Body**:
  ```json
  {
    "findingId": "61d626eb-26fa-4bae-bbe7-64dc03fb921b"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "ok": true,
    "data": {
      "id": "78a123bc-...",
      "projectId": "...",
      "findingId": "61d626eb-...",
      "targetFile": "src/pins.h",
      "originalHash": "06ea07a7d8d97bb2ee2d2e5ed33b0d33ca93bf29e4fb87ef4a4fc6c55c4b08e6",
      "originalLineNumber": 7,
      "originalLineText": "#define MOTOR_EN GPIO26",
      "proposedLineText": "#define MOTOR_EN GPIO14",
      "diff": "--- a/src/pins.h\n+++ b/src/pins.h\n@@ -7,1 +7,1 @@\n- #define MOTOR_EN GPIO26\n+ #define MOTOR_EN GPIO14",
      "explanation": "Align signal MOTOR_EN with netlist pin GPIO14",
      "generatedAt": "2026-11-03T17:00:00.000Z"
    }
  }
  ```

### 2. `POST /api/v1/projects/:id/corrections/apply`

- **Request Body**:
  ```json
  {
    "previewId": "78a123bc-...",
    "findingId": "61d626eb-...",
    "expectedOriginalHash": "06ea07a7d8d97bb2ee2d2e5ed33b0d33ca93bf29e4fb87ef4a4fc6c55c4b08e6",
    "userApproved": true
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "ok": true,
    "data": {
      "ok": true,
      "projectId": "...",
      "targetFile": "src/pins.h",
      "backupPath": "src/pins.h.bak",
      "revalidationJob": {
        "id": "...",
        "status": "succeeded",
        "exitCode": 0,
        "stdoutTail": "Deterministic validation PASSED: all 3 firmware signals match netlist."
      },
      "revalidationFindings": [],
      "contextRecord": {
        "id": "...",
        "kind": "fact",
        "text": "Applied safe correction to src/pins.h: #define MOTOR_EN GPIO14. Revalidation status: succeeded (0 findings).",
        "provenance": { "sourceKind": "observed_tool", "actor": "safe-correction-engine" }
      },
      "appliedAt": "2026-11-03T17:00:05.000Z"
    }
  }
  ```

### 3. `POST /api/v1/projects/:id/corrections/rollback`

- **Request Body**:
  ```json
  {
    "targetFile": "src/pins.h",
    "backupPath": "src/pins.h.bak"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "ok": true,
    "data": {
      "ok": true,
      "targetFile": "src/pins.h",
      "restoredAt": "2026-11-03T17:00:10.000Z",
      "revalidationJob": { "id": "...", "status": "failed", "exitCode": 1 }
    }
  }
  ```

---

## 3. Typed SDK Methods (`@udi/client-sdk`)

Use the typed methods available directly on `client`:

```ts
import { createClient } from '@udi/client-sdk';

const client = createClient({ baseUrl: 'http://127.0.0.1:4317', token: currentToken });

// 1. Preview correction
const preview = await client.previewCorrection(projectId, {
  findingId: finding.id,
});

// Render preview.diff, preview.originalLineText, preview.proposedLineText in UI

// 2. Apply correction after explicit user confirmation button click
const result = await client.applyCorrection(projectId, {
  previewId: preview.id,
  findingId: finding.id,
  expectedOriginalHash: preview.originalHash,
  userApproved: true, // required by schema
});

// result.revalidationJob has status 'succeeded' with 0 findings
// result.backupPath holds "src/pins.h.bak"

// 3. Rollback if user clicks Undo / Rollback
const rollback = await client.rollbackCorrection(projectId, {
  targetFile: result.targetFile,
  backupPath: result.backupPath,
});
```

---

## 4. UI Integration Guide

### VS Code Extension

- **Code Action / Quick Fix**: When the diagnostic on `src/pins.h` is active, offer a Quick Fix: `Review and Apply Safe Correction`.
- Clicking the Quick Fix can display a diff preview in a side-by-side document or quick-pick preview.
- On user confirmation, calls `client.applyCorrection(...)`.
- Diagnostics clear automatically because the revalidation job returns 0 findings.

### Desktop Control Center (React Dashboard)

- **Validation Run View**: Findings with `suggestedFix` display a **Preview Fix** action.
- Displays the unified diff in a styled code block.
- An explicit **Apply Fix** button with a confirmation checkbox or modal invokes `client.applyCorrection(...)`.
- Success card displays `Revalidation: PASSED (0 active findings)` and provides an `Undo Correction` button invoking `client.rollbackCorrection(...)`.
