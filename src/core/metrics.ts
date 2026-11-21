/**
 * Which signals the app asks the SDK for.
 *
 * Codes 3-7 (breathing amplitude, apnea, respiratory line length, baseline,
 * inhale:exhale ratio) are Unavailable: requesting one makes `start()` throw
 * `kConfigurationFailed`, so they are filtered out of every set.
 */
export const UNAVAILABLE_CODES: readonly number[] = [3, 4, 5, 6, 7];

/** chest breathing, abdomen breathing, breathing rate, pulse rate, talking */
export const REQUESTED_METRICS: readonly number[] = [0, 1, 2, 15, 13];

export function sanitizeMetrics(codes: readonly number[]): number[] {
  const out: number[] = [];
  for (const code of codes) {
    if (!Number.isInteger(code) || code < 0) continue;
    if (UNAVAILABLE_CODES.includes(code)) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/** CHEST_BREATHING, ABDOMEN_BREATHING, BREATHING_RATE: the SDK's `breathingMetrics` bundle. */
export const BREATHING_METRICS: readonly number[] = [0, 1, 2];

/** kConfigurationFailed (3) and kMetricNotAuthorized (13): the key or config refused a metric. */
export const METRIC_REFUSAL_CODES: readonly number[] = [3, 13];

export function isMetricRefusal(code: number): boolean {
  return METRIC_REFUSAL_CODES.includes(code);
}

/**
 * Decide what to do after an SDK error that arrived before any metrics did.
 *
 * A refused metric set (code 3 or 13) gets exactly one retry with breathing only, since a
 * key that cannot use pulse or talking can still produce the chest and abdomen traces.
 * Returns the set to retry with, or `null` when the error should be reported as is
 * (another code, or the breathing-only retry already happened).
 */
export function nextMetricsAfterError(
  code: number,
  alreadyFellBack: boolean,
  breathing: readonly number[] = BREATHING_METRICS,
): number[] | null {
  if (alreadyFellBack || !isMetricRefusal(code)) return null;
  const set = sanitizeMetrics(breathing);
  return set.length > 0 ? set : null;
}
