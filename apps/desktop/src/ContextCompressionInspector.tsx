import { useState } from 'react';
import type { ActivityEvent } from '@udi/contracts';
import { Badge, Button, Card, EmptyState } from '@udi/ui';

export function ContextCompressionInspector({
  events,
  inspection,
}: {
  events: ActivityEvent[];
  inspection?:
    | {
        rawTokens: number;
        injectedTokens: number;
        preserved: number;
        pruned: number;
        classifications: {
          id: string;
          timestamp: string;
          source: string;
          score: number;
          category: string;
          preserve: boolean;
          fact: string;
        }[];
        injectedBlock: string;
      }
    | undefined;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const validMetrics =
    inspection &&
    [
      inspection.rawTokens,
      inspection.injectedTokens,
      inspection.preserved,
      inspection.pruned,
    ].every((n) => Number.isFinite(n) && n >= 0);
  const savings =
    validMetrics && inspection.rawTokens > 0
      ? (1 - inspection.injectedTokens / inspection.rawTokens) * 100
      : undefined;
  async function copy() {
    try {
      await navigator.clipboard.writeText(inspection?.injectedBlock ?? '');
      setCopyStatus('Injection block copied');
    } catch {
      setCopyStatus('Copy unavailable. Select and copy the payload below.');
    }
  }
  return (
    <section className="compression-inspector" aria-label="Context compression inspector">
      <div className="hub-section-intro">
        <p className="eyebrow">MEMORY CORE / CONTEXT ECONOMY</p>
        <h2>Keep the signal. Carry the knowledge.</h2>
        <p>
          Inspect source activity, semantic decisions and the exact context delivered to your agent.
        </p>
        <Badge tone={inspection ? 'good' : 'warning'}>
          {inspection ? 'Inspection received' : 'Awaiting compression service'}
        </Badge>
      </div>
      <div className="compression-metrics">
        {[
          [
            'Raw session footprint',
            validMetrics ? inspection.rawTokens.toLocaleString() : '—',
            'tokens',
          ],
          [
            'Injected context payload',
            validMetrics ? inspection.injectedTokens.toLocaleString() : '—',
            'tokens',
          ],
          ['Efficiency gain', savings !== undefined ? `${savings.toFixed(1)}%` : '—', 'reduction'],
          [
            'Memory quality',
            validMetrics ? `${inspection.preserved} / ${inspection.pruned}` : '—',
            'preserved / pruned',
          ],
        ].map(([label, value, unit]) => (
          <div className="compression-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{unit}</small>
          </div>
        ))}
      </div>
      <div className="compression-gauge">
        <span>Token reduction</span>
        {savings !== undefined ? (
          <progress
            aria-label="Token reduction"
            max={100}
            value={Math.max(0, Math.min(100, savings))}
          />
        ) : (
          <div className="gauge-waiting" />
        )}
        <small>
          {savings === undefined
            ? 'Waiting for measured token counts'
            : `${savings.toFixed(1)}% reduction`}
        </small>
      </div>
      <div className="inspection-streams">
        <Card title="01 / Raw interaction stream">
          <div className="inspection-scroll raw-stream">
            {events.length ? (
              events.map((event) => (
                <article key={event.id}>
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString()}
                  </time>
                  <div>
                    <Badge>{event.sourceKind}</Badge> <code>{event.actor}</code>
                  </div>
                  <h3>{event.type}</h3>
                  <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                </article>
              ))
            ) : (
              <EmptyState title="No recorded activity">
                Project events appear here as they arrive.
              </EmptyState>
            )}
          </div>
          <small>Stored project activity; private agent conversations are not captured.</small>
        </Card>
        <Card title="02 / Laya classifier stream">
          <div className="inspection-scroll">
            {inspection?.classifications.length ? (
              inspection.classifications.map((item) => (
                <article
                  className={`classification-card ${item.preserve ? 'preserve' : 'prune'}`}
                  key={item.id}
                >
                  <time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleString()}</time>
                  <code>{item.source}</code>
                  <div className="signal-line">
                    <strong>
                      {Number.isFinite(item.score) ? item.score.toFixed(2) : '—'} SIGNAL
                    </strong>
                    <Badge tone={item.preserve ? 'good' : 'neutral'}>
                      {item.preserve ? 'PRESERVE TO MEMORY' : 'PRUNE / DISCARD'}
                    </Badge>
                  </div>
                  <Badge>{item.category}</Badge>
                  <p>{item.fact}</p>
                </article>
              ))
            ) : (
              <EmptyState title="Awaiting classifier decisions">
                Signal scores and distilled facts will appear when classification is available.
              </EmptyState>
            )}
          </div>
        </Card>
        <Card
          title="03 / Injected compressed context"
          action={
            <Button disabled={!inspection?.injectedBlock} onClick={() => void copy()}>
              Copy Injection Block
            </Button>
          }
        >
          <div className="inspection-scroll injected-stream">
            {inspection?.injectedBlock ? (
              <pre aria-label="Injected Markdown payload">{inspection.injectedBlock}</pre>
            ) : (
              <EmptyState title="No injection received">
                The exact Markdown payload will appear after the backend reports an injection.
              </EmptyState>
            )}
          </div>
          <p role="status">{copyStatus}</p>
        </Card>
      </div>
    </section>
  );
}
