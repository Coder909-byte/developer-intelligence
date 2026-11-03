import { useState, useRef, type FormEvent } from 'react';
import type { DaemonClient } from '@udi/client-sdk';
import {
  HandoffCreateSchema,
  ContextRecordCreateSchema,
  McpServerCreateSchema,
  McpServerUpdateSchema,
  type AgentHandoff,
  type HandoffCreate,
  type McpServer,
} from '@udi/contracts';
import {
  ActivityTimeline,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  LogViewer,
  sourceLabel,
} from '@udi/ui';
import { Result, useResource } from './data.js';
import { describeError } from './resource.js';
export function scoped<T extends { projectId: string }>(items: T[], projectId: string) {
  if (items.some((item) => item.projectId !== projectId)) throw new Error('Project scope mismatch');
  return items;
}
export function usePage() {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  return {
    offset,
    revision,
    options: { limit: 50, offset },
    previous: () => setOffset((o) => Math.max(0, o - 50)),
    next: () => setOffset((o) => o + 50),
    reset: () => setOffset(0),
    refresh: () => setRevision((r) => r + 1),
  };
}
export function PageControls({ page, count }: { page: ReturnType<typeof usePage>; count: number }) {
  return (
    <div className="row pagination">
      <Button disabled={page.offset === 0} onClick={page.previous}>
        Previous page
      </Button>
      <small>
        {count} records · offset {page.offset} · oldest first
      </small>
      <Button disabled={count < 50 || page.offset >= 1000000} onClick={page.next}>
        Next page
      </Button>
    </div>
  );
}
function failure(error: unknown) {
  const d = describeError(error);
  return `${d.title}. ${d.message}`;
}
export async function latestHandoff(client: DaemonClient, projectId: string) {
  let latest: AgentHandoff | undefined;
  for (let offset = 0; offset <= 1000000; offset += 500) {
    const { items } = await client.listHandoffs(projectId, { limit: 500, offset });
    scoped(items, projectId);
    latest = items.at(-1) ?? latest;
    if (items.length < 500) return latest;
  }
  throw new Error('Handoff history exceeds pagination range');
}
export function StoredEvents({ client, projectId }: { client: DaemonClient; projectId: string }) {
  const page = usePage();
  const [type, setType] = useState('');
  const [draft, setDraft] = useState('');
  const events = useResource(async () => {
    const data = await client.listEvents(projectId, { ...page.options, ...(type ? { type } : {}) });
    scoped(data.items, projectId);
    return data;
  }, [client, projectId, page.offset, page.revision, type]);
  return (
    <Card
      title="Project activity"
      action={<Button onClick={events.retry}>Refresh activity</Button>}
    >
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          page.reset();
          setType(draft.trim());
        }}
      >
        <Field label="Exact event type">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="All event types"
          />
        </Field>
        <Button type="submit">Filter events</Button>
      </form>
      <Result value={events}>
        {(data) => (
          <>
            {data.items.length ? (
              <ol className="timeline">
                {data.items.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                    <div>
                      <h3>{event.type}</h3>
                      <small>
                        {sourceLabel(event.sourceKind)} · {event.actor}
                      </small>
                      {event.sourceRef && <code>{event.sourceRef}</code>}
                      <details>
                        <summary>Inspect stored event payload</summary>
                        <LogViewer
                          label="Stored event payload"
                          text={JSON.stringify(event.payload, null, 2)}
                        />
                      </details>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No stored activity">
                No events were returned for this page and filter.
              </EmptyState>
            )}
            <PageControls page={page} count={data.items.length} />
          </>
        )}
      </Result>
    </Card>
  );
}
export function StoredRecords({ client, projectId }: { client: DaemonClient; projectId: string }) {
  const page = usePage();
  const [add, setAdd] = useState(false);
  const [message, setMessage] = useState('');
  const records = useResource(async () => {
    const data = await client.listContextRecords(projectId, page.options);
    scoped(data.items, projectId);
    return data;
  }, [client, projectId, page.offset, page.revision]);
  async function copy() {
    try {
      const memory = await client.getContext(projectId, 500);
      if (memory.projectId !== projectId) throw new Error('Scope');
      scoped(memory.records, projectId);
      await navigator.clipboard.writeText(JSON.stringify(memory, null, 2));
      setMessage('Stored context copied (bounded to 500 records).');
    } catch (e) {
      setMessage(failure(e));
    }
  }
  return (
    <Card
      title="Project Memory"
      action={<Button onClick={records.retry}>Retrieve latest context</Button>}
    >
      <div className="row">
        <Button onClick={() => setAdd(true)}>Record decision</Button>
        <Button
          onClick={() => {
            void copy();
          }}
        >
          Copy structured context
        </Button>
        <Badge>Stored records · original provenance</Badge>
      </div>
      <p role="status">{message}</p>
      <Result value={records}>
        {(data) => (
          <>
            <ActivityTimeline records={data.items} />
            <PageControls page={page} count={data.items.length} />
          </>
        )}
      </Result>
      {add && (
        <DecisionForm
          client={client}
          projectId={projectId}
          onClose={() => setAdd(false)}
          onSaved={() => {
            setAdd(false);
            page.refresh();
            setMessage('Decision saved to the daemon.');
          }}
        />
      )}
    </Card>
  );
}
function DecisionForm({
  client,
  projectId,
  onClose,
  onSaved,
}: {
  client: DaemonClient;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const parsed = ContextRecordCreateSchema.safeParse({
      kind: 'decision',
      text: text.trim(),
      provenance: { sourceKind: 'user_entered', actor: 'desktop-user' },
      evidence: [],
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('. '));
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      await client.createContextRecord(projectId, parsed.data);
      onSaved();
    } catch (e) {
      setError(failure(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog title="Record project decision" onClose={onClose}>
      <form
        onSubmit={(e) => {
          void save(e);
        }}
      >
        <Field
          label="Decision"
          hint="Saved as user-entered context, never as an observed tool result."
        >
          <textarea required value={text} onChange={(e) => setText(e.target.value)} rows={4} />
        </Field>
        {error && <p role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save decision'}
        </Button>
      </form>
    </Dialog>
  );
}
export function Handoffs({ client, projectId }: { client: DaemonClient; projectId: string }) {
  const page = usePage();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [latest, setLatest] = useState(false);
  const [message, setMessage] = useState('');
  const list = useResource(async () => {
    const data = await client.listHandoffs(projectId, page.options);
    scoped(data.items, projectId);
    return data;
  }, [client, projectId, page.offset, page.revision]);
  return (
    <Card title="Agent handoffs" action={<Button onClick={list.retry}>Refresh handoffs</Button>}>
      <div className="row">
        <Button variant="primary" onClick={() => setCreating(true)}>
          Create handoff
        </Button>
        <Button onClick={() => setLatest(true)}>Retrieve latest handoff</Button>
      </div>
      <p role="status">{message}</p>
      <Result value={list}>
        {(data) => (
          <>
            {data.items.length ? (
              <div className="finding-list">
                {data.items.map((h) => (
                  <button className="finding-row" key={h.id} onClick={() => setSelected(h.id)}>
                    <span>
                      <strong>{h.summary}</strong>
                      <small>
                        {new Date(h.createdAt).toLocaleString()} ·{' '}
                        {sourceLabel(h.provenance.sourceKind)} · {h.recordIds.length} referenced
                        records
                      </small>
                    </span>
                    <span>Review →</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="No stored handoffs">
                Create a reviewed handoff referencing this project's context records.
              </EmptyState>
            )}
            <PageControls page={page} count={data.items.length} />
          </>
        )}
      </Result>
      {creating && (
        <CreateHandoff
          client={client}
          projectId={projectId}
          onClose={() => setCreating(false)}
          onSaved={(h) => {
            setCreating(false);
            page.refresh();
            setMessage(`Handoff saved: ${h.id}`);
          }}
        />
      )}
      {selected && (
        <HandoffDetail
          client={client}
          projectId={projectId}
          handoffId={selected}
          onClose={() => setSelected(undefined)}
        />
      )}
      {latest && (
        <LatestHandoff client={client} projectId={projectId} onClose={() => setLatest(false)} />
      )}
    </Card>
  );
}
function HandoffContent({ handoff }: { handoff: AgentHandoff }) {
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(handoff, null, 2));
      setMessage('Saved handoff copied.');
    } catch {
      setMessage('Clipboard unavailable. Select the JSON below to copy manually.');
    }
  }
  return (
    <>
      <Badge>{sourceLabel(handoff.provenance.sourceKind)}</Badge>
      <h3>{handoff.summary}</h3>
      <p className="muted">
        {handoff.provenance.actor} · {new Date(handoff.createdAt).toLocaleString()}
      </p>
      <h4>Next steps</h4>
      <ul>
        {handoff.nextSteps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <details>
        <summary>Structured saved handoff</summary>
        <LogViewer text={JSON.stringify(handoff, null, 2)} label="Saved handoff JSON" />
      </details>
      <Button
        onClick={() => {
          void copy();
        }}
      >
        Copy structured handoff
      </Button>
      <p role="status">{message}</p>
    </>
  );
}
function HandoffDetail({
  client,
  projectId,
  handoffId,
  onClose,
}: {
  client: DaemonClient;
  projectId: string;
  handoffId: string;
  onClose: () => void;
}) {
  const handoff = useResource(async () => {
    const h = await client.getHandoff(projectId, handoffId);
    scoped([h], projectId);
    return h;
  }, [client, projectId, handoffId]);
  return (
    <Dialog title="Review saved handoff" onClose={onClose}>
      <Result value={handoff}>{(h) => <HandoffContent handoff={h} />}</Result>
    </Dialog>
  );
}
function LatestHandoff({
  client,
  projectId,
  onClose,
}: {
  client: DaemonClient;
  projectId: string;
  onClose: () => void;
}) {
  const latest = useResource(() => latestHandoff(client, projectId), [client, projectId]);
  return (
    <Dialog title="Latest stored handoff" onClose={onClose}>
      <p className="muted">
        History is paged in timestamp/ID order. Writes during retrieval may change this view.
      </p>
      <Result value={latest}>
        {(h) =>
          h ? (
            <HandoffContent handoff={h} />
          ) : (
            <EmptyState title="No stored handoffs">
              Nothing has been saved for this project.
            </EmptyState>
          )
        }
      </Result>
    </Dialog>
  );
}
export function CreateHandoff({
  client,
  projectId,
  onClose,
  onSaved,
}: {
  client: DaemonClient;
  projectId: string;
  onClose: () => void;
  onSaved: (h: AgentHandoff) => void;
}) {
  const page = usePage();
  const records = useResource(async () => {
    const data = await client.listContextRecords(projectId, page.options);
    scoped(data.items, projectId);
    return data;
  }, [client, projectId, page.offset]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState('');
  const [steps, setSteps] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<HandoffCreate>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  function review(e: FormEvent) {
    e.preventDefault();
    const parsed = HandoffCreateSchema.safeParse({
      fromAgentId: from.trim(),
      ...(to.trim() ? { toAgentId: to.trim() } : {}),
      summary: summary.trim(),
      recordIds: ids,
      nextSteps: steps
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      provenance: { sourceKind: 'user_entered', actor: 'desktop-user' },
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('. '));
      return;
    }
    setError('');
    setPreview(parsed.data);
  }
  async function save() {
    if (!preview || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const h = await client.createHandoff(projectId, preview);
      scoped([h], projectId);
      onSaved(h);
    } catch (e) {
      setError(failure(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog title="Create project handoff" onClose={onClose}>
      {preview ? (
        <>
          <p>
            Review this exact project-scoped payload before saving. Agent IDs identify external
            agents; they do not imply live connections.
          </p>
          <LogViewer
            text={JSON.stringify({ projectId, ...preview }, null, 2)}
            label="Handoff approval preview"
          />
          <div className="row">
            <Button disabled={saving} onClick={() => setPreview(undefined)}>
              Back to edit
            </Button>
            <Button
              disabled={saving}
              variant="primary"
              onClick={() => {
                void save();
              }}
            >
              {saving ? 'Saving…' : 'Confirm and save handoff'}
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            void review(e);
          }}
        >
          <Field
            label="From agent UUID"
            hint="Use the external agent identity agreed by your team."
          >
            <input required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To agent UUID (optional)">
            <input value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Handoff summary">
            <textarea
              required
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
            />
          </Field>
          <Field label="Next steps (one per line)">
            <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={3} />
          </Field>
          <h3>Choose stored context records</h3>
          <small>Selected references: {ids.length}. Only this project's records are offered.</small>
          <Result value={records}>
            {(data) => (
              <>
                {data.items.map((r) => (
                  <label className="record-choice" key={r.id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(r.id)}
                      onChange={(e) =>
                        setIds((v) =>
                          e.target.checked ? [...v, r.id] : v.filter((id) => id !== r.id),
                        )
                      }
                    />
                    <span>
                      {r.text}
                      <small>
                        {sourceLabel(r.provenance.sourceKind)} · {r.id}
                      </small>
                    </span>
                  </label>
                ))}
                {!data.items.length && <p>No context records on this page.</p>}
                <PageControls page={page} count={data.items.length} />
              </>
            )}
          </Result>
          <Button type="submit" variant="primary">
            Review handoff
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </Dialog>
  );
}
export function StoredJob({
  client,
  projectId,
  jobId,
}: {
  client: DaemonClient;
  projectId: string;
  jobId: string;
}) {
  const job = useResource(async () => {
    const j = await client.getJob(projectId, jobId);
    scoped([j], projectId);
    if (j.id !== jobId) throw new Error('Job mismatch');
    return j;
  }, [client, projectId, jobId]);
  return (
    <details>
      <summary>Inspect stored job and logs</summary>
      <Result value={job}>
        {(j) => (
          <>
            <div className="row">
              <Badge>{j.status}</Badge>
              <small>Exit code: {j.exitCode ?? 'not recorded'}</small>
            </div>
            <p className="muted">
              Completed: {j.completedAt ? new Date(j.completedAt).toLocaleString() : 'not recorded'}
              . Stored adapter output does not prove the daemon executed this tool.
            </p>
            <LogViewer label="Stored stdout" text={j.stdoutTail} />
            <LogViewer label="Stored stderr" text={j.stderrTail} />
            {j.artifacts.map((a, i) => (
              <code className="artifact" key={i}>
                {a}
              </code>
            ))}
          </>
        )}
      </Result>
    </details>
  );
}
export function RegistryControls({
  client,
  servers,
  onChanged,
}: {
  client: DaemonClient;
  servers?: McpServer[];
  onChanged: () => void;
}) {
  const [edit, setEdit] = useState<McpServer | true>();
  const [remove, setRemove] = useState<McpServer>();
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<string>();
  async function probe(server: McpServer) {
    if (checking) return;
    setChecking(server.id);
    try {
      const result = await client.checkMcpServerHealth(server.id);
      if (result.id !== server.id) throw new Error('Server mismatch');
      setMessage(
        `Daemon transport probe: ${result.status}. This does not establish MCP tool compatibility.`,
      );
      onChanged();
    } catch (e) {
      setMessage(failure(e));
    } finally {
      setChecking(undefined);
    }
  }
  async function deleteServer() {
    if (!remove || saving) return;
    setSaving(true);
    try {
      await client.deleteMcpServer(remove.id);
      setRemove(undefined);
      setMessage('Inventory record removed. No server process was controlled.');
      onChanged();
    } catch (e) {
      setMessage(failure(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="row">
        {servers ? (
          servers.map((s) => (
            <div className="row" key={s.id}>
              <small>{s.name}</small>
              <Button onClick={() => setEdit(s)}>Configure inventory</Button>
              <Button
                disabled={!s.enabled || Boolean(checking)}
                onClick={() => {
                  void probe(s);
                }}
                title={
                  s.enabled
                    ? 'Probe the configured transport via the daemon'
                    : 'Enable the inventory record before probing'
                }
              >
                {checking === s.id ? 'Probing…' : 'Probe connection'}
              </Button>
              <Button onClick={() => setRemove(s)}>Remove record</Button>
            </div>
          ))
        ) : (
          <Button onClick={() => setEdit(true)}>Add MCP</Button>
        )}
      </div>
      <p role="status">{message}</p>
      {edit && (
        <McpForm
          client={client}
          existing={edit === true ? undefined : edit}
          onClose={() => setEdit(undefined)}
          onSaved={() => {
            setEdit(undefined);
            setMessage('Inventory configuration saved. Connection status is unverified.');
            onChanged();
          }}
        />
      )}
      {remove && (
        <Dialog title="Remove MCP inventory record" onClose={() => setRemove(undefined)}>
          <p>
            Remove {remove.name} from stored inventory? This does not stop a running server or edit
            host configuration.
          </p>
          <Button
            disabled={saving}
            onClick={() => {
              void deleteServer();
            }}
          >
            Confirm removal
          </Button>
        </Dialog>
      )}
    </>
  );
}
function McpForm({
  client,
  existing,
  onClose,
  onSaved,
}: {
  client: DaemonClient;
  existing: McpServer | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [transport, setTransport] = useState(existing?.transport.type ?? 'stdio');
  const [endpoint, setEndpoint] = useState(
    existing?.transport.type === 'http'
      ? existing.transport.url
      : (existing?.transport.executableId ?? ''),
  );
  const [args, setArgs] = useState(
    existing?.transport.type === 'stdio' ? existing.transport.args.join('\n') : '',
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const input = {
      name: name.trim(),
      transport:
        transport === 'http'
          ? { type: 'http' as const, url: endpoint.trim() }
          : {
              type: 'stdio' as const,
              executableId: endpoint.trim(),
              args: args.split('\n').filter(Boolean),
            },
      enabled,
      ...(existing?.secretRef ? { secretRef: existing.secretRef } : {}),
    };
    const parsed = existing
      ? McpServerUpdateSchema.safeParse({ ...input, status: enabled ? 'unknown' : 'disabled' })
      : McpServerCreateSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('. '));
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      if (existing)
        await client.replaceMcpServer(existing.id, McpServerUpdateSchema.parse(parsed.data));
      else await client.createMcpServer(McpServerCreateSchema.parse(parsed.data));
      onSaved();
    } catch (e) {
      setError(failure(e));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog title={existing ? 'Configure stored MCP' : 'Register MCP inventory'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          void save(e);
        }}
      >
        <Field label="Server name">
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Transport">
          <select
            value={transport}
            onChange={(e) => {
              setTransport(e.target.value as 'http' | 'stdio');
              setEndpoint('');
              setArgs('');
            }}
          >
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
          </select>
        </Field>
        <Field label={transport === 'http' ? 'Server URL' : 'Allowlisted executable ID'}>
          <input required value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
        </Field>
        {transport === 'stdio' && (
          <Field label="Arguments (one per line)">
            <textarea value={args} onChange={(e) => setArgs(e.target.value)} />
          </Field>
        )}
        <label className="record-choice">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled in inventory
        </label>
        <p className="muted">
          Saving does not execute or test a server. Configuration changes reset status to
          unknown/disabled. Existing secret references are preserved without displaying credentials.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button disabled={saving} type="submit" variant="primary">
          {saving ? 'Saving…' : 'Save inventory'}
        </Button>
      </form>
    </Dialog>
  );
}
