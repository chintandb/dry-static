import { describe, expect, it } from 'vitest';
import { scaleSeries } from '../src/renderer/charts/strip.js';

describe('scaleSeries', () => {
  it('maps the window onto the padded box', () => {
    const points = [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
    ];
    const out = scaleSeries(points, 0, 1, 100, 50, 5);
    expect(out[0]).toEqual({ x: 5, y: 45 });
    expect(out[1]).toEqual({ x: 95, y: 5 });
  });

  it('breaks the path across a gap', () => {
    const points = [
      { t: 0, v: 0 },
      { t: 1, v: 0 },
      { t: 3, v: 0 },
      { t: 4, v: 0 },
    ];
    const out = scaleSeries(points, 0, 4, 100, 50, 5, 1.5);
    expect(out).toHaveLength(5);
    expect(Number.isNaN(out[2].x)).toBe(true);
  });

  it('centers constant values', () => {
    const out = scaleSeries([{ t: 0, v: 2 }, { t: 1, v: 2 }], 0, 1, 100, 50, 5);
    expect(out.every((p) => p.y === 25)).toBe(true);
  });

  it('returns nothing for an empty series', () => {
    expect(scaleSeries([], 0, 5, 100, 50, 5)).toEqual([]);
  });
});
