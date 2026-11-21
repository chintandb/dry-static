import type { Packet, RatePoint, RawPacket, TalkPoint, TracePoint } from './types.js';

/** protobuf int64 arrives as number or Long; anything else is null. */
export function toNumber(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (x && typeof (x as { toNumber?: () => number }).toNumber === 'function') {
    const n = (x as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type AnyRecord = Record<string, any>;

const pick = (o: AnyRecord | undefined, ...names: string[]): any => {
  if (!o) return undefined;
  for (const n of names) if (o[n] !== undefined && o[n] !== null) return o[n];
  return undefined;
};
const arr = (x: unknown): AnyRecord[] => (Array.isArray(x) ? (x as AnyRecord[]) : []);

/**
 * Turn one decoded `presage.smartspectra.Metrics` message into a raw packet.
 * Missing sections become empty arrays: the SDK often sends packets with an
 * empty `rate` or `pulse` array between updates, and breathing can be absent.
 */
export function rawFromDecoded(m: unknown, wallMs: number, packetTsUs: number): RawPacket {
  const metrics = (m ?? {}) as AnyRecord;
  const breathing = metrics.breathing as AnyRecord | undefined;
  const cardio = metrics.cardio as AnyRecord | undefined;
  const face = metrics.face as AnyRecord | undefined;

  const trace = (nodes: AnyRecord[]): [number, number, boolean][] => {
    const out: [number, number, boolean][] = [];
    for (const n of nodes) {
      const ts = toNumber(n.timestamp);
      const v = toNumber(n.value);
      if (ts === null || v === null) continue;
      out.push([ts, v, n.stable === true]);
    }
    return out;
  };

  const rates = (nodes: AnyRecord[]): [number, number, number, boolean][] => {
    const out: [number, number, number, boolean][] = [];
    for (const n of nodes) {
      const ts = toNumber(n.timestamp);
      const v = toNumber(n.value);
      if (ts === null || v === null) continue;
      const conf = toNumber(n.confidence) ?? 0;
      out.push([ts, v, conf, n.stable === true]);
    }
    return out;
  };

  const talks = (nodes: AnyRecord[]): [number, boolean][] => {
    const out: [number, boolean][] = [];
    for (const n of nodes) {
      const ts = toNumber(n.timestamp);
      if (ts === null) continue;
      out.push([ts, n.detected === true]);
    }
    return out;
  };

  return {
    wallMs,
    tsUs: packetTsUs,
    upper: trace(arr(pick(breathing, 'upperTrace', 'upper_trace'))),
    lower: trace(arr(pick(breathing, 'lowerTrace', 'lower_trace'))),
    rate: rates(arr(pick(breathing, 'rate'))),
    pulse: rates(arr(pick(cardio, 'pulseRate', 'pulse_rate'))),
    talking: talks(arr(pick(face, 'talking'))),
  };
}

export interface NormalizeState {
  originUs: number | null;
  lastUpper: number;
  lastLower: number;
  lastRate: number;
  lastPulse: number;
  lastTalking: number;
  lastT: number;
}

export function createNormalizeState(): NormalizeState {
  return {
    originUs: null,
    lastUpper: -Infinity,
    lastLower: -Infinity,
    lastRate: -Infinity,
    lastPulse: -Infinity,
    lastTalking: -Infinity,
    lastT: 0,
  };
}

/**
 * Convert a raw packet to session time. Samples are deduplicated per series:
 * consecutive packets overlap, so each timestamp is kept once.
 */
export function normalizeRaw(raw: RawPacket, s: NormalizeState): Packet {
  if (s.originUs === null) {
    let min = Infinity;
    for (const list of [raw.upper, raw.lower, raw.rate, raw.pulse, raw.talking]) {
      for (const row of list) if (row[0] < min) min = row[0] as number;
    }
    s.originUs = Number.isFinite(min) ? min : 0;
  }
  const origin = s.originUs;
  const sec = (tsUs: number) => (tsUs - origin) / 1e6;

  const upper: TracePoint[] = [];
  for (const [ts, v, stable] of raw.upper) {
    if (ts <= s.lastUpper) continue;
    s.lastUpper = ts;
    upper.push({ t: sec(ts), v, stable });
  }
  const lower: TracePoint[] = [];
  for (const [ts, v, stable] of raw.lower) {
    if (ts <= s.lastLower) continue;
    s.lastLower = ts;
    lower.push({ t: sec(ts), v, stable });
  }
  const rate: RatePoint[] = [];
  for (const [ts, v, conf, stable] of raw.rate) {
    if (ts <= s.lastRate) continue;
    s.lastRate = ts;
    rate.push({ t: sec(ts), v, conf, stable });
  }
  const pulse: RatePoint[] = [];
  for (const [ts, v, conf, stable] of raw.pulse) {
    if (ts <= s.lastPulse) continue;
    s.lastPulse = ts;
    pulse.push({ t: sec(ts), v, conf, stable });
  }
  const talking: TalkPoint[] = [];
  for (const [ts, detected] of raw.talking) {
    if (ts <= s.lastTalking) continue;
    s.lastTalking = ts;
    talking.push({ t: sec(ts), detected });
  }

  const newest = Math.max(s.lastUpper, s.lastLower, s.lastRate, s.lastPulse, s.lastTalking);
  if (Number.isFinite(newest)) s.lastT = sec(newest);

  return { wallMs: raw.wallMs, t: s.lastT, upper, lower, rate, pulse, talking };
}
