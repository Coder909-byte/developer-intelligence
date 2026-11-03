import type { FirmwareExtraction, ExtractedPin } from './types.js';
import { normalizePin } from './pin-normalizer.js';

/**
 * Parses pin definitions from C/C++ headers (#define, const int, constexpr)
 * or JSON pinmap files.
 */
export function parseFirmwarePins(content: string, filePath: string): FirmwareExtraction {
  const trimmed = content.trim();

  // Handle JSON pinmap
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        pins?: Record<string, string | number>;
        sourceFile?: string;
      };

      const pins = new Map<string, ExtractedPin>();
      if (parsed.pins && typeof parsed.pins === 'object') {
        for (const [name, rawPin] of Object.entries(parsed.pins)) {
          const rawStr = String(rawPin);
          pins.set(name, {
            signalName: name,
            pin: normalizePin(rawStr),
            rawPin: rawStr,
            evidence: {
              filePath,
              line: 1,
              excerpt: `"${name}": "${rawStr}"`,
            },
          });
        }
      }

      return {
        sourceFile: filePath,
        pins,
      };
    } catch {
      // Fall through to C/C++ parser
    }
  }

  // Parse C/C++ line by line
  const pins = new Map<string, ExtractedPin>();
  const lines = content.split('\n');

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const lineText = lines[idx] ?? '';
    const trimmedLine = lineText.trim();

    // Skip empty lines or pure comments
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
      continue;
    }

    // Match #define SIGNAL_NAME PIN_VALUE (e.g. #define MOTOR_EN GPIO26, #define MOTOR_EN 14)
    const defineMatch = trimmedLine.match(/^#define\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)/);
    if (defineMatch && defineMatch[1] && defineMatch[2]) {
      const signalName = defineMatch[1];
      const rawPin = defineMatch[2];

      // Ignore standard macro guards (e.g. #define _PINS_H, #define PINS_H_INCLUDED)
      if (rawPin === '1' && (signalName.endsWith('_H') || signalName.endsWith('_H_'))) {
        continue;
      }

      pins.set(signalName, {
        signalName,
        pin: normalizePin(rawPin),
        rawPin,
        evidence: {
          filePath,
          line: lineNum,
          excerpt: trimmedLine,
        },
      });
      continue;
    }

    // Match const / constexpr / static const int SIGNAL_NAME = PIN_VALUE;
    const constMatch = trimmedLine.match(
      /(?:const|constexpr|static\s+const)\s+(?:int|uint8_t|uint16_t|auto)\s+([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\s*;/,
    );
    if (constMatch && constMatch[1] && constMatch[2]) {
      const signalName = constMatch[1];
      const rawPin = constMatch[2];

      pins.set(signalName, {
        signalName,
        pin: normalizePin(rawPin),
        rawPin,
        evidence: {
          filePath,
          line: lineNum,
          excerpt: trimmedLine,
        },
      });
    }
  }

  return {
    sourceFile: filePath,
    pins,
  };
}
