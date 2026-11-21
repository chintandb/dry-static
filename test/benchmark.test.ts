import { describe, expect, it } from 'vitest';
import { analyzeRecording, formatReport, goNoGo } from '../src/core/benchmark.js';
import { makeParams } from '../src/core/params.js';
import { serializeLine } from '../src/core/recording.js';
import { synthSession } from '../src/core/synth.js';
import type { RecLine } from '../src/core/types.js';

const p = makeParams();

const holds = [
  { startS: 60, durS: 60, contractionsAtS: [78, 88, 100] },
  { startS: 150, durS: 75, contractionsAtS: [172, 186, 202] },
  { startS: 255, durS: 90, contractionsAtS: [281, 299, 318] },
];

const textOf = (lines: RecLine[]): string => lines.map(serializeLine).join('\n');

describe('analyzeRecording', () => {
  it('analyze synthetic session', () => {
    const lines = synthSession({ seed: 5, holds, totalS: 380, pulseDrop: 8 });
    const report = analyzeRecording('synthetic.jsonl', textOf(lines), p);
    expect(report.holds).toHaveLength(3);
    for (const hold of report.holds) {
      expect(hold.verdict.verdict).toBe('verified');
      expect(hold.coveragePct).toBeGreaterThanOrEqual(95);
    }
    const verdict = goNoGo([report], p);
    expect(verdict.a).toBe('PASS');
    expect(verdict.c).toBe('PASS');
    expect(verdict.ship).toBe('GO');
    expect(verdict.pooled.recall ?? 0).toBeGreaterThanOrEqual(0.8);
  });

  it('analyze closes unterminated hold', () => {
    const lines = synthSession({ seed: 6, holds, totalS: 380, pulseDrop: 8 });
    const lastEnd = [...lines].reverse().find((l) => l.type === 'cue' && l.phase === 'hold_end');
    const trimmed = lines.filter((l) => l !== lastEnd);
    const lastSampleUs = Math.max(
      ...trimmed.filter((l) => l.type === 'metrics').flatMap((l) => (l.type === 'metrics' ? l.upper.map((s) => s[0]) : [])),
    );
    const report = analyzeRecording('cut.jsonl', textOf(trimmed), p);
    expect(report.holds).toHaveLength(3);
    const last = report.holds[2];
    expect(last.tEnd).toBeGreaterThan(last.t0 + 80);
    // the open hold closes on the newest sample, not on a made-up cue time
    expect(last.tEnd).toBeLessThanOrEqual(lastSampleUs / 1e6 + 1e-6);
    expect(last.tEnd).toBeGreaterThan(lastSampleUs / 1e6 - 1);
  });

  it('analyze flags dropout-heavy file', () => {
    const dropouts: [number, number][] = [
      [70, 100],
      [170, 207],
      [280, 325],
    ];
    const lines = synthSession({ seed: 7, holds, totalS: 380, pulseDrop: 8, dropouts });
    const report = analyzeRecording('dropouts.jsonl', textOf(lines), p);
    const verdict = goNoGo([report], p);
    expect(verdict.a).toBe('FAIL');
    expect(verdict.ship).toBe('NO-GO');
  });

  it('short dropouts that keep recurring are not covered', () => {
    // 2.8 s gaps every 4 s inside every hold: each gap is over gapS, so only the 1.2 s
    // stretches of real samples count, about 30% of the hold
    const dropouts: [number, number][] = holds.flatMap((h) => {
      const out: [number, number][] = [];
      for (let t = h.startS; t < h.startS + h.durS; t += 4) out.push([t, t + 2.8]);
      return out;
    });
    const lines = synthSession({ seed: 10, holds, totalS: 380, pulseDrop: 8, dropouts });
    const report = analyzeRecording('choppy.jsonl', textOf(lines), p);
    for (const hold of report.holds) {
      expect(hold.coveragePct).toBeLessThan(60);
      expect(hold.coveragePct).toBeGreaterThan(20);
    }
    const verdict = goNoGo([report], p);
    expect(verdict.a).toBe('FAIL');
    expect(verdict.ship).toBe('NO-GO');
  });

  it('a single gap just over gapS costs only its own length', () => {
    const lines = synthSession({ seed: 11, holds, totalS: 380, pulseDrop: 8, dropouts: [[90, 92]] });
    const report = analyzeRecording('one-gap.jsonl', textOf(lines), p);
    const first = report.holds[0];
    const binsLost = (100 - first.coveragePct) / 100 * (first.durS - p.holdIgnoreS);
    expect(binsLost).toBeGreaterThan(1.8);
    expect(binsLost).toBeLessThan(2.3);
    expect(report.holds[1].coveragePct).toBeGreaterThanOrEqual(99);
  });

  it('a validation code set before the first hold and never cleared applies to every hold', () => {
    const lines = synthSession({ seed: 5, holds, totalS: 380, pulseDrop: 8 });
    const first = lines.find((l) => l.type === 'cue');
    const wall0 = first && first.type === 'cue' ? first.wallMs : 0;
    // kTooDark at 20 s, long before the first hold at 60 s
    const [meta, ...rest] = lines;
    const tooDark: RecLine = { type: 'validation', wallMs: wall0 + 20_000, tsUs: 20_000_000, code: 5, hint: 'too dark' };
    const report = analyzeRecording('dark.jsonl', textOf([meta, tooDark, ...rest]), p);
    expect(report.holds).toHaveLength(3);
    for (const hold of report.holds) expect(hold.verdict.verdict).not.toBe('verified');
  });

  it('formatReport mentions every check', () => {
    const lines = synthSession({ seed: 8, holds, totalS: 380, pulseDrop: 8 });
    const report = analyzeRecording('synthetic.jsonl', textOf(lines), p);
    const text = formatReport([report], goNoGo([report], p));
    for (const token of ['(a)', '(b)', '(c)', '(d)']) expect(text).toContain(token);
    expect(text.includes('GO')).toBe(true);
  });

  it('rejects a file with no meta', () => {
    const lines = synthSession({ seed: 9, holds, totalS: 380, pulseDrop: 8 }).filter((l) => l.type !== 'meta');
    expect(() => analyzeRecording('nometa.jsonl', textOf(lines), p)).toThrow(/meta/);
  });
});
