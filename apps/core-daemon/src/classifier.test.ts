import { describe, it, expect } from 'vitest';
import {
  deterministicScrub,
  evaluateRuleClassifier,
  LayaClassifierService,
} from './classifier/laya-classifier.js';

describe('Laya Classifier & Scrubbing Pipeline', () => {
  it('strips ANSI escape codes, progress bars, and detects obvious noise', () => {
    const rawAnsi =
      '\u001b[32m[SUCCESS]\u001b[0m All tests passed \u001b[33m[=====>    ] 50%\u001b[0m';
    const result = deterministicScrub(rawAnsi);
    expect(result.scrubbed).not.toContain('\u001b');
    expect(result.scrubbed).toContain('[SUCCESS] All tests passed');
    expect(result.scrubbed).not.toContain('50%');

    const empty = deterministicScrub('   ');
    expect(empty.isObviousNoise).toBe(true);

    const npmLog = deterministicScrub(
      'npm notice created package in 45ms\nadded 14 packages in 2s',
    );
    expect(npmLog.isObviousNoise).toBe(true);
  });

  it('correctly classifies hardware pin invariants with high signal score', () => {
    const text =
      'Signal MOTOR_EN pin mismatch: netlist specifies GPIO14 but firmware configures GPIO26 in rover.net and src/pins.h';
    const classification = evaluateRuleClassifier(text, 'tool_output');
    expect(classification.category).toBe('HARDWARE_SPEC');
    expect(classification.signalScore).toBeGreaterThan(0.9);
    expect(classification.decision).toBe('preserve');
    expect(classification.distilledFact).toBeDefined();
  });

  it('correctly classifies architectural decisions and user constraints', () => {
    const text = 'Decision: preserve existing hardware wiring and patch src/pins.h directly';
    const classification = evaluateRuleClassifier(text, 'user_message');
    expect(classification.category).toBe('ARCHITECTURAL_DECISION');
    expect(classification.signalScore).toBeGreaterThan(0.85);
    expect(classification.decision).toBe('preserve');
    expect(classification.distilledFact).toContain('preserve existing hardware wiring');
  });

  it('correctly classifies validation outcomes', () => {
    const text = 'pin_consistency validation succeeded with exitCode: 0 and zero findings';
    const classification = evaluateRuleClassifier(text, 'tool_output');
    expect(classification.category).toBe('VALIDATED_OUTCOME');
    expect(classification.decision).toBe('preserve');
    expect(classification.distilledFact).toContain('validation succeeded with exitCode: 0');
  });

  it('prunes ephemeral noise with low signal score', () => {
    const text = 'Scanning workspace directories for configuration files... done.';
    const classification = evaluateRuleClassifier(text, 'assistant_thought');
    expect(classification.category).toBe('EPHEMERAL_NOISE');
    expect(classification.signalScore).toBeLessThan(0.5);
    expect(classification.decision).toBe('discard');
  });

  it('runs through LayaClassifierService and handles offline fallback cleanly', async () => {
    const service = new LayaClassifierService('http://127.0.0.1:9999/non-existent-laya');
    const result = await service.classify({
      projectId: 'a0000000-0000-4000-8000-000000000001',
      text: 'Signal MOTOR_EN mapped to GPIO14',
      sourceType: 'tool_output',
      actor: 'engineering-core',
    });

    expect(result.id).toBeDefined();
    expect(result.category).toBe('HARDWARE_SPEC');
    expect(result.decision).toBe('preserve');
    expect(result.signalScore).toBeGreaterThan(0.9);
  });
});
