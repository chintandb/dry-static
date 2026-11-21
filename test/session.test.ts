import { describe, expect, it } from 'vitest';
import { analyzeRecording } from '../src/core/benchmark.js';
import { makeParams, type Params } from '../src/core/params.js';
import { serializeLine } from '../src/core/recording.js';
import { SessionController, summarize, toCsv } from '../src/core/session.js';
import { synthSession } from '../src/core/synth.js';
import { planTable } from '../src/core/table.js';
import type { Packet, RecLine, TablePlan, TracePoint } from '../src/core/types.js';

const START = 1_700_000_000_000;
const p: Params = makeParams();

const plan = (restS: number[], holdS: number[]): TablePlan => ({
  type: 'co2',
  size: 'quick',
  pbS: 100,
  capPct: 0.5,
  rounds: restS.map((rest, i) => ({ round: i + 1, restS: rest, holdS: holdS[i] })),
  liveS: 0,
});

let seed = 21;
const gauss = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  const u = Math.max(seed / 4294967296, 1e-9);
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  const v = seed / 4294967296;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Breathing (2 s period, amplitude 1) outside holds, flat inside, one packet per 0.1 s. */
const packetAt = (wallMs: number, t: number, inHold: boolean, noise = 0.02): Packet => {
  const v = inHold ? 0.03 * gauss() : Math.sin((2 * Math.PI * t) / 4) + noise * gauss();
  const point: TracePoint = { t, v, stable: true };
  return {
    wallMs,
    t,
    upper: [point],
    lower: [{ t, v: v * 0.9, stable: true }],
    rate: [],
    pulse: [],
    talking: [],
  };
};

const controller = (table: TablePlan, params: Params = p): SessionController =>
  new SessionController({
    plan: table,
    mode: 'live',
    params,
    startWallMs: START,
    id: 'session-test',
    startedAt: new Date(START).toISOString(),
  });

describe('SessionController live', () => {
  it('live phases follow plan', () => {
    const table = plan([10, 10], [20, 20]);
    const ctl = controller(table);
    const table2 = table;
    const holds = table2.rounds.map((r) => ({ startS: 0, restS: r.restS }));
    void holds;

    // holds start at 45 + 10 + 3 and 78 + 10 + 3
    const holdWindows = [
      [58, 78],
      [91, 111],
    ];
    const cues: { wallMs: number; phase: string; round: number }[] = [];
    for (let ms = 0; ms <= 130_000; ms += 100) {
      const t = ms / 1000;
      const inHold = holdWindows.some(([a, b]) => t >= a && t < b);
      ctl.onPacket(packetAt(START + ms, t, inHold));
      cues.push(...ctl.tick(START + ms));
    }

    expect(cues.map((c) => c.phase)).toEqual([
      'rest_start',
      'countdown_start',
      'hold_start',
      'hold_end',
      'rest_start',
      'countdown_start',
      'hold_start',
      'hold_end',
      'session_end',
    ]);
    const times = cues.map((c) => (c.wallMs - START) / 1000);
    const expected = [45, 55, 58, 78, 78, 88, 91, 111, 111];
    times.forEach((t, i) => expect(Math.abs(t - expected[i])).toBeLessThanOrEqual(0.1));
    expect(ctl.view(START + 130_000).phase).toBe('done');
  });

  it('calibration fails on noise', () => {
    const ctl = controller(plan([10], [20]));
    let cues: { wallMs: number; phase: string; round: number }[] = [];
    for (let ms = 0; ms <= 50_000; ms += 100) {
      const t = ms / 1000;
      // no breathing at all: pure noise on both traces
      const v = 0.03 * gauss();
      ctl.onPacket({
        wallMs: START + ms,
        t,
        upper: [{ t, v, stable: true }],
        lower: [{ t, v, stable: true }],
        rate: [],
        pulse: [],
        talking: [],
      });
      cues = cues.concat(ctl.tick(START + ms));
    }
    expect(ctl.view(START + 50_000).phase).toBe('calibration_failed');
    expect(cues.some((c) => c.phase === 'rest_start')).toBe(false);
  });

  it('stop during last hold ends session', () => {
    const ctl = controller(plan([10], [20]));
    const holdStart = 58;
    for (let ms = 0; ms <= 58_500; ms += 100) {
      const t = ms / 1000;
      ctl.onPacket(packetAt(START + ms, t, t >= holdStart));
      ctl.tick(START + ms);
    }
    expect(ctl.view(START + 58_500).phase).toBe('hold');
    const cues = ctl.stopHold(START + (holdStart + 5) * 1000);
    const result = ctl.result();
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].stopped).toBe(true);
    expect(result.rounds[0].actualHoldS).toBeGreaterThan(4.5);
    expect(result.rounds[0].actualHoldS).toBeLessThan(5.5);
    // the session waits for the last pulse window before it is done (pulse: settling)
    expect(ctl.view(START + (holdStart + 5) * 1000).phase).toBe('finishing');
    expect(cues.map((c) => c.phase)).toEqual(['hold_end', 'session_end']);
  });

  it('stop during settle-in is ignored', () => {
    // Stop during countdown and rest is covered in session-edge-cases.test.ts
    const ctl = controller(plan([10], [20]));
    for (let ms = 0; ms <= 20_000; ms += 100) {
      ctl.onPacket(packetAt(START + ms, ms / 1000, false));
      ctl.tick(START + ms);
    }
    expect(ctl.view(START + 20_000).phase).toBe('settle');
    expect(ctl.stopHold(START + 20_000)).toEqual([]);
    expect(ctl.view(START + 20_000).phase).toBe('settle');
  });

  it('fail mid-session keeps completed rounds', () => {
    const ctl = controller(plan([10, 10], [20, 20]));
    const holdWindows = [
      [58, 78],
      [91, 111],
    ];
    for (let ms = 0; ms <= 80_000; ms += 100) {
      const t = ms / 1000;
      ctl.onPacket(packetAt(START + ms, t, holdWindows.some(([a, b]) => t >= a && t < b)));
      ctl.tick(START + ms);
    }
    ctl.fail(4, 'credits');
    const result = ctl.result();
    expect(result.rounds).toHaveLength(1);
    expect(result.endedEarly).toBe(true);
    expect(result.error?.code).toBe(4);
    expect(ctl.view(START + 80_000).phase).toBe('done');
  });
});

