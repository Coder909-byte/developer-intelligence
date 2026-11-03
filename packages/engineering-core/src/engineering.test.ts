import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  normalizePin,
  arePinsEqual,
  formatGpioDisplay,
  parseKiCadNetlist,
  parseFirmwarePins,
  validatePinConsistency,
  parseTelemetryMessage,
  DefaultEngineeringValidator,
} from './index.js';
import type { ToolRunner } from '@udi/tool-runners';

const repoRoot = resolve(import.meta.dirname, '../../..');
const roverDir = resolve(repoRoot, 'examples/rover');

describe('pin-normalizer', () => {
  it('normalizes GPIO strings to numbers', () => {
    expect(normalizePin('GPIO14')).toBe('14');
    expect(normalizePin('gpio14')).toBe('14');
    expect(normalizePin('IO14')).toBe('14');
    expect(normalizePin('io14')).toBe('14');
    expect(normalizePin('PIN_14')).toBe('14');
    expect(normalizePin('14')).toBe('14');
    expect(normalizePin(14)).toBe('14');
  });

  it('preserves named pins', () => {
    expect(normalizePin('SDA')).toBe('SDA');
    expect(normalizePin('tx')).toBe('TX');
  });

  it('compares pins for equality correctly', () => {
    expect(arePinsEqual('GPIO14', '14')).toBe(true);
    expect(arePinsEqual('gpio26', 'GPIO26')).toBe(true);
    expect(arePinsEqual('GPIO14', 'GPIO26')).toBe(false);
  });

  it('formats display names', () => {
    expect(formatGpioDisplay('14')).toBe('GPIO14');
    expect(formatGpioDisplay('GPIO26')).toBe('GPIO26');
    expect(formatGpioDisplay('SDA')).toBe('SDA');
  });
});

describe('KiCad S-expression netlist parser', () => {
  const sampleSExpr = `(export (version "E")
    (components
      (comp (ref "U1") (value "DRV8833") (footprint "TSSOP-16"))
      (comp (ref "U2") (value "ESP32-WROOM-32") (footprint "ESP32")))
    (nets
      (net (code "1") (name "Net-(U1-MOTOR_EN)")
        (node (ref "U1") (pin "10") (pinfunction "nSLEEP"))
        (node (ref "U2") (pin "12") (pinfunction "IO14")))
      (net (code "2") (name "Net-(U1-MOTOR_IN1)")
        (node (ref "U1") (pin "1") (pinfunction "IN1"))
        (node (ref "U2") (pin "11") (pinfunction "IO27")))))`;

  it('extracts components and nets with pin mappings', () => {
    const netlist = parseKiCadNetlist(sampleSExpr, 'rover.net');
    expect(netlist.components).toHaveLength(2);
    expect(netlist.nets).toHaveLength(2);

    const motorEn = netlist.signals.get('MOTOR_EN');
    expect(motorEn).toBeDefined();
    expect(motorEn?.pin).toBe('14');
    expect(motorEn?.componentRef).toBe('U2');
    expect(motorEn?.mcuPin).toBe('12');
  });

  it('parses normalized JSON netlists as well', () => {
    const jsonNetlist = JSON.stringify({
      board: 'esp32',
      signals: [
        { name: 'MOTOR_EN', gpio: 'GPIO14', component: 'U2', pin: '12' },
      ],
    });
    const netlist = parseKiCadNetlist(jsonNetlist, 'rover.json');
    expect(netlist.signals.get('MOTOR_EN')?.pin).toBe('14');
  });
});

describe('Firmware pin parser', () => {
  const headerContent = `#pragma once
#define MOTOR_EN GPIO26
#define MOTOR_IN1 GPIO27
const int STATUS_LED = 2;
`;

  it('extracts defines and const declarations with line numbers', () => {
    const fw = parseFirmwarePins(headerContent, 'src/pins.h');
    expect(fw.pins.get('MOTOR_EN')?.pin).toBe('26');
    expect(fw.pins.get('MOTOR_EN')?.evidence.line).toBe(2);
    expect(fw.pins.get('MOTOR_IN1')?.pin).toBe('27');
    expect(fw.pins.get('STATUS_LED')?.pin).toBe('2');
    expect(fw.pins.get('STATUS_LED')?.evidence.line).toBe(4);
  });
});

