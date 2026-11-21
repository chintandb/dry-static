import { describe, expect, it } from 'vitest';
import { ClockSync } from '../src/core/clock.js';

describe('clock', () => {
  it('median offset', () => {
    const c = new ClockSync();
    expect(c.toSdkTime(4000)).toBeNull();
    c.observe(1000, 0.2);
    c.observe(2000, 1.2);
    c.observe(3000, 2.9);
    expect(c.offset).toBeCloseTo(0.8, 6);
    expect(c.toSdkTime(4000)).toBeCloseTo(3.2, 6);
    expect(c.toWallMs(3.2)).toBeCloseTo(4000, 6);
  });

  it('keeps only the last window of observations', () => {
    const c = new ClockSync(2);
    c.observe(1000, 0);
    c.observe(2000, 5);
    c.observe(3000, 1);
    expect(c.size).toBe(2);
    // remaining offsets: 2-5=-3, 3-1=2 -> median -0.5
    expect(c.offset).toBeCloseTo(-0.5, 6);
  });

  it('ignores non-finite input', () => {
    const c = new ClockSync();
    c.observe(Number.NaN, 1);
    c.observe(1000, Number.NaN);
    expect(c.offset).toBeNull();
  });
});
