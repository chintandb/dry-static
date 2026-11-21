import { calibrate, type Calibration } from './calibration.js';
import { ClockSync } from './clock.js';
import { detectContractions, matchTaps } from './contractions.js';
import { fmt } from './copy.js';
import { HoldVerifier, type HoldLiveStatus, type HoldVerdict } from './holdVerifier.js';
import type { Params } from './params.js';
import { pulseTrend, type PulseTrend } from './pulseTrend.js';
import { cadenceHz, medianOf, percentile } from './signal.js';
import type {
  Cue,
  CuePhase,
  Packet,
  RatePoint,
  TablePlan,
  Tap,
  TracePoint,
  ValidationEvent,
} from './types.js';

/**
 * 'finishing' follows the last hold (or an early end): the session waits up to
 * `pulseLagS` (+ FINISH_GRACE_S) for the last pulse window to fill before it is 'done'.
 */
export type Phase = 'settle' | 'calibration_failed' | 'rest' | 'countdown' | 'hold' | 'finishing' | 'done';

/**
 * A round's pulse summary covers [t0, tEnd + pulseLagS]. It is 'pending' until SDK time has
 * passed the end of that window, 'final' after, and 'incomplete' when the session ended
 * (source stopped or failed) before the window filled. Saved sessions from older builds have
 * no status; treat a missing status as 'final'.
 */
export type PulseStatus = 'pending' | 'final' | 'incomplete';

export interface RoundResult {
  round: number;
  plannedHoldS: number;
  actualHoldS: number;
  stopped: boolean;
  verdict: HoldVerdict;
  marks: number[];
  taps: number[];
  firstTapS: number | null;
  firstMarkS: number | null;
  pulse: PulseTrend;
  pulseStatus?: PulseStatus;
  t0: number;
  tEnd: number;
}

export interface SessionResult {
  id: string;
  startedAt: string;
  mode: 'live' | 'replay';
  plan: TablePlan;
  calibration: Calibration | null;
  rounds: RoundResult[];
  endedEarly: boolean;
  error: { code: number; message: string } | null;
  quality: { cadenceHz: number; delayMsMedian: number; delayMsP95: number; invalidPct: number };
}

export interface SessionView {
  phase: Phase;
  /** SDK time the current hold started, null outside a hold */
  holdT0: number | null;
  /** planned length of the current hold, 0 outside a hold */
  holdTargetS: number;
  round: number;
  totalRounds: number;
  phaseElapsedS: number;
  phaseRemainingS: number;
  live: HoldLiveStatus | null;
  trace: TracePoint[];
  marks: number[];
  taps: number[];
  lastRound: RoundResult | null;
  restRate: number | null;
  validation: { code: number; hint: string } | null;
}

const emptyVerdict: HoldVerdict = { verdict: 'partly_readable', readablePct: 0, breathAt: null, unreadable: [] };

/**
 * Extra wall time the finishing phase allows past `pulseLagS`: samples arrive a little after
 * the moment they describe, so SDK time reaches tEnd + pulseLagS slightly after the wall clock
 * does. Local here because params.ts is owned elsewhere.
 */
const FINISH_GRACE_S = 2;
/** pending pulse summaries are recomputed at most this often (SDK seconds) */
const PULSE_REFRESH_S = 0.5;

/** A pulse window the session could not wait out: no low point and no change are claimed. */
const incompletePulse = (r: RoundResult): RoundResult => ({
  ...r,
  pulse: { ...r.pulse, min: { kind: 'na' }, delta: null },
  pulseStatus: 'incomplete',
});

/**
 * The whole session as a pure state machine: phases advance on wall time (live) or on
 * recorded cues (replay), and every number comes from the core detectors. No DOM, no SDK,
 * so the tests drive it with synthetic packets and fake wall time.
 */
export class SessionController {
  private phase: Phase = 'settle';
  private phaseStart: number;
  private phaseEnd: number;
  private roundIdx = 0;
  private readonly params: Params;
  private readonly plan: TablePlan;
  private readonly mode: 'live' | 'replay';
  private readonly id: string;
  private readonly startedAt: string;
  private readonly clock: ClockSync;

  private upper: TracePoint[] = [];
  private lower: TracePoint[] = [];
  private rate: RatePoint[] = [];
  private pulse: RatePoint[] = [];
  private talking: { t: number; detected: boolean }[] = [];
  private validationEvents: { wallMs: number; code: number; hint: string }[] = [];
  private delays: number[] = [];
  private lastSampleT: number | null = null;

