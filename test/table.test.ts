import { describe, expect, it } from 'vitest';
import { formatLive, planTable } from '../src/core/table.js';
import type { CapPct, TableSize, TableType } from '../src/core/types.js';

const holds = (p: ReturnType<typeof planTable>) => p.rounds.map((r) => r.holdS);
const rests = (p: ReturnType<typeof planTable>) => p.rounds.map((r) => r.restS);

describe('table', () => {
  it('co2 quick', () => {
    const p = planTable({ pbS: 90, type: 'co2', size: 'quick', capPct: 0.5 });
    expect(holds(p)).toEqual([45, 45, 45]);
    expect(rests(p)).toEqual([60, 50, 40]);
    expect(p.liveS).toBe(339);
  });

  it('co2 full floors at 30', () => {
    const p = planTable({ pbS: 120, type: 'co2', size: 'full', capPct: 0.5 });
    expect(rests(p)).toEqual([90, 75, 60, 45, 30, 30, 30, 30]);
  });

  it('o2 standard grows to cap', () => {
    const p = planTable({ pbS: 100, type: 'o2', size: 'standard', capPct: 0.6 });
    expect(holds(p)).toEqual([36, 42, 48, 54, 60]);
    expect(new Set(rests(p))).toEqual(new Set([90]));
  });

  it('minimum hold 15', () => {
    const p = planTable({ pbS: 30, type: 'co2', size: 'quick', capPct: 0.5 });
    expect(holds(p)).toEqual([15, 15, 15]);
  });

  it('every hold sits between 15 s and the cap for every accepted PB', () => {
    const types: TableType[] = ['co2', 'o2'];
    const sizes: TableSize[] = ['quick', 'standard', 'full'];
    const caps: CapPct[] = [0.5, 0.55, 0.6];
    for (let pb = 30; pb <= 600; pb += 1) {
      for (const type of types) {
        for (const size of sizes) {
          for (const capPct of caps) {
            const cap = Math.round(capPct * pb);
            for (const h of holds(planTable({ pbS: pb, type, size, capPct }))) {
              expect(h).toBeLessThanOrEqual(cap);
              expect(h).toBeGreaterThanOrEqual(15);
            }
          }
        }
      }
    }
  });

  it('never exceeds cap', () => {
    const types: TableType[] = ['co2', 'o2'];
    const sizes: TableSize[] = ['quick', 'standard', 'full'];
    const caps: CapPct[] = [0.5, 0.55, 0.6];
    for (let pb = 30; pb <= 600; pb += 7) {
      for (const type of types) {
        for (const size of sizes) {
          for (const capPct of caps) {
            const limit = Math.max(15, Math.round(capPct * pb));
            const max = Math.max(...holds(planTable({ pbS: pb, type, size, capPct })));
            expect(max).toBeLessThanOrEqual(limit);
          }
        }
      }
    }
  });

  it('rejects bad PB', () => {
    for (const pb of [0, 601, 12.5, Number.NaN, 9, 10, 20, 29, 29.5, -30, Number.POSITIVE_INFINITY]) {
      expect(() => planTable({ pbS: pb, type: 'co2', size: 'quick', capPct: 0.5 })).toThrow(RangeError);
    }
  });

  it('counts live time the same way it is shown', () => {
    const p = planTable({ pbS: 90, type: 'co2', size: 'quick', capPct: 0.5 });
    expect(p.liveS).toBe(45 + p.rounds.reduce((s, r) => s + r.restS + r.holdS + 3, 0));
  });

  it('formats live time', () => {
    expect(formatLive(339)).toBe('≈ 5:39 live');
    expect(formatLive(60)).toBe('≈ 1:00 live');
    expect(formatLive(0)).toBe('≈ 0:00 live');
  });
});
