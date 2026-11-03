import { randomUUID } from 'node:crypto';
import type { ValidationFinding } from '@udi/contracts';
import type { NetlistExtraction, FirmwareExtraction, EngineeringMap } from './types.js';
import { arePinsEqual, formatGpioDisplay } from './pin-normalizer.js';

export function validatePinConsistency(
  netlist: NetlistExtraction,
  firmware: FirmwareExtraction,
  projectId: string,
  jobId: string,
  engineeringMap?: EngineeringMap,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const now = new Date().toISOString();

  // 1. Check duplicate GPIO assignments in firmware (Pin Conflict)
  const gpioUsage = new Map<string, string[]>();
  for (const [sigName, fwPin] of firmware.pins.entries()) {
    const list = gpioUsage.get(fwPin.pin) ?? [];
    list.push(sigName);
    gpioUsage.set(fwPin.pin, list);
  }

  for (const [pin, signals] of gpioUsage.entries()) {
    if (signals.length > 1) {
      const firstSig = firmware.pins.get(signals[0]!)!;
      const secondSig = firmware.pins.get(signals[1]!)!;
      findings.push({
        id: randomUUID(),
        projectId,
        jobId,
        createdAt: now,
        updatedAt: now,
        ruleId: 'pin_conflict',
        severity: 'error',
        message: `Duplicate GPIO assignment: signals [${signals.join(', ')}] both configure pin ${formatGpioDisplay(pin)}`,
        expected: { conflict: false, pin: formatGpioDisplay(pin) },
        observed: { signals, pin: formatGpioDisplay(pin) },
        evidence: [
          {
            filePath: firmware.sourceFile,
            line: firstSig.evidence.line,
            excerpt: firstSig.evidence.excerpt,
          },
          {
            filePath: firmware.sourceFile,
            line: secondSig.evidence.line,
            excerpt: secondSig.evidence.excerpt,
          },
        ],
        suggestedFix: `Assign distinct GPIO pins to signals ${signals.join(', ')}`,
        status: 'open',
        verifiedBy: {
          tool: 'engineering-core/pin-validator',
          version: '1.0.0',
        },
      });
    }
  }

  // 2. Check each firmware signal against netlist
  for (const [sigName, fwPin] of firmware.pins.entries()) {
    // Check if signal exists directly in netlist
    let netlistSignal = netlist.signals.get(sigName);

    // If not found directly, check engineering-map
    if (!netlistSignal && engineeringMap?.signals[sigName]) {
      const mapEntry = engineeringMap.signals[sigName]!;
      netlistSignal = {
        signalName: sigName,
        pin: mapEntry.gpio,
        rawPin: mapEntry.gpio,
        componentRef: mapEntry.component ?? engineeringMap.mcuComponent,
        mcuPin: mapEntry.mcuPin,
        evidence: {
          filePath: netlist.sourceFile,
          line: 1,
          excerpt: `Mapped via engineering-map: ${sigName} -> ${mapEntry.gpio}`,
        },
      };
    }

    // Try case-insensitive matching if still not found
    if (!netlistSignal) {
      for (const [netSigName, candidate] of netlist.signals.entries()) {
        if (netSigName.toUpperCase() === sigName.toUpperCase()) {
          netlistSignal = candidate;
          break;
        }
      }
    }

    if (!netlistSignal) {
      findings.push({
        id: randomUUID(),
        projectId,
        jobId,
        createdAt: now,
        updatedAt: now,
        ruleId: 'pin_missing_in_netlist',
        severity: 'warning',
        message: `Firmware signal ${sigName} has no corresponding connection in netlist ${netlist.sourceFile}`,
        expected: { signal: sigName, status: 'connected' },
        observed: { signal: sigName, status: 'missing_in_netlist' },
        evidence: [
          {
            filePath: firmware.sourceFile,
            line: fwPin.evidence.line,
            excerpt: fwPin.evidence.excerpt,
          },
        ],
        suggestedFix: `Verify schematic netlist or add alias in engineering-map.json for ${sigName}`,
        status: 'open',
        verifiedBy: {
          tool: 'engineering-core/pin-validator',
          version: '1.0.0',
        },
      });
      continue;
    }

    // Compare pins
    if (!arePinsEqual(netlistSignal.pin, fwPin.pin)) {
      const expectedDisplay = formatGpioDisplay(netlistSignal.pin);
      const observedDisplay = formatGpioDisplay(fwPin.pin);

      findings.push({
        id: randomUUID(),
        projectId,
        jobId,
        createdAt: now,
        updatedAt: now,
        ruleId: 'pin_consistency',
        severity: 'error',
        message: `Signal ${sigName} pin mismatch: netlist specifies ${expectedDisplay} but firmware configures ${observedDisplay}`,
        expected: {
          signal: sigName,
          pin: expectedDisplay,
          sourceFile: netlist.sourceFile,
          component: netlistSignal.componentRef ?? null,
          mcuPin: netlistSignal.mcuPin ?? null,
        },
        observed: {
          signal: sigName,
          pin: observedDisplay,
          sourceFile: firmware.sourceFile,
        },
        evidence: [
          {
            filePath: netlist.sourceFile,
            line: netlistSignal.evidence.line,
            excerpt: netlistSignal.evidence.excerpt,
          },
          {
            filePath: firmware.sourceFile,
            line: fwPin.evidence.line,
            excerpt: fwPin.evidence.excerpt,
          },
        ],
        suggestedFix: `Update ${firmware.sourceFile} line ${fwPin.evidence.line ?? 1} to: #define ${sigName} ${expectedDisplay}`,
        status: 'open',
        verifiedBy: {
          tool: 'engineering-core/pin-validator',
          version: '1.0.0',
        },
      });
    }
  }

  return findings;
}
