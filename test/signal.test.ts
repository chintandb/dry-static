import { describe, expect, it } from 'vitest';
import { cadenceHz, medianAbsDiff, movingMean, movingMedian, percentile, rollingRms } from '../src/core/signal.js';

const seq = (n: number, dt: number, f: (i: number) => number) => {
  const t: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < n; i += 1) {
    t.push(i * dt);
    v.push(f(i));
  }
  return { t, v };
};

describe('signal', () => {
  it('movingMedian removes a step spike', () => {
    const { t, v } = seq(101, 0.1, (i) => (i === 50 ? 100 : 5));
    const out = movingMedian(t, v, 1);
    expect(out[50]).toBeCloseTo(5, 6);
  });

  it('percentile', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([0, 10], 25)).toBe(2.5);
    expect(percentile([], 50)).toBeNaN();
  });

  it('cadenceHz', () => {
    const t = Array.from({ length: 50 }, (_, i) => i * 0.04);
    expect(cadenceHz(t)).toBeCloseTo(25, 2);
    expect(cadenceHz([1])).toBe(0);
  });

  it('medianAbsDiff', () => {
    expect(medianAbsDiff([0, 1, 0, 1, 0])).toBe(1);
    expect(medianAbsDiff([2])).toBeNaN();
  });

  it('movingMean follows a ramp', () => {
    const { t, v } = seq(20, 0.1, (i) => i);
    const out = movingMean(t, v, 0.5);
    expect(out[10]).toBeCloseTo(10, 6);
  });

  it('rollingRms is trailing', () => {
    const { t, v } = seq(60, 0.1, (i) => (i < 30 ? 1 : 0));
    const out = rollingRms(t, v, 1);
    expect(out[20]).toBeCloseTo(1, 1);
    expect(out[59]).toBeCloseTo(0, 1);
  });
});
