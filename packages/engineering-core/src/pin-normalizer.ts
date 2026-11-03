/**
 * Normalizes pin identifiers to a canonical representation.
 * Examples:
 *  "GPIO14" -> "14"
 *  "gpio14" -> "14"
 *  "IO14"   -> "14"
 *  "io14"   -> "14"
 *  "14"     -> "14"
 *  "PIN_14" -> "14"
 * Non-numeric / named pins (e.g. "SDA", "TX") are trimmed and uppercase.
 */
export function normalizePin(raw: string | number): string {
  const str = String(raw).trim();
  const gpioMatch = str.match(/^(?:GPIO|IO|PIN|P)[_-]?([0-9]+)$/i);
  if (gpioMatch && gpioMatch[1] !== undefined) {
    return String(Number.parseInt(gpioMatch[1], 10));
  }
  if (/^[0-9]+$/.test(str)) {
    return String(Number.parseInt(str, 10));
  }
  return str.toUpperCase();
}

/**
 * Returns formatted display name for a GPIO pin, e.g. "GPIO14".
 */
export function formatGpioDisplay(raw: string | number): string {
  const norm = normalizePin(raw);
  if (/^[0-9]+$/.test(norm)) {
    return `GPIO${norm}`;
  }
  return norm;
}

/**
 * Compares two pin representations for equality after normalization.
 */
export function arePinsEqual(pinA: string | number, pinB: string | number): boolean {
  return normalizePin(pinA) === normalizePin(pinB);
}
