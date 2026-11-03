import { useEffect, useMemo, useRef, useState } from 'react';
import { DaemonClientError, type DaemonClient } from '@udi/client-sdk';
import type { CodexClaudeHandoff, Project } from '@udi/contracts';
import { Badge, Button, Card } from '@udi/ui';
import { describeError } from './resource.js';
import './context-bridge.css';

type State = {
  scope: object;
  status: 'loading' | 'error' | 'ready';
  result?: CodexClaudeHandoff;
  error?: string;
};

export function ContextBridge({ client, project }: { client: DaemonClient; project: Project }) {
  const scope = useMemo(() => ({}), [client, project.id]);
  const generation = useRef(0);
  const inFlight = useRef<object | undefined>(undefined);
  const [state, setState] = useState<State>();
  const [notice, setNotice] = useState('');
  const current = state?.scope === scope ? state : undefined;
  const result = current?.result?.projectId === project.id ? current.result : undefined;
  const busy = current?.status === 'loading';
  useEffect(
    () => () => {
      generation.current++;
    },
    [scope],
  );

  async function convert() {
    if (busy || inFlight.current === scope) return;
    inFlight.current = scope;
    const run = ++generation.current;
    setNotice('');
    setState({ scope, status: 'loading' });
    try {
      const data = await client.convertCodexContext(project.id);
      if (generation.current !== run) return;
      if (data.projectId !== project.id) throw new Error('Project scope mismatch');
      setState({ scope, status: 'ready', result: data });
    } catch (error) {
      if (generation.current !== run) return;
      const message =
        error instanceof DaemonClientError && error.code === 'NOT_FOUND'
          ? error.message === 'Route not found'
            ? 'Start the updated daemon build to enable context conversion, then retry.'
            : 'No saved Codex session was found for this workspace. Open it in Codex first, or select the project you used with Codex.'
          : describeError(error).message;
      setState({ scope, status: 'error', error: message });
    } finally {
      if (inFlight.current === scope) inFlight.current = undefined;
    }
  }
  async function copy() {
    if (!result) return;
    const run = generation.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(result.markdown);
      if (run === generation.current)
        setNotice('Copied. Paste this handoff into a new Claude Code conversation.');
    } catch {
      if (run === generation.current)
        setNotice('Clipboard is unavailable here. Download the handoff instead.');
    }
  }
  function download() {
    if (!result) return;
    try {
      const url = URL.createObjectURL(
        new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('Handoff downloaded. Open it in this workspace and reference it from Claude Code.');
    } catch {
      setNotice('Download is unavailable here. Copy the handoff instead.');
    }
  }

  return (
    <Card
      title="Context Bridge"
      action={
        <Badge tone={result ? 'good' : 'neutral'}>{result ? 'Ready to import' : 'On demand'}</Badge>
      }
    >
      <div className="context-bridge" aria-busy={busy}>
        <div className="context-bridge-intro">
          <div>
            <p className="eyebrow">CARRY THE THREAD</p>
            <h3>Pick up where Codex left off.</h3>
            <p>Turn this workspace’s saved Codex context into a handoff Claude Code can read.</p>
          </div>
          <Button type="button" variant="primary" onClick={() => void convert()} disabled={busy}>
            {busy
              ? 'Converting context…'
              : result
                ? 'Convert latest context again'
                : 'Convert to Claude Code'}
          </Button>
        </div>
        <div className="context-bridge-route" aria-label="Codex to Claude Code conversion">
          <div className="context-bridge-host">
            <span className="context-bridge-avatar" aria-hidden="true">
              C_
            </span>
            <div>
              <strong>Codex</strong>
              <small>Saved VS Code session</small>
            </div>
            <Badge>Source</Badge>
          </div>
          <span className="context-bridge-arrow" aria-hidden="true">
            →
          </span>
          <div className="context-bridge-host">
            <span className="context-bridge-avatar claude" aria-hidden="true">
              ✳
            </span>
            <div>
              <strong>Claude Code</strong>
              <small>Markdown context handoff</small>
            </div>
            <Badge>Destination</Badge>
          </div>
        </div>
        <ol className="context-bridge-steps" aria-label="Conversion progress">
          {['Read project session', 'Preserve roles & sources', 'Prepare Claude context'].map(
            (step, index) => (
              <li
                key={step}
                data-state={result ? 'complete' : busy && index === 0 ? 'active' : 'waiting'}
              >
                <span aria-hidden="true">{result ? '✓' : `0${index + 1}`}</span>
                {step}
              </li>
            ),
          )}
        </ol>
        <div aria-live="polite" role="status" className="context-bridge-status">
          {busy ? (
            'Reading the latest saved session for this project…'
          ) : current?.status === 'error' ? (
            current.error
          ) : result ? (
            `Converted ${result.stats.messagesIncluded} messages from this project. Ready for review and import.`
          ) : (
            <>
              Active workspace: <strong>{project.name}</strong>. Conversion starts when you click.
            </>
          )}
        </div>
        {result && (
          <>
            <div className="context-bridge-metrics">
              <div>
                <strong>{result.stats.messagesIncluded}</strong>
                <small>Messages carried over</small>
              </div>
              <div>
                <strong>{result.stats.outputTokensEstimate.toLocaleString()}</strong>
                <small>Estimated output tokens</small>
              </div>
              <div>
                <strong>{result.stats.truncatedMessages}</strong>
                <small>Shortened excerpts</small>
              </div>
              <div>
                <strong>{result.storage === 'codex_sqlite' ? 'SQLite' : 'Rollout'}</strong>
                <small>Actual Codex source</small>
              </div>
            </div>
            <div className="context-bridge-preview">
              <section>
                <h4>Captured Codex context</h4>
                <pre aria-label="Captured Codex context">
                  {result.entries
                    .map(
                      (entry) =>
                        `[${entry.role}] ${new Date(entry.occurredAt).toLocaleString()}\n${entry.text}`,
                    )
                    .join('\n\n')}
                </pre>
              </section>
              <section>
                <h4>Claude-ready handoff</h4>
                <pre aria-label="Claude-ready handoff">{result.markdown}</pre>
              </section>
            </div>
            <div className="context-bridge-export">
              <div className="row">
                <Button type="button" variant="primary" onClick={() => void copy()}>
                  Copy for Claude Code
                </Button>
                <Button type="button" onClick={download}>
                  Download handoff
                </Button>
              </div>
              <small>
                Session {result.sessionId.slice(0, 8)} · {result.stats.omittedMessages} other
                inspected messages omitted
                {result.stats.sourceWindowLimited ? ' · Bounded source window' : ''}
              </small>
            </div>
            <details className="context-bridge-help">
              <summary>Use this context in Claude Code</summary>
              <p>
                Paste the copied handoff into a new Claude Code conversation in this workspace. To
                load it as project memory, save <code>{result.filename}</code> here and add this
                line to your existing <code>CLAUDE.md</code>:
              </p>
              <pre>{result.importLine}</pre>
              <p>
                Start a new Claude Code session and check <code>/context</code>. This exports
                recorded history; it does not resume or verify a live Claude session.
              </p>
              <a
                href="https://code.claude.com/docs/en/memory#import-additional-files"
                target="_blank"
                rel="noreferrer"
              >
                Claude Code memory documentation ↗
              </a>
            </details>
          </>
        )}
        {current && notice && (
          <p className="context-bridge-notice" role="status">
            {notice}
          </p>
        )}
      </div>
    </Card>
  );
}
