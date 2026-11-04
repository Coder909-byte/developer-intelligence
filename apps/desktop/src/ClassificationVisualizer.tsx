import { useState, useEffect } from 'react';
import type { DaemonClient } from '@udi/client-sdk';
import type { LayaClassificationResult, ClassifierCategory } from '@udi/contracts';
import { Card, Badge, Button, EmptyState } from '@udi/ui';

interface ScrubResult {
  scrubbed: string;
  isObviousNoise: boolean;
  truncated: boolean;
  durationMs: number;
}

interface Stage2Result {
  category: ClassifierCategory;
  signalScore: number;
  decision: 'preserve' | 'discard';
  distilledFact?: string;
  durationMs: number;
}

const PRESETS = [
  {
    title: 'Hardware GPIO Invariant',
    actor: 'engineering-core',
    sourceType: 'tool_output' as const,
    text: 'Signal MOTOR_EN pin mismatch: netlist rover.net line 28 specifies GPIO14 on MCU U2:12, but firmware src/pins.h:7 configures GPIO26. Patch applied to lock GPIO14.',
  },
  {
    title: 'Compiler Noise & ANSI Spam',
    actor: 'terminal-runner',
    sourceType: 'tool_output' as const,
    text: '\u001b[32m[BUILD SUCCESS]\u001b[0m [=========>    ] 65% Compiling firmware/main.c\nAdded 14 packages in 0.8s\nup to date in 2.1s\nnpm warn deprecated inflight@1.0.6: This module is not supported',
  },
  {
    title: 'Architectural Decision',
    actor: 'fev',
    sourceType: 'user_message' as const,
    text: 'User directive: KiCad schematic netlist rev B is the authoritative hardware reference. Never modify circuit netlist; firmware pins must adapt to schematic.',
  },
  {
    title: 'Validation Pass Outcome',
    actor: 'kicad-platformio-runner',
    sourceType: 'tool_output' as const,
    text: 'Validation passed: 0 active findings. Netlist and firmware pin definitions verified consistent across all MCU GPIO headers.',
  },
];

function localDeterministicScrub(raw: string): ScrubResult {
  const start = performance.now();
  // eslint-disable-next-line no-control-regex
  let text = raw.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim();
  text = text.replace(/\[[=>\s.-]{5,}\]\s*\d+%/g, '').trim();
  text = text.replace(/\n{3,}/g, '\n\n');

  if (/[A-Za-z0-9+/=]{80,}/.test(text)) {
    text = text.replace(/[A-Za-z0-9+/=]{80,}/g, '[BINARY/BASE64_OMITTED]');
  }

  const isObviousNoise =
    !text ||
    text.length === 0 ||
    /^(ok|done|\{\s*\}|\[\s*\])$/i.test(text) ||
    (/^(npm warn|npm notice|pnpm install|added \d+ packages)/im.test(text) &&
      !/(error|failed|fatal|exception)/i.test(text));

  const end = performance.now();
  return {
    scrubbed: text,
    isObviousNoise,
    truncated: text.length > 500,
    durationMs: Math.max(0.1, Number((end - start).toFixed(2))),
  };
}

