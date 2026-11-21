/**
 * The real Electron window is often hidden or occluded (behind another window, on another
 * desktop). Chromium then stops delivering animation frames and clamps every timer to at
 * most one wakeup per second. The replay has to keep its 4x pace and the screens have to
 * keep following the session anyway; this boots the app under exactly those conditions.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/app.js';
import { mount as about } from '../src/renderer/screens/about.js';
import { mount as consent } from '../src/renderer/screens/consent.js';
import { mount as end } from '../src/renderer/screens/end.js';
import { mount as framing } from '../src/renderer/screens/framing.js';
import { mount as history } from '../src/renderer/screens/history.js';
import { mount as round } from '../src/renderer/screens/round.js';
import { mount as safety } from '../src/renderer/screens/safety.js';
import { mount as settle } from '../src/renderer/screens/settle.js';
import { mount as setup } from '../src/renderer/screens/setup.js';

const demo = readFileSync('recordings/demo-1.jsonl', 'utf8');
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true });
const BACKGROUND_TIMER_MIN_MS = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  const g = globalThis as unknown as Record<string, unknown>;
  // a hidden page's timers: never sooner than once a second
  const fakeSetTimeout = globalThis.setTimeout;
  const fakeSetInterval = globalThis.setInterval;
  g.setTimeout = ((f: () => void, ms?: number, ...a: unknown[]) =>
    fakeSetTimeout(f, Math.max(BACKGROUND_TIMER_MIN_MS, ms ?? 0), ...a)) as never;
  g.setInterval = ((f: () => void, ms?: number, ...a: unknown[]) =>
    fakeSetInterval(f, Math.max(BACKGROUND_TIMER_MIN_MS, ms ?? 0), ...a)) as never;
  // a hidden page's animation frames: requested, never delivered
  g.requestAnimationFrame = (): number => 1;
  g.cancelAnimationFrame = (): void => undefined;
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as never;
  dom.window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
  (dom.window as unknown as { dryStatic: unknown }).dryStatic = {
    apiKey: async () => null,
    replayPath: async () => 'recordings/demo-1.jsonl',
    readFile: async () => demo,
    saveSession: async () => undefined,
    listSessions: async () => [],
    appendRecording: async () => undefined,
    addUsage: async () => undefined,
    usageSeconds: async () => 0,
    deleteAll: async () => undefined,
    dataDir: async () => '/tmp/data',
    exportFile: async () => true,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hidden window', () => {
  it('replay keeps its 4x pace and reaches the round and end screens with throttled timers and no frames', async () => {
    const root = document.getElementById('app') as HTMLElement;
    const app = new App(root)
      .register('consent', consent)
      .register('safety', safety)
      .register('setup', setup)
      .register('framing', framing)
      .register('settle', settle)
      .register('round', round)
      .register('end', end)
      .register('history', history)
      .register('about', about);
    app.start();

    await app.startReplay();
    expect(root.textContent).toContain('Settle in');

    // the first hold_start is 108 s into the recording: 27 s of wall time at 4x
    await vi.advanceTimersByTimeAsync(35_000);
    expect(root.textContent).not.toContain('Settle in');
    expect(root.textContent).toContain('Stop');

    // the recording is 345 s long: about 86 s at 4x
    await vi.advanceTimersByTimeAsync(85_000);
    expect(root.textContent).toContain('Session end');
    expect(root.textContent).toContain('Export');
    expect(app.lastResult?.rounds).toHaveLength(3);
    expect(app.session).toBeNull();
  });
});
