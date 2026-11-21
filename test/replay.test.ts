import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SessionController } from '../src/core/session.js';
import { makeParams } from '../src/core/params.js';
import { planTable } from '../src/core/table.js';
import type { RecLine } from '../src/core/types.js';

const text = readFileSync('recordings/demo-1.jsonl', 'utf8');
const expected = JSON.parse(readFileSync('recordings/demo-1.expected.json', 'utf8')) as {
  rounds: { round: number; verdict: string }[];
};

describe('replay of the bundled recording', () => {
  it('replay matches expected verdicts', () => {
    const lines = text
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as RecLine);
    const meta = lines[0];
    expect(meta.type).toBe('meta');

    const ctl = new SessionController({
      plan: planTable({ pbS: 90, type: 'co2', size: 'quick', capPct: 0.5 }),
      mode: 'replay',
      params: makeParams(),
      startWallMs: 0,
      id: 'replay-demo',
      startedAt: '2026-11-21T00:00:00.000Z',
    });

    const origin = lines.find((l) => l.type === 'cue') as Extract<RecLine, { type: 'cue' }>;
    const shift = (wallMs: number): number => 1_000_000 + (wallMs - origin.wallMs);

    for (const line of lines) {
      if (line.type === 'metrics') {
        const wallMs = shift(line.wallMs);
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
        ctl.onCue({ wallMs: shift(line.wallMs), phase: line.phase, round: line.round });
      } else if (line.type === 'tap') {
        ctl.onTap({ wallMs: shift(line.wallMs), kind: line.kind });
      }
    }

    const result = ctl.result();
    expect(result.rounds.map((r) => ({ round: r.round, verdict: r.verdict.verdict }))).toEqual(expected.rounds);
    // the file says a breath was sneaked in during round 2, and the app must catch it
    expect(result.rounds[1].verdict.breathAt).not.toBeNull();
  });
});
