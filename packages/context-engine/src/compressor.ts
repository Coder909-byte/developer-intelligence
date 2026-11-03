import { stripVTControlCharacters } from 'node:util';
import {
  CompressedContextResultSchema,
  IdSchema,
  type CompressedContextResult,
  type ContextRecord,
  type ValidationFinding,
  type ActivityEvent,
  type Job,
} from '@udi/contracts';

/** A projection of real classified activity, not a competing classifier or Laya service. */
export interface CompressionInput {
  projectId: string;
  projectName?: string;
  records: ContextRecord[];
  findings: ValidationFinding[];
  events?: ActivityEvent[];
  latestJob?: Job;
  sessionTurns?: number;
}
export class CompressionUnavailableError extends Error {}
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
const clean = (text: string) => stripVTControlCharacters(text).replace(/\s+/g, ' ').trim();
const quote = (text: string) => clean(text).replace(/[\r\n]/g, ' ');
function checkScope(input: CompressionInput) {
  IdSchema.parse(input.projectId);
  if (
    [
      ...input.records,
      ...input.findings,
      ...(input.events ?? []),
      ...(input.latestJob ? [input.latestJob] : []),
    ].some((r) => r.projectId !== input.projectId)
  )
    throw new Error('Compression input crosses project scope');
}
function result(
  input: CompressionInput,
  mode: CompressedContextResult['mode'],
  block: string,
  invariants: string[],
  open: number,
): CompressedContextResult {
  const raw =
    input.records.map((r) => r.text).join('\n') +
    JSON.stringify(input.findings) +
    (input.events ?? []).map((e) => JSON.stringify(e.payload)).join('\n');
  const rawTokensEstimate = estimateTokens(raw);
  const compressedTokensEstimate = estimateTokens(block);
  return CompressedContextResultSchema.parse({
    projectId: input.projectId,
    mode,
    rawTokensEstimate,
    compressedTokensEstimate,
    savingsPercent: rawTokensEstimate
      ? Math.max(0, (1 - compressedTokensEstimate / rawTokensEstimate) * 100)
      : 0,
    injectedBlock: block,
    activeInvariants: invariants,
    openIssuesCount: open,
    generatedAt: new Date().toISOString(),
  });
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function buildDeterministicDelta(input: CompressionInput): CompressedContextResult {
  checkScope(input);
  // A passed current job supersedes old open findings without rewriting historical results.
  const relevant = input.latestJob
    ? input.findings.filter((f) => f.jobId === input.latestJob!.id)
    : input.findings;
  const open = relevant.filter((f) => f.status === 'open');
  const invariants = new Set<string>();
  const hardware: string[] = [];
  for (const f of open) {
    const expected = object(f.expected),
      observed = object(f.observed);
    if (typeof expected.signal === 'string' && typeof expected.pin === 'string') {
      const binding = `${quote(expected.signal)}=${quote(expected.pin)}`;
      invariants.add(binding);
      const component = typeof expected.component === 'string' ? expected.component : '';
      const pin = typeof expected.mcuPin === 'string' ? ` pin ${expected.mcuPin}` : '';
      const evidence = f.evidence
        .map((e) => `${e.filePath}${e.line ? `:${e.line}` : ''}`)
        .join(', ');
      hardware.push(
        `- [HW] ${binding}${component ? ` (${component}${pin})` : ''}; observed=${quote(String(observed.pin ?? 'unknown'))} (${evidence})`,
      );
    }
  }
  const authoritative = input.records
    .filter(
      (r) =>
        r.provenance.sourceKind === 'user_entered' || r.provenance.sourceKind === 'observed_tool',
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const latestBindings = new Map<string, { binding: string; provenance: string }>();
  for (const r of authoritative.filter((r) => r.kind === 'fact')) {
    // Extract explicit bindings only; arbitrary scrollback and conversational text are omitted.
    // Historical validator facts are represented by the current job/findings above.
    if (r.provenance.sourceRef && input.findings.some((f) => f.jobId === r.provenance.sourceRef))
      continue;
    const matches = clean(r.text).matchAll(
      /\b([A-Za-z_]\w*)\s*(?:=|->|is mapped to|mapped to)\s*(GPIO\d+)\b/g,
    );
    for (const m of matches) {
      latestBindings.set(m[1]!, {
        binding: `${m[1]}=${m[2]}`,
        provenance: `${r.provenance.sourceKind}:${r.provenance.actor}`,
      });
    }
  }
  for (const [signal, { binding, provenance }] of latestBindings) {
    // Current validator evidence overrides historical narrative bindings for the same signal.
    if ([...invariants].some((existing) => existing.startsWith(`${signal}=`))) continue;
    hardware.push(`- [HW] ${binding} [${provenance}]`);
    invariants.add(binding);
  }
  const decisions = [
    ...new Set(
      authoritative
        .filter((r) => r.kind === 'decision')
        .map(
          (r) => `- [DECISION] [${r.provenance.sourceKind}:${r.provenance.actor}] ${quote(r.text)}`,
        ),
    ),
  ];
  const issues = open.map((f) => `- [ISSUE] ${quote(f.message)}`);
  let status = open.length
    ? `${open.length} open finding(s).`
    : input.latestJob?.status === 'succeeded'
      ? 'Latest validation succeeded; zero active findings. No build result implied.'
      : 'No verified current validation pass.';
  if (input.latestJob && input.latestJob.status !== 'succeeded' && !open.length)
    status = `Latest validation ${input.latestJob.status}; zero findings does not establish a pass.`;
  const block = [
    `## Active Project State: ${quote(input.projectName ?? input.projectId)}`,
    ...new Set(hardware),
    ...decisions,
    ...new Set(issues),
    `- [STATUS] ${status}`,
  ].join('\n');
  return result(input, 'deterministic_delta', block, [...invariants].sort(), open.length);
}
export function buildDistilledRollup(input: CompressionInput): CompressedContextResult {
  checkScope(input);
  const events = [...(input.events ?? [])].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const turns =
    input.sessionTurns ??
    events.filter((e) => object(e.payload).sourceType === 'user_message').length;
  if (turns <= 10) return buildDeterministicDelta(input);
  const completed: string[] = [],
    truth: string[] = [],
    next: string[] = [];
  for (const e of events) {
    const p = object(e.payload);
    if (
      typeof p.signalScore !== 'number' ||
      p.signalScore < 0.7 ||
      p.decision === 'discard' ||
      typeof p.distilledFact !== 'string' ||
      p.category === 'EPHEMERAL_NOISE'
    )
      continue;
    // Trust the original activity provenance, not classifier-supplied assertions of truth.
    const provenance = {
      sourceKind:
        p.sourceType === 'assistant_thought'
          ? 'agent_summary'
          : p.sourceType === 'user_message' && e.sourceKind === 'observed_tool'
            ? 'user_entered'
            : e.sourceKind,
      actor: e.actor,
      ...(e.sourceRef ? { sourceRef: e.sourceRef } : {}),
    };
    const line = `- [${provenance.sourceKind}:${provenance.actor}] ${quote(p.distilledFact)}`;
    if (
      p.category === 'HARDWARE_SPEC' &&
      ['observed_tool', 'user_entered'].includes(provenance.sourceKind)
    )
      truth.push(line);
    else if (p.category === 'VALIDATED_OUTCOME') completed.push(line);
    else next.push(line);
  }
  if (!completed.length && !truth.length && !next.length)
    throw new CompressionUnavailableError(
      'AI rollup requires high-signal classified events from Backend Spec 1',
    );
  const deterministic = buildDeterministicDelta(input);
  const block = [
    '## What was completed',
    ...new Set(completed),
    '## Current verified ground truth',
    ...new Set(truth),
    ...deterministic.injectedBlock.split('\n').filter((line) => line.startsWith('- [HW]')),
    '## What is blocked / next steps',
    ...new Set(next),
  ].join('\n');
  return result(
    input,
    'ai_distillation',
    block,
    deterministic.activeInvariants,
    deterministic.openIssuesCount,
  );
}
