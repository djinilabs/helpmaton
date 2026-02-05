/**
 * Parses and validates the `limit` query parameter for paginated list endpoints.
 * Returns a number in [1, max], or default when value is missing/invalid.
 *
 * - Invalid or non-numeric values (e.g. "abc") fall back to default (avoids NaN being passed to DynamoDB).
 * - Values below 1 are clamped to 1; values above max are clamped to max.
 * - Decimal strings (e.g. "123.456") are truncated to integer via parseInt (123).
 */
export function parseLimitParam(
  value: unknown,
  options: { default?: number; max?: number } = {}
): number {
  const defaultLimit = options.default ?? 50;
  const max = options.max ?? 100;
  if (value === undefined || value === null || typeof value !== "string") {
    return defaultLimit;
  }
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return defaultLimit;
  }
  return Math.min(Math.max(parsed, 1), max);
}
