import type { Params } from './params.js';
import { movingMedian, rollingRms } from './signal.js';
import type { TracePoint } from './types.js';

export interface MatchResult {
  taps: number;
  marks: number;
  matched: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

const overlaps = (a: number, spans: [number, number][]): boolean =>
  spans.some(([from, to]) => a >= from && a <= to);

/**
 * Diaphragm contraction marks for one hold.
 *
 * A contraction is a 0.3-1 s jerk of the abdominal wall. The detector looks at the RMS
 * envelope of the trace with slow drift removed; the baseline is measured inside the hold
 * itself (3-10 s, before contractions normally start) so it adapts to each person's noise.
 * Batch and safe to call repeatedly during a hold: it recomputes from the samples given.
 */
export function detectContractions(
  trace: TracePoint[],
  t0: number,
  tEnd: number,
  A: number,
  unreadable: [number, number][],
  p: Params,
): number[] {
  const window = trace.filter((pt) => pt.t >= t0 && pt.t <= tEnd && Number.isFinite(pt.v));
  if (window.length < 8) return [];

  const t = window.map((pt) => pt.t);
  const v = window.map((pt) => pt.v);
  const base = movingMedian(t, v, p.contractionMedianS);
  const residual = v.map((x, i) => x - base[i]);
  const envelope = rollingRms(t, residual, p.envelopeS);

  const baselineFrom = t0 + p.contractionBaselineFromS;
  const baselineTo = t0 + p.contractionBaselineToS;
  const early: number[] = [];
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] >= baselineFrom && t[i] <= baselineTo && Number.isFinite(envelope[i])) early.push(envelope[i]);
  }
  early.sort((a, b) => a - b);
  const baseline = early.length ? early[Math.floor(early.length / 2)] : 0;

  const threshold = Math.max(p.envelopeK * baseline, p.envelopeAbsFrac * Math.abs(A));
  const activeFrom = t0 + p.contractionStartS;

  // Contiguous runs above threshold. The run is found from the envelope, but the mark time
  // is the peak of the residual inside the run: a trailing RMS window lags the jerk by half
  // its width, which would push every mark late.
  const marks: number[] = [];
  let runPeakAt = Number.NaN;
  let lastMagnitude = Number.NEGATIVE_INFINITY;
  let lastMarkAt = Number.NEGATIVE_INFINITY;

  const flush = (): void => {
    if (!Number.isFinite(runPeakAt)) return;
    if (runPeakAt - lastMarkAt >= p.refractoryS && !overlaps(runPeakAt, unreadable)) {
      marks.push(runPeakAt);
      lastMarkAt = runPeakAt;
    }
    runPeakAt = Number.NaN;
    lastMagnitude = Number.NEGATIVE_INFINITY;
  };

  for (let i = 0; i < t.length; i += 1) {
    const hot = t[i] >= activeFrom && Number.isFinite(envelope[i]) && envelope[i] > threshold;
    if (hot) {
      const magnitude = Math.abs(residual[i]);
      if (Number.isFinite(magnitude) && magnitude > lastMagnitude) {
        lastMagnitude = magnitude;
        runPeakAt = t[i];
      }
    } else {
      flush();
    }
  }
  flush();

  return marks.sort((a, b) => a - b);
}

/** One-to-one greedy matching of auto marks to manual taps, both in SDK seconds. */
export function matchTaps(marks: number[], taps: number[], tolS: number): MatchResult {
  const used: boolean[] = taps.map(() => false);
  let matched = 0;
  for (const mark of [...marks].sort((a, b) => a - b)) {
    let bestIdx = -1;
    let bestDt = Number.POSITIVE_INFINITY;
    for (let i = 0; i < taps.length; i += 1) {
      if (used[i]) continue;
      const dt = Math.abs(taps[i] - mark);
      if (dt <= tolS && dt < bestDt) {
        bestDt = dt;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used[bestIdx] = true;
      matched += 1;
    }
  }
  return score(marks.length, taps.length, matched);
}

export function pooledMatch(results: MatchResult[], minTaps: number): MatchResult & { inconclusive: boolean } {
  const taps = results.reduce((s, r) => s + r.taps, 0);
  const marks = results.reduce((s, r) => s + r.marks, 0);
  const matched = results.reduce((s, r) => s + r.matched, 0);
  return { ...score(marks, taps, matched), inconclusive: taps < minTaps };
}

function score(marks: number, taps: number, matched: number): MatchResult {
  const precision = marks > 0 ? matched / marks : null;
  const recall = taps > 0 ? matched / taps : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  return { taps, marks, matched, precision, recall, f1 };
}
