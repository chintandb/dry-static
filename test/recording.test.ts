import { describe, expect, it } from 'vitest';
import { parseRecording, serializeLine } from '../src/core/recording.js';
import type { RecLine } from '../src/core/types.js';

const meta: RecLine = {
  type: 'meta', version: 1, app: 'dry-static', sdk: '3.5.0',
  createdAt: '2026-11-21T00:00:00.000Z', mode: 'record', plan: null, requestedMetrics: [0, 1, 2],
};
const metrics: RecLine = {
  type: 'metrics', wallMs: 10, tsUs: 20,
  upper: [[1, 2, true]], lower: [], rate: [], pulse: [], talking: [],
};
const cue: RecLine = { type: 'cue', wallMs: 30, phase: 'hold_start', round: 1 };
const tap: RecLine = { type: 'tap', wallMs: 40, kind: 'contraction' };
const validation: RecLine = { type: 'validation', wallMs: 50, tsUs: 60, code: 7, hint: 'Chest not visible' };
const status: RecLine = { type: 'status', wallMs: 70, status: 3 };
const error: RecLine = { type: 'error', wallMs: 80, code: 4, message: 'credits' };

describe('recording', () => {
  it('skips bad lines', () => {
    const text = [serializeLine(meta), serializeLine(metrics), '{bad', ''].join('\n');
    const r = parseRecording(text);
    expect(r.lines.length).toBe(2);
    expect(r.badLines).toBe(1);
    expect(r.meta).not.toBeNull();
  });

  it('reports a missing meta line', () => {
    const r = parseRecording(serializeLine(metrics));
    expect(r.meta).toBeNull();
  });

  it('round-trips every line type', () => {
    for (const line of [meta, metrics, cue, tap, validation, status, error]) {
      const r = parseRecording(serializeLine(line));
      expect(r.lines[0]).toEqual(line);
      expect(r.badLines).toBe(0);
    }
  });

  it('serializes without a trailing newline', () => {
    expect(serializeLine(cue).endsWith('\n')).toBe(false);
  });
});
