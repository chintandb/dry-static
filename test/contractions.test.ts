import { describe, expect, it } from 'vitest';
import { detectContractions, matchTaps, pooledMatch } from '../src/core/contractions.js';
import { makeParams } from '../src/core/params.js';
import type { TracePoint } from '../src/core/types.js';

const p = makeParams();
const HZ = 25;

let seed = 11;
const gauss = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  const u = Math.max(seed / 4294967296, 1e-9);
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  const v = seed / 4294967296;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Flat hold with noise, plus optional jerks of (amplitude, width) at given times. */
const hold = (jerks: [number, number, number][] = [], seconds = 90): TracePoint[] => {
  const out: TracePoint[] = [];
  for (let i = 0; i < seconds * HZ; i += 1) {
    const t = i / HZ;
    let v = 0.03 * gauss();
    for (const [at, amp, width] of jerks) {
      if (t >= at && t < at + width) v += amp * Math.sin((Math.PI * (t - at)) / width);
    }
    out.push({ t, v, stable: true });
  }
  return out;
};

describe('detectContractions', () => {
  it('finds injected jerks', () => {
    const trace = hold([
      [50, 0.4, 0.3],
      [60, 0.4, 0.3],
      [68, 0.4, 0.3],
      [75, 0.4, 0.3],
    ]);
    const marks = detectContractions(trace, 0, 90, 1, [], p);
    expect(marks).toHaveLength(4);
    for (const mark of marks) {
      const nearest = [50, 60, 68, 75].reduce((best, at) => (Math.abs(at - mark) < Math.abs(best - mark) ? at : best), 50);
      expect(Math.abs(nearest - mark)).toBeLessThanOrEqual(0.5);
    }
  });

  it('marks within 0.35 s of the jerk peak', () => {
    const marks = detectContractions(hold([[50, 0.4, 0.3]]), 0, 90, 1, [], p);
    expect(marks).toHaveLength(1);
    expect(Math.abs(marks[0] - 50.15)).toBeLessThanOrEqual(0.35);
  });

  it('ignores single-sample noise spikes', () => {
    const trace = hold().map((pt) => (Math.abs(pt.t - 40) < 1e-6 || Math.abs(pt.t - 45) < 1e-6 || Math.abs(pt.t - 50) < 1e-6
      || Math.abs(pt.t - 55) < 1e-6 || Math.abs(pt.t - 60) < 1e-6 ? { ...pt, v: pt.v + 0.3 } : pt));
    expect(detectContractions(trace, 0, 90, 1, [], p)).toHaveLength(0);
  });

  it('no marks before t0 + 10 s', () => {
    const trace = hold([[6, 0.4, 0.3]]);
    expect(detectContractions(trace, 0, 90, 1, [], p)).toHaveLength(0);
  });

  it('refractory merges bursts', () => {
    const trace = hold([
      [50, 0.4, 0.3],
      [51, 0.4, 0.3],
    ]);
    expect(detectContractions(trace, 0, 90, 1, [], p)).toHaveLength(1);
  });

  it('skips unreadable spans', () => {
    const trace = hold([[60, 0.4, 0.3]]);
    expect(detectContractions(trace, 0, 90, 1, [[58, 62]], p)).toHaveLength(0);
  });

  it('scales with the calibrated amplitude', () => {
    const trace = hold([[50, 0.12, 0.3]]);
    expect(detectContractions(trace, 0, 90, 1, [], p)).toHaveLength(0);
    expect(detectContractions(trace, 0, 90, 0.2, [], p)).toHaveLength(0);
  });
});

describe('matchTaps', () => {
  it('matches one to one within tolerance', () => {
    const r = matchTaps([10, 20, 30], [10.5, 21.8, 40], 1.5);
    expect(r.matched).toBe(1);
    expect(r.precision).toBeCloseTo(1 / 3, 6);
    expect(r.recall).toBeCloseTo(1 / 3, 6);
  });

  it('reports null precision and recall without inputs', () => {
    const r = matchTaps([], [], 1.5);
    expect(r.precision).toBeNull();
    expect(r.recall).toBeNull();
    expect(r.f1).toBeNull();
  });

  it('uses one tap once', () => {
    const r = matchTaps([10, 10.6], [10.2], 1.5);
    expect(r.matched).toBe(1);
    expect(r.precision).toBeCloseTo(0.5, 6);
    expect(r.recall).toBe(1);
  });
});

describe('pooledMatch', () => {
  it('pooledMatch inconclusive under 6 taps', () => {
    const a = matchTaps([10], [10.2], 1.5);
    const b = matchTaps([20], [20.2], 1.5);
    const pooled = pooledMatch([a, b], 6);
    expect(pooled.taps).toBe(2);
    expect(pooled.matched).toBe(2);
    expect(pooled.inconclusive).toBe(true);
    expect(pooledMatch([a, b, a, b, a, b], 6).inconclusive).toBe(false);
  });
});
