import { describe, expect, it } from 'vitest';
import { createNormalizeState, normalizeRaw, rawFromDecoded, toNumber } from '../src/core/normalize.js';
import type { RawPacket } from '../src/core/types.js';

const emptyRaw = (wallMs = 0): RawPacket => ({
  wallMs, tsUs: 0, upper: [], lower: [], rate: [], pulse: [], talking: [],
});

describe('normalize', () => {
  it('converts Long timestamps', () => {
    expect(toNumber({ toNumber: () => 5 })).toBe(5);
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(7)).toBe(7);
  });

  it('handles missing sections', () => {
    const raw = rawFromDecoded({}, 0, 0);
    expect(raw.upper).toEqual([]);
    expect(raw.lower).toEqual([]);
    expect(raw.rate).toEqual([]);
    expect(raw.pulse).toEqual([]);
    expect(raw.talking).toEqual([]);

    const one = rawFromDecoded(
      { breathing: { upperTrace: [{ value: 1, stable: true, timestamp: 10 }] } },
      0,
      0,
    );
    expect(one.upper).toEqual([[10, 1, true]]);
    expect(one.lower).toEqual([]);
  });

  it('reads confidence and talking from their nested sections', () => {
    const raw = rawFromDecoded(
      {
        cardio: { pulseRate: [{ value: 71, confidence: 80, stable: true, timestamp: 5 }] },
        face: { talking: [{ detected: true, stable: true, timestamp: 6 }] },
      },
      123,
      9,
    );
    expect(raw.pulse).toEqual([[5, 71, 80, true]]);
    expect(raw.talking).toEqual([[6, true]]);
    expect(raw.wallMs).toBe(123);
  });

  it('sets origin from first sample', () => {
    const s = createNormalizeState();
    const a = normalizeRaw({ ...emptyRaw(), upper: [[2_000_000, 1, true]] }, s);
    expect(a.upper[0].t).toBe(0);
    const b = normalizeRaw({ ...emptyRaw(), upper: [[3_500_000, 1, true]] }, s);
    expect(b.upper[0].t).toBe(1.5);
  });

  it('dedupes overlapping arrays', () => {
    const s = createNormalizeState();
    normalizeRaw({ ...emptyRaw(), upper: [[0, 1, true], [40_000, 2, true], [80_000, 3, true]] }, s);
    const second = normalizeRaw({ ...emptyRaw(), upper: [[40_000, 2, true], [80_000, 3, true], [120_000, 4, true]] }, s);
    expect(second.upper.map((p) => p.v)).toEqual([4]);
    expect(second.upper[0].t).toBeCloseTo(0.12, 6);
  });

  it('keeps increasing times across a whole run', () => {
    const s = createNormalizeState();
    const times: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const p = normalizeRaw({ ...emptyRaw(), upper: [[i * 36_000, i, true]] }, s);
      for (const pt of p.upper) times.push(pt.t);
    }
    for (let i = 1; i < times.length; i += 1) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('reports the newest sample time on the packet', () => {
    const s = createNormalizeState();
    const p = normalizeRaw({ ...emptyRaw(), upper: [[0, 1, true]], lower: [[2_000_000, 1, true]] }, s);
    expect(p.t).toBeCloseTo(2, 6);
  });

  it('survives an empty packet', () => {
    const s = createNormalizeState();
    const p = normalizeRaw(emptyRaw(), s);
    expect(p.t).toBe(0);
    expect(p.upper).toEqual([]);
  });
});