describe('SessionController replay', () => {
  it('replay mode follows recorded cues', () => {
    const table = planTable({ pbS: 120, type: 'co2', size: 'quick', capPct: 0.5 });
    const holds = [
      { startS: 45, durS: 45, contractionsAtS: [70, 80] },
      { startS: 103, durS: 45, contractionsAtS: [125, 133, 141] },
      { startS: 151, durS: 45, contractionsAtS: [170, 180, 190] },
    ];
    const lines = synthSession({ seed: 4, holds, totalS: 200, plan: table, pulseDrop: 8 });
    const text = lines.map(serializeLine).join('\n');
    const offline = analyzeRecording('replay.jsonl', text, p);

    const ctl = new SessionController({
      plan: table,
      mode: 'replay',
      params: p,
      startWallMs: START,
      id: 'replay-test',
      startedAt: new Date(START).toISOString(),
    });

    for (const line of lines as RecLine[]) {
      if (line.type === 'metrics') {
        const wallMs = START + (line.tsUs / 1000);
        ctl.onPacket({
          wallMs,
          t: 0,
          upper: line.upper.map(([tsUs, v, stable]) => ({ t: tsUs / 1e6, v, stable })),
          lower: line.lower.map(([tsUs, v, stable]) => ({ t: tsUs / 1e6, v, stable })),
          rate: line.rate.map(([tsUs, v, conf, stable]) => ({ t: tsUs / 1e6, v, conf, stable })),
          pulse: line.pulse.map(([tsUs, v, conf, stable]) => ({ t: tsUs / 1e6, v, conf, stable })),
          talking: line.talking.map(([tsUs, detected]) => ({ t: tsUs / 1e6, detected })),
        });
      } else if (line.type === 'cue') {
        ctl.onCue({ wallMs: START + (line.wallMs - 1_763_000_000_000), phase: line.phase, round: line.round });
      } else if (line.type === 'tap') {
        ctl.onTap({ wallMs: START + (line.wallMs - 1_763_000_000_000), kind: line.kind });
      }
    }

    const result = ctl.result();
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds.map((r) => r.verdict.verdict)).toEqual(offline.holds.map((h) => h.verdict.verdict));
    expect(result.rounds.map((r) => r.marks.length)).toEqual(offline.holds.map((h) => h.marks.length));
    expect(result.rounds.map((r) => r.taps.length)).toEqual(offline.holds.map((h) => h.taps.length));
  });
});