describe('Deterministic circuit-to-firmware pin consistency', () => {
  const sampleNetlist = parseKiCadNetlist(
    `(export (version "E")
      (nets
        (net (code "1") (name "Net-(U1-MOTOR_EN)")
          (node (ref "U1") (pin "10"))
          (node (ref "U2") (pin "12") (pinfunction "IO14")))
        (net (code "2") (name "Net-(U1-MOTOR_IN1)")
          (node (ref "U1") (pin "1"))
          (node (ref "U2") (pin "11") (pinfunction "IO27")))))`,
    'rover.net',
  );

  const mismatchedFw = parseFirmwarePins(
    `#define MOTOR_EN GPIO26\n#define MOTOR_IN1 GPIO27`,
    'src/pins.h',
  );

  const correctedFw = parseFirmwarePins(
    `#define MOTOR_EN GPIO14\n#define MOTOR_IN1 GPIO27`,
    'src/pins.h',
  );

  const projectId = randomUUID();
  const jobId = randomUUID();

  it('detects pin mismatch with precise evidence and suggested fix', () => {
    const findings = validatePinConsistency(sampleNetlist, mismatchedFw, projectId, jobId);
    expect(findings).toHaveLength(1);

    const f = findings[0]!;
    expect(f.ruleId).toBe('pin_consistency');
    expect(f.severity).toBe('error');
    expect(f.message).toContain('MOTOR_EN');
    expect(f.message).toContain('GPIO14');
    expect(f.message).toContain('GPIO26');
    expect(f.expected).toEqual({
      signal: 'MOTOR_EN',
      pin: 'GPIO14',
      sourceFile: 'rover.net',
      component: 'U2',
      mcuPin: '12',
    });
    expect(f.observed).toEqual({
      signal: 'MOTOR_EN',
      pin: 'GPIO26',
      sourceFile: 'src/pins.h',
    });
    expect(f.evidence).toHaveLength(2);
    expect(f.evidence[1]?.filePath).toBe('src/pins.h');
    expect(f.evidence[1]?.line).toBe(1);
    expect(f.suggestedFix).toContain('#define MOTOR_EN GPIO14');
  });

  it('passes cleanly when firmware matches schematic netlist', () => {
    const findings = validatePinConsistency(sampleNetlist, correctedFw, projectId, jobId);
    expect(findings).toHaveLength(0);
  });

  it('identifies duplicate GPIO pin conflicts', () => {
    const conflictingFw = parseFirmwarePins(
      `#define MOTOR_IN1 GPIO27\n#define MOTOR_IN2 GPIO27`,
      'src/pins.h',
    );
    const findings = validatePinConsistency(sampleNetlist, conflictingFw, projectId, jobId);
    const conflict = findings.find((f) => f.ruleId === 'pin_conflict');
    expect(conflict).toBeDefined();
    expect(conflict?.severity).toBe('error');
  });

  it('warns on signals missing in netlist', () => {
    const fwWithExtra = parseFirmwarePins(
      `#define UNKNOWN_SENSOR GPIO33`,
      'src/pins.h',
    );
    const findings = validatePinConsistency(sampleNetlist, fwWithExtra, projectId, jobId);
    const missing = findings.find((f) => f.ruleId === 'pin_missing_in_netlist');
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe('warning');
  });
});

describe('IoT telemetry adapter', () => {
  const projectId = randomUUID();

  it('parses valid telemetry payload with metrics and units', () => {
    const raw = JSON.stringify({
      deviceId: 'esp32-rover',
      metrics: { voltage: 3.28, current_ma: 145.2, temp_c: 28.4 },
      units: { voltage: 'V', current_ma: 'mA', temp_c: 'C' },
    });
    const result = parseTelemetryMessage(raw, projectId);
    expect(result.success).toBe(true);
    expect(result.telemetry?.deviceId).toBe('esp32-rover');
    expect(result.telemetry?.metrics.voltage).toBe(3.28);
    expect(result.telemetry?.units.current_ma).toBe('mA');
    expect(result.telemetry?.sourceKind).toBe('observed_tool');
  });

  it('rejects malformed telemetry cleanly', () => {
    const result = parseTelemetryMessage('not-valid-json', projectId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Malformed');
  });

  it('rejects empty telemetry payload', () => {
    const result = parseTelemetryMessage('   ', projectId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Empty');
  });
});

describe('DefaultEngineeringValidator end-to-end on examples/rover fixture', () => {
  const mockRunner: ToolRunner = {
    isAvailable: async () => false,
    run: async () => ({
      exitCode: 127,
      stdoutTail: '',
      stderrTail: 'unavailable',
      timedOut: false,
      cancelled: false,
      artifacts: [],
    }),
  };

  const validator = new DefaultEngineeringValidator({
    runner: mockRunner,
    resolveWorkspace: async () => roverDir,
  });

  it('runs pin_consistency on mismatched rover.net and src/pins.h producing failed job and finding', async () => {
    const result = await validator.validate({
      projectId: randomUUID(),
      kind: 'pin_consistency',
      artifactPaths: ['rover.net', 'src/pins.h', 'engineering-map.json'],
      requestedBy: 'test-suite',
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.exitCode).toBe(1);
    expect(result.findings.length).toBeGreaterThan(0);

    const mismatch = result.findings.find((f) => f.ruleId === 'pin_consistency');
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe('error');
    expect(mismatch?.message).toContain('MOTOR_EN');
  });

  it('runs pin_consistency on corrected rover.net and src/pins_corrected.h producing succeeded job', async () => {
    const result = await validator.validate({
      projectId: randomUUID(),
      kind: 'pin_consistency',
      artifactPaths: ['rover.net', 'src/pins_corrected.h', 'engineering-map.json'],
      requestedBy: 'test-suite',
    });

    expect(result.job.status).toBe('succeeded');
    expect(result.job.exitCode).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it('reports unavailable toolchain without claiming fake pass for platformio', async () => {
    const result = await validator.validate({
      projectId: randomUUID(),
      kind: 'platformio_build',
      artifactPaths: ['platformio.ini'],
      requestedBy: 'test-suite',
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.exitCode).toBe(127);
    expect(result.job.stderrTail).toContain('PlatformIO toolchain is not available');
    expect(result.findings.some((f) => f.ruleId === 'platformio_toolchain_unavailable')).toBe(true);
  });

  it('reports unavailable toolchain without claiming fake pass for rtl simulation', async () => {
    const result = await validator.validate({
      projectId: randomUUID(),
      kind: 'rtl_simulation',
      artifactPaths: ['examples/rtl-alu/alu.v', 'examples/rtl-alu/alu_tb.v'],
      requestedBy: 'test-suite',
    });

    expect(result.job.status).toBe('failed');
    expect(result.job.exitCode).toBe(127);
    expect(result.job.stderrTail).toContain('Icarus Verilog toolchain is not available');
  });
});
