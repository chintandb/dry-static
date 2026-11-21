/**
 * Boots the real renderer app against a stubbed bridge and the bundled recording, then lets
 * the replay run. This is the closest thing to `npm run replay` that runs without a display.
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
let clock = 0;
let frames: ((t: number) => void)[] = [];

/** Advance wall clock, fake timers and one round of animation frames together. */
async function step(ms: number): Promise<void> {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(clock);
}
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true });

beforeEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  // a clock we control: frames and performance.now() advance together with the timers
  clock = 0;
  frames = [];
  g.performance = { now: () => clock };
  g.requestAnimationFrame = (cb: (t: number) => void): number => {
    frames.push(cb);
    return frames.length;
  };
  g.cancelAnimationFrame = (): void => undefined;
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

describe('app flow', () => {
  it('boots to consent, then replays the bundled recording through every phase', async () => {
    vi.useFakeTimers();
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

    expect(root.textContent).toContain('DRY STATIC');

    await app.startReplay();
    await step(100);
    expect(app.synthetic()).toBe(true);
    expect(app.session).not.toBeNull();

    // run the whole 4x replay: 345 s of recording, ~86 s of wall time
    for (let i = 0; i < 900; i += 1) await step(100);
    // the controller is released when the run finishes; its result stays on the app
    const result = app.lastResult;
    expect(app.session).toBeNull();
    expect(result?.rounds).toHaveLength(3);
    expect(result?.rounds.map((r) => r.verdict.verdict)).toEqual(['verified', 'breath_detected', 'verified']);
    expect(root.textContent).toContain('Session end');
    // the same match count `npm run analyze -- recordings/demo-1.jsonl` reports
    expect(root.textContent).toContain('Auto marks agreed with 7 of 7 taps.');
    // the last pulse window runs past the end of the file, so it is not reported as a number
    expect(root.textContent).toContain('Pulse: start 58 BPM, low not available (window not complete).');
    expect(root.textContent).not.toMatch(/\{\w+\}/);
  });
});