  private calibration: Calibration | null = null;
  private verifier: HoldVerifier | null = null;
  private holdT0 = 0;
  private holdTaps: number[] = [];
  private allTaps: number[] = [];
  private holdMarks: number[] = [];
  private lastMarkSweepSdk = 0;
  private rounds: RoundResult[] = [];
  private endedEarly = false;
  private error: { code: number; message: string } | null = null;
  private cues: Cue[] = [];

  private lastValidation: { code: number; hint: string } | null = null;
  private lastPulseRefreshT = Number.NEGATIVE_INFINITY;

  constructor(o: {
    plan: TablePlan;
    mode: 'live' | 'replay';
    params: Params;
    startWallMs: number;
    id: string;
    startedAt: string;
  }) {
    this.plan = o.plan;
    this.mode = o.mode;
    this.params = o.params;
    this.id = o.id;
    this.startedAt = o.startedAt;
    this.clock = new ClockSync(o.params.clockWindow);
    this.phaseStart = o.startWallMs;
    this.phaseEnd = o.startWallMs + o.params.settleS * 1000;
    this.cues.push({ wallMs: o.startWallMs, phase: 'settle_start', round: 0 });
  }

  // ---------------------------------------------------------------- inputs

  onPacket(p: Packet): void {
    if (p.upper.length) this.upper.push(...p.upper);
    if (p.lower.length) this.lower.push(...p.lower);
    if (p.rate.length) this.rate.push(...p.rate);
    if (p.pulse.length) this.pulse.push(...p.pulse);
    if (p.talking.length) this.talking.push(...p.talking);

    const newest = this.newestSample(p);
    if (newest !== null) {
      this.lastSampleT = newest;
      this.clock.observe(p.wallMs, newest);
      this.delays.push(p.wallMs / 1000 - newest);
    }

    if (this.phase === 'hold' && this.verifier) {
      const primary = this.calibration?.primary;
      const source = primary === 'lower' ? p.lower : p.upper;
      if (source.length) this.verifier.pushSamples(source);
      if (p.talking.length) this.verifier.pushTalking(p.talking);
    }

    this.refreshPulses(false);
  }

  onValidation(e: ValidationEvent): void {
    this.validationEvents.push({ wallMs: e.wallMs, code: e.code, hint: e.hint });
    this.lastValidation = { code: e.code, hint: e.hint };
    if (this.verifier) {
      const t = this.sdkTime(e.wallMs);
      this.verifier.pushValidation(t, e.code);
    }
  }

  onTap(t: Tap): void {
    if (t.kind === 'stop') {
      this.stopHold(t.wallMs);
      return;
    }
    // taps are assigned to a hold by time, not by arrival order: they can be delivered
    // after the hold_end cue and a replayed file interleaves them with packets
    const t0 = this.sdkTime(t.wallMs);
    this.allTaps.push(t0);
    if (this.phase === 'hold') this.holdTaps.push(t0);
  }

