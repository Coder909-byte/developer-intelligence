import { useEffect, useRef, useState } from 'react';
import { DaemonClientError, type DaemonClient } from '@udi/client-sdk';
import type {
  CorrectionPreview,
  CorrectionApplyResult,
  Job,
  ValidationFinding,
} from '@udi/contracts';
import { Badge, Button, Card, LogViewer } from '@udi/ui';
import { describeError } from './resource.js';

export const supportsCorrection = (finding: ValidationFinding) =>
  finding.status === 'open' &&
  finding.ruleId === 'pin_consistency' &&
  Boolean(finding.suggestedFix) &&
  finding.evidence.some((e) => /\.(h|hpp|ino|c|cpp)$/.test(e.filePath));

export function SafeCorrection({
  client,
  projectId,
  finding,
  onCancel,
  onStart,
  onJob,
}: {
  client: DaemonClient;
  projectId: string;
  finding: ValidationFinding | undefined;
  onCancel: () => void;
  onStart: () => void;
  onJob: (job: Job) => void;
}) {
  const [preview, setPreview] = useState<CorrectionPreview>();
  const [backup, setBackup] = useState<CorrectionApplyResult>();
  const [approved, setApproved] = useState(false);
  const [undoApproved, setUndoApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  const revision = useRef(0);
  const panel = useRef<HTMLElement>(null);
  function failure(error: unknown) {
    if (error instanceof DaemonClientError && error.code === 'CONFLICT')
      return 'File changed since preview. Review a fresh preview before applying. No automatic retry was made.';
    if (error instanceof DaemonClientError && ['TIMEOUT', 'CONNECTION_ERROR'].includes(error.code))
      return 'Response unavailable. The operation may have completed. Inspect the source and stored activity before retrying; no automatic retry was made.';
    const d = describeError(error);
    return `${d.title}. ${d.message}`;
  }
  async function loadPreview() {
    if (!finding || lock.current) return;
    const request = ++revision.current;
    setBusy(true);
    setError('');
    setPreview(undefined);
    setApproved(false);
    try {
      const data = await client.previewCorrection(projectId, { findingId: finding.id });
      if (data.projectId !== projectId || data.findingId !== finding.id)
        throw new Error('Correction scope mismatch');
      if (request === revision.current) setPreview(data);
    } catch (error) {
      if (request === revision.current) setError(failure(error));
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (finding) {
      void loadPreview();
      panel.current?.scrollIntoView?.({ block: 'nearest' });
    }
    return () => {
      revision.current++;
    };
  }, [finding?.id, client, projectId]);
  async function apply() {
    if (!preview || !approved || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('Applying reviewed correction and revalidating...');
    onStart();
    try {
      const result = await client.applyCorrection(projectId, {
        previewId: preview.id,
        findingId: preview.findingId,
        expectedOriginalHash: preview.originalHash,
        userApproved: true,
      });
      if (
        result.projectId !== projectId ||
        result.revalidationJob.projectId !== projectId ||
        result.targetFile !== preview.targetFile ||
        result.contextRecord.projectId !== projectId ||
        result.revalidationFindings.some(
          (f) => f.projectId !== projectId || f.jobId !== result.revalidationJob.id,
        )
      )
        throw new Error('Correction result scope mismatch');
      setBackup(result);
      setUndoApproved(false);
      setPreview(undefined);
      setApproved(false);
      onCancel();
      onJob(result.revalidationJob);
      setMessage(
        `Correction applied. Revalidation: ${result.revalidationJob.status} (${result.revalidationFindings.filter((f) => f.status === 'open').length} active findings).`,
      );
    } catch (error) {
      setError(failure(error));
      setMessage('');
      setPreview(undefined);
      setApproved(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function undo() {
    if (!backup || !undoApproved || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    onStart();
    setMessage('Restoring the recorded backup...');
    try {
      const result = await client.rollbackCorrection(projectId, {
        targetFile: backup.targetFile,
        backupPath: backup.backupPath,
      });
      if (result.targetFile !== backup.targetFile || result.revalidationJob.projectId !== projectId)
        throw new Error('Rollback scope mismatch');
      setBackup(undefined);
      setUndoApproved(false);
      setPreview(undefined);
      onCancel();
      setMessage(
        `Backup restored. Daemon rollback check: ${result.revalidationJob.status}. Refreshing persisted validation...`,
      );
      // Current daemons persist rollback validation. Older responses require a persisted check.
      if (
        result.revalidationFindings?.some(
          (f) => f.projectId !== projectId || f.jobId !== result.revalidationJob.id,
        )
      )
        throw new Error('Rollback findings scope mismatch');
      const job =
        result.revalidationFindings !== undefined
          ? result.revalidationJob
          : await client.requestValidation(projectId, {
              kind: 'pin_consistency',
              artifactPaths: result.revalidationJob.artifacts,
              requestedBy: 'desktop-rollback-review',
            });
      if (job.projectId !== projectId) throw new Error('Validation scope mismatch');
      onJob(job);
      setMessage(`Backup restored. Updated validation: ${job.status}.`);
    } catch (error) {
      setError(failure(error));
      if (error instanceof DaemonClientError && error.code === 'NOT_FOUND') setBackup(undefined);
    } finally {
      lock.current = false;
      setBusy(false);
      setUndoApproved(false);
    }
  }
  if (!finding && !backup && !message && !error) return null;
  return (
    <section ref={panel} aria-label="Safe engineering correction">
      <Card title="Safe engineering correction">
        {finding && (
          <>
            <p>{finding.message}</p>
            <Badge>Review only until explicitly approved</Badge>
          </>
        )}
        {busy && (
          <p role="status">
            Waiting for the daemon. Do not close or switch workspaces during a write.
          </p>
        )}
        {preview && (
          <>
            <p>
              <code>{preview.targetFile}</code> : line {preview.originalLineNumber}
            </p>
            <p>{preview.explanation}</p>
            <div className="comparison">
              <div>
                <h3>Before correction</h3>
                <LogViewer label="Before correction" text={preview.originalLineText} />
              </div>
              <div>
                <h3>After correction</h3>
                <LogViewer label="After correction" text={preview.proposedLineText} />
              </div>
            </div>
            <LogViewer label="Correction diff" text={preview.diff} />
            <details>
              <summary>Reviewed content hash</summary>
              <code>{preview.originalHash}</code>
            </details>
            <label className="correction-approval">
              <input
                type="checkbox"
                checked={approved}
                disabled={busy}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed this diff and approve changing this firmware file.
            </label>
            <Button
              variant="primary"
              disabled={busy || !approved}
              onClick={() => {
                void apply();
              }}
            >
              Apply Fix
            </Button>
          </>
        )}
        {finding && !preview && !busy && (
          <Button
            onClick={() => {
              void loadPreview();
            }}
          >
            Refresh correction preview
          </Button>
        )}
        {finding && (
          <Button
            disabled={busy}
            onClick={() => {
              setPreview(undefined);
              setError('');
              onCancel();
            }}
          >
            Cancel correction
          </Button>
        )}
        {message && <p role="status">{message}</p>}
        {backup && (
          <div className="notice">
            <p>
              Recorded backup: <code>{backup.backupPath}</code>
            </p>
            <p>
              Undo overwrites the current file with this backup. Review any newer edits first. The
              daemon verifies backup availability when restoring.
            </p>
            <label className="correction-approval">
              <input
                type="checkbox"
                checked={undoApproved}
                disabled={busy}
                onChange={(e) => setUndoApproved(e.target.checked)}
              />
              I approve restoring this backup over the current file.
            </label>
            <Button
              disabled={busy || !undoApproved}
              onClick={() => {
                void undo();
              }}
            >
              Undo Correction
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </Card>
    </section>
  );
}
