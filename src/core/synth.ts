import type { RecLine, TablePlan } from './types.js';

/** Deterministic PRNG so a seed always produces the same session. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SynthHold {
  startS: number;
  durS: number;
  contractionsAtS: number[];
  sneakBreathAtS?: number;
}

export interface SynthOptions {
  seed: number;
  holds: SynthHold[];
  totalS: number;
  hz?: number;
  pulseDrop?: number;
  dropouts?: [number, number][];
  breathPeriodS?: number;
  plan?: TablePlan | null;
}

const WALL0 = 1_763_000_000_000;

/**
 * Build a synthetic recording. Used by the tests and to demo the pipeline without
 * a camera or a key. It is *not* a substitute for a real recording: the hold
 * verdicts it produces say nothing about physiology.
 */
export function synthSession(opts: SynthOptions): RecLine[] {
  const hz = opts.hz ?? 27.5;
  const dt = 1 / hz;
  const rand = mulberry32(opts.seed);
  const gauss = () => {
    const u = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const period = opts.breathPeriodS ?? 4;
  const pulseDrop = opts.pulseDrop ?? 8;
  const dropouts = opts.dropouts ?? [];
  const isDropout = (t: number) => dropouts.some(([a, b]) => t >= a && t < b);
  const holdAt = (t: number) => opts.holds.find((h) => t >= h.startS && t < h.startS + h.durS) ?? null;

  const lines: RecLine[] = [];
  lines.push({
    type: 'meta',
    version: 1,
    app: 'dry-static',
    sdk: 'synthetic',
    createdAt: new Date(WALL0).toISOString(),
    mode: 'record',
    plan: opts.plan ?? null,
    requestedMetrics: [0, 1, 2, 15, 13],
  });

  // Cue stream: settle, then rest / countdown / hold per round, so the replay source can
  // drive the same phases a live session would.
  lines.push({ type: 'cue', wallMs: WALL0, phase: 'settle_start', round: 0 });
  opts.holds.forEach((h, i) => {
    const prevEnd = i === 0 ? null : opts.holds[i - 1].startS + opts.holds[i - 1].durS;
    const restS = opts.plan?.rounds[i]?.restS ?? 45;
    const restStart = prevEnd ?? Math.max(0, h.startS - 3 - restS);
    lines.push({ type: 'cue', wallMs: WALL0 + restStart * 1000, phase: 'rest_start', round: i + 1 });
    lines.push({ type: 'cue', wallMs: WALL0 + Math.max(0, h.startS - 3) * 1000, phase: 'countdown_start', round: i + 1 });
    lines.push({ type: 'cue', wallMs: WALL0 + h.startS * 1000, phase: 'hold_start', round: i + 1 });
    lines.push({ type: 'cue', wallMs: WALL0 + (h.startS + h.durS) * 1000, phase: 'hold_end', round: i + 1 });
    for (const c of h.contractionsAtS) {
      lines.push({ type: 'tap', wallMs: WALL0 + (c + 0.4) * 1000, kind: 'contraction' });
    }
  });
  lines.push({ type: 'cue', wallMs: WALL0 + opts.totalS * 1000, phase: 'session_end', round: 0 });

  const steps = Math.floor(opts.totalS * hz);
  let batch: { tsUs: number; v: number; jerk: number }[] = [];
  let nextRate = 0;
  let nextPulse = 0;

  const flush = (wallMs: number) => {
    if (!batch.length) return;
    const first = batch[0];
    lines.push({
      type: 'metrics',
      wallMs,
      tsUs: first.tsUs,
      upper: batch.map((s) => [s.tsUs, s.v + s.jerk * 0.1, true] as [number, number, boolean]),
      lower: batch.map((s) => [s.tsUs, s.v * 0.9 + s.jerk, true] as [number, number, boolean]),
      rate: [],
      pulse: [],
      talking: [],
    });
    batch = [];
  };

  for (let i = 0; i < steps; i += 1) {
    const t = i * dt;
    const tsUs = Math.round(t * 1e6);

    const h = holdAt(t);
    let v: number;
    if (h && isDropout(t) === false) {
      // inside a hold: flat, small noise; the optional sneaked breath is a full cycle
      const sneakAt = h.sneakBreathAtS;
      const inSneak = sneakAt !== undefined && t >= sneakAt && t < sneakAt + period;
      v = inSneak && sneakAt !== undefined
        ? Math.sin((2 * Math.PI * (t - sneakAt)) / period)
        : 0.03 * gauss();
    } else if (h) {
      v = 0;
    } else {
      const base = Math.sin((2 * Math.PI * t) / period);
      const sneakPhase = opts.holds.some(
        (x) => x.sneakBreathAtS !== undefined && t >= x.sneakBreathAtS && t < x.sneakBreathAtS + period,
      );
      v = base + (sneakPhase ? 0 : 0.02 * gauss());
    }

    // diaphragm jerks: 0.4 amplitude for 0.3 s, on the abdominal trace only
    let jerk = 0;
    if (h) {
      for (const c of h.contractionsAtS) {
        const d = t - c;
        if (d >= 0 && d < 0.3) jerk += 0.4 * Math.sin((Math.PI * d) / 0.3);
      }
    }

    if (!isDropout(t)) {
      batch.push({ tsUs, v, jerk });
      if (batch.length === 3) flush(WALL0 + t * 1000);
    }

    // 1 Hz scalar series
    if (t >= nextRate) {
      nextRate += 1;
      const stable = t >= 30;
      const rateRow: [number, number, number, boolean] = [Math.round(t * 1e6), 12, stable ? 70 : 0, stable];
      const lastPacket = [...lines].reverse().find((l) => l.type === 'metrics');
      if (lastPacket && lastPacket.type === 'metrics') lastPacket.rate.push(rateRow);
    }
    if (t >= nextPulse) {
      nextPulse += 1;
      let bpm = 72;
      for (const hh of opts.holds) {
        if (t >= hh.startS) {
          const frac = Math.min(1, (t - hh.startS) / hh.durS);
          bpm -= pulseDrop * frac;
        }
      }
      const pulseRow: [number, number, number, boolean] = [Math.round(t * 1e6), Math.round(bpm), 85, true];
      const lastPacket = [...lines].reverse().find((l) => l.type === 'metrics');
      if (lastPacket && lastPacket.type === 'metrics') lastPacket.pulse.push(pulseRow);
    }
  }
  flush(WALL0 + opts.totalS * 1000);
  // A real recorder writes lines as they arrive, so replay the same way: meta first, then
  // everything else in wall-clock order (stable, so equal times keep their insertion order).
  const [meta, ...rest] = lines as RecLine[];
  const when = (l: RecLine): number => ('wallMs' in l ? l.wallMs : 0);
  rest.sort((a, b) => when(a) - when(b));
  return [meta, ...rest];
}
