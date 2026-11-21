import { describe, expect, it } from 'vitest';
import { calibrate } from '../src/core/calibration.js';
import { makeParams } from '../src/core/params.js';
import type { RatePoint, TracePoint } from '../src/core/types.js';

let seed = 1;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());

const trace = (seconds: number, hz: number, f: (t: number) => number): TracePoint[] => {
  const out: TracePoint[] = [];
  for (let i = 0; i < seconds * hz; i += 1) {
    const t = i / hz;
    out.push({ t, v: f(t), stable: true });
  }
  return out;
};

const p = makeParams();

describe('calibration', () => {
  it('picks the cleaner trace', () => {
    const upper = trace(40, 25, (t) => Math.sin((2 * Math.PI * t) / 8) + 0.02 * gauss());
    const lower = trace(40, 25, () => 0.5 * gauss());
    const cal = calibrate(upper, lower, [], p);
    expect(cal.primary).toBe('upper');
    expect(cal.upper.snr).toBeGreaterThan(cal.lower.snr);
  });

  it('keeps a clean trace whose samples repeat in pairs', () => {
    // the SDK can hold a value for two samples: half the first differences are exactly 0
    const held = (f: (t: number) => number): TracePoint[] =>
      trace(40, 27.5, (t) => f(Math.floor(t * 27.5 / 2) * 2 / 27.5));
    const upper = held((t) => Math.sin((2 * Math.PI * t) / 4));
    const lower = held((t) => 0.9 * Math.sin((2 * Math.PI * t) / 4));
    const cal = calibrate(upper, lower, [], p);
    expect(cal.primary).not.toBeNull();
    expect(cal.upper.snr).toBeGreaterThanOrEqual(p.primarySnrMin);
    expect(cal.upper.N).toBeGreaterThan(0);
    expect(cal.contractionTrace).toBe('lower');
  });

  it('repeated samples do not make noise look clean', () => {
    const held = (f: () => number): TracePoint[] => {
      const out = trace(40, 27.5, f);
      for (let i = 1; i < out.length; i += 2) out[i] = { ...out[i], v: out[i - 1].v };
      return out;
    };
    const cal = calibrate(held(() => gauss()), held(() => gauss()), [], p);
    expect(cal.primary).toBeNull();
    expect(cal.contractionTrace).toBeNull();
  });

  it('noise estimate is never exactly zero for a trace with any movement', () => {
    const upper = trace(40, 25, (t) => Math.sin((2 * Math.PI * t) / 8));
    const cal = calibrate(upper, upper, [], p);
    expect(cal.upper.N).toBeGreaterThan(0);
    expect(Number.isFinite(cal.upper.snr)).toBe(true);
    expect(cal.primary).toBe('upper');
  });

  it('prefers the abdominal trace for contractions when it is clean', () => {
    const upper = trace(40, 25, (t) => Math.sin((2 * Math.PI * t) / 8) + 0.02 * gauss());
    const lower = trace(40, 25, (t) => 0.9 * Math.sin((2 * Math.PI * t) / 8) + 0.02 * gauss());
    const cal = calibrate(upper, lower, [], p);
    expect(cal.contractionTrace).toBe('lower');
  });

  it('returns null primary on flat noise', () => {
    const upper = trace(40, 25, () => gauss());
    const lower = trace(40, 25, () => gauss());
    const cal = calibrate(upper, lower, [], p);
    expect(cal.primary).toBeNull();
    expect(cal.contractionTrace).toBeNull();
  });

  it('ignores unstable and out-of-range pulse', () => {
    const t = 1;
    const pulse: RatePoint[] = [
      { t, v: 70, conf: 90, stable: true },
      { t, v: 120, conf: 90, stable: true },
      { t, v: 60, conf: 90, stable: false },
      { t, v: 72, conf: 90, stable: true },
    ];
    expect(calibrate([], [], pulse, p).restingPulse).toBe(71);
  });

  it('reports no resting pulse when nothing is stable', () => {
    const pulse: RatePoint[] = [{ t: 1, v: 70, conf: 90, stable: false }];
    expect(calibrate([], [], pulse, p).restingPulse).toBeNull();
  });

  it('survives empty input', () => {
    const cal = calibrate([], [], [], p);
    expect(cal.upper.snr).toBe(0);
    expect(cal.primary).toBeNull();
    expect(cal.cadenceHz).toBe(0);
  });
});
