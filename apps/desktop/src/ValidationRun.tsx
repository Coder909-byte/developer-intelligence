import { useRef, useState, type FormEvent } from 'react';
import { DaemonClientError, type DaemonClient } from '@udi/client-sdk';
import { ValidationRequestBodySchema, type Job, type ValidationRequestBody } from '@udi/contracts';
import { Button, Dialog, Field, LogViewer } from '@udi/ui';
import { describeError } from './resource.js';
export function relativeArtifactPaths(text: string) {
  const paths = text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  if (
    paths.some(
      (p) =>
        p.startsWith('/') ||
        p.startsWith('\\') ||
        p.includes(':') ||
        p.includes('\0') ||
        p.split(/[\\/]/).includes('..'),
    )
  )
    throw new Error('Use relative workspace paths without parent traversal.');
  return paths;
}
export function ValidationRun({
  client,
  projectId,
  onClose,
  onStart,
  onJob,
}: {
  client: DaemonClient;
  projectId: string;
  onClose: () => void;
  onStart: () => void;
  onJob: (job: Job) => void;
}) {
  const [artifacts, setArtifacts] = useState('');
  const [preview, setPreview] = useState<ValidationRequestBody>();
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  function review(e: FormEvent) {
    e.preventDefault();
    try {
      const parsed = ValidationRequestBodySchema.safeParse({
        kind: 'pin_consistency',
        artifactPaths: relativeArtifactPaths(artifacts),
        requestedBy: 'desktop-user',
      });
      if (!parsed.success) {
        setError(parsed.error.issues.map((i) => i.message).join('. '));
        return;
      }
      setError('');
      setPreview(parsed.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the artifact paths.');
    }
  }
  async function run() {
    if (!preview || busy.current) return;
    busy.current = true;
    setRunning(true);
    setError('');
    onStart();
    try {
      const job = await client.requestValidation(projectId, preview);
      if (job.projectId !== projectId) throw new Error('Job scope mismatch');
      onJob(job);
    } catch (e) {
      if (e instanceof DaemonClientError && e.code === 'TIMEOUT')
        setError(
          'The response timed out. The check may still finish; inspect project activity before retrying.',
        );
      else {
        const d = describeError(e);
        setError(`${d.title}. ${d.message}`);
      }
    } finally {
      busy.current = false;
      setRunning(false);
    }
  }
  return (
    <Dialog title="Run pin consistency validation" onClose={onClose} busy={running}>
      {preview ? (
        <>
          <p>
            This sends the reviewed workspace paths to the daemon's engineering service. It does not
            edit files, flash firmware or control hardware.
          </p>
          <LogViewer
            label="Validation request preview"
            text={JSON.stringify({ projectId, ...preview }, null, 2)}
          />
          <div className="row">
            <Button disabled={running} onClick={() => setPreview(undefined)}>
              Back to edit
            </Button>
            <Button
              variant="primary"
              disabled={running}
              onClick={() => {
                void run();
              }}
            >
              {running ? 'Running check…' : 'Confirm and run validation'}
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={review}>
          <Field
            label="Workspace artifact paths (one per line)"
            hint="Relative paths only. For the bundled rover fixture: rover.net, src/pins.h, engineering-map.json. Use the corrected header explicitly when validating that fixture."
          >
            <textarea
              required
              value={artifacts}
              onChange={(e) => setArtifacts(e.target.value)}
              rows={5}
            />
          </Field>
          <Button type="submit" variant="primary">
            Review validation request
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <p className="muted">
        The returned job becomes the selected validation scope. No automatic retry is made if the
        request fails.
      </p>
    </Dialog>
  );
}
