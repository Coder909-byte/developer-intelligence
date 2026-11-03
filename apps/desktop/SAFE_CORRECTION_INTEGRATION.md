# Frontend safe correction integration

Preserves all six retro screens and existing SDK integrations. Safe correction uses only the shared client SDK; no correction engine or backend interfaces were changed.

## User flow

1. Select a validation job in Engineering. Open pin-consistency findings with firmware evidence and a suggested fix offer **Preview Fix**. Historical findings do not offer writes.
2. Preview calls `previewCorrection`, verifies project/finding scope, and displays target file, line, explanation, before/after, unified diff and original hash. Preview does not write.
3. The user must check the approval checkbox before **Apply Fix** enables. The SDK sends the reviewed preview ID, finding ID, original hash and `userApproved: true`. Duplicate clicks are guarded; writes are never retried automatically.
4. While applying, old current-job findings are cleared. Only the verified returned revalidation job becomes selected; its persisted findings/logs load automatically. Failed revalidation is reported as failed, never converted into success.
5. The returned backup enables a separately approved **Undo Correction**. The UI explains that restoring overwrites current edits. Backend validation checks backup availability at restore time; missing backups are reported honestly. Backup controls are session-scoped, not a durable backup browser.
6. Native VS Code polls actual daemon completion observations every five seconds and follows new verified job scopes. Corrections made in desktop therefore clear old diagnostics without a manual job switch. Manual historical selection remains usable until another completion event arrives. Disposing the extension clears the timer.

Conflicts discard the stale preview and require a fresh review. Timeout/disconnection warns that the operation may already have completed and directs the user to inspect source/activity. The UI never retries a potentially completed write automatically. Errors for authentication, unavailable services and missing records remain explicit.

## Actual runtime verification

Used a separate ignored database and copied rover workspace at `.data/frontend-safe-correction-qa`; repository example sources were not edited.

- Initial actual validation `b37ed5ab-3a04-4255-b303-785517171a0e`: failed, one GPIO mismatch, diagnostics in two evidence files.
- Browser preview: `#define MOTOR_EN GPIO26` to `#define MOTOR_EN GPIO14`; original file remained unchanged until checkbox approval and Apply Fix.
- Browser apply: job `66bec893-863b-4209-92a7-fcaba03c639d` succeeded, zero findings; backup created; actual source read confirmed GPIO14.
- Compiled extension with mocked VS Code APIs and real daemon HTTP automatically followed that event: zero diagnostic files.
- Browser Undo: original GPIO26 content restored. Refreshed persisted validation `0f45835e-e02e-4938-9273-c15fd9b84621` failed with the expected mismatch; native polling restored diagnostics in two files.
- React integration tests start the actual daemon HTTP app with SQLite and real correction/validator services. They verify no-write preview, required approval, apply, backup bytes, persisted empty findings, approved rollback, restored source/findings, stale-hash conflict and auth failure. These tests do not stub correction success.

Frontend integration verification from the repository root:

```sh
pnpm exec vitest run apps/desktop/src/SafeCorrection.test.ts apps/vscode-extension/src/completion-events.test.ts apps/vscode-extension/src/extension.test.ts
```

## Backend integration gap for Developer 1/2

The rollback route currently returns an actual revalidation job and appends a `engineering.correction.rolled_back` event, but does not persist that job or its findings. To display real persisted findings immediately, the frontend follows successful rollback with the existing `requestValidation` endpoint using the returned job's artifact paths. This executes a second real check; it is not snapshot ingestion or manufactured data. If the check fails, the file-restored message remains visible, no current job is claimed, and the error is shown.

Recommended backend follow-up: atomically persist rollback revalidation job/findings, so the event sourceRef always resolves and an extra validation is unnecessary. No backend/SDK changes were made here. Current native polling can briefly show an unavailable rollback job until the following persisted check completes.

Actual VS Code Extension Host and native Tauri packaging limitations remain as previously documented. All correction browser writes were restricted to the isolated QA copy. Preview/apply/undo screenshots are supplied in the Codex outputs directory.

## Local verification environment

Root typecheck and lint passed. The full Windows run had 149 passing of 154 tests: three existing backend assertions assume POSIX slash paths and two symlink tests cannot create file symlinks in this sandbox. Backend tests/business logic were not changed to hide those failures. Frontend tests and the actual daemon correction flow pass; Linux CI is the full-suite merge gate.
