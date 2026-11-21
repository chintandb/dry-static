import type { Params } from './params.js';
import type { RatePoint } from './types.js';

export type PulseValue = { kind: 'value'; bpm: number } | { kind: 'out_of_range' } | { kind: 'na' };

export interface PulseTrend {
  start: PulseValue;
  min: PulseValue;
  delta: number | null;
  curve: { t: number; bpm: number }[];
}

const NA: PulseValue = { kind: 'na' };
const OUT: PulseValue = { kind: 'out_of_range' };

/**
 * Pulse is a 12 s average in the SDK, so the low point of a hold shows up well after the
 * hold ends; `pulseLagS` of extra data is included for that reason. Values outside the
 * SDK's valid band are never reported as numbers.
 */
export function pulseTrend(pulse: RatePoint[], t0: number, tEnd: number, p: Params): PulseTrend {
  const inBand = (bpm: number): boolean => bpm >= p.pulseMin && bpm <= p.pulseMax;
  const stable = pulse.filter((pt) => pt.stable && Number.isFinite(pt.v));

  const uptoStart = stable.filter((pt) => pt.t <= t0);
  const startPoint = uptoStart.length ? uptoStart[uptoStart.length - 1] : null;
  const start: PulseValue = startPoint
    ? inBand(startPoint.v)
      ? { kind: 'value', bpm: startPoint.v }
      : OUT
    : NA;

  const during = stable.filter((pt) => pt.t >= t0 && pt.t <= tEnd + p.pulseLagS);
  let min: PulseValue = NA;
  if (during.length) {
    const lowest = during.reduce((acc, pt) => (pt.v < acc.v ? pt : acc));
    min = inBand(lowest.v) ? { kind: 'value', bpm: lowest.v } : OUT;
  }

  const delta = start.kind === 'value' && min.kind === 'value' ? min.bpm - start.bpm : null;

  const curve = pulse
    .filter((pt) => pt.stable && inBand(pt.v) && pt.t >= t0 - 10 && pt.t <= tEnd + p.pulseLagS)
    .map((pt) => ({ t: pt.t, bpm: pt.v }));

  return { start, min, delta, curve };
}
