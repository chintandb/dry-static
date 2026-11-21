/**
 * Session controller edge cases: pulse windows that fill after the hold ends, validation state
 * set before a hold, Stop outside a hold, and live auto marks over unreadable spans.
 */
import { describe, expect, it } from 'vitest';
import { makeParams, type Params } from '../src/core/params.js';
import { SessionController, summarize, type SessionResult } from '../src/core/session.js';
import { synthSession } from '../src/core/synth.js';
import type { Packet, RatePoint, RecLine, TablePlan } from '../src/core/types.js';

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

let seed = 7;
const gauss = (): number => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  const u = Math.max(seed / 4294967296, 1e-9);
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos((2 * Math.PI * seed) / 4294967296);
};

/** Breathing outside holds, flat inside; SDK time equals wall time minus START. */
const packetAt = (ms: number, inHold: boolean, pulse: RatePoint[] = []): Packet => {
  const t = ms / 1000;
  const v = inHold ? 0.03 * gauss() : Math.sin((2 * Math.PI * t) / 4) + 0.02 * gauss();
  return {
    wallMs: START + ms,
    t,
    upper: [{ t, v, stable: true }],
    lower: [{ t, v: v * 0.9, stable: true }],
    rate: [],
    pulse,
    talking: [],
  };
};

const controller = (table: TablePlan): SessionController =>
  new SessionController({
    plan: table,
    mode: 'live',
    params: p,
    startWallMs: START,
    id: 'edge-cases',
    startedAt: new Date(START).toISOString(),
  });

/** Drive a live controller in 100 ms steps; returns every cue it emitted. */
function run(
  ctl: SessionController,
  fromMs: number,
  toMs: number,
  opts: { pulseAt?: (t: number) => number | null; beforeTick?: (ms: number) => void } = {},
): string[] {
  const phases: string[] = [];
  for (let ms = fromMs; ms <= toMs; ms += 100) {
    const t = ms / 1000;
    const inHold = ctl.view(START + ms).phase === 'hold';
    const bpm = opts.pulseAt?.(t) ?? null;
    const pulse: RatePoint[] = bpm !== null && ms % 1000 === 0 ? [{ t, v: bpm, conf: 90, stable: true }] : [];
    opts.beforeTick?.(ms);
    ctl.onPacket(packetAt(ms, inHold, pulse));
    phases.push(...ctl.tick(START + ms).map((c) => c.phase));
  }
  return phases;
}

describe('pulse windows', () => {
  // round 1 holds 58-78 s, round 2 holds 91-111 s; round 1's low (60.6 at 85 s) is inside its lag
  const pulseAt = (t: number): number =>
    t < 80 ? 72.4 : t < 85 ? 66 : t < 88 ? 60.6 : t < 95 ? 64.4 : t < 105 ? 58.2 : 63;

  it('a round pulse is pending until SDK time passes tEnd + pulseLagS, then final', () => {
    const ctl = controller(plan([10, 10], [20, 20]));
    run(ctl, 0, 80_000, { pulseAt });
    const pending = ctl.view(START + 80_000).lastRound;
    expect(pending?.round).toBe(1);
    expect(pending?.pulseStatus).toBe('pending');

    run(ctl, 80_100, 89_000, { pulseAt });
    const final = ctl.view(START + 89_000).lastRound;
    expect(final?.pulseStatus).toBe('final');
    expect(final?.pulse.min).toEqual({ kind: 'value', bpm: 60.6 });
  });

  it('the session waits in a finishing phase for the last pulse window before it is done', () => {
    const ctl = controller(plan([10, 10], [20, 20]));
    const cues = run(ctl, 0, 112_000, { pulseAt });
    expect(cues).toContain('session_end');
    expect(ctl.view(START + 112_000).phase).toBe('finishing');
    run(ctl, 112_100, 122_000, { pulseAt });
    expect(ctl.view(START + 122_000).phase).toBe('done');
    expect(ctl.result().rounds.map((r) => r.pulseStatus)).toEqual(['final', 'final']);
  });

  it('a pulse window that never filled is reported as incomplete, not as a number', () => {
    const ctl = controller(plan([10], [20]));
    run(ctl, 0, 80_000, { pulseAt });
    // the source ends two seconds after the last hold
    const result = ctl.result();
    expect(result.rounds[0].pulseStatus).toBe('incomplete');
    expect(result.rounds[0].pulse.min).toEqual({ kind: 'na' });
    expect(result.rounds[0].pulse.delta).toBeNull();
  });

  it('summary sentences round pulse values to whole beats', () => {
    const ctl = controller(plan([10, 10], [20, 20]));
    run(ctl, 0, 122_000, { pulseAt });
    const text = summarize(ctl.result()).join(' ');
    expect(text).toMatch(/Pulse fell from 64 to 58 during round 2/);
  });
});

describe('validation state before a hold', () => {
  it('kTooDark at 40 s that never clears keeps later holds from being verified', () => {
    const ctl = controller(plan([10, 10], [20, 20]));
    run(ctl, 0, 125_000, {
      beforeTick: (ms) => {
        if (ms === 40_000) ctl.onValidation({ wallMs: START + ms, tsUs: ms * 1000, code: 5, hint: 'too dark' });
      },
    });
    const verdicts = ctl.result().rounds.map((r) => r.verdict.verdict);
    expect(verdicts).toHaveLength(2);
    expect(verdicts).not.toContain('verified');
  });

  it('a validation code that cleared before the hold does not affect it', () => {
    const ctl = controller(plan([10], [20]));
    run(ctl, 0, 90_000, {
      beforeTick: (ms) => {
        if (ms === 40_000) ctl.onValidation({ wallMs: START + ms, tsUs: 0, code: 5, hint: 'too dark' });
        if (ms === 42_000) ctl.onValidation({ wallMs: START + ms, tsUs: 0, code: 0, hint: '' });
      },
    });
    expect(ctl.result().rounds[0].verdict.verdict).toBe('verified');
  });
});

