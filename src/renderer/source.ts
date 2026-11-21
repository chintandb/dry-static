import type { Cue, Packet, RawPacket, Tap, ValidationEvent } from '../core/types.js';

export interface SourceEvents {
  packet: (p: Packet, raw: RawPacket, wallMs: number) => void;
  validation: (e: ValidationEvent) => void;
  cue: (c: Cue) => void;
  tap: (t: Tap) => void;
  /** `retryable` is the SDK's own flag when the error came from its 'error' event */
  error: (code: number, message: string, retryable?: boolean) => void;
  stream: (s: MediaStream) => void;
  ended: () => void;
}

export interface Source {
  start(): Promise<void>;
  stop(): Promise<void>;
  on<K extends keyof SourceEvents>(ev: K, f: SourceEvents[K]): void;
}
