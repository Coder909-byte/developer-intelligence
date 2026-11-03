import { useEffect, useState, useRef, type FormEvent } from 'react';
import type { DaemonClient } from '@udi/client-sdk';
import { IdSchema, type PageOptions } from '@udi/contracts';
import { Badge, Button, Field } from '@udi/ui';
import { describeError } from './resource.js';
export async function readJobFindings(
  client: DaemonClient,
  projectId: string,
  jobId: string,
  options: PageOptions = { limit: 100, offset: 0 },
) {
  const job = await client.getJob(projectId, jobId);
  if (job.projectId !== projectId || job.id !== jobId) throw new Error('Job scope mismatch');
  const { items } = await client.listFindings(projectId, { ...options, jobId });
  if (items.some((f) => f.projectId !== projectId || f.jobId !== jobId))
    throw new Error('Findings do not belong to the selected job');
  return { job, items };
}
export function JobPicker({
  client,
  projectId,
  jobId,
  onSelect,
}: {
  client: DaemonClient;
  projectId: string;
  jobId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const [value, setValue] = useState(jobId ?? '');
  useEffect(() => {
    if (jobId) setValue(jobId);
  }, [jobId]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const parsed = IdSchema.safeParse(value.trim());
    if (!parsed.success) {
      setError('Enter a validation job UUID.');
      return;
    }
    busy.current = true;
    setLoading(true);
    setError('');
    onSelect(undefined);
    try {
      const job = await client.getJob(projectId, parsed.data);
      if (job.projectId !== projectId || job.id !== parsed.data) throw new Error('Scope mismatch');
      if (alive.current) onSelect(job.id);
    } catch (e) {
      const d = describeError(e);
      if (alive.current) setError(`${d.title}. ${d.message}`);
    } finally {
      busy.current = false;
      if (alive.current) setLoading(false);
    }
  }
  return (
    <>
      <form
        className="row"
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <Field
          label="Validation job UUID"
          hint="Use a recorded job ID from your validation adapter or event. Automatic latest-job discovery is not available."
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Select a recorded validation job"
          />
        </Field>
        <Button type="submit" disabled={loading}>
          {loading ? 'Loading job…' : 'Select validation job'}
        </Button>
        {jobId && (
          <Button
            disabled={loading}
            type="button"
            onClick={() => {
              setValue('');
              onSelect(undefined);
            }}
          >
            Clear job selection
          </Button>
        )}
      </form>
      {jobId && <Badge>Selected job: {jobId}</Badge>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </>
  );
}
