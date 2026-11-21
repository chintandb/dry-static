/** Shared types. Everything here is plain data so it can be tested without a DOM or the SDK. */

export interface TracePoint {
  /** seconds since the session origin, on the SDK sample clock */
  t: number;
  v: number;
  stable: boolean;
}

export interface RatePoint {
  t: number;
  v: number;
  /** percentage 0-100 */
  conf: number;
  stable: boolean;
}

export interface TalkPoint {
  t: number;
  detected: boolean;
}

/** One decoded metrics packet, normalized onto the session clock. */
export interface Packet {
  wallMs: number;
  /** SDK time of the newest sample in the packet, in seconds since the session origin */
  t: number;
  upper: TracePoint[];
  lower: TracePoint[];
  rate: RatePoint[];
  pulse: RatePoint[];
  talking: TalkPoint[];
}

/** Raw packet exactly as it is written to a recording (arrays, no objects). */
export interface RawPacket {
  wallMs: number;
  tsUs: number;
  upper: [number, number, boolean][];
  lower: [number, number, boolean][];
  rate: [number, number, number, boolean][];
  pulse: [number, number, number, boolean][];
  talking: [number, boolean][];
}

export type CuePhase =
  | 'settle_start'
  | 'rest_start'
  | 'countdown_start'
  | 'hold_start'
  | 'hold_end'
  | 'session_end';

export interface Cue {
  wallMs: number;
  phase: CuePhase;
  round: number;
}

export interface Tap {
  wallMs: number;
  kind: 'contraction' | 'stop';
}

export interface ValidationEvent {
  wallMs: number;
  tsUs: number;
  code: number;
  hint: string;
}

export type TableType = 'co2' | 'o2';
export type TableSize = 'quick' | 'standard' | 'full';
export type CapPct = 0.5 | 0.55 | 0.6;

export interface TablePlan {
  type: TableType;
  size: TableSize;
  pbS: number;
  capPct: CapPct;
  rounds: { round: number; restS: number; holdS: number }[];
  /** estimated live SDK minutes for the whole session, in seconds */
  liveS: number;
}

export type RecLine =
  | {
      type: 'meta';
      version: 1;
      app: 'dry-static';
      sdk: string;
      createdAt: string;
      mode: 'live' | 'record';
      plan: TablePlan | null;
      requestedMetrics: number[];
    }
  | ({ type: 'metrics' } & RawPacket)
  | ({ type: 'validation' } & ValidationEvent)
  | { type: 'status'; wallMs: number; status: number }
  | ({ type: 'cue' } & Cue)
  | ({ type: 'tap' } & Tap)
  | { type: 'error'; wallMs: number; code: number; message: string };
