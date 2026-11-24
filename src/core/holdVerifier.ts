import type { Calibration } from './calibration.js';
import type { Params } from './params.js';
import { movingMean } from './signal.js';
import type { TalkPoint, TracePoint } from './types.js';

export type LiveState = 'verified' | 'breath' | 'unreadable';

export interface HoldLiveStatus {
  state: LiveState;
  reason: 'ok' | 'no_signal' | 'validation' | 'talking' | 'breath_seen' | 'starting';
}

export interface HoldVerdict {
  verdict: 'verified' | 'breath_detected' | 'partly_readable';
  readablePct: number;
  breathAt: number | null;
  /** dips the user marked as contractions, so not counted as breaths (SDK-time seconds) */
  excused: number[];
  unreadable: [number, number][];
  /** what most of the unreadable time was lost to, or null when every moment was readable */
  lostTo: LostReason | null;
  /**
   * Each unreadable stretch with what it was lost to, for the strip chart. Optional because
   * sessions saved before it existed do not have it.
   */
  lost?: { from: number; to: number; reason: LostReason }[];
}

export type LostReason = 'no_signal' | 'validation' | 'talking';

const GRID = 0.1;
const BREATH_STEP_S = 0.25;
const BASE_HZ = 5;

/**
 * Trailing (causal) median baseline: for each sample, the median of the samples in
 * `[t - windowS, t]`. A slow baseline does not need every sample, so the median runs on a
 * ~5 Hz grid (the first sample of each 0.2 s bucket) and each sample takes the newest grid
 * value at or before it. The grid is anchored to absolute time, so a streamed buffer and a
 * whole hold give the same baseline wherever their windows overlap.
 */
function trailingMedian(t: number[], v: number[], windowS: number): number[] {
  const ts: number[] = [];
  const vs: number[] = [];
  let bucket = Number.NaN;
  for (let i = 0; i < t.length; i += 1) {
    const b = Math.floor(t[i] * BASE_HZ);
    if (b === bucket || !Number.isFinite(v[i])) continue;
    bucket = b;
    ts.push(t[i]);
    vs.push(v[i]);
  }
  const bs = new Array<number>(ts.length);
  let lo = 0;
  for (let j = 0; j < ts.length; j += 1) {
    while (ts[lo] < ts[j] - windowS) lo += 1;
    const w = vs.slice(lo, j + 1).sort((a, b) => a - b);
    const m = w.length >> 1;
    bs[j] = w.length % 2 ? w[m] : (w[m - 1] + w[m]) / 2;
  }
  const out = new Array<number>(t.length);
  let j = -1;
  for (let i = 0; i < t.length; i += 1) {
    while (j + 1 < ts.length && ts[j + 1] <= t[i]) j += 1;
    out[i] = j >= 0 ? bs[j] : v[i];
  }
  return out;
}

/**
 * Streaming "was this hold real?" state machine.
 *
 * Readability is evaluated *as of* a given time using only data that had arrived by
 * then, so live status and the offline verdict agree. A hold is never smoothed over:
 * a gap, a validation warning or talking makes it unreadable for that stretch.
 */
