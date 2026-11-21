import { describe, expect, it } from 'vitest';
import { HoldVerifier } from '../src/core/holdVerifier.js';
import type { Calibration } from '../src/core/calibration.js';
import { makeParams } from '../src/core/params.js';
import type { TracePoint } from '../src/core/types.js';

const p = makeParams();

const cal: Calibration = {
  upper: { A: 1, N: 0.05, snr: 20 },
  lower: { A: 0.9, N: 0.05, snr: 18 },
  primary: 'upper',
  contractionTrace: 'lower',
  restingPulse: 70,
  cadenceHz: 25,
};

let seed = 7;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-9))) * Math.cos(2 * Math.PI * rnd());

interface Shape {
  seconds?: number;
  hz?: number;
  base?: (t: number) => number;
  gaps?: [number, number][];
}

const makeTrace = ({ seconds = 60, hz = 25, base = () => 0, gaps = [] }: Shape = {}): TracePoint[] => {
  const out: TracePoint[] = [];
  for (let i = 0; i < seconds * hz; i += 1) {
    const t = i / hz;
    if (gaps.some(([a, b]) => t >= a && t < b)) continue;
    out.push({ t, v: base(t) + 0.03 * gauss(), stable: true });
  }
  return out;
};

const run = (trace: TracePoint[], tEnd: number, extra?: (v: HoldVerifier) => void): HoldVerifier => {
  const v = new HoldVerifier(0, cal, p);
  v.pushSamples(trace);
  extra?.(v);
  return v;
};