function localSemanticClassify(
  scrubbed: string,
  sourceType: 'user_message' | 'assistant_thought' | 'tool_output' | 'system_message',
): Stage2Result {
  const start = performance.now();

  // 1. Hardware Specification
  const pinMatch = scrubbed.match(/(?:GPIO\d+|pin\s*["']?\d+["']?|MOTOR_[A-Z0-9_]+|I2C|SPI|UART)/i);
  const netlistMatch = scrubbed.match(/\.net|netlist|schematic|KiCad/i);
  if (
    pinMatch &&
    (netlistMatch ||
      /mismatch|pin_consistency|expected|observed|header|defines?|mapped|assigned|wiring|binding|pinout/i.test(
        scrubbed,
      ))
  ) {
    const specific = scrubbed.match(
      /(?:Signal\s+)?([A-Za-z0-9_]+)\s*(?:pin\s*mismatch:?\s*|->|=|specifies\s*)([A-Za-z0-9_]+)/i,
    );
    const fact = specific
      ? `${specific[1]} mapped to ${specific[2]}`
      : scrubbed.slice(0, 240).replace(/\n/g, ' ');

    return {
      category: 'HARDWARE_SPEC',
      signalScore: 0.98,
      decision: 'preserve',
      distilledFact: fact,
      durationMs: Math.max(0.2, Number((performance.now() - start).toFixed(2))),
    };
  }

  // 2. User Directives
  if (sourceType === 'user_message') {
    const clean = scrubbed.replace(/^[-*•#\s]+/, '').replace(/\n+/g, ' ').slice(0, 280);
    return {
      category: 'ARCHITECTURAL_DECISION',
      signalScore: 0.92,
      decision: 'preserve',
      distilledFact: clean,
      durationMs: Math.max(0.2, Number((performance.now() - start).toFixed(2))),
    };
  }

  // 3. Validated Outcomes
  if (/(?:validation passed|0 active findings|all tests passed|revalidation succeeded)/i.test(scrubbed)) {
    return {
      category: 'VALIDATED_OUTCOME',
      signalScore: 0.95,
      decision: 'preserve',
      distilledFact: 'Engineering validation verified: 0 active findings',
      durationMs: Math.max(0.2, Number((performance.now() - start).toFixed(2))),
    };
  }

  // 4. Ephemeral Noise
  return {
    category: 'EPHEMERAL_NOISE',
    signalScore: 0.04,
    decision: 'discard',
    durationMs: Math.max(0.1, Number((performance.now() - start).toFixed(2))),
  };
}

export function ClassificationVisualizer({
  client,
  projectId,
}: {
  client: DaemonClient;
  projectId?: string | undefined;
}) {
  const [inputText, setInputText] = useState(PRESETS[0]!.text);
  const [sourceType, setSourceType] = useState<
    'user_message' | 'assistant_thought' | 'tool_output' | 'system_message'
  >(PRESETS[0]!.sourceType);
  const [actor, setActor] = useState(PRESETS[0]!.actor);

  const [scrubResult, setScrubResult] = useState<ScrubResult>(() =>
    localDeterministicScrub(PRESETS[0]!.text),
  );
  const [stage2Result, setStage2Result] = useState<Stage2Result>(() =>
    localSemanticClassify(scrubResult.scrubbed, PRESETS[0]!.sourceType),
  );

  const [streamItems, setStreamItems] = useState<LayaClassificationResult[]>([]);
  const [running, setRunning] = useState(false);

  // Run live classification pipeline
  const processLive = async (text: string, type: typeof sourceType, act: string) => {
    setRunning(true);
    const scrub = localDeterministicScrub(text);
    const st2 = localSemanticClassify(scrub.scrubbed, type);

    setScrubResult(scrub);
    setStage2Result(st2);

    if (projectId && typeof client.classifyText === 'function') {
      try {
        const recorded = await client.classifyText(projectId, {
          text,
          sourceType: type,
          actor: act,
        });
        setStreamItems((prev) => [recorded, ...prev.slice(0, 19)]);
      } catch {
        // Local simulation fallback
      }
    }
    setRunning(false);
  };

  useEffect(() => {
    if (!projectId || typeof client.listClassifierStream !== 'function') return;
    client
      .listClassifierStream(projectId, 15)
      .then((res) => {
        if (res?.items?.length) {
          setStreamItems(res.items);
        }
      })
      .catch(() => {});
  }, [client, projectId]);

  const rawTokensEstimate = Math.max(5, Math.round(inputText.length / 4));
  const compressedTokensEstimate =
    stage2Result.decision === 'discard'
      ? 0
      : Math.max(5, Math.round((stage2Result.distilledFact?.length ?? scrubResult.scrubbed.length) / 4));
  const savingsPct =
    rawTokensEstimate > 0
      ? Math.max(0, Math.round(((rawTokensEstimate - compressedTokensEstimate) / rawTokensEstimate) * 100))
      : 0;

  return (
    <Card
      title="Real-Time Context Compression & Laya Classifier Pipeline"
      action={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Badge tone={savingsPct >= 90 ? 'good' : 'neutral'}>
            {savingsPct}% Token Reduction
          </Badge>
          <Badge>Stage 1 + Stage 2 Latency: {(scrubResult.durationMs + stage2Result.durationMs).toFixed(2)}ms</Badge>
        </div>
      }
    >
      <p style={{ margin: '0 0 16px 0', color: '#94a3b8' }}>
        Live MitM interception pipeline: raw agent and tool turns pass through <strong>Stage 1 Deterministic Scrub (&lt;1ms)</strong> and{' '}
        <strong>Stage 2 Laya Semantic Classification</strong> to distill verified project invariants and prune ephemeral noise before entering long-term memory.
      </p>

      {/* Preset Pickers */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: '#64748b', alignSelf: 'center', marginRight: '4px' }}>
          Simulate Input:
        </span>
        {PRESETS.map((p, idx) => (
          <Button
            key={idx}
            variant="secondary"
            onClick={() => {
              setInputText(p.text);
              setSourceType(p.sourceType);
              setActor(p.actor);
              void processLive(p.text, p.sourceType, p.actor);
            }}
          >
            {p.title}
          </Button>
        ))}
      </div>

      {/* Interactive Input Form */}
      <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={3}
          style={{
            background: '#090d16',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            padding: '12px',
            fontFamily: 'Consolas, monospace',
            fontSize: '13px',
            color: '#f8fafc',
            width: '100%',
            boxSizing: 'border-box',
          }}
          placeholder="Enter raw session context, terminal logs, or user directives..."
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Role:</span>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
              style={{
                background: '#0f172a',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '12px',
              }}
            >
              <option value="user_message">user_message</option>
              <option value="tool_output">tool_output</option>
              <option value="assistant_thought">assistant_thought</option>
              <option value="system_message">system_message</option>
            </select>
            <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>Actor:</span>
            <input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              style={{
                background: '#0f172a',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: '4px',
                padding: '4px 8px',
                fontSize: '12px',
                width: '140px',
              }}
            />
          </div>
          <Button
            variant="primary"
            disabled={running}
            onClick={() => void processLive(inputText, sourceType, actor)}
          >
            {running ? 'Processing…' : '▶ Run Live Classifier'}
          </Button>
        </div>
      </div>

      {/* 3-Column Pipeline Stages */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '16px',
          marginBottom: '20px',
        }}
      >
        {/* Stage 0 / Raw Inbound */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            padding: '16px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '13px', color: '#f1f5f9' }}>Stage 0: Raw Context</strong>
            <Badge>{rawTokensEstimate} est. tokens</Badge>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>Length: {inputText.length} characters</div>
          <pre
            style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              padding: '10px',
              borderRadius: '4px',
              fontFamily: 'Consolas, monospace',
              fontSize: '12px',
              color: '#cbd5e1',
              maxHeight: '180px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {inputText}
          </pre>
        </div>

        {/* Stage 1 / Deterministic Scrub */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            padding: '16px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '13px', color: '#38bdf8' }}>Stage 1: Deterministic Scrub</strong>
            <Badge tone="good">{scrubResult.durationMs}ms</Badge>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <Badge tone="good">ANSI Stripped</Badge>
            <Badge tone="good">Scrollback Filtered</Badge>
            {scrubResult.isObviousNoise && <Badge tone="warning">Obvious Noise Detected</Badge>}
          </div>
          <pre
            style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              padding: '10px',
              borderRadius: '4px',
              fontFamily: 'Consolas, monospace',
              fontSize: '12px',
              color: '#38bdf8',
              maxHeight: '180px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}
          >
            {scrubResult.scrubbed || '[EMPTY NOISE - STRIPPED]'}
          </pre>
        </div>

        {/* Stage 2 / Laya Semantic Scoring */}
        <div
          style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            padding: '16px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '13px', color: '#a855f7' }}>Stage 2: Laya Classifier</strong>
            <Badge tone={stage2Result.decision === 'preserve' ? 'good' : 'neutral'}>
              Score: {stage2Result.signalScore.toFixed(2)}
            </Badge>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge
              tone={
                stage2Result.category === 'HARDWARE_SPEC'
                  ? 'good'
                  : stage2Result.category === 'ARCHITECTURAL_DECISION'
                    ? 'good'
                    : 'neutral'
              }
            >
              {stage2Result.category}
            </Badge>
            <Badge tone={stage2Result.decision === 'preserve' ? 'good' : 'warning'}>
              {stage2Result.decision === 'preserve' ? '✓ PRESERVED' : '✗ PRUNED NOISE'}
            </Badge>
          </div>
          <div
            style={{
              background: '#090d16',
              border: '1px solid #1e293b',
              padding: '10px',
              borderRadius: '4px',
              display: 'grid',
              gap: '6px',
              maxHeight: '180px',
              overflowY: 'auto',
            }}
          >
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>
              DISTILLED INVARIANT PUNCHLIST FACT:
            </span>
            <code style={{ fontSize: '12px', color: '#10b981', lineHeight: '1.4' }}>
              {stage2Result.distilledFact ?? '(Pruned as ephemeral log noise — 0 tokens retained)'}
            </code>
          </div>
        </div>
      </div>

      {/* Stage 3 Ground Truth Injection Box */}
      <div
        style={{
          background: '#0b1120',
          border: '1px solid #1d4ed8',
          borderRadius: '6px',
          padding: '14px 16px',
          display: 'grid',
          gap: '8px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '13px' }}>
              ✦ MitM Forwarded Ground Truth Block
            </span>
            <Badge tone="good">Injected into messages[0]</Badge>
          </div>
          <span style={{ fontSize: '12px', color: '#38bdf8', fontFamily: 'monospace' }}>
            Raw: {rawTokensEstimate} tokens ➔ Injected: {compressedTokensEstimate} tokens ({savingsPct}% saved)
          </span>
        </div>
        <pre
          style={{
            background: '#040711',
            border: '1px solid #1e293b',
            borderRadius: '4px',
            padding: '10px',
            fontFamily: 'Consolas, monospace',
            fontSize: '12px',
            color: '#a5f3fc',
            margin: 0,
            whiteSpace: 'pre-wrap',
          }}
        >
          {stage2Result.decision === 'preserve'
            ? `[PROJECT INTELLIGENCE: Verified Invariant]\n• [${stage2Result.category}] ${stage2Result.distilledFact}\n[ZERO-DISCOVERY CONTEXT RESTORED]`
            : `[NO NOISE INJECTED - CONTEXT CLEAN]`}
        </pre>
      </div>

      {/* Chronological Stream Feed */}
      <h3 style={{ fontSize: '14px', margin: '0 0 10px 0', color: '#f1f5f9' }}>
        Live Classification Stream Archive ({streamItems.length} events logged)
      </h3>
      {streamItems.length ? (
        <div
          style={{
            maxHeight: '220px',
            overflowY: 'auto',
            border: '1px solid #1e293b',
            borderRadius: '6px',
            background: '#090d16',
          }}
        >
          {streamItems.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom: '1px solid #1e293b',
                fontSize: '12px',
              }}
            >
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <Badge
                  tone={
                    item.category === 'HARDWARE_SPEC'
                      ? 'good'
                      : item.category === 'ARCHITECTURAL_DECISION'
                        ? 'good'
                        : 'neutral'
                  }
                >
                  {item.category}
                </Badge>
                <span style={{ color: '#cbd5e1' }}>
                  {item.distilledFact || `Raw turn (${item.rawLengthChars} chars)`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>{item.sourceActor}</span>
                <Badge tone={item.decision === 'preserve' ? 'good' : 'neutral'}>
                  Score: {item.signalScore.toFixed(2)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No classification stream events yet">
          Run the live classifier simulator or route an agent through the daemon to log turns here.
        </EmptyState>
      )}
    </Card>
  );
}