export class HoldVerifier {
  private readonly samples: TracePoint[] = [];
  private readonly talking: TalkPoint[] = [];
  private readonly validation: { t: number; code: number }[] = [];
  /** breath-sized excursions, before taps are taken into account */
  private readonly candidates: { at: number; start: number; end: number; peak: number }[] = [];
  private readonly taps: number[] = [];
  private readonly tIgnore: number;
  /** newest time already judged by the breath scan */
  private scanCursor = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly t0: number,
    private readonly cal: Calibration,
    private readonly p: Params,
  ) {
    this.tIgnore = t0 + p.holdIgnoreS;
  }

  pushSamples(primary: TracePoint[]): void {
    let added = false;
    for (const pt of primary) {
      if (!Number.isFinite(pt.t) || !Number.isFinite(pt.v)) continue;
      if (pt.t < this.tIgnore) continue;
      if (this.samples.length && pt.t <= this.samples[this.samples.length - 1].t) continue;
      this.samples.push(pt);
      added = true;
    }
    if (added) this.scanBreath();
  }

  /** Contraction taps (SDK-time seconds). */
  pushTaps(times: number[]): void {
    for (const t of times) if (Number.isFinite(t)) this.taps.push(t);
  }

  /**
   * First breath-sized excursion that no contraction tap explains. With `now`, an excursion
   * is only reported once its tap window has passed, so a tap that arrives a moment later
   * can still explain it.
   */
  private breathAt(now?: number): number | null {
    for (const c of this.candidates) {
      const short = c.end - c.start <= this.p.tapExcuseMaxS;
      const excused =
        short && this.taps.some((t) => t >= c.at - this.p.tapExcuseBeforeS && t <= c.at + this.p.tapExcuseAfterS);
      if (excused) continue;
      if (now !== undefined && short && now < c.at + this.p.tapExcuseAfterS) continue;
      return c.at;
    }
    return null;
  }

  /** Excursions seen so far, for tuning: `{ at, start, end, peak }` with peak as a share of A. */
  excursions(): { at: number; start: number; end: number; peak: number }[] {
    return this.candidates.map((c) => ({ ...c }));
  }

  pushTalking(pts: TalkPoint[]): void {
    for (const pt of pts) {
      if (!Number.isFinite(pt.t)) continue;
      this.talking.push(pt);
    }
  }

  pushValidation(t: number, code: number): void {
    if (!Number.isFinite(t)) return;
    if (this.validation.length && this.validation[this.validation.length - 1].t === t) {
      this.validation[this.validation.length - 1].code = code;
      return;
    }
    this.validation.push({ t, code });
  }

  /**
   * Breath detection, re-run every `BREATH_STEP_S` of new data.
   *
   * A breath taken during a hold is an exhale then a re-inhale (or an extra sip of air): the
   * trace dips or rises and comes back, usually without crossing to the other side. So any
   * excursion of the smoothed, detrended trace past `breathFrac x A`, in either direction,
   * that lasts at least `breathMinS` is a breath. The detrend is a *trailing* median over
   * `breathMedianS`: a centered median as wide as the excursion follows it and cancels the
   * very event it is meant to expose. Looking only backward
   * also means the last seconds of a hold are checked as soon as they arrive.
   */
  private scanBreath(): void {
    const primary = this.cal.primary;
    if (!primary) return;
    const A = this.cal[primary].A;
    if (!(A > 0)) return;
    const threshold = this.p.breathFrac * A;

    const lastT = this.samples[this.samples.length - 1].t;
    // one sweep per BREATH_STEP_S is enough; packets arrive several times faster
    if (lastT < this.scanCursor + BREATH_STEP_S) return;

    // centered smoothing needs half its window of data past the last point judged
    const evalTo = lastT - this.p.breathSmoothS / 2;
    // re-judge a little of the previous sweep so a run that straddles two sweeps is whole
    const evalFrom = Number.isFinite(this.scanCursor)
      ? Math.max(this.tIgnore, this.scanCursor - Math.max(1, 2 * this.p.breathMinS))
      : this.tIgnore;
    const fromT = Math.max(this.tIgnore, evalFrom - this.p.breathMedianS - this.p.breathSmoothS);
    const buf = this.samples.filter((pt) => pt.t >= fromT);
    const t = buf.map((pt) => pt.t);
    const v = buf.map((pt) => pt.v);

    const base = trailingMedian(t, v, this.p.breathMedianS);
    const x = movingMean(
      t,
      v.map((y, i) => y - base[i]),
      this.p.breathSmoothS,
    );

    let runSign = 0;
    let runStart = Number.NaN;
    let extreme = 0;
    let extremeAt = Number.NaN;
    for (let i = 0; i < x.length; i += 1) {
      if (t[i] < evalFrom) continue;
      if (t[i] > evalTo) break;
      // a dropout breaks a run: what happened inside it is unknown, not a breath
      const broken = i > 0 && t[i] - t[i - 1] > this.p.gapS;
      const sign = Number.isFinite(x[i]) && Math.abs(x[i]) > threshold ? Math.sign(x[i]) : 0;
      if (sign === 0 || sign !== runSign || broken) {
        runSign = sign;
        runStart = t[i];
        extreme = 0;
        extremeAt = Number.NaN;
      }
      if (sign === 0) continue;
      if (Math.abs(x[i]) > Math.abs(extreme)) {
        extreme = x[i];
        extremeAt = t[i];
      }
      if (t[i] - runStart >= this.p.breathMinS) {
        // one candidate per excursion: a run can be re-judged by the next sweep
        const last = this.candidates[this.candidates.length - 1];
        const peak = Math.abs(extreme) / A;
        if (last === undefined || runStart > last.end + this.p.breathMinS) {
          this.candidates.push({ at: extremeAt, start: runStart, end: t[i], peak });
        } else {
          last.start = Math.min(last.start, runStart);
          last.end = Math.max(last.end, t[i]);
          if (peak >= last.peak) {
            last.peak = peak;
            last.at = extremeAt;
          }
        }
      }
    }
    this.scanCursor = Math.max(this.scanCursor, evalTo);
  }

  private lastSampleAtOrBefore(g: number): number | null {
    let best: number | null = null;
    for (const pt of this.samples) {
      if (pt.t <= g) best = pt.t;
      else break;
    }
    return best;
  }

  private badSince(events: { t: number; bad: boolean }[], g: number): number | null {
    let since: number | null = null;
    for (const e of events) {
      if (e.t > g) break;
      since = e.bad ? (since ?? e.t) : null;
    }
    return since;
  }

  /** Readability as of time g (seconds, SDK clock). */
  private readableAt(g: number): { readable: boolean; reason: HoldLiveStatus['reason'] } {
    if (g < this.tIgnore) return { readable: true, reason: 'starting' };

    const last = this.lastSampleAtOrBefore(g);
    if (last === null || g - last > this.p.gapS) return { readable: false, reason: 'no_signal' };

    const valEvents = this.validation.map((v) => ({ t: v.t, bad: v.code !== 0 }));
    const valSince = this.badSince(valEvents, g);
    if (valSince !== null && g - valSince > this.p.badStateS) return { readable: false, reason: 'validation' };

    // talking is immediate: the SDK's talking flag already needs a sustained detection,
    // and a single spoken word is enough to corrupt a hold's trace.
    const talkSince = this.badSince(this.talking.map((pt) => ({ t: pt.t, bad: pt.detected })), g);
    if (talkSince !== null) return { readable: false, reason: 'talking' };

    return { readable: true, reason: 'ok' };
  }

  private grid(tEnd: number): { g: number; readable: boolean; reason: HoldLiveStatus['reason'] }[] {
    const out: { g: number; readable: boolean; reason: HoldLiveStatus['reason'] }[] = [];
    for (let g = this.tIgnore; g <= tEnd + 1e-9; g += GRID) {
      const r = this.readableAt(g);
      out.push({ g, readable: r.readable, reason: r.reason });
    }
    return out;
  }

  status(now: number): HoldLiveStatus {
    if (this.breathAt(now) !== null) return { state: 'breath', reason: 'breath_seen' };
    const { readable, reason } = this.readableAt(now);
    if (!readable) return { state: 'unreadable', reason };
    return { state: 'verified', reason };
  }

  finish(tEnd: number): HoldVerdict {
    const samples = this.grid(tEnd);
    const total = samples.length;
    const readable = samples.filter((s) => s.readable).length;
    const readablePct = total ? (100 * readable) / total : 100;

    const unreadable: [number, number][] = [];
    let open: number | null = null;
    for (const s of samples) {
      if (!s.readable && open === null) open = s.g;
      if (s.readable && open !== null) {
        unreadable.push([open, s.g]);
        open = null;
      }
    }
    if (open !== null) unreadable.push([open, tEnd]);

    const breathAt = this.breathAt();
    const excused = this.candidates
      .filter((c) => c.end - c.start <= this.p.tapExcuseMaxS)
      .filter((c) => this.taps.some((t) => t >= c.at - this.p.tapExcuseBeforeS && t <= c.at + this.p.tapExcuseAfterS))
      .map((c) => c.at);
    const verdict: HoldVerdict['verdict'] =
      breathAt !== null ? 'breath_detected' : readablePct >= this.p.readablePctMin ? 'verified' : 'partly_readable';

    const lost = new Map<LostReason, number>();
    for (const s of samples) {
      if (s.readable || s.reason === 'ok' || s.reason === 'starting' || s.reason === 'breath_seen') continue;
      lost.set(s.reason, (lost.get(s.reason) ?? 0) + 1);
    }
    let lostTo: LostReason | null = null;
    for (const [r, n] of lost) if (lostTo === null || n > (lost.get(lostTo) ?? 0)) lostTo = r;

    const spans: { from: number; to: number; reason: LostReason }[] = [];
    for (const s of samples) {
      const reason = s.readable ? null : (s.reason as LostReason);
      const lastSpan = spans[spans.length - 1];
      if (reason === null) continue;
      if (lastSpan && lastSpan.reason === reason && s.g - lastSpan.to <= GRID + 1e-9) lastSpan.to = s.g;
      else spans.push({ from: s.g, to: s.g, reason });
    }
    for (const span of spans) span.to = Math.min(tEnd, span.to + GRID);

    return { verdict, readablePct, breathAt, excused, unreadable, lostTo, lost: spans };
  }
}
