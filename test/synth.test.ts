import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { synthSession } from '../src/core/synth.js';
import { loadApiKey } from '../src/main/env.js';

const opts = {
  seed: 3,
  totalS: 200,
  holds: [
    { startS: 30, durS: 60, contractionsAtS: [50, 60, 70] },
    { startS: 110, durS: 75, contractionsAtS: [130, 145] },
  ],
};

describe('synth', () => {
  it('emits meta first and cues per hold', () => {
    const lines = synthSession(opts);
    expect(lines[0].type).toBe('meta');
    expect(lines.filter((l) => l.type === 'cue' && l.phase === 'hold_start').length).toBe(2);
    expect(lines.filter((l) => l.type === 'cue' && l.phase === 'hold_end').length).toBe(2);
    expect(lines.filter((l) => l.type === 'tap').length).toBe(5);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(synthSession(opts))).toBe(JSON.stringify(synthSession(opts)));
    expect(JSON.stringify(synthSession({ ...opts, seed: 4 }))).not.toBe(JSON.stringify(synthSession(opts)));
  });

  it('respects dropouts', () => {
    const withHole = synthSession({ ...opts, dropouts: [[40, 43]] });
    const packets = withHole.filter((l) => l.type === 'metrics');
    for (const p of packets) {
      if (p.type !== 'metrics') continue;
      for (const [ts] of p.upper) {
        const s = ts / 1e6;
        expect(s >= 40 && s < 43).toBe(false);
      }
    }
  });

  it('puts 3 samples in a packet and keeps the trace cadence', () => {
    const lines = synthSession({ ...opts, totalS: 10 });
    const packets = lines.filter((l) => l.type === 'metrics');
    expect(packets.length).toBeGreaterThan(50);
    // every packet is a full batch except the trailing partial one
    packets.slice(0, -1).forEach((p) => {
      if (p.type === 'metrics') expect(p.upper.length).toBe(3);
    });
    const last = packets[packets.length - 1];
    if (last.type === 'metrics') expect(last.upper.length).toBeLessThanOrEqual(3);
  });

  it('emits a sneaked breath when asked', () => {
    const withSneak = synthSession({
      seed: 5,
      totalS: 120,
      holds: [{ startS: 30, durS: 60, contractionsAtS: [], sneakBreathAtS: 55 }],
    });
    const inHold = withSneak
      .filter((l) => l.type === 'metrics')
      .flatMap((l) => (l.type === 'metrics' ? l.upper : []))
      .filter(([ts]) => ts / 1e6 > 54 && ts / 1e6 < 60);
    const values = inHold.map(([, v]) => v);
    expect(Math.max(...values)).toBeGreaterThan(0.7);
    expect(Math.min(...values)).toBeLessThan(-0.7);
  });
});

describe('loadApiKey', () => {
  let dir: string;
  beforeEach(() => {
    delete process.env.PRESAGE_API_KEY;
    dir = mkdtempSync(join(tmpdir(), 'dry-static-env-'));
  });

  it('reads .env', () => {
    writeFileSync(join(dir, '.env'), 'FOO=1\nPRESAGE_API_KEY="abc"\n');
    expect(loadApiKey(dir)).toBe('abc');
  });

  it('returns null when absent', () => {
    expect(loadApiKey(dir)).toBeNull();
  });

  it('prefers the process environment', () => {
    writeFileSync(join(dir, '.env'), 'PRESAGE_API_KEY=fromfile\n');
    process.env.PRESAGE_API_KEY = 'fromenv';
    expect(loadApiKey(dir)).toBe('fromenv');
  });
});
