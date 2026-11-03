import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createClient, type DaemonClient } from '@udi/client-sdk';
import {
  ProjectCreateSchema,
  type Project,
  type McpServer,
  type ProjectMemory,
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
  Skeleton,
  NavigationIcon,
} from '@udi/ui';
import { Resource, describeError } from './resource.js';
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
function useResource<T>(loader: () => Promise<T>, dependencies: readonly unknown[]) {
  // The caller supplies the identity of the SDK/project; new identities get isolated resource instances.
  const resource = useMemo(() => new Resource<T>(), dependencies);
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  useEffect(() => {
    void resource.load(loader);
    return () => resource.cancel();
  }, [resource]);
  return {
    state,
    retry: () => {
      void resource.load(loader);
    },
  };
}
function Result<T>({
  value,
  children,
}: {
  value: ReturnType<typeof useResource<T>>;
  children: (data: T) => ReactNode;
}) {
  if (value.state.status === 'loading') return <Skeleton />;
  if (value.state.status === 'error')
    return (
      <EmptyState title={value.state.title}>
        <p>{value.state.message}</p>
        <Button onClick={value.retry}>Retry</Button>
      </EmptyState>
    );
  return <>{children(value.state.data)}</>;
}
function Unavailable({ title, reason }: { title: string; reason: string }) {
  return (
    <EmptyState title={title}>
      <p>{reason}</p>
      <Badge tone="warning">Unavailable</Badge>
    </EmptyState>
  );
}
function Context({ client, project }: { client: DaemonClient; project: Project }) {
  const context = useResource(async () => {
    const data = await client.getContext(project.id);
    if (data.projectId !== project.id || data.records.some((r) => r.projectId !== project.id))
      throw new Error('Project scope mismatch');
    return data;
  }, [client, project.id]);
  const [tab, setTab] = useState('Project Memory');
  const [copied, setCopied] = useState('');
  const tabs = ['Connected Agents', 'Project Memory', 'Context Timeline', 'Agent Handoffs'];
  async function copy(data: ProjectMemory) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied('Structured context copied.');
    } catch {
      setCopied('Clipboard unavailable. Select and copy the context manually.');
    }
  }
  return (
    <>
      <Tabs tabs={tabs} selected={tab} onSelect={setTab} />
      {tab === 'Connected Agents' ? (
        <Card title="Connected agents">
          <Unavailable
            title="Agent discovery unavailable"
            reason="This daemon does not expose a connected-agent inventory. No private agent sessions are captured."
          />
        </Card>
      ) : tab === 'Agent Handoffs' ? (
        <Card title="Agent handoffs">
          <Unavailable
            title="Handoff storage is not available yet"
            reason="Create and retrieve require shared handoff SDK methods. You can retrieve and copy current project context from Project Memory."
          />
          <Button disabled>Create handoff</Button>
        </Card>
      ) : (
        <Card title={tab} action={<Button onClick={context.retry}>Retrieve latest context</Button>}>
          <Result value={context}>
            {(data) => (
              <>
                <div className="row">
                  <Badge>{data.records.length} records</Badge>
                  <small>Generated {new Date(data.generatedAt).toLocaleString()}</small>
                  <Button
                    onClick={() => {
                      void copy(data);
                    }}
                  >
                    Copy structured context
                  </Button>
                </div>
                <p role="status">{copied}</p>
                <ActivityTimeline records={data.records} />
                {data.openIssues.length > 0 && (
                  <>
                    <h3>Unresolved issues</h3>
                    <ul>
                      {data.openIssues.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </Result>
        </Card>
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
  const servers = useResource(() => client.listMcpServers(), [client]);
  return (
    <>
      <div className="notice">
        Registry mutations, tool discovery and health checks require additional SDK methods. The
        status below is the daemon's recorded inventory.
      </div>
      <Card
        title="MCP registry"
        action={<Button onClick={servers.retry}>Refresh inventory</Button>}
      >
        <Result value={servers}>{(data) => <McpList items={data.items} />}</Result>
        <div className="row disabled-actions" aria-label="Unavailable server operations">
          {['Add MCP', 'Test connection', 'View tools', 'Configure', 'Disconnect', 'Remove'].map(
            (a) => (
              <Button key={a} disabled>
                {a}
              </Button>
            ),
          )}
        </div>
      </Card>
    </>
  );
}
export function Findings({ items }: { items: ValidationFinding[] }) {
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
                {f.ruleId} · {f.evidence[0]?.filePath}
              </small>
            </span>
            <span>View evidence →</span>
          </button>
        ))}
      </div>
      {selected && (
        <Dialog title="Engineering finding" onClose={() => setSelected(undefined)}>
          <FindingDetailPanel finding={selected} />
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
function Engineering({ client, project }: { client: DaemonClient; project: Project }) {
  const findings = useResource(async () => {
    const data = await client.listFindings(project.id);
    if (data.items.some((f) => f.projectId !== project.id))
      throw new Error('Project scope mismatch');
    return data;
  }, [client, project.id]);
  return (
    <>
      <div className="summary-grid">
        <Card title="Active engineering project">
          <h3>{project.name}</h3>
          <code>{project.rootPath}</code>
        </Card>
        <Card title="Toolchain">
          <Badge tone="warning">Detection unavailable</Badge>
          <p className="muted">Build and artifact discovery APIs are not available.</p>
        </Card>
      </div>
      <Card
        title="Validation findings"
        action={<Button onClick={findings.retry}>Refresh findings</Button>}
      >
        <Result value={findings}>{(data) => <Findings items={data.items} />}</Result>
      </Card>
      <Card title="Validation & builds">
        <Unavailable
          title="Validation execution is not available yet"
          reason="The SDK exposes findings retrieval, but not job submission, build logs, artifact detection or correction approval."
        />
        <div className="row">
          <Button disabled>Run validation</Button>
          <Button disabled>View build logs</Button>
        </div>
        <p className="muted">
          Artifact consistency checks do not verify physical wiring or electrical safety.
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
}: {
  client: DaemonClient;
  project: Project;
  navigate: (s: Screen) => void;
}) {
  const context = useResource(() => client.getContext(project.id), [client, project.id]);
  const findings = useResource(() => client.listFindings(project.id), [client, project.id]);
  const mcp = useResource(() => client.listMcpServers(), [client]);
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
                  Registered servers ·{' '}
                  <button className="text-button" onClick={() => navigate('MCP Hub')}>
                    Manage MCPs
                  </button>
                </p>
              </>
            )}
          </Result>
        </Card>
        <Card title="Recorded findings">
          <Result value={findings}>
            {(d) => (
              <>
                <strong className="metric">
                  {d.items.filter((f) => f.status === 'open').length}
                </strong>
                <p className="muted">Open findings · not a validation pass</p>
                <Button onClick={() => navigate('Engineering')}>Review findings</Button>
              </>
            )}
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
  const [register, setRegister] = useState(false);
  const items = projects.state.status === 'ready' ? projects.state.data.items : [];
  const project = items.find((p) => p.id === projectId);
  const connected = health.state.status === 'ready';
  function applySettings(e: FormEvent) {
    e.preventDefault();
    try {
      createClient({ baseUrl: draftUrl });
      setSettingsError('');
      setUrl(draftUrl);
      setToken(draftToken);
      setDraftToken('');
      setProjectId('');
    } catch {
      setSettingsError('Use an HTTP loopback origin, for example http://127.0.0.1:4317.');
    }
  }
  return (
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
                    (['overview', 'agents', 'mcp', 'engineering', 'devices', 'settings'] as const)[
                      i
                    ]!
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
                      <Overview client={client} project={project} navigate={setScreen} />
                    ) : screen === 'Engineering' ? (
                      <Engineering client={client} project={project} />
                    ) : (
                      <Context client={client} project={project} />
                    )}
                  </div>
                ) : (
                  <Card title="Workspace">
                    <EmptyState
                      title={items.length ? 'Choose your active project' : 'No registered projects'}
                    >
                      <p>Select a workspace from the sidebar or register an existing directory.</p>
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
          <span>Live API · No demo data</span>
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
  );
}
