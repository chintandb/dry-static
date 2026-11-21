import { ClockSync } from './clock.js';
import { calibrate, type Calibration } from './calibration.js';
import { detectContractions, matchTaps, pooledMatch, type MatchResult } from './contractions.js';
import { HoldVerifier, type HoldVerdict } from './holdVerifier.js';
import { createNormalizeState, normalizeRaw } from './normalize.js';
import type { Params } from './params.js';
import { pulseTrend, type PulseTrend } from './pulseTrend.js';
import { cadenceHz, medianOf, percentile } from './signal.js';
import { parseRecording } from './recording.js';
import type { Packet, RatePoint, TracePoint } from './types.js';

export interface HoldReport {
  round: number;
  t0: number;
  tEnd: number;
  durS: number;
  coveragePct: number;
  maxGapS: number;
  verdict: HoldVerdict;
  marks: number[];
  taps: number[];
  match: MatchResult;
  pulse: PulseTrend;
  recoveryS: number | null;
}

export interface FileReport {
  file: string;
  badLines: number;
  cadenceHz: number;
  delayMsMedian: number;
  delayMsP95: number;
  invalidPct: number;
  calibration: Calibration;
  holds: HoldReport[];
}

export type Check = 'PASS' | 'PARTIAL' | 'FAIL' | 'INCONCLUSIVE';

export interface GoNoGo {
  a: Check;
  b: Check;
  c: Check;
  d: Check;
  ship: 'GO' | 'NO-GO';
  pooled: MatchResult & { inconclusive: boolean };
}

const BIN_S = 0.1;

/**
 * Share of `BIN_S` bins in [from, to] that are covered, plus the worst gap.
 *
 * A bin is covered only when it lies between two consecutive samples at most `gapS` apart,
 * the same rule the hold verifier uses ("no sample for more than gapS is unreadable"). A
 * bin merely *near* a sample is not enough: that would let gaps of up to 2 x gapS count.
 * `times` must be sorted; samples just outside the range still bound its first and last span.
 */
function coverage(times: number[], from: number, to: number, gapS: number): { pct: number; maxGap: number } {
  const inside = times.filter((t) => t >= from && t <= to);
  if (inside.length === 0) return { pct: 0, maxGap: to - from };

  let gap = 0;
  for (let i = 1; i < inside.length; i += 1) gap = Math.max(gap, inside[i] - inside[i - 1]);
  gap = Math.max(gap, inside[0] - from, to - inside[inside.length - 1]);

  let bins = 0;
  let covered = 0;
  // index of the newest sample at or before the bin
  let k = -1;
  for (let g = from; g <= to + 1e-9; g += BIN_S) {
    bins += 1;
    while (k + 1 < times.length && times[k + 1] <= g) k += 1;
    if (k < 0) continue;
    const spanOk = k + 1 < times.length && times[k + 1] - times[k] <= gapS;
    // a bin that lands exactly on the final sample still closes the span before it
    const endsSpan = times[k] === g && k > 0 && times[k] - times[k - 1] <= gapS;
    if (spanOk || endsSpan) covered += 1;
  }
  return { pct: (100 * covered) / bins, maxGap: gap };
}

