/**
 * Replay keeps one time domain, the recorded one, for every input. If packets, cues and taps
 * were restamped with the 4x playback time while the traces kept recorded SDK time, the
 * wall-to-SDK offset would drift 0.75 s per second of SDK time; ClockSync's 100-packet median
 * lags that by about 4 s, so every tap and cue would land about 4 s early and no auto mark
 * would match a tap.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeRecording } from '../src/core/benchmark.js';
import { matchTaps } from '../src/core/contractions.js';
import { makeParams } from '../src/core/params.js';
import { SessionController } from '../src/core/session.js';
import { createReplaySource } from '../src/renderer/replaySource.js';

const demo = readFileSync('recordings/demo-1.jsonl', 'utf8');

afterEach(() => {
  vi.useRealTimers();
});

describe('replay keeps one time domain', () => {
  it('demo-1 at the app replay pace gives the same matched count as analyzeRecording', async () => {
    vi.useFakeTimers();
    const params = makeParams();
    const offline = analyzeRecording('demo-1.jsonl', demo, params);
    const offlineMatched = offline.holds.reduce((s, h) => s + h.match.matched, 0);
    const offlineTaps = offline.holds.reduce((s, h) => s + h.taps.length, 0);

    // the same wiring and pace as App.startReplay
    const source = createReplaySource(demo, 4);
    const meta = source.meta;
    if (!meta || meta.type !== 'meta' || !meta.plan) throw new Error('demo-1 has no plan');
    const ctl = new SessionController({
      plan: meta.plan,
      mode: 'replay',
      params,
      startWallMs: source.firstWallMs,
      id: 'replay-time',
      startedAt: '2026-11-21T00:00:00.000Z',
    });
    let ended = false;
    source.on('packet', (packet, _raw, wallMs) => ctl.onPacket({ ...packet, wallMs }));
    source.on('validation', (e) => ctl.onValidation(e));
    source.on('cue', (c) => ctl.onCue(c));
    source.on('tap', (t) => ctl.onTap(t));
    source.on('ended', () => {
      ended = true;
    });
    await source.start();
    for (let i = 0; i < 400 && !ended; i += 1) {
      await vi.advanceTimersByTimeAsync(250);
      ctl.tick(source.now());
      ctl.view(source.now());
    }
    expect(ended).toBe(true);

    const result = ctl.result();
    const matched = result.rounds.reduce((s, r) => s + matchTaps(r.marks, r.taps, params.tapTolS).matched, 0);
    const taps = result.rounds.reduce((s, r) => s + r.taps.length, 0);
    expect(taps).toBe(offlineTaps);
    expect(matched).toBe(offlineMatched);
    expect(result.rounds.map((r) => r.marks.length)).toEqual(offline.holds.map((h) => h.marks.length));
    expect(result.rounds.map((r) => r.t0)).toEqual(offline.holds.map((h) => h.t0).map((t) => expect.closeTo(t, 1)));
  });

  it('replay source stamps every line with its recorded wall time and exposes a recorded-time clock', async () => {
    vi.useFakeTimers();
    const source = createReplaySource(demo, 4);
    const cues: number[] = [];
    source.on('cue', (c) => cues.push(c.wallMs));
    await source.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cues[0]).toBe(1_763_000_000_000);
    expect(cues).toContain(1_763_000_108_000); // round 1 hold_start, 108 s in
    // 30 s of playback at 4x is about 120 s of recording
    expect(source.now() - source.firstWallMs).toBeGreaterThan(110_000);
    expect(source.now() - source.firstWallMs).toBeLessThan(125_000);
    await source.stop();
  });
});
