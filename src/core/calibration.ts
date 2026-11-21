import type { Params } from './params.js';
import type { RatePoint, TracePoint } from './types.js';
import { cadenceHz, medianAbsDiff, medianOf, movingMedian, percentile, toSeries } from './signal.js';

export interface TraceCal {
  /** breath amplitude: p95 - p5 of the detrended trace */
  A: number;
  /** noise: median absolute first difference between changed values, scaled to their rate */
  N: number;
  snr: number;
}

export interface Calibration {
  upper: TraceCal;
  lower: TraceCal;
  primary: 'upper' | 'lower' | null;
  contractionTrace: 'upper' | 'lower' | null;
  restingPulse: number | null;
  cadenceHz: number;
}

/**
 * Robust noise estimate: median absolute first difference times the square root of the
 * sample rate. The SDK sometimes holds a value for two samples; counted as-is, those zero
 * differences make up half the list, the median collapses to 0 and a clean trace looks
 * unusable. So repeated values are dropped first and the rate is scaled down to match
 * (only the share of samples that carry a new value counts). A trace with no repeats gets
 * exactly the plain estimate.
 */
function noiseOf(v: number[], cad: number): number {
  const finite = v.filter(Number.isFinite);
  const changed: number[] = [];
  for (const x of finite) if (!changed.length || x !== changed[changed.length - 1]) changed.push(x);
  if (changed.length < 2 || finite.length < 2) return 0;
  const newShare = (changed.length - 1) / (finite.length - 1);
  return medianAbsDiff(changed) * Math.sqrt(cad * newShare);
}

function traceCal(points: TracePoint[], p: Params): TraceCal {
  if (points.length < 8) return { A: 0, N: 0, snr: 0 };
  const { t, v } = toSeries(points);
  const base = movingMedian(t, v, p.detrendMedianS);
  const detrended = v.map((x, i) => (Number.isFinite(x) && Number.isFinite(base[i]) ? x - base[i] : Number.NaN));
  const A = percentile(detrended, 95) - percentile(detrended, 5);
  const cad = cadenceHz(t);
  const rawN = noiseOf(v, cad || 0);
  // a floor keeps the SNR finite for a trace that barely moves between samples
  const N = Number.isFinite(A) && A > 0 ? Math.max(rawN, p.noiseFloorFrac * A) : rawN;
  const snr = N > 0 && Number.isFinite(A) ? A / N : 0;
  return { A: Number.isFinite(A) ? A : 0, N: Number.isFinite(N) ? N : 0, snr: Number.isFinite(snr) ? snr : 0 };
}

/** Settle-in calibration: amplitude and noise per trace, which trace to trust, resting pulse. */
export function calibrate(upper: TracePoint[], lower: TracePoint[], pulse: RatePoint[], p: Params): Calibration {
  const windowStart = (points: TracePoint[]) => {
    if (!points.length) return points;
    const last = points[points.length - 1].t;
    return points.filter((pt) => pt.t >= last - p.calibWindowS);
  };

  const u = traceCal(windowStart(upper), p);
  const l = traceCal(windowStart(lower), p);

  let primary: Calibration['primary'] = null;
  if (u.snr >= p.primarySnrMin || l.snr >= p.primarySnrMin) {
    primary = u.snr >= l.snr ? 'upper' : 'lower';
  }

  let contractionTrace: Calibration['contractionTrace'] = null;
  if (l.snr >= p.contractionSnrMin) contractionTrace = 'lower';
  else if (u.snr >= p.contractionSnrMin) contractionTrace = 'upper';

  const stableInRange = pulse
    .filter((pt) => pt.stable && pt.v >= p.pulseMin && pt.v <= p.pulseMax)
    .map((pt) => pt.v);
  const restingPulse = stableInRange.length ? medianOf(stableInRange) : null;

  return {
    upper: u,
    lower: l,
    primary,
    contractionTrace,
    restingPulse,
    cadenceHz: cadenceHz(upper.map((pt) => pt.t)),
  };
}
