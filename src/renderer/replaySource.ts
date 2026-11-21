import { createNormalizeState, normalizeRaw } from '../core/normalize.js';
import { parseRecording } from '../core/recording.js';
import type { Cue, Packet, RecLine, Tap, ValidationEvent } from '../core/types.js';
import type { Source, SourceEvents } from './source.js';

export interface ReplaySource extends Source {
  meta: RecLine | null;
  badLines: number;
  /** recorded wall time of the first line, the session's start in the recording's clock */
  firstWallMs: number;
  /** the recording's wall clock now: what a session fed by this source must use as "now" */
  now(): number;
}

/**
 * Replay source: a JSONL recording played back on a timer, through exactly the same
 * normalize path as live data. It needs no key, no camera and no network.
 *
 * One time domain: every packet, validation event, cue and tap keeps the wall time it was
 * recorded with, and `now()` reports playback progress on that same clock. Restamping lines
 * with the (sped-up) playback time while the traces keep their recorded SDK times makes the
 * wall-to-SDK offset drift by (1 - 1/speed) s per SDK second; the clock's median window lags
 * that drift, so taps and cues would land about 4 s early at 4x and no auto mark would match a tap.
 */
export function createReplaySource(text: string, speed: 1 | 4 = 4): ReplaySource {
  const handlers: Partial<SourceEvents> = {};
  const parsed = parseRecording(text);
  const state = createNormalizeState();
  const lines = parsed.lines.filter((l) => l.type !== 'meta');
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const emit = <K extends keyof SourceEvents>(ev: K, ...args: Parameters<SourceEvents[K]>): void => {
    const f = handlers[ev] as ((...a: unknown[]) => void) | undefined;
    if (f) f(...args);
  };

  const wallOf = (l: RecLine): number => ('wallMs' in l ? l.wallMs : 0);
  const firstWallMs = lines.length ? wallOf(lines[0]) : 0;

  // playback position: the recorded time of the newest emitted line and when it was due
  let started = false;
  let index = 0;
  let cursorRecMs = firstWallMs;
  let cursorDueMs = 0;
  let lastNow = firstWallMs;

  return {
    meta: parsed.meta,
    badLines: parsed.badLines,
    firstWallMs,

    now(): number {
      if (!started) return lastNow;
      // never run ahead of the next line, which also covers gaps shortened below
      const next = index < lines.length ? wallOf(lines[index]) : cursorRecMs;
      const t = Math.min(next, cursorRecMs + (performance.now() - cursorDueMs) * speed);
      lastNow = Math.max(lastNow, t);
      return lastNow;
    },

    async start(): Promise<void> {
      // Lines are scheduled against the wall clock, not one timer wakeup per line: a hidden
      // or occluded window gets at most one timer wakeup a second, and pacing by wakeups
      // would then stretch a 4x replay of ~3000 lines to most of an hour. Each wakeup emits
      // every line that is due; lines keep their recorded times (see above).
      index = 0;
      let dueMs = performance.now();
      started = true;
      cursorDueMs = dueMs;

      const gapMs = (from: RecLine, to: RecLine): number => {
        const gap = (wallOf(to) - wallOf(from)) / speed;
        return Number.isFinite(gap) ? Math.min(Math.max(0, gap), 1000) : 0;
      };

      const emitLine = (line: RecLine): void => {
        const wallMs = wallOf(line);
        if (line.type === 'metrics') {
          const packet: Packet = normalizeRaw(line, state);
          emit('packet', packet, line, wallMs);
        } else if (line.type === 'validation') {
          const ev: ValidationEvent = { wallMs, tsUs: line.tsUs, code: line.code, hint: line.hint };
          emit('validation', ev);
        } else if (line.type === 'cue') {
          const cue: Cue = { wallMs, phase: line.phase, round: line.round };
          emit('cue', cue);
        } else if (line.type === 'tap') {
          const tap: Tap = { wallMs, kind: line.kind };
          emit('tap', tap);
        } else if (line.type === 'error') {
          emit('error', line.code, line.message);
        }
      };

      const step = (): void => {
        const now = performance.now();
        while (!stopped && index < lines.length && dueMs <= now) {
          const line = lines[index];
          cursorRecMs = wallOf(line);
          cursorDueMs = dueMs;
          index += 1;
          emitLine(line);
          if (index < lines.length) dueMs += gapMs(line, lines[index]);
        }
        if (stopped || index >= lines.length) {
          emit('ended');
          return;
        }
        timer = setTimeout(step, Math.max(0, dueMs - now));
      };

      step();
    },

    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
    },

    on(ev, f): void {
      handlers[ev] = f as never;
    },
  };
}
