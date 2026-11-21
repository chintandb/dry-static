/**
 * Live-session lifecycle in the real App, with the SDK source replaced by a fake that the test
 * drives: a second session in one launch, recovery from failed calibration, every exit
 * releasing the camera, errors after Settle reaching the End screen, usage counting and the
 * Stop button recording its cues.
 */
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY, errorScreen } from '../src/core/copy.js';
import type { Packet, TablePlan } from '../src/core/types.js';
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
import type { SourceEvents } from '../src/renderer/source.js';

interface FakeSource {
  id: number;
  handlers: Partial<SourceEvents>;
  started: boolean;
  stopped: boolean;
  emit<K extends keyof SourceEvents>(ev: K, ...args: Parameters<SourceEvents[K]>): void;
}

const log: string[] = [];
const sources: FakeSource[] = [];
let failNextStart = false;

vi.mock('../src/renderer/sdkSource.js', () => ({
  createSdkSource: () => {
    const fake: FakeSource = {
      id: sources.length + 1,
      handlers: {},
      started: false,
      stopped: false,
      emit(ev, ...args) {
        const f = this.handlers[ev] as ((...a: unknown[]) => void) | undefined;
        f?.(...args);
      },
    };
    sources.push(fake);
    return {
      async start() {
        log.push(`start${fake.id}`);
        if (failNextStart) {
          failNextStart = false;
          fake.emit('error', 7, 'no camera');
          throw new Error('no camera');
        }
        fake.started = true;
      },
      async stop() {
        log.push(`stop${fake.id}:begin`);
        await new Promise((r) => setTimeout(r, 50));
        fake.stopped = true;
        log.push(`stop${fake.id}:done`);
      },
      on(ev: keyof SourceEvents, f: never) {
        fake.handlers[ev] = f;
      },
    };
  },
}));

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true });
let clock = 0;
let saves = 0;
let usage: number[] = [];
let recorded: string[] = [];

const PLAN: TablePlan = {
  type: 'co2',
  size: 'quick',
  pbS: 40,
  capPct: 0.5,
  rounds: [{ round: 1, restS: 5, holdS: 10 }],
  liveS: 0,
};

beforeEach(() => {
  vi.useFakeTimers();
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  clock = 0;
  saves = 0;
  usage = [];
  recorded = [];
  log.length = 0;
  sources.length = 0;
  failNextStart = false;
  g.performance = { now: () => clock };
  g.requestAnimationFrame = (): number => 1;
  g.cancelAnimationFrame = (): void => undefined;
  dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as never;
  dom.window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
  (dom.window as unknown as { dryStatic: unknown }).dryStatic = {
    apiKey: async () => 'test-key',
    replayPath: async () => null,
    readFile: async () => '',
    saveSession: async () => {
      saves += 1;
    },
    listSessions: async () => [],
    appendRecording: async (_id: string, line: string) => {
      recorded.push(line);
    },
    addUsage: async (s: number) => {
      usage.push(s);
    },
    usageSeconds: async () => 0,
    deleteAll: async () => undefined,
    dataDir: async () => '/tmp/data',
    exportFile: async () => true,
  };
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  vi.useRealTimers();
});

function boot(): { app: App; root: HTMLElement } {
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
  return { app, root };
}

const current = (): FakeSource => sources[sources.length - 1];

/** Advance wall time in 100 ms steps, feeding the newest fake source breathing or a flat hold. */
async function feed(app: App, ms: number, opts: { noise?: boolean } = {}): Promise<void> {
  for (let done = 0; done < ms; done += 100) {
    clock += 100;
    const t = clock / 1000;
    const inHold = app.session?.view(clock).phase === 'hold';
    const v = opts.noise ? 0.03 * Math.sin(t * 977) : inHold ? 0.01 * Math.sin(t * 31) : Math.sin((2 * Math.PI * t) / 4);
    const packet: Packet = {
      wallMs: clock,
      t,
      upper: [{ t, v, stable: true }],
      lower: [{ t, v: v * 0.9, stable: true }],
      rate: [],
      pulse: [],
      talking: [],
    };
    const src = current();
    if (src && src.started && !src.stopped) src.emit('packet', packet, { wallMs: clock, tsUs: 0, upper: [], lower: [], rate: [], pulse: [], talking: [] }, clock);
    await vi.advanceTimersByTimeAsync(100);
  }
}

async function runOneLiveSession(app: App, root: HTMLElement): Promise<void> {
  await app.startLive(PLAN);
  expect(root.textContent).toContain(COPY['framing.title']);
  app.beginSettle();
  // 45 s settle, 5 s rest, 3 s countdown, 10 s hold, then up to 12 s finishing
  await feed(app, 80_000);
}

