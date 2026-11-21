import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeLine } from '../src/core/recording.js';
import { createReplaySource } from '../src/renderer/replaySource.js';
import { synthSession } from '../src/core/synth.js';

const lines = synthSession({
  seed: 3,
  holds: [
    { startS: 45, durS: 20, contractionsAtS: [55] },
    { startS: 80, durS: 20, contractionsAtS: [90] },
  ],
  totalS: 105,
});
const text = lines.map(serializeLine).join('\n');

afterEach(() => {
  vi.useRealTimers();
});

describe('createReplaySource', () => {
  it('replaySource emits in order and reports meta', async () => {
    vi.useFakeTimers();
    const source = createReplaySource(text, 4);
    const seen: string[] = [];
    source.on('packet', () => seen.push('packet'));
    source.on('cue', (c) => seen.push(`cue:${c.phase}`));
    source.on('tap', () => seen.push('tap'));
    source.on('ended', () => seen.push('ended'));

    await source.start();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(source.meta?.type).toBe('meta');
    expect(source.badLines).toBe(0);
    expect(seen[0]).toBe('cue:settle_start');
    expect(seen.includes('cue:hold_start')).toBe(true);
    expect(seen.includes('tap')).toBe(true);
    expect(seen).toContain('ended');
    // every non-meta line is emitted exactly once
    expect(seen.filter((s) => s === 'packet').length).toBe(text.split('\n').filter((l) => l.includes('"type":"metrics"')).length);
  });

  it('replaySource reports missing meta', () => {
    const withoutMeta = text
      .split('\n')
      .filter((l) => !l.startsWith('{"type":"meta"'))
      .join('\n');
    const source = createReplaySource(withoutMeta, 4);
    expect(source.meta).toBeNull();
  });

  it('replaySource counts bad lines', () => {
    const source = createReplaySource(`${text}\n{bad`, 4);
    expect(source.badLines).toBe(1);
  });
});