export function analyzeRecording(file: string, text: string, p: Params): FileReport {
  const parsed = parseRecording(text);
  if (!parsed.meta) throw new Error(`${file}: no meta line, this is not a DRY STATIC recording`);

  const state = createNormalizeState();
  const clock = new ClockSync(p.clockWindow);
  const packets: Packet[] = [];
  const delays: number[] = [];
  const rawValidation: { wallMs: number; code: number }[] = [];
  const rawCues: { phase: string; round: number; wallMs: number }[] = [];
  const rawTaps: { kind: string; wallMs: number }[] = [];
  const validation: { t: number; code: number }[] = [];
  const cueTimes: { phase: string; round: number; t: number }[] = [];
  const tapTimes: { kind: string; t: number }[] = [];
  let lastSampleT = 0;

  for (const line of parsed.lines) {
    if (line.type === 'metrics') {
      const packet = normalizeRaw(line, state);
      packets.push(packet);
      const newest = Math.max(
        packet.upper.length ? packet.upper[packet.upper.length - 1].t : -Infinity,
        packet.lower.length ? packet.lower[packet.lower.length - 1].t : -Infinity,
        packet.rate.length ? packet.rate[packet.rate.length - 1].t : -Infinity,
        packet.pulse.length ? packet.pulse[packet.pulse.length - 1].t : -Infinity,
      );
      if (Number.isFinite(newest)) {
        lastSampleT = newest;
        clock.observe(line.wallMs, newest);
        delays.push(line.wallMs / 1000 - newest);
      }
    } else if (line.type === 'validation') {
      rawValidation.push({ wallMs: line.wallMs, code: line.code });
    } else if (line.type === 'cue') {
      rawCues.push({ phase: line.phase, round: line.round, wallMs: line.wallMs });
    } else if (line.type === 'tap') {
      rawTaps.push({ kind: line.kind, wallMs: line.wallMs });
    }
  }

  // Cues and taps carry wall-clock times, the traces carry SDK times; resolve the mapping
  // after every packet has been seen, because markers can precede the first packet.
  for (const v of rawValidation) {
    const t = clock.toSdkTime(v.wallMs);
    if (t !== null) validation.push({ t, code: v.code });
  }
  for (const c of rawCues) {
    const t = clock.toSdkTime(c.wallMs);
    if (t !== null) cueTimes.push({ phase: c.phase, round: c.round, t });
  }
  for (const tap of rawTaps) {
    const t = clock.toSdkTime(tap.wallMs);
    if (t !== null) tapTimes.push({ kind: tap.kind, t });
  }

  const upper: TracePoint[] = [];
  const lower: TracePoint[] = [];
  const rate: RatePoint[] = [];
  const pulse: RatePoint[] = [];
  const talking: { t: number; detected: boolean }[] = [];
  for (const packet of packets) {
    upper.push(...packet.upper);
    lower.push(...packet.lower);
    rate.push(...packet.rate);
    pulse.push(...packet.pulse);
    talking.push(...packet.talking);
  }

  // Holds come from cue pairs; an unterminated hold closes at the last sample.
  const starts = cueTimes.filter((c) => c.phase === 'hold_start').sort((a, b) => a.t - b.t);
  const ends = cueTimes.filter((c) => c.phase === 'hold_end').sort((a, b) => a.t - b.t);
  const firstStart = starts.length ? starts[0].t : 0;
  const calibFrom = firstStart - p.calibWindowS;
  const pick = <T extends { t: number }>(xs: T[], from: number, to: number): T[] => xs.filter((x) => x.t >= from && x.t <= to);

  const calibration = calibrate(
    pick(upper, calibFrom, firstStart),
    pick(lower, calibFrom, firstStart),
    pick(pulse, calibFrom, firstStart),
    p,
  );

  const delayMin = delays.length ? Math.min(...delays) : 0;
  const delayMs = delays.map((d) => (d - delayMin) * 1000);

  const sortedValidation = [...validation].sort((a, b) => a.t - b.t);
  const invalidSpans = (() => {
    const v = sortedValidation;
    let bad = 0;
    let total = 0;
    for (let i = 0; i < v.length; i += 1) {
      const span = i + 1 < v.length ? v[i + 1].t - v[i].t : 0;
      total += span;
      if (v[i].code !== 0) bad += span;
    }
    return total > 0 ? (100 * bad) / total : 0;
  })();

  const primaryTrace: TracePoint[] = calibration.primary === 'lower' ? lower : upper;
  const contractionTrace: TracePoint[] = calibration.contractionTrace === 'upper' ? upper : lower;
  const primaryTimes = primaryTrace.map((pt) => pt.t);

  const holds: HoldReport[] = [];
  const usedEnds = new Set<number>();
  starts.forEach((start, index) => {
    const next = starts[index + 1]?.t ?? Number.POSITIVE_INFINITY;
    const end =
      ends.find((e) => e.t > start.t && e.t < next && !usedEnds.has(e.t)) ??
      ({ t: Math.min(lastSampleT, next), round: start.round } as { t: number; round: number });
    if (ends.some((e) => e.t === end.t)) usedEnds.add(end.t);
    const tEnd = end.t;

    const verifier = new HoldVerifier(start.t, calibration, p);
    verifier.pushSamples(pick(primaryTrace, start.t, tEnd));
    // as in the app, a validation code set before the hold still applies at its start
    const before = sortedValidation.filter((v) => v.t < start.t);
    if (before.length) verifier.pushValidation(start.t, before[before.length - 1].code);
    for (const v of sortedValidation) {
      if (v.t >= start.t && v.t <= tEnd) verifier.pushValidation(v.t, v.code);
    }
    verifier.pushTalking(pick(talking, start.t, tEnd));
    const verdict = verifier.finish(tEnd);

    const A = calibration.contractionTrace ? calibration[calibration.contractionTrace].A : 0;
    const marks = detectContractions(
      pick(contractionTrace, start.t, tEnd),
      start.t,
      tEnd,
      A,
      verdict.unreadable,
      p,
    );

    const taps = tapTimes.filter((tap) => tap.kind === 'contraction' && tap.t >= start.t && tap.t <= tEnd).map((tap) => tap.t);
    const match = matchTaps(marks, taps, p.tapTolS);
    const trend = pulseTrend(pulse, start.t, tEnd, p);

    const cover = coverage(primaryTimes, start.t + p.holdIgnoreS, tEnd, p.gapS);
    const stableAfter = rate.find((pt) => pt.t >= tEnd && pt.stable);

    holds.push({
      round: start.round,
      t0: start.t,
      tEnd,
      durS: tEnd - start.t,
      coveragePct: cover.pct,
      maxGapS: cover.maxGap,
      verdict,
      marks,
      taps,
      match,
      pulse: trend,
      recoveryS: stableAfter ? stableAfter.t - tEnd : null,
    });
  });

  return {
    file,
    badLines: parsed.badLines,
    cadenceHz: cadenceHz(upper.map((pt) => pt.t)),
    delayMsMedian: delayMs.length ? medianOf(delayMs) : 0,
    delayMsP95: delayMs.length ? percentile(delayMs, 95) : 0,
    invalidPct: invalidSpans,
    calibration,
    holds,
  };
}