describe('live lifecycle', () => {
  it('a second live session in the same launch runs from a fresh controller and saves once', async () => {
    const { app, root } = boot();
    await runOneLiveSession(app, root);
    expect(root.textContent).toContain('Session end');
    expect(saves).toBe(1);
    expect(usage).toHaveLength(1);
    expect(app.session).toBeNull();

    await app.startLive(PLAN);
    await feed(app, 1000);
    // the old 'done' session must not finish a second time
    expect(saves).toBe(1);
    expect(root.textContent).not.toContain('Session end');
    app.beginSettle();
    expect(app.session?.view(clock).phase).toBe('settle');
    await feed(app, 50_000);
    expect(root.textContent).not.toContain('Settle in');
    await feed(app, 30_000);
    expect(root.textContent).toContain('Session end');
    expect(saves).toBe(2);
    expect(usage).toHaveLength(2);
  });

  it('after a failed calibration, the next Settle starts a new controller', async () => {
    const { app, root } = boot();
    await app.startLive(PLAN);
    app.beginSettle();
    await feed(app, 46_000, { noise: true });
    expect(root.textContent).toContain(COPY['framing.cantSee']);
    expect(app.session).toBeNull();
    // the camera stays on while the user reframes
    expect(current().stopped).toBe(false);
    app.beginSettle();
    await feed(app, 46_000);
    expect(app.session?.view(clock).phase).not.toBe('calibration_failed');
    expect(root.textContent).not.toContain(COPY['framing.cantSee']);
  });

  it('Framing Back stops the camera, and the next start waits for the stop to finish', async () => {
    const { app } = boot();
    await app.startLive(PLAN);
    await feed(app, 2000);
    app.go('setup'); // Framing's Back button
    const second = app.startLive(PLAN);
    await vi.advanceTimersByTimeAsync(200);
    await second;
    expect(log).toEqual(['start1', 'stop1:begin', 'stop1:done', 'start2']);
  });

  it('the footer About link, startReplay and beforeunload all stop the camera', async () => {
    const { app, root } = boot();
    await app.startLive(PLAN);
    const aboutLink = [...root.querySelectorAll('footer button')].find((b) => b.textContent?.includes('About'));
    (aboutLink as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(sources[0].stopped).toBe(true);

    await app.startLive(PLAN);
    void app.startReplay();
    await vi.advanceTimersByTimeAsync(100);
    expect(sources[1].stopped).toBe(true);

    await app.startLive(PLAN);
    window.dispatchEvent(new dom.window.Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(100);
    expect(sources[2].stopped).toBe(true);
  });

  it('closing the overlay after an error during Framing stops the camera', async () => {
    const { app, root } = boot();
    await app.startLive(PLAN);
    current().emit('error', 14, 'slow camera');
    const close = [...root.querySelectorAll('.overlay button')].find((b) => b.textContent === 'Close');
    expect(close).toBeTruthy();
    (close as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(100);
    expect(current().stopped).toBe(true);
    void app;
  });

  it('a fatal error after Settle ends on the End screen with the error shown', async () => {
    const { app, root } = boot();
    await app.startLive(PLAN);
    app.beginSettle();
    await feed(app, 50_000);
    current().emit('error', 4, 'credits');
    await feed(app, 500);
    expect(root.textContent).toContain('Session end');
    expect(root.textContent).toContain(errorScreen(4).title);
    expect(root.textContent).toContain(errorScreen(4).body);
    expect(root.querySelector('.banner-error')).not.toBeNull();
    expect(saves).toBe(1);
    expect(current().stopped).toBe(true);
  });

  it('a retryable error after Settle does not end the run', async () => {
    const { app, root } = boot();
    await app.startLive(PLAN);
    app.beginSettle();
    await feed(app, 50_000);
    current().emit('error', 5, 'network blip');
    await feed(app, 1000);
    expect(root.textContent).not.toContain('Session end');
    expect(app.session?.view(clock).phase).not.toBe('done');
    expect(current().stopped).toBe(false);
  });

  it("the SDK's retryable flag decides whether an error ends the run", async () => {
    const { app, root } = boot();
    await app.startLive(PLAN);
    app.beginSettle();
    await feed(app, 50_000);
    // credit exhaustion is fatal by code, but the SDK says this one is retryable
    current().emit('error', 4, 'credits', true);
    await feed(app, 500);
    expect(root.textContent).not.toContain('Session end');
    // a network error is retryable by code, but the SDK says this one is not
    current().emit('error', 5, 'network down', false);
    await feed(app, 500);
    expect(root.textContent).toContain('Session end');
  });

  it('usage runs from a successful start until the source stops, once per run', async () => {
    const { app } = boot();
    await app.startLive(PLAN);
    await feed(app, 10_000); // ten seconds on Framing count: the SDK is running
    app.go('setup');
    await vi.advanceTimersByTimeAsync(100);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toBeCloseTo(10, 0);

    failNextStart = true;
    await app.startLive(PLAN);
    await vi.advanceTimersByTimeAsync(100);
    app.go('setup');
    await vi.advanceTimersByTimeAsync(100);
    // a start that failed never counts
    expect(usage).toHaveLength(1);
  });

  it('the Stop button records the cues it produces', async () => {
    const { app, root } = boot();
    await app.startLive(PLAN);
    app.beginSettle();
    await feed(app, 56_000); // hold starts at 53 s
    expect(app.session?.view(clock).phase).toBe('hold');
    const stop = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Stop') as HTMLButtonElement;
    stop.click();
    const cues = recorded.map((l) => JSON.parse(l) as { type: string; phase?: string }).filter((l) => l.type === 'cue');
    expect(cues.map((c) => c.phase)).toContain('hold_end');
    expect(cues.map((c) => c.phase)).toContain('session_end');
  });
});
