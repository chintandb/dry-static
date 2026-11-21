import { describe, expect, it } from 'vitest';
import {
  BREATHING_METRICS,
  isMetricRefusal,
  nextMetricsAfterError,
  REQUESTED_METRICS,
  sanitizeMetrics,
  UNAVAILABLE_CODES,
} from '../src/core/metrics.js';

describe('metrics', () => {
  it('never requests an unavailable code', () => {
    for (const code of REQUESTED_METRICS) expect(UNAVAILABLE_CODES.includes(code)).toBe(false);
    const set = nextMetricsAfterError(13, false) ?? [];
    for (const code of set) expect(UNAVAILABLE_CODES.includes(code)).toBe(false);
  });

  it('requests chest, abdomen, rate, pulse and talking', () => {
    expect([...REQUESTED_METRICS]).toEqual([0, 1, 2, 15, 13]);
  });

  it('dedupes and keeps order', () => {
    expect(sanitizeMetrics([2, 2, 15, 3, 13, 15])).toEqual([2, 15, 13]);
  });

  it('breathing set is chest, abdomen and rate (the SDK breathingMetrics bundle)', () => {
    expect([...BREATHING_METRICS]).toEqual([0, 1, 2]);
  });
});

describe('nextMetricsAfterError', () => {
  it('falls back to breathing only on kMetricNotAuthorized', () => {
    expect(nextMetricsAfterError(13, false)).toEqual([0, 1, 2]);
  });

  it('falls back to breathing only on kConfigurationFailed', () => {
    expect(nextMetricsAfterError(3, false)).toEqual([0, 1, 2]);
  });

  it('fallback set is a strict subset of the request, without pulse or talking', () => {
    const set = nextMetricsAfterError(13, false) ?? [];
    expect(set).not.toContain(15);
    expect(set).not.toContain(13);
    for (const code of set) expect(REQUESTED_METRICS).toContain(code);
    expect(set.length).toBeLessThan(REQUESTED_METRICS.length);
  });

  it('retries only once', () => {
    expect(nextMetricsAfterError(13, true)).toBeNull();
    expect(nextMetricsAfterError(3, true)).toBeNull();
  });

  it('does not fall back on other errors', () => {
    for (const code of [0, 1, 2, 4, 5, 6, 7, 8, 14]) expect(nextMetricsAfterError(code, false)).toBeNull();
  });

  it('uses the bundle it is given', () => {
    expect(nextMetricsAfterError(13, false, [0, 1, 2, 4])).toEqual([0, 1, 2]);
    expect(nextMetricsAfterError(13, false, [])).toBeNull();
  });

  it('isMetricRefusal', () => {
    expect(isMetricRefusal(3)).toBe(true);
    expect(isMetricRefusal(13)).toBe(true);
    expect(isMetricRefusal(2)).toBe(false);
  });
});
