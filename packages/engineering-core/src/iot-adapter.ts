import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { DeviceTelemetrySchema, type DeviceTelemetry } from '@udi/contracts';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string | undefined;
  serialNumber?: string | undefined;
  deviceType: 'esp32' | 'arduino' | 'generic_serial';
}

export interface TelemetryParseResult {
  success: boolean;
  telemetry?: DeviceTelemetry | undefined;
  error?: string | undefined;
  rawPayload: string;
}

/**
 * Enumerates available serial ports on Linux/POSIX systems without requiring native addons.
 */
export async function enumerateSerialPorts(): Promise<SerialPortInfo[]> {
  const ports: SerialPortInfo[] = [];

  try {
    const devEntries = await readdir('/dev');
    for (const entry of devEntries) {
      if (entry.startsWith('ttyUSB') || entry.startsWith('ttyACM')) {
        const fullPath = `/dev/${entry}`;
        const isEsp = entry.startsWith('ttyUSB');
        ports.push({
          path: fullPath,
          deviceType: isEsp ? 'esp32' : 'arduino',
        });
      }
    }
  } catch {
    // If /dev is inaccessible (e.g. non-linux or restricted)
  }

  return ports;
}

/**
 * Parses documented telemetry messages (JSON format) and converts them
 * into validated DeviceTelemetry records.
 *
 * Example input:
 * {"deviceId": "esp32-rover-01", "metrics": {"voltage": 3.28, "current_ma": 142.5, "temp_c": 31.2}, "units": {"voltage": "V", "current_ma": "mA", "temp_c": "C"}}
 */
export function parseTelemetryMessage(
  rawPayload: string,
  projectId: string,
  defaultDeviceId = 'esp32-sensor-01',
): TelemetryParseResult {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    return {
      success: false,
      error: 'Empty telemetry payload received',
      rawPayload,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      success: false,
      error: `Malformed telemetry payload: ${err instanceof Error ? err.message : 'Invalid JSON'}`,
      rawPayload,
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      success: false,
      error: 'Telemetry payload must be a JSON object',
      rawPayload,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const deviceId =
    typeof obj.deviceId === 'string' && obj.deviceId ? obj.deviceId : defaultDeviceId;
  const now = new Date().toISOString();

  // Metrics must be record<string, number>
  const metrics: Record<string, number> = {};
  const units: Record<string, string> = {};

  if (obj.metrics && typeof obj.metrics === 'object') {
    for (const [k, v] of Object.entries(obj.metrics as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        metrics[k] = v;
      }
    }
  } else {
    // Flatten numeric root properties if no nested metrics object
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        metrics[k] = v;
      }
    }
  }

  if (obj.units && typeof obj.units === 'object') {
    for (const [k, v] of Object.entries(obj.units as Record<string, unknown>)) {
      if (typeof v === 'string') {
        units[k] = v;
      }
    }
  }

  // Populate default units if missing
  for (const k of Object.keys(metrics)) {
    if (!units[k]) {
      if (k.includes('volt') || k.endsWith('_v')) units[k] = 'V';
      else if (k.includes('temp') || k.endsWith('_c')) units[k] = 'C';
      else if (k.includes('humid')) units[k] = '%';
      else if (k.includes('ma')) units[k] = 'mA';
      else units[k] = 'raw';
    }
  }

  const candidate = {
    id: randomUUID(),
    projectId,
    deviceId,
    observedAt: typeof obj.observedAt === 'string' ? obj.observedAt : now,
    metrics,
    units,
    sourceKind: 'observed_tool' as const,
  };

  const validation = DeviceTelemetrySchema.safeParse(candidate);
  if (!validation.success) {
    return {
      success: false,
      error: `Telemetry schema validation failed: ${validation.error.message}`,
      rawPayload,
    };
  }

  return {
    success: true,
    telemetry: validation.data,
    rawPayload,
  };
}
