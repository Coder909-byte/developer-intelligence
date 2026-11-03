import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createClient, type DaemonClient } from '@udi/client-sdk';
import {
  ProjectCreateSchema,
  type Project,
  type McpServer,
  type ValidationFinding,
} from '@udi/contracts';
import {
  ActivityTimeline,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FindingDetailPanel,
  NavigationIcon,
} from '@udi/ui';
import { describeError } from './resource.js';
import { JobPicker, readJobFindings } from './validation.js';
import { useResource, Result, ConnectionReporter } from './data.js';
import {
  StoredRecords,
  StoredEvents,
  Handoffs,
  StoredJob,
  RegistryControls,
  PageControls,
  usePage,
  scoped,
} from './persistence.js';
import { IntegrationGuide } from './IntegrationGuide.js';
export const screens = [
  'Overview',
  'Agent Workspace',
  'MCP Hub',
  'Engineering',
  'Devices',
  'Settings',
] as const;
type Screen = (typeof screens)[number];
function Unavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <EmptyState title={title}>
      <p>{reason}</p>
      <Badge tone="warning">Unavailable</Badge>
    </EmptyState>
  );
}
function Context({ client, project }: { client: DaemonClient; project: Project }) {
  const [tab, setTab] = useState('Project Memory');
  return (
    <>
      <Tabs
        tabs={['Connected Agents', 'Project Memory', 'Context Timeline', 'Agent Handoffs']}
        selected={tab}
        onSelect={setTab}
      />
      {tab === 'Connected Agents' ? (
        <Card title="Connected agents">
          <Unavailable
            title="Agent discovery unavailable"
            reason="Agent IDs in handoffs are external UUIDs. The daemon does not expose live agent registrations."
          />
        </Card>
      ) : tab === 'Agent Handoffs' ? (
        <Handoffs client={client} projectId={project.id} />
      ) : tab === 'Context Timeline' ? (
        <StoredEvents client={client} projectId={project.id} />
      ) : (
        <StoredRecords client={client} projectId={project.id} />
      )}
    </>
  );
}
export function McpList({ items }: { items: McpServer[] }) {
  const [selected, setSelected] = useState<McpServer>();
  if (!items.length)
    return (
      <EmptyState title="No registered servers">
        Servers registered with the daemon will appear here.
      </EmptyState>
    );
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Server</th>
              <th>Transport</th>
              <th>Status</th>
              <th>Configuration</th>
            </tr>
          </thead>
          <tbody>
            {items.map((server) => (
              <tr key={server.id}>
                <td>{server.name}</td>
                <td>{server.transport.type}</td>
                <td>
                  <Badge
                    tone={
                      server.status === 'healthy'
                        ? 'good'
                        : server.status === 'unreachable'
                          ? 'error'
                          : 'neutral'
                    }
                  >
                    {server.status}
                  </Badge>
                </td>
                <td>
                  <Button onClick={() => setSelected(server)}>View details</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <Dialog title={selected.name} onClose={() => setSelected(undefined)}>
          <Badge>{selected.enabled ? 'Enabled' : 'Disabled'}</Badge>
          <pre>{JSON.stringify(selected.transport, null, 2)}</pre>
          <p>Tools, supported hosts and permission details are not exposed by this SDK.</p>
          <p className="muted">Credentials and secret references are not displayed.</p>
        </Dialog>
      )}
    </>
  );
}
function Mcp({ client }: { client: DaemonClient }) {
  const page = usePage();
  const servers = useResource(
    () => client.listMcpServers(page.options),
    [client, page.offset, page.revision],
  );
  return (
    <>
      <div className="notice">
        Stored inventory is available independently of MCP execution. Recorded status is not a fresh
        connection test.
      </div>
      <Card
        title="MCP registry"
        action={<Button onClick={servers.retry}>Refresh inventory</Button>}
      >
        <RegistryControls client={client} onChanged={page.refresh} />
        <Result value={servers}>
          {(data) => (
            <>
              <McpList items={data.items} />
              <RegistryControls client={client} servers={data.items} onChanged={page.refresh} />
              <PageControls page={page} count={data.items.length} />
            </>
          )}
        </Result>
        <p className="muted">
          MCP health checks and host configuration execution remain unavailable. Inventory changes
          do not execute servers.
        </p>
      </Card>
    </>
  );
}
export function Findings({ items, client }: { items: ValidationFinding[]; client?: DaemonClient }) {
  const [selected, setSelected] = useState<ValidationFinding>();
  if (!items.length)
    return (
      <EmptyState title="No recorded findings">
        An empty findings list does not establish that validation has passed.
      </EmptyState>
    );
  return (
    <>
      <div className="finding-list">
        {items.map((f) => (
          <button key={f.id} className="finding-row" onClick={() => setSelected(f)}>
            <Badge
              tone={
                f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'neutral'
              }
            >
              {f.severity}
            </Badge>
            <span>
              <strong>{f.message}</strong>
              <small>
                {f.ruleId} · Job {f.jobId} · {f.evidence[0]?.filePath}
              </small>
            </span>
            <span>View evidence →</span>
          </button>
        ))}
      </div>
      {selected && (
        <Dialog title="Engineering finding" onClose={() => setSelected(undefined)}>
          <FindingDetailPanel finding={selected} />
          {client && (
            <StoredJob client={client} projectId={selected.projectId} jobId={selected.jobId} />
          )}
          <p className="muted">
            Open evidence in the VS Code extension. Desktop source navigation and patch approval are
            not exposed by this SDK.
          </p>
          <Button disabled>Propose correction</Button>
        </Dialog>
      )}
    </>
  );
}
function Engineering({
  client,
  project,
  jobId,
  onJobSelect,
}: {
  client: DaemonClient;
  project: Project;
  jobId: string | undefined;
  onJobSelect: (id: string | undefined) => void;
}) {
  const page = usePage();
  const [mode, setMode] = useState('Selected job');
  const findings = useResource(
    async () => {
      if (mode === 'History') {
        const data = await client.listFindings(project.id, page.options);
        scoped(data.items, project.id);
        return { items: data.items, job: undefined };
      }
      return jobId ? readJobFindings(client, project.id, jobId, page.options) : undefined;
    },
    [client, project.id, jobId, mode, page.offset, page.revision],
    mode === 'History' || Boolean(jobId),
  );
  return (
    <>
      <Card title="Validation job scope">
        <JobPicker
          client={client}
          projectId={project.id}
          jobId={jobId}
          onSelect={(id) => {
            page.reset();
            onJobSelect(id);
          }}
        />
        <p className="muted">
          Only the selected job contributes to its findings view. Historical records are not
          evidence of a current failure.
        </p>
      </Card>
      <Tabs
        tabs={['Selected job', 'History']}
        selected={mode}
        onSelect={(m) => {
          page.reset();
          setMode(m);
        }}
      />
      <Card
        title={
          mode === 'History' ? 'Historical findings  |  all stored jobs' : 'Selected job findings'
        }
        action={<Button onClick={findings.retry}>Refresh findings</Button>}
      >
        <Result value={findings}>
          {(data) =>
            data ? (
              <>
                {mode === 'History' ? (
                  <div className="notice">
                    Historical records across jobs. These are not the current validation result.
                  </div>
                ) : (
                  <div className="row">
                    <Badge>Job {data.job?.id}</Badge>
                    <Badge>Stored status: {data.job?.status}</Badge>
                    <small>Persisted adapter result; not proof of live execution.</small>
                  </div>
                )}
                <Findings
                  key={`${mode}:${jobId ?? ''}:${page.offset}`}
                  items={data.items}
                  client={client}
                />
                <PageControls page={page} count={data.items.length} />
                {mode !== 'History' && jobId && (
                  <StoredJob client={client} projectId={project.id} jobId={jobId} />
                )}
              </>
            ) : (
              <EmptyState title="No validation job selected">
                Select a recorded job UUID above. Old findings remain available under History.
              </EmptyState>
            )
          }
        </Result>
      </Card>
      <Card title="Validation execution">
        <Unavailable
          title="Execution is not available yet"
          reason="The validation submission endpoint remains unimplemented. You can inspect persisted job results without claiming that a new check ran."
        />
        <Button disabled>Run validation</Button>
        <p className="muted">
          Configuration checks do not verify physical wiring or electrical safety.
        </p>
      </Card>
    </>
  );
}
function Tabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: string[];
  selected: string;
  onSelect: (s: string) => void;
}) {
  return (
    <nav className="tabs" aria-label="Workspace sections">
      {tabs.map((t) => (
        <Button
          key={t}
          variant="quiet"
          aria-current={t === selected ? 'page' : undefined}
          onClick={() => onSelect(t)}
        >
          {t}
        </Button>
      ))}
    </nav>
  );
}
function Overview({
  client,
  project,
  navigate,
  jobId,
}: {
  client: DaemonClient;
  project: Project;
  navigate: (s: Screen) => void;
  jobId: string | undefined;
}) {
  const context = useResource(() => client.getContext(project.id, 100), [client, project.id]);
  const findings = useResource(
    () =>
      jobId
        ? readJobFindings(client, project.id, jobId, { limit: 100, offset: 0 })
        : Promise.resolve(undefined),
    [client, project.id, jobId],
    Boolean(jobId),
  );
  const mcp = useResource(() => client.listMcpServers({ limit: 100, offset: 0 }), [client]);
  return (
    <>
      <Card title="Active project">
        <h3>{project.name}</h3>
        <code>{project.rootPath}</code>
        <p className="muted">{project.description || 'No project description provided.'}</p>
      </Card>
      <div className="summary-grid">
        <Card title="MCP servers">
          <Result value={mcp}>
            {(d) => (
              <>
                <strong className="metric">{d.items.length}</strong>
                <p className="muted">
                  Loaded registry records (first 100) ·{' '}
                  <button className="text-button" onClick={() => navigate('MCP Hub')}>
                    Manage MCPs
                  </button>
                </p>
              </>
            )}
          </Result>
        </Card>
        <Card title="Selected validation job">
          <Result value={findings}>
            {(data) =>
              data ? (
                <>
                  <code>{data.job.id}</code>
                  <p>Stored status: {data.job.status}</p>
                  <strong className="metric">
                    {data.items.filter((f) => f.status === 'open').length}
                  </strong>
                  <p className="muted">
                    Open findings for this job (first 100). No findings alone does not establish a
                    pass.
                  </p>
                  <Button onClick={() => navigate('Engineering')}>Review selected job</Button>
                </>
              ) : (
                <EmptyState title="No validation job selected">
                  <Button onClick={() => navigate('Engineering')}>Select job in Engineering</Button>
                </EmptyState>
              )
            }
          </Result>
        </Card>
      </div>
      <Card
        title="Project memory"
        action={<Button onClick={() => navigate('Agent Workspace')}>View context</Button>}
      >
        <Result value={context}>
          {(d) =>
            d.projectId === project.id ? (
              <ActivityTimeline
                records={d.records.filter((r) => r.projectId === project.id).slice(0, 5)}
              />
            ) : (
              <Unavailable
                title="Project scope mismatch"
                reason="Context was not displayed because it belongs to a different project."
              />
            )
          }
        </Result>
      </Card>
      <StoredEvents client={client} projectId={project.id} />
      <Card title="Development environments">
        <Unavailable
          title="Environment status unavailable"
          reason="Agent/environment discovery is not part of the current SDK."
        />
      </Card>
    </>
  );
}
function RegisterProject({
  client,
  onCreated,
  onClose,
}: {
  client: DaemonClient;
  onCreated: (p: Project) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const parsed = ProjectCreateSchema.safeParse({ name, rootPath: path });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('. '));
      return;
    }
    setSaving(true);
    setError('');
    try {
      onCreated(await client.createProject(parsed.data));
      onClose();
    } catch (e) {
      const d = describeError(e);
      setError(`${d.title}. ${d.message}`);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog title="Register workspace" onClose={onClose}>
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <Field label="Project name">
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Absolute workspace path"
          hint="Must be an existing directory on the daemon's machine."
        >
          <input required value={path} onChange={(e) => setPath(e.target.value)} />
        </Field>
        <p>Registering this directory authorizes it as a project workspace.</p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <Button variant="primary" disabled={saving} type="submit">
          {saving ? 'Registering…' : 'Register project'}
        </Button>
      </form>
    </Dialog>
  );
}
export function App() {
  const [screen, setScreen] = useState<Screen>('Overview');
  const [url, setUrl] = useState(import.meta.env.VITE_UDI_URL ?? 'http://127.0.0.1:4317');
  const [token, setToken] = useState('');
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftToken, setDraftToken] = useState('');
  const [settingsError, setSettingsError] = useState('');
  const client = useMemo(() => createClient({ baseUrl: url, token: () => token }), [url, token]);
  const health = useResource(() => client.health(), [client]);
  const projects = useResource(() => client.listProjects(), [client]);
  const [projectId, setProjectId] = useState('');
  const [jobIds, setJobIds] = useState<Record<string, string | undefined>>({});
  const [register, setRegister] = useState(false);
  const items = projects.state.status === 'ready' ? projects.state.data.items : [];
  const project = items.find((p) => p.id === projectId);
  const [reachable, setReachable] = useState(true);
  useEffect(() => {
    if (health.state.status === 'ready') setReachable(true);
  }, [health.state]);
  useEffect(() => {
    const timer = setInterval(health.retry, 15000);
    return () => clearInterval(timer);
  }, [client]);
  const connected = health.state.status === 'ready' && reachable;
  function applySettings(e: FormEvent) {
    e.preventDefault();
    try {
      createClient({ baseUrl: draftUrl });
      setSettingsError('');
      setUrl(draftUrl);
      setToken(draftToken);
      setDraftToken('');
      setProjectId('');
      setJobIds({});
    } catch {
      setSettingsError('Use an HTTP loopback origin, for example http://127.0.0.1:4317.');
    }
  }
  return (
    <ConnectionReporter.Provider value={setReachable}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">di</span>
            <div>
              Developer<span>Intelligence</span>
            </div>
          </div>
          <label className="project-picker">
            WORKSPACE
            <select
              aria-label="Active project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Select a project</option>
              {items.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <nav aria-label="Primary navigation">
            {screens.map((s, i) => (
              <button
                key={s}
                className={`nav-item ${screen === s ? 'active' : ''}`}
                aria-current={screen === s ? 'page' : undefined}
                aria-label={s}
                onClick={() => setScreen(s)}
              >
                <span className="nav-symbol" aria-hidden="true">
                  <NavigationIcon
                    name={
                      (
                        ['overview', 'agents', 'mcp', 'engineering', 'devices', 'settings'] as const
                      )[i]!
                    }
                  />
                </span>
                {s}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className={`status-dot ${connected ? 'online' : ''}`} />
            {health.state.status === 'loading'
              ? 'Checking engine'
              : connected
                ? 'Engine connected'
                : 'Engine unavailable'}
            <small>Local-first · Shared project state</small>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <span>
              Control center <span className="muted">/ {screen}</span>
            </span>
            <Badge tone={connected ? 'good' : 'warning'}>
              {connected
                ? `Daemon ${health.state.status === 'ready' ? health.state.data.version : ''}`
                : health.state.status === 'loading'
                  ? 'Connecting'
                  : 'Disconnected'}
            </Badge>
          </header>
          <main id="main-content">
            <header className="page-heading">
              <div>
                <p className="eyebrow">DEVELOPER INTELLIGENCE</p>
                <h1>{screen}</h1>
                <p className="muted">
                  {project ? project.name : 'Connect your tools. Keep the evidence.'}
                </p>
              </div>
              <div className="row">
                <Button
                  onClick={() => {
                    health.retry();
                    projects.retry();
                  }}
                >
                  Refresh
                </Button>
                <Button variant="primary" onClick={() => setRegister(true)}>
                  Open project
                </Button>
              </div>
            </header>
            {health.state.status === 'error' && (
              <div className="notice" role="status">
                {health.state.title}. {health.state.message}{' '}
                <Button onClick={() => setScreen('Settings')}>Connection settings</Button>
              </div>
            )}
            {screen === 'Settings' ? (
              <>
                <Card title="Local engine connection">
                  <form onSubmit={applySettings}>
                    <Field label="Daemon URL">
                      <input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} />
                    </Field>
                    <Field
                      label="Local daemon token"
                      hint="Use the token from .data/token on the daemon machine. Kept in memory for this session only; never saved to browser storage."
                    >
                      <input
                        type="password"
                        autoComplete="off"
                        value={draftToken}
                        onChange={(e) => setDraftToken(e.target.value)}
                      />
                    </Field>
                    {settingsError && <p role="alert">{settingsError}</p>}
                    <div className="row">
                      <Button variant="primary" type="submit">
                        Connect
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          setToken('');
                          setDraftToken('');
                        }}
                      >
                        Forget token
                      </Button>
                    </div>
                  </form>
                </Card>
                <IntegrationGuide />
                <Card title="Preferences">
                  <p>
                    Dark appearance follows the application's developer-tool theme. Reduced-motion
                    preferences are respected.
                  </p>
                  <p className="muted">
                    Persistent OS-backed credential storage, environment connections and storage
                    statistics are not available yet.
                  </p>
                </Card>
              </>
            ) : screen === 'MCP Hub' ? (
              <Mcp client={client} />
            ) : screen === 'Devices' ? (
              <Card title="Devices & telemetry">
                <Unavailable
                  title="Device monitoring unavailable"
                  reason="Serial ports, connections and telemetry are not exposed by this daemon SDK."
                />
                <div className="row">
                  <Button disabled>Refresh devices</Button>
                  <Button disabled>Connect</Button>
                  <Button disabled>View telemetry</Button>
                </div>
              </Card>
            ) : (
              <Result value={projects}>
                {() =>
                  project ? (
                    <div key={`${url}:${project.id}`} className="screen-content">
                      {screen === 'Overview' ? (
                        <Overview
                          client={client}
                          project={project}
                          navigate={setScreen}
                          jobId={jobIds[project.id]}
                        />
                      ) : screen === 'Engineering' ? (
                        <Engineering
                          client={client}
                          project={project}
                          jobId={jobIds[project.id]}
                          onJobSelect={(id) =>
                            setJobIds((previous) => ({ ...previous, [project.id]: id }))
                          }
                        />
                      ) : (
                        <Context client={client} project={project} />
                      )}
                    </div>
                  ) : (
                    <Card title="Workspace">
                      <EmptyState
                        title={
                          items.length ? 'Choose your active project' : 'No registered projects'
                        }
                      >
                        <p>
                          Select a workspace from the sidebar or register an existing directory.
                        </p>
                        <Button onClick={() => setRegister(true)}>Register workspace</Button>
                      </EmptyState>
                    </Card>
                  )
                }
              </Result>
            )}
          </main>
          <footer className="workspace-footer">
            <span>{project?.rootPath || 'No active workspace'}</span>
            <span>Live daemon API · Original provenance</span>
          </footer>
        </div>
        {register && (
          <RegisterProject
            client={client}
            onClose={() => setRegister(false)}
            onCreated={(p) => {
              setProjectId(p.id);
              projects.retry();
            }}
          />
        )}
      </div>
    </ConnectionReporter.Provider>
  );
}
