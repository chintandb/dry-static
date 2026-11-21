import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorage } from '../src/main/storage.js';
import type { SessionResult } from '../src/core/session.js';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dry-static-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const session = (id: string, startedAt: string): SessionResult => ({
  id,
  startedAt,
  mode: 'live',
  plan: { type: 'co2', size: 'quick', pbS: 90, capPct: 0.5, rounds: [], liveS: 0 },
  calibration: null,
  rounds: [],
  endedEarly: false,
  error: null,
  quality: { cadenceHz: 27.5, delayMsMedian: 40, delayMsP95: 90, invalidPct: 1 },
});

describe('storage', () => {
  it('storage round-trip', () => {
    const base = join(tempDir(), 'data');
    const storage = createStorage(base);

    storage.saveSession(session('a', '2026-11-21T10:00:00.000Z'));
    storage.saveSession(session('b', '2026-11-21T11:00:00.000Z'));
    expect(storage.listSessions().map((s) => s.id)).toEqual(['b', 'a']);

    storage.addUsage(30);
    storage.addUsage(30);
    expect(storage.usageSeconds()).toBe(60);

    storage.appendRecording('b', '{"type":"meta"}');
    expect(existsSync(join(base, 'recordings', 'b.jsonl'))).toBe(true);

    storage.deleteAll();
    expect(storage.listSessions()).toEqual([]);
    expect(existsSync(storage.dataDir)).toBe(false);
  });

  it('survives a corrupt session file', () => {
    const base = join(tempDir(), 'data');
    const storage = createStorage(base);
    storage.saveSession(session('ok', '2026-11-21T10:00:00.000Z'));
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(base, 'sessions', 'broken.json'), '{not json');
    expect(storage.listSessions()).toHaveLength(1);
  });

  it('usage starts at zero and ignores nonsense', () => {
    const storage = createStorage(join(tempDir(), 'data'));
    expect(storage.usageSeconds()).toBe(0);
    storage.addUsage(0);
    storage.addUsage(Number.NaN);
    expect(storage.usageSeconds()).toBe(0);
  });
});