/** The decision rule, fixed before any recording was analyzed. Nothing here is tuned on the answer. */
export function goNoGo(reports: FileReport[], p: Params): GoNoGo {
  const holds = reports.flatMap((r) => r.holds);
  const slowestCadence = Math.min(...reports.map((r) => r.cadenceHz));

  const worstCoverage = holds.length ? Math.min(...holds.map((h) => h.coveragePct)) : 0;
  const worstGap = holds.length ? Math.max(...holds.map((h) => h.maxGapS)) : Number.POSITIVE_INFINITY;
  let a: Check;
  if (holds.length === 0) a = 'FAIL';
  else if (worstCoverage >= 90 && worstGap <= 1.0 && slowestCadence >= 20) a = 'PASS';
  else if (worstCoverage >= 60) a = 'PARTIAL';
  else a = 'FAIL';

  const pooled = pooledMatch(holds.map((h) => h.match), 6);
  let b: Check;
  if (pooled.inconclusive) b = 'INCONCLUSIVE';
  else if ((pooled.precision ?? 0) >= 0.7 && (pooled.recall ?? 0) >= 0.5) b = 'PASS';
  else if ((pooled.precision ?? 0) >= 0.6 && (pooled.recall ?? 0) >= 0.3) b = 'PARTIAL';
  else b = 'FAIL';

  const drops = holds.filter((h) => h.pulse.delta !== null && (h.pulse.delta as number) <= -3).length;
  const c: Check = drops >= 2 ? 'PASS' : 'PARTIAL';

  const recoveries = holds.map((h) => h.recoveryS).filter((s): s is number => s !== null);
  const d: Check = recoveries.length > 0 && medianOf(recoveries) <= 40 ? 'PASS' : 'PARTIAL';

  return { a, b, c, d, ship: a === 'FAIL' ? 'NO-GO' : 'GO', pooled };
}

const seconds = (s: number): string => `${s.toFixed(1)} s`;
const pulseText = (value: PulseTrend['start']): string =>
  value.kind === 'value' ? `${value.bpm} BPM` : value.kind === 'out_of_range' ? "outside the SDK's valid range" : 'not available';

export function formatReport(reports: FileReport[], g: GoNoGo): string {
  const out: string[] = [];
  for (const r of reports) {
    out.push(`== ${r.file}`);
    out.push(`   cadence ${r.cadenceHz.toFixed(1)} Hz, bad lines ${r.badLines}, invalid ${r.invalidPct.toFixed(1)}%`);
    out.push(
      `   delay ${r.delayMsMedian.toFixed(0)} ms median, ${r.delayMsP95.toFixed(0)} ms p95 (jitter above the fastest packet)`,
    );
    out.push(
      `   calibration: primary ${r.calibration.primary ?? 'none'} (SNR ${r.calibration.primary ? r.calibration[r.calibration.primary].snr.toFixed(1) : '-'}), contraction trace ${r.calibration.contractionTrace ?? 'none'}`,
    );
    for (const h of r.holds) {
      out.push(
        `   round ${h.round}: ${seconds(h.durS)} hold, ${h.verdict.verdict} (readable ${h.verdict.readablePct.toFixed(1)}%), coverage ${h.coveragePct.toFixed(1)}%, max gap ${h.maxGapS.toFixed(2)} s`,
      );
      if (h.verdict.breathAt !== null) out.push(`     breath seen at ${seconds(h.verdict.breathAt)}`);
      out.push(
        `     marks ${h.marks.length} vs taps ${h.taps.length} (${h.match.matched} matched, precision ${h.match.precision === null ? '-' : h.match.precision.toFixed(2)}, recall ${h.match.recall === null ? '-' : h.match.recall.toFixed(2)})`,
      );
      const delta = h.pulse.delta === null ? 'not available' : `${h.pulse.delta} BPM`;
      out.push(
        `     pulse start ${pulseText(h.pulse.start)}, min ${pulseText(h.pulse.min)}, delta ${delta}; confidence back after ${h.recoveryS === null ? '-' : seconds(h.recoveryS)}`,
      );
    }
    out.push('');
  }

  const totalHolds = reports.reduce((s, r) => s + r.holds.length, 0);
  out.push(`holds: ${totalHolds}`);
  out.push(`(a) verified-hold signal quality: ${g.a}`);
  out.push(
    `(b) contraction marks vs taps: ${g.b} — ${g.pooled.matched} matched of ${g.pooled.marks} marks and ${g.pooled.taps} taps${g.pooled.inconclusive ? ' (inconclusive: fewer than 6 taps)' : ''}`,
  );
  out.push(`(c) pulse drop across holds: ${g.c}`);
  out.push(`(d) breathing confidence recovery: ${g.d}`);
  out.push(`ship: ${g.ship}`);
  return out.join('\n');
}