describe('Stop is always available', () => {
  it('Stop during the countdown cancels that hold and moves on to the next rest', () => {
    const ctl = controller(plan([10, 10], [20, 20]));
    run(ctl, 0, 56_000); // countdown runs 55-58 s
    expect(ctl.view(START + 56_000).phase).toBe('countdown');
    const cues = ctl.stopHold(START + 56_000);
    expect(cues.map((c) => c.phase)).toEqual(['rest_start']);
    const view = ctl.view(START + 56_000);
    expect(view.phase).toBe('rest');
    expect(view.round).toBe(2);
    const r = ctl.result().rounds;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ round: 1, stopped: true, actualHoldS: 0 });
    expect(ctl.result().endedEarly).toBe(false);
  });

  it('Stop during the last countdown ends the session after recording the round', () => {
    const ctl = controller(plan([10], [20]));
    run(ctl, 0, 56_000);
    const cues = ctl.stopHold(START + 56_000);
    expect(cues.map((c) => c.phase)).toEqual(['session_end']);
    expect(['finishing', 'done']).toContain(ctl.view(START + 56_000).phase);
    expect(ctl.result().rounds[0]).toMatchObject({ stopped: true, actualHoldS: 0 });
  });

  it('Stop during a rest ends the whole session early', () => {
    const ctl = controller(plan([10, 10], [20, 20]));
    run(ctl, 0, 47_000);
    expect(ctl.view(START + 47_000).phase).toBe('rest');
    const cues = ctl.stopHold(START + 47_000);
    expect(cues.map((c) => c.phase)).toEqual(['session_end']);
    run(ctl, 47_100, 60_000);
    expect(ctl.view(START + 60_000).phase).toBe('done');
    const result: SessionResult = ctl.result();
    expect(result.endedEarly).toBe(true);
    expect(result.rounds).toHaveLength(0);
  });
});

describe('live auto marks honor unreadable spans', () => {
  it('the marks shown during a hold match the final marks when a contraction falls in a talking span', () => {
    const contractions = [65, 72, 80];
    const lines = synthSession({
      seed: 11,
      holds: [{ startS: 45, durS: 45, contractionsAtS: contractions }],
      totalS: 100,
      plan: plan([42], [45]),
    }) as RecLine[];
    const ctl = new SessionController({
      plan: plan([42], [45]),
      mode: 'replay',
      params: p,
      startWallMs: 1_763_000_000_000,
      id: 'replay-marks',
      startedAt: new Date(START).toISOString(),
    });

    let liveMarksBeforeEnd: number[] = [];
    let holdEndWall = 0;
    for (const line of lines) {
      if (line.type === 'cue' && line.phase === 'hold_end') holdEndWall = line.wallMs;
    }
    for (const line of lines) {
      if (line.type === 'metrics') {
        const talking = line.upper.map(([tsUs]) => {
          const t = tsUs / 1e6;
          return { t, detected: t >= 71 && t <= 74 };
        });
        ctl.onPacket({
          wallMs: line.wallMs,
          t: 0,
          upper: line.upper.map(([tsUs, v, stable]) => ({ t: tsUs / 1e6, v, stable })),
          lower: line.lower.map(([tsUs, v, stable]) => ({ t: tsUs / 1e6, v, stable })),
          rate: [],
          pulse: [],
          talking,
        });
        if (line.wallMs < holdEndWall - 200) {
          const view = ctl.view(line.wallMs);
          if (view.phase === 'hold') liveMarksBeforeEnd = view.marks;
        }
      } else if (line.type === 'cue') {
        ctl.onCue({ wallMs: line.wallMs, phase: line.phase, round: line.round });
      }
    }
    const final = ctl.result().rounds[0].marks;
    // the contraction inside the talking span is dropped from the final result
    expect(final.some((m) => m >= 71 && m <= 74)).toBe(false);
    expect(liveMarksBeforeEnd.some((m) => m >= 71 && m <= 74)).toBe(false);
    expect(liveMarksBeforeEnd.length).toBeGreaterThan(0);
  });
});

describe('Rest screen pulse text', () => {
  it('shows "pulse: settling" while the window fills, then the whole-beat low point', async () => {
    const { JSDOM } = await import('jsdom');
    const { mount } = await import('../src/renderer/screens/round.js');
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = dom.window;
    g.document = dom.window.document;
    g.HTMLElement = dom.window.HTMLElement;
    dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as never;

    const ctl = controller(plan([10, 10], [20, 20]));
    const pulseAt = (t: number): number => (t < 80 ? 72.4 : 60.6);
    const root = document.createElement('div');
    const handle = mount(root, { params: p, stop: () => undefined, recording: () => true } as never);
    run(ctl, 0, 80_000, { pulseAt });
    handle.render(ctl.view(START + 80_000));
    expect(root.textContent).toContain('pulse: settling');
    run(ctl, 80_100, 89_000, { pulseAt });
    handle.render(ctl.view(START + 89_000));
    expect(root.textContent).not.toContain('pulse: settling');
    expect(root.textContent).toContain('Start 72 BPM, low 61 BPM.');
  });
});