describe('holdVerifier', () => {
  it('flat hold is verified', () => {
    const v = run(makeTrace(), 60);
    const verdict = v.finish(60);
    expect(verdict.verdict).toBe('verified');
    expect(verdict.readablePct).toBeGreaterThanOrEqual(99);
    expect(verdict.breathAt).toBeNull();
  });

  it('sneaked breath is detected', () => {
    const trace = makeTrace({
      base: (t) => (t >= 30 && t < 34 ? Math.sin((2 * Math.PI * (t - 30)) / 4) : 0),
    });
    const verdict = run(trace, 60).finish(60);
    expect(verdict.verdict).toBe('breath_detected');
    expect(verdict.breathAt).not.toBeNull();
    expect(verdict.breathAt as number).toBeGreaterThanOrEqual(28);
    expect(verdict.breathAt as number).toBeLessThanOrEqual(34);
  });

  it('contraction jerk is not a breath', () => {
    const trace = makeTrace({
      base: (t) => (t >= 40 && t < 40.3 ? 0.4 * Math.sin((Math.PI * (t - 40)) / 0.3) : 0),
    });
    expect(run(trace, 60).finish(60).verdict).toBe('verified');
  });

  it('slow drift is not a breath', () => {
    const trace = makeTrace({ base: (t) => (0.5 * t) / 60 });
    expect(run(trace, 60).finish(60).verdict).toBe('verified');
  });

  it('gap over 1.5 s is unreadable', () => {
    const trace = makeTrace({ gaps: [[20, 23]] });
    const v = run(trace, 60);
    const status = v.status(22);
    expect(status.state).toBe('unreadable');
    expect(status.reason).toBe('no_signal');
    const pct = v.finish(60).readablePct;
    expect(pct).toBeGreaterThan(95);
    expect(pct).toBeLessThan(99);
  });

  it('long gap gives partly readable', () => {
    const trace = makeTrace({ gaps: [[10, 25]] });
    expect(run(trace, 60).finish(60).verdict).toBe('partly_readable');
  });

  it('talking makes unreadable', () => {
    const v = run(makeTrace(), 60, (vv) => {
      vv.pushTalking([{ t: 30, detected: true }, { t: 32, detected: false }]);
    });
    expect(v.status(31).reason).toBe('talking');
    expect(v.status(31).state).toBe('unreadable');
  });

  it('validation not ok over 1.5 s makes unreadable', () => {
    const v = run(makeTrace(), 60, (vv) => {
      vv.pushValidation(30, 7);
      vv.pushValidation(33, 0);
    });
    expect(v.status(32).reason).toBe('validation');
    expect(v.status(33.2).state).toBe('verified');
  });

  it('ignores the first 8 s while the chest settles', () => {
    const trace = makeTrace({
      base: (t) => (t < 7 ? -Math.sin((Math.PI * t) / 7) : 0),
    });
    expect(run(trace, 60).finish(60).verdict).toBe('verified');
  });

  describe('contraction taps', () => {
    // a short one-sided dip, the size of a felt contraction on a real recording
    const dip = (t: number) => (t >= 30 && t < 31.6 ? -0.8 * Math.sin((Math.PI * (t - 30)) / 1.6) : 0);

    it('a short dip with no tap is a breath', () => {
      const verdict = run(makeTrace({ base: dip }), 60).finish(60);
      expect(verdict.verdict).toBe('breath_detected');
      expect(verdict.excused).toEqual([]);
    });

    it('a short dip next to a contraction tap is not a breath, and is reported', () => {
      const verdict = run(makeTrace({ base: dip }), 60, (v) => v.pushTaps([31.5])).finish(60);
      expect(verdict.verdict).toBe('verified');
      expect(verdict.breathAt).toBeNull();
      expect(verdict.excused).toHaveLength(1);
      expect(verdict.excused[0]).toBeGreaterThan(29.5);
      expect(verdict.excused[0]).toBeLessThan(32);
    });

    it('a tap far from the dip does not excuse it', () => {
      const verdict = run(makeTrace({ base: dip }), 60, (v) => v.pushTaps([40])).finish(60);
      expect(verdict.verdict).toBe('breath_detected');
    });

    it('a full breath is caught even with a tap next to it', () => {
      const trace = makeTrace({
        base: (t) => (t >= 30 && t < 34 ? -Math.sin((Math.PI * (t - 30)) / 4) : 0),
      });
      const verdict = run(trace, 60, (v) => v.pushTaps([32])).finish(60);
      expect(verdict.verdict).toBe('breath_detected');
    });

    it('live status waits for a late tap before calling a short dip a breath', () => {
      const v = new HoldVerifier(0, cal, p);
      v.pushSamples(makeTrace({ base: dip, seconds: 33 }));
      expect(v.status(32.9).state).toBe('verified');
      v.pushTaps([32.5]);
      v.pushSamples(makeTrace({ base: dip }).filter((pt) => pt.t >= 33));
      expect(v.status(45).state).toBe('verified');
    });
  });

  it('reports a breath status as sticky', () => {
    const trace = makeTrace({
      base: (t) => (t >= 30 && t < 34 ? Math.sin((2 * Math.PI * (t - 30)) / 4) : 0),
    });
    const v = run(trace, 60);
    expect(v.status(45).state).toBe('breath');
    expect(v.status(45).reason).toBe('breath_seen');
  });

  describe('one-sided breath excursions', () => {
    const calA2: Calibration = { ...cal, upper: { A: 2, N: 0.05, snr: 40 } };
    const runA2 = (trace: TracePoint[]) => {
      const v = new HoldVerifier(0, calA2, p);
      v.pushSamples(trace);
      return v.finish(60);
    };
    // exhale then re-inhale: a smooth one-sided dip with no overshoot
    const dip = (at: number, durS: number, depth: number) => (t: number) =>
      t >= at && t < at + durS ? -depth * Math.sin((Math.PI * (t - at)) / durS) : 0;

    for (const durS of [3, 4, 5]) {
      it(`flags a one-sided dip of depth A lasting ${durS} s`, () => {
        const verdict = runA2(makeTrace({ base: dip(30, durS, 2) }));
        expect(verdict.verdict).toBe('breath_detected');
        expect(verdict.breathAt as number).toBeGreaterThanOrEqual(29);
        expect(verdict.breathAt as number).toBeLessThanOrEqual(30 + durS + 1);
      });
    }

    it('flags a flat-bottomed dip of depth A lasting 4 s', () => {
      const verdict = runA2(makeTrace({ base: (t) => (t >= 30 && t < 34 ? -2 : 0) }));
      expect(verdict.verdict).toBe('breath_detected');
      expect(verdict.breathAt as number).toBeGreaterThanOrEqual(29);
      expect(verdict.breathAt as number).toBeLessThanOrEqual(34);
    });

    it('flags a one-sided dip of 1.5 x A', () => {
      const verdict = runA2(makeTrace({ base: dip(30, 4, 3) }));
      expect(verdict.verdict).toBe('breath_detected');
      expect(verdict.breathAt as number).toBeGreaterThanOrEqual(29);
      expect(verdict.breathAt as number).toBeLessThanOrEqual(35);
    });

    it('flags a one-sided rise (extra inhale)', () => {
      const verdict = runA2(makeTrace({ base: (t) => -dip(30, 2, 2)(t) }));
      expect(verdict.verdict).toBe('breath_detected');
      expect(verdict.breathAt as number).toBeGreaterThanOrEqual(29);
      expect(verdict.breathAt as number).toBeLessThanOrEqual(33);
    });

    it('flags a one-sided dip near the end of the hold', () => {
      const verdict = runA2(makeTrace({ base: dip(55, 4, 2) }));
      expect(verdict.verdict).toBe('breath_detected');
    });

    it('flags the same dip when samples arrive in small packets', () => {
      const trace = makeTrace({ base: dip(30, 4, 2) });
      const v = new HoldVerifier(0, calA2, p);
      for (let i = 0; i < trace.length; i += 3) v.pushSamples(trace.slice(i, i + 3));
      const verdict = v.finish(60);
      expect(verdict.verdict).toBe('breath_detected');
      expect(verdict.breathAt as number).toBeGreaterThanOrEqual(29);
      expect(verdict.breathAt as number).toBeLessThanOrEqual(34);
    });

    it('noise alone is never a breath, packet by packet', () => {
      const trace = makeTrace();
      const v = new HoldVerifier(0, cal, p);
      for (let i = 0; i < trace.length; i += 3) v.pushSamples(trace.slice(i, i + 3));
      expect(v.finish(60).verdict).toBe('verified');
    });
  });

  it('starting status before the ignore window', () => {
    const v = run(makeTrace(), 60);
    expect(v.status(1)).toEqual({ state: 'verified', reason: 'starting' });
  });
});
