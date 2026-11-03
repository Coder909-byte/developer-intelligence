import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import type { ContextRecord, ValidationFinding } from '@udi/contracts';
export function NavigationIcon({
  name,
}: {
  name: 'overview' | 'agents' | 'mcp' | 'engineering' | 'devices' | 'settings';
}) {
  const paths = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    agents:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.87',
    mcp: 'M8 3v5 M16 3v5 M5 8h14v3a7 7 0 0 1-14 0z M12 18v3',
    engineering: 'M12 3 3 8l9 5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
    devices: 'M6 6h12v12H6z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4',
    settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Button({
  children,
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' }) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Card({
  title,
  children,
  action,
}: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <section className="card" aria-label={title}>
      <header className="card-heading">
        <h2>{title}</h2>
        {action}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}
export const StatusPanel = Card;
export function Badge({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'neutral' | 'good' | 'warning' | 'error' }>) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
export function Skeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="skeleton">
      <span>{label}…</span>
      <i />
      <i />
      <i />
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  busy = false,
}: PropsWithChildren<{ title: string; onClose: () => void; busy?: boolean }>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <header className="card-heading">
        <h2>{title}</h2>
        <Button disabled={busy} onClick={onClose} aria-label="Close dialog">
          Close
        </Button>
      </header>
      <div className="card-body">{children}</div>
    </dialog>
  );
}
export const sourceLabel = (source: ContextRecord['provenance']['sourceKind']) =>
  ({
    observed_tool: 'Observed tool result',
    user_entered: 'User entered',
    agent_summary: 'Agent summary',
    imported: 'Imported',
  })[source];
export function ActivityTimeline({ records }: { records: ContextRecord[] }) {
  if (!records.length)
    return (
      <EmptyState title="No context recorded">
        Recorded decisions and tool results will appear here.
      </EmptyState>
    );
  return (
    <ol className="timeline">
      {[...records]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((record) => (
          <li key={record.id}>
            <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time>
            <div>
              <Badge>{record.kind}</Badge>
              <p>{record.text}</p>
              <small>
                {sourceLabel(record.provenance.sourceKind)} · {record.provenance.actor}
              </small>
              {record.provenance.sourceRef && <code>{record.provenance.sourceRef}</code>}
              {record.evidence.map((e, i) => (
                <code key={i}>
                  {e.filePath}
                  {e.line ? `:${e.line}` : ''}
                </code>
              ))}
            </div>
          </li>
        ))}
    </ol>
  );
}
export function FindingDetailPanel({ finding }: { finding: ValidationFinding }) {
  return (
    <div className="finding-detail">
      <div className="row">
        <Badge
          tone={
            finding.severity === 'error'
              ? 'error'
              : finding.severity === 'warning'
                ? 'warning'
                : 'neutral'
          }
        >
          {finding.severity}
        </Badge>
        <Badge>{finding.status}</Badge>
        <code>{finding.ruleId}</code>
      </div>
      <h3>{finding.message}</h3>
      <div className="comparison">
        <div>
          <small>Expected</small>
          <pre>{JSON.stringify(finding.expected, null, 2)}</pre>
        </div>
        <div>
          <small>Observed</small>
          <pre>{JSON.stringify(finding.observed, null, 2)}</pre>
        </div>
      </div>
      <h4>Source evidence</h4>
      {finding.evidence.map((e, i) => (
        <div className="evidence" key={i}>
          <code>
            {e.filePath}
            {e.line ? `:${e.line}` : ''}
            {e.column ? `:${e.column}` : ''}
          </code>
          {e.excerpt && <pre>{e.excerpt}</pre>}
        </div>
      ))}
      <p className="muted">
        Verified by {finding.verifiedBy.tool} {finding.verifiedBy.version}
      </p>
      {finding.suggestedFix && (
        <>
          <h4>Suggested correction · review required</h4>
          <p>{finding.suggestedFix}</p>
        </>
      )}
      <p className="muted">
        Configuration checks do not verify physical wiring or electrical safety.
      </p>
    </div>
  );
}
export function LogViewer({ text, label }: { text: string; label: string }) {
  return (
    <pre className="log" aria-label={label}>
      {text || 'No log output returned.'}
    </pre>
  );
}
