import { describe, expect, it } from 'vitest';
import { makeParams } from '../src/core/params.js';
import { planTable } from '../src/core/table.js';
import { summarize, toCsv, type RoundResult, type SessionResult } from '../src/core/session.js';
import type { PulseTrend } from '../src/core/pulseTrend.js';

const p = makeParams();
const plan = planTable({ pbS: 100, type: 'co2', size: 'quick', capPct: 0.5 });

const pulse = (start: number | null, min: number | null): PulseTrend => ({
  start: start === null ? { kind: 'na' } : { kind: 'value', bpm: start },
  min: min === null ? { kind: 'na' } : { kind: 'value', bpm: min },
  delta: start !== null && min !== null ? min - start : null,
  curve: [],
});

const round = (n: number, firstTapS: number, taps: number[], marks: number[], trend: PulseTrend): RoundResult => ({
  round: n,
  plannedHoldS: 50,
  actualHoldS: 50,
  stopped: false,
  verdict: { verdict: 'verified', readablePct: 100, breathAt: null, excused: [], unreadable: [], lostTo: null },
  marks,
  taps,
  firstTapS,
  firstMarkS: marks.length ? marks[0] : null,
  pulse: trend,
  t0: n * 100,
  tEnd: n * 100 + 50,
});

const fixture = (trend: PulseTrend): SessionResult => ({
  id: 'fixture',
  startedAt: '2026-11-21T00:00:00.000Z',
  mode: 'live',
  plan,
  calibration: null,
  rounds: [
    round(1, 38, [38, 45], [38.2, 45.1], trend),
    round(2, 40, [140, 155], [140.4, 160], trend),
    round(3, 36, [236, 250], [236.3, 250.2], trend),
  ],
  endedEarly: false,
  error: null,
  quality: { cadenceHz: 27.5, delayMsMedian: 40, delayMsP95: 90, invalidPct: 0 },
});

describe('summarize', () => {
  it('never lumps a hold the camera could not see in with one where a breath was seen', () => {
    const base = fixture(pulse(null, null));
    const [r1, r2, r3] = base.rounds;
    const result: SessionResult = {
      ...base,
      rounds: [
        r1,
        { ...r2, verdict: { ...r2.verdict, verdict: 'breath_detected', breathAt: 160 } },
        { ...r3, verdict: { ...r3.verdict, verdict: 'partly_readable', readablePct: 40, lostTo: 'validation' } },
        { ...r3, round: 4, stopped: true, actualHoldS: 0, verdict: { ...r3.verdict, verdict: 'partly_readable', readablePct: 0 } },
      ],
    };
    expect(summarize(result, p.tapTolS)[0]).toBe(
      '1 of 4 holds verified; 1 with a breath seen, 1 partly readable (lost view), 1 stopped.',
    );
  });

  it('names every reason when partly readable holds were lost to different things', () => {
    const base = fixture(pulse(null, null));
    const [r1, r2, r3] = base.rounds;
    const result: SessionResult = {
      ...base,
      rounds: [
        r1,
        { ...r2, verdict: { ...r2.verdict, verdict: 'partly_readable', readablePct: 70, lostTo: 'no_signal' } },
        { ...r3, verdict: { ...r3.verdict, verdict: 'partly_readable', readablePct: 55, lostTo: 'talking' } },
      ],
    };
    expect(summarize(result, p.tapTolS)[0]).toBe('1 of 3 holds verified; 2 partly readable (signal dropped, talking).');
  });

  it('three plain sentences', () => {
    expect(summarize(fixture(pulse(74, 63)), p.tapTolS)).toEqual([
      '3 of 3 holds verified.',
      'First contraction (your taps): 0:38 average. Auto marks agreed with 5 of 6 taps.',
      'Pulse fell from 74 to 63 during round 3.',
    ]);
  });

  it('omits the pulse sentence without a pulse', () => {
    const text = summarize(fixture(pulse(null, null)), p.tapTolS);
    expect(text).toHaveLength(2);
    expect(text[1]).toBe('First contraction (your taps): 0:38 average. Auto marks agreed with 5 of 6 taps.');
  });

  it('drops the auto-mark clause when nothing was detected', () => {
    const r = fixture(pulse(74, 63));
    r.rounds = r.rounds.map((x) => ({ ...x, marks: [] }));
    expect(summarize(r, p.tapTolS)[1]).toBe('First contraction (your taps): 0:38 average.');
  });

  it('says nothing when there were no rounds', () => {
    const r = fixture(pulse(74, 63));
    r.rounds = [];
    expect(summarize(r, p.tapTolS)).toEqual([]);
  });
});

describe('toCsv', () => {
  it('header and one row per round', () => {
    const csv = toCsv(fixture(pulse(74, 63)));
    const rows = csv.split('\n');
    expect(rows[0]).toBe(
      'round,planned_hold_s,actual_hold_s,stopped,verdict,readable_pct,first_tap_s,first_auto_mark_s,taps,auto_marks,pulse_start,pulse_min,pulse_delta,lost_to',
    );
    expect(rows).toHaveLength(4);
    expect(rows[3].startsWith('3,50,50.0,no,verified,100.0,36.0,236.3,2,2,74,63,-11')).toBe(true);
  });
});