  /** Replay mode drives phases from recorded cues; live mode ignores recorded cues. */
  onCue(c: Cue): void {
    if (this.mode !== 'replay') return;
    this.cues.push(c);
    switch (c.phase) {
      case 'rest_start':
        this.enterPhase('rest', c.wallMs, this.plan.rounds[this.roundIdx]?.restS ?? 0);
        break;
      case 'countdown_start':
        this.enterPhase('countdown', c.wallMs, this.params.countdownS);
        break;
      case 'hold_start':
        this.beginHold(c.wallMs, c.round);
        break;
      case 'hold_end':
        if (this.phase !== 'hold') break;
        this.finishHold(c.wallMs, false);
        if (this.roundIdx < this.plan.rounds.length) {
          // replay keeps following the file, so a rest that is already running is re-anchored
          this.enterPhase('rest', c.wallMs, this.plan.rounds[this.roundIdx]?.restS ?? 0);
        } else {
          this.enterFinishing(c.wallMs);
        }
        break;
      case 'session_end':
        if (this.phase === 'finishing' || this.phase === 'done') break;
        if (this.phase === 'hold') this.finishHold(c.wallMs, true);
        // a live run that was ended with Stop during a rest leaves rounds unplayed
        if (this.roundIdx < this.plan.rounds.length) this.endedEarly = true;
        this.enterFinishing(c.wallMs);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- timing

  /** Live mode: advance on wall time and return every cue emitted since the last call. */
  tick(nowWallMs: number): Cue[] {
    const before = this.cues.length;
    if (this.mode === 'live') {
      let guard = 0;
      while (nowWallMs >= this.phaseEnd && guard < 64) {
        guard += 1;
        const boundary = this.phaseEnd;
        if (this.phase === 'settle') {
          this.calibrateNow(boundary);
          if (!this.calibration?.primary) {
            this.phase = 'calibration_failed';
            this.phaseStart = boundary;
            this.phaseEnd = boundary;
            break;
          }
          this.enterPhase('rest', boundary, this.plan.rounds[0]?.restS ?? 0);
        } else if (this.phase === 'rest') {
          this.enterPhase('countdown', boundary, this.params.countdownS);
        } else if (this.phase === 'countdown') {
          this.beginHold(boundary, this.roundIdx + 1);
        } else if (this.phase === 'hold') {
          this.finishHold(boundary, false);
          this.afterRound(boundary);
        } else {
          break;
        }
      }
    }
    // both modes: replay has no timer-driven phases, but it still has to leave 'finishing'
    if (this.phase === 'finishing') this.checkFinishing(nowWallMs);
    return this.cues.slice(before);
  }

  /**
   * Stop is always available, and what it means depends on the phase:
   * - hold: the hold ends now and is kept as stopped; the next rest starts (or the session
   *   ends after the last round).
   * - countdown: the upcoming hold is canceled. The round is recorded as stopped with an
   *   actual hold of 0 s and the session moves to the next rest, or ends after the last round.
   *   No hold_start/hold_end cues are written for it, so a replay simply has no hold there.
   * - rest: the user is signaling they want to quit, so the whole session ends early
   *   (endedEarly) instead of skipping to the next hold.
   * - finishing: stop waiting for the last pulse window; it is marked incomplete.
   * Settle-in and the other phases ignore it.
   */
  stopHold(nowWallMs: number): Cue[] {
    const before = this.cues.length;
    const boundary = nowWallMs;
    switch (this.phase) {
      case 'hold':
        this.finishHold(boundary, true);
        this.afterRound(boundary);
        break;
      case 'countdown':
        this.cancelHold(boundary);
        this.afterRound(boundary);
        break;
      case 'rest':
        this.endedEarly = true;
        this.cues.push({ wallMs: boundary, phase: 'session_end', round: this.roundIdx });
        this.enterFinishing(boundary);
        break;
      case 'finishing':
        this.completeFinishing(boundary);
        break;
      default:
        return [];
    }
    return this.cues.slice(before);
  }

  fail(code: number, message: string): void {
    this.endedEarly = true;
    this.error = { code, message };
    // a failure mid-hold closes the hold at the newest sample so the round is kept
    if (this.phase === 'hold') {
      const lastWall = this.lastSampleT !== null ? this.clock.toWallMs(this.lastSampleT) : null;
      this.finishHold(lastWall ?? this.phaseStart, true);
    }
    // the source is gone, so no pending pulse window can fill any more
    this.refreshPulses(true);
    this.rounds = this.rounds.map((r) => (r.pulseStatus === 'pending' ? incompletePulse(r) : r));
    this.phase = 'done';
    this.phaseEnd = this.phaseStart;
  }

  // ---------------------------------------------------------------- phases

  private cue(phase: CuePhase, wallMs: number): void {
    this.cues.push({ wallMs, phase, round: this.roundIdx });
  }

  private enterPhase(phase: Phase, startWallMs: number, durS: number): void {
    this.phase = phase;
    this.phaseStart = startWallMs;
    this.phaseEnd = startWallMs + Math.max(0, durS) * 1000;
    switch (phase) {
      case 'rest':
        this.cue('rest_start', startWallMs);
        break;
      case 'countdown':
        this.cue('countdown_start', startWallMs);
        break;
      case 'done':
        break;
      default:
        break;
    }
  }

  /** After a round: the next rest, or the end of the table and the finishing wait. */
  private afterRound(boundary: number): void {
    if (this.roundIdx < this.plan.rounds.length) {
      this.enterPhase('rest', boundary, this.plan.rounds[this.roundIdx]?.restS ?? 0);
    } else {
      this.cues.push({ wallMs: boundary, phase: 'session_end', round: this.roundIdx });
      this.enterFinishing(boundary);
    }
  }

  private enterFinishing(wallMs: number): void {
    this.phase = 'finishing';
    this.phaseStart = wallMs;
    this.phaseEnd = wallMs + (this.params.pulseLagS + FINISH_GRACE_S) * 1000;
    this.verifier = null;
    this.checkFinishing(wallMs);
  }

  /** Leave 'finishing' once every pulse window is final, or when the wait runs out. */
  private checkFinishing(nowWallMs: number): void {
    this.refreshPulses(true);
    const pending = this.rounds.some((r) => r.pulseStatus === 'pending');
    if (!pending || nowWallMs >= this.phaseEnd) this.completeFinishing(nowWallMs);
  }

  private completeFinishing(nowWallMs: number): void {
    this.refreshPulses(true);
    this.rounds = this.rounds.map((r) => (r.pulseStatus === 'pending' ? incompletePulse(r) : r));
    this.phase = 'done';
    this.phaseStart = nowWallMs;
    this.phaseEnd = nowWallMs;
  }

  /** Recompute pending pulse summaries from the data that has arrived; finalize full windows. */
  private refreshPulses(force: boolean): void {
    const tMax = this.lastSampleT;
    if (tMax === null) return;
    if (!this.rounds.some((r) => r.pulseStatus === 'pending')) return;
    const crossed = this.rounds.some((r) => r.pulseStatus === 'pending' && tMax >= r.tEnd + this.params.pulseLagS);
    if (!force && !crossed && tMax - this.lastPulseRefreshT < PULSE_REFRESH_S) return;
    this.lastPulseRefreshT = tMax;
    this.rounds = this.rounds.map((r) => {
      if (r.pulseStatus !== 'pending') return r;
      const pulse = pulseTrend(this.pulse, r.t0, r.tEnd, this.params);
      return { ...r, pulse, pulseStatus: tMax >= r.tEnd + this.params.pulseLagS ? 'final' : 'pending' };
    });
  }

  /** Stop during a countdown: the hold never starts, and the round is kept as stopped at 0 s. */
  private cancelHold(wallMs: number): void {
    const t = this.sdkTime(wallMs);
    this.rounds.push({
      round: this.roundIdx + 1,
      plannedHoldS: this.plan.rounds[this.roundIdx]?.holdS ?? 0,
      actualHoldS: 0,
      stopped: true,
      verdict: emptyVerdict,
      marks: [],
      taps: [],
      firstTapS: null,
      firstMarkS: null,
      pulse: pulseTrend(this.pulse, t, t, this.params),
      pulseStatus: 'pending',
      t0: t,
      tEnd: t,
    });
    this.roundIdx += 1;
    this.refreshPulses(true);
  }

  private beginHold(wallMs: number, round: number): void {
    this.roundIdx = Math.max(0, round - 1);
    const planned = this.plan.rounds[this.roundIdx]?.holdS ?? 0;
    this.phase = 'hold';
    this.phaseStart = wallMs;
    this.phaseEnd = wallMs + planned * 1000;
    this.cue('hold_start', wallMs);

    this.holdT0 = this.sdkTime(wallMs);
    this.holdTaps = [];
    this.holdMarks = [];
    this.lastMarkSweepSdk = this.holdT0;
    this.verifier = null;
    // replay sessions never run a settle phase through tick(), so calibrate on first need
    if (!this.calibration) this.calibrateAt(this.holdT0);
    if (this.calibration?.primary) {
      this.verifier = new HoldVerifier(this.holdT0, this.calibration, this.params);
      // A validation code set before the hold still applies: the verifier only hears codes
      // pushed while it exists, so seed it with the latest one (a kOk seed is harmless).
      if (this.lastValidation) this.verifier.pushValidation(this.holdT0, this.lastValidation.code);
    }
  }

  private finishHold(endWallMs: number, stopped: boolean): void {
    const tEnd = Math.max(this.sdkTime(endWallMs), this.holdT0);
    const verdict = this.verifier ? this.verifier.finish(tEnd) : emptyVerdict;
    const marks = this.marksFor(tEnd, verdict.unreadable);
    const taps = this.allTaps.filter((t) => t >= this.holdT0 && t <= tEnd).sort((a, b) => a - b);
    // only data up to tEnd exists yet; the summary stays 'pending' until tEnd + pulseLagS
    const pulse = pulseTrend(this.pulse, this.holdT0, tEnd, this.params);
    const planned = this.plan.rounds[this.roundIdx]?.holdS ?? 0;

    this.rounds.push({
      round: this.roundIdx + 1,
      plannedHoldS: planned,
      actualHoldS: tEnd - this.holdT0,
      stopped,
      verdict,
      marks,
      taps,
      firstTapS: taps.length ? taps[0] - this.holdT0 : null,
      firstMarkS: marks.length ? marks[0] - this.holdT0 : null,
      pulse,
      pulseStatus: 'pending',
      t0: this.holdT0,
      tEnd,
    });

    this.cue('hold_end', endWallMs);
    this.verifier = null;
    this.roundIdx += 1;
    this.holdTaps = [];
    this.holdMarks = [];
    this.refreshPulses(true);
  }

  private calibrateNow(wallMs: number): void {
    this.calibrateAt(this.sdkTime(wallMs));
  }

  private calibrateAt(tNow: number): void {
    const from = tNow - this.params.calibWindowS;
    const pick = <T extends { t: number }>(xs: T[]): T[] => xs.filter((x) => x.t >= from && x.t <= tNow);
    this.calibration = calibrate(pick(this.upper), pick(this.lower), pick(this.pulse), this.params);
  }

  private marksFor(tEnd: number, unreadable: [number, number][]): number[] {
    if (!this.calibration?.contractionTrace) return [];
    const trace = this.calibration.contractionTrace === 'lower' ? this.lower : this.upper;
    const A = this.calibration[this.calibration.contractionTrace].A;
    return detectContractions(
      trace.filter((pt) => pt.t >= this.holdT0 && pt.t <= tEnd),
      this.holdT0,
      tEnd,
      A,
      unreadable,
      this.params,
    );
  }

  // ---------------------------------------------------------------- outputs

  private sdkTime(wallMs: number): number {
    const t = this.clock.toSdkTime(wallMs);
    return t ?? this.lastSampleT ?? 0;
  }

  private newestSample(p: Packet): number | null {
    let newest: number | null = null;
    for (const series of [p.upper, p.lower, p.rate, p.pulse]) {
      const last = series.length ? series[series.length - 1].t : null;
      if (last !== null && (newest === null || last > newest)) newest = last;
    }
    return newest;
  }

  private primaryTrace(): TracePoint[] {
    const primary = this.calibration?.primary;
    return primary === 'lower' ? this.lower : this.upper;
  }

  view(nowWallMs: number): SessionView {
    const elapsedS = (nowWallMs - this.phaseStart) / 1000;
    const remainingS = Math.max(0, (this.phaseEnd - nowWallMs) / 1000);

    let live: HoldLiveStatus | null = null;
    let trace: TracePoint[] = [];
    if (this.phase === 'hold' && this.verifier) {
      const nowSdk = this.sdkTime(nowWallMs);
      live = this.verifier.status(nowSdk);
      // auto marks are recomputed at most once a second so the strip stays cheap
      if (nowSdk - this.lastMarkSweepSdk >= 1) {
        this.lastMarkSweepSdk = nowSdk;
        // the verifier's unreadable spans so far, so live marks agree with the final result
        // (finish() only reads the verifier's state)
        this.holdMarks = this.marksFor(nowSdk, this.verifier.finish(nowSdk).unreadable);
      }
      trace = this.primaryTrace().filter((pt) => pt.t >= this.holdT0 - 2 && pt.t <= nowSdk);
    }

    let restRate: number | null = null;
    if (this.phase === 'rest') {
      const latest = [...this.rate].reverse().find((pt) => pt.stable);
      restRate = latest ? latest.v : null;
    }

    return {
      phase: this.phase,
      holdT0: this.phase === 'hold' ? this.holdT0 : null,
      holdTargetS: this.phase === 'hold' ? (this.plan.rounds[this.roundIdx]?.holdS ?? 0) : 0,
      round: Math.min(this.roundIdx + 1, this.plan.rounds.length),
      totalRounds: this.plan.rounds.length,
      phaseElapsedS: elapsedS,
      phaseRemainingS: remainingS,
      live,
      trace,
      marks: this.phase === 'hold' ? this.holdMarks : (this.rounds[this.rounds.length - 1]?.marks ?? []),
      taps: this.phase === 'hold' ? [...this.holdTaps] : (this.rounds[this.rounds.length - 1]?.taps ?? []),
      lastRound: this.rounds.length ? this.rounds[this.rounds.length - 1] : null,
      restRate,
      validation: this.lastValidation,
    };
  }

  /** The traces kept in memory, for the end-screen strips. */
  traces(): { primary: TracePoint[]; contraction: TracePoint[] } {
    return { primary: this.primaryTrace(), contraction: this.calibration?.contractionTrace === 'upper' ? this.upper : this.lower };
  }

  result(): SessionResult {
    this.refreshPulses(true);
    // a result is a snapshot: a pulse window that has not filled by now is reported as
    // incomplete rather than as a premature low point
    const rounds = this.rounds.map((r) => (r.pulseStatus === 'pending' ? incompletePulse(r) : r));
    const delays = this.delays.length ? this.delays : [0];
    const delayMin = Math.min(...delays);
    const jitter = delays.map((d) => (d - delayMin) * 1000);

    const sorted = [...this.validationEvents].sort((a, b) => a.wallMs - b.wallMs);
    let bad = 0;
    let total = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const span = i + 1 < sorted.length ? (sorted[i + 1].wallMs - sorted[i].wallMs) / 1000 : 0;
      total += span;
      if (sorted[i].code !== 0) bad += span;
    }

    return {
      id: this.id,
      startedAt: this.startedAt,
      mode: this.mode,
      plan: this.plan,
      calibration: this.calibration,
      rounds,
      endedEarly: this.endedEarly,
      error: this.error,
      quality: {
        cadenceHz: cadenceHz(this.upper.map((pt) => pt.t)),
        delayMsMedian: medianOf(jitter),
        delayMsP95: percentile(jitter, 95),
        invalidPct: total > 0 ? (100 * bad) / total : 0,
      },
    };
  }
}

const clockText = (s: number): string => {
  const whole = Math.max(0, Math.round(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** At most three plain sentences: verified holds, first contraction, pulse change. */
export function summarize(r: SessionResult, tolS = 1.5): string[] {
  const out: string[] = [];
  const total = r.rounds.length;
  if (total > 0) {
    const verified = r.rounds.filter((x) => x.verdict.verdict === 'verified').length;
    out.push(fmt('summary.verified', { n: verified, total }));
  }

  const firstTaps = r.rounds.map((x) => x.firstTapS).filter((s): s is number => s !== null);
  if (firstTaps.length) {
    const avg = firstTaps.reduce((a, b) => a + b, 0) / firstTaps.length;
    const taps = r.rounds.reduce((sum, x) => sum + x.taps.length, 0);
    const marks = r.rounds.reduce((sum, x) => sum + x.marks.length, 0);
    const matched = r.rounds.reduce((sum, round) => sum + matchTaps(round.marks, round.taps, tolS).matched, 0);
    const template = marks > 0 && taps > 0 ? 'summary.contraction' : 'summary.contractionNoAuto';
    out.push(fmt(template, { avg: clockText(avg), matched, taps }));
  }

  const withPulse = [...r.rounds].reverse().find((x) => x.pulse.delta !== null);
  if (withPulse && withPulse.pulse.start.kind === 'value' && withPulse.pulse.min.kind === 'value') {
    // the SDK reports fractional BPM; sentences show whole beats
    const start = Math.round((withPulse.pulse.start as { bpm: number }).bpm);
    const min = Math.round((withPulse.pulse.min as { bpm: number }).bpm);
    out.push(
      min < start
        ? fmt('summary.pulse', { start, min, round: withPulse.round })
        : fmt('summary.pulseFlat', { round: withPulse.round }),
    );
  }

  return out.slice(0, 3);
}

export function toCsv(r: SessionResult): string {
  const header =
    'round,planned_hold_s,actual_hold_s,stopped,verdict,readable_pct,first_tap_s,first_auto_mark_s,taps,auto_marks,pulse_start,pulse_min,pulse_delta';
  const rows = r.rounds.map((x) => {
    const pulseStart = x.pulse.start.kind === 'value' ? x.pulse.start.bpm : '';
    const pulseMin = x.pulse.min.kind === 'value' ? x.pulse.min.bpm : '';
    return [
      x.round,
      x.plannedHoldS,
      x.actualHoldS.toFixed(1),
      x.stopped ? 'yes' : 'no',
      x.verdict.verdict,
      x.verdict.readablePct.toFixed(1),
      x.firstTapS === null ? '' : x.firstTapS.toFixed(1),
      x.firstMarkS === null ? '' : x.firstMarkS.toFixed(1),
      x.taps.length,
      x.marks.length,
      pulseStart,
      pulseMin,
      x.pulse.delta === null ? '' : x.pulse.delta,
    ].join(',');
  });
  return [header, ...rows].join('\n');
}
