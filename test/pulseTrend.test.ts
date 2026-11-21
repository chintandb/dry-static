import { describe, expect, it } from 'vitest';
import { makeParams } from '../src/core/params.js';
import { pulseTrend } from '../src/core/pulseTrend.js';
import type { RatePoint } from '../src/core/types.js';

const p = makeParams();
const pt = (t: number, v: number, stable = true): RatePoint => ({ t, v, conf: 90, stable });

describe('pulseTrend', () => {
  it('drop across hold', () => {
    const pulse: RatePoint[] = [];
    for (let t = 0; t <= 40; t += 1) pulse.push(pt(t, 74));
    for (let t = 41; t <= 95; t += 1) pulse.push(pt(t, Math.max(63, 74 - (t - 40))));
    const trend = pulseTrend(pulse, 40, 90, p);
    expect(trend.start).toEqual({ kind: 'value', bpm: 74 });
    expect(trend.min).toEqual({ kind: 'value', bpm: 63 });
    expect(trend.delta).toBe(-11);
  });

  it('below 40 is out of range', () => {
    const pulse = [pt(30, 72), pt(45, 66), pt(60, 38), pt(70, 55)];
    const trend = pulseTrend(pulse, 40, 60, p);
    expect(trend.min).toEqual({ kind: 'out_of_range' });
    expect(trend.delta).toBeNull();
    expect(trend.start).toEqual({ kind: 'value', bpm: 72 });
  });

  it('unstable points ignored', () => {
    const pulse = [pt(30, 72, false), pt(45, 66, false), pt(60, 61, false)];
    const trend = pulseTrend(pulse, 40, 60, p);
    expect(trend.start).toEqual({ kind: 'na' });
    expect(trend.min).toEqual({ kind: 'na' });
    expect(trend.delta).toBeNull();
    expect(trend.curve).toHaveLength(0);
  });

  it('lag window included', () => {
    const near = pulseTrend([pt(30, 70), pt(59, 65), pt(69, 58)], 40, 60, p);
    expect(near.min).toEqual({ kind: 'value', bpm: 58 });
    const far = pulseTrend([pt(30, 70), pt(59, 65), pt(71, 50)], 40, 60, p);
    expect(far.min).toEqual({ kind: 'value', bpm: 65 });
  });

  it('start ignores a stale point long before the hold', () => {
    const trend = pulseTrend([pt(0, 90), pt(30, 74), pt(50, 66)], 40, 60, p);
    expect(trend.start).toEqual({ kind: 'value', bpm: 74 });
  });

  it('above 110 is out of range', () => {
    const trend = pulseTrend([pt(30, 72), pt(50, 118)], 40, 60, p);
    expect(trend.min).toEqual({ kind: 'out_of_range' });
  });
});
