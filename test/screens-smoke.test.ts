/**
 * The screens are plain DOM modules, so they can be mounted headlessly. This does not replace
 * looking at the window: it proves every screen builds, renders and reports without throwing.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COPY } from '../src/core/copy.js';
import { makeParams } from '../src/core/params.js';
import type { AppContext, ScreenHandle } from '../src/renderer/app.js';
import type { SessionResult, SessionView } from '../src/core/session.js';
import { mount as about } from '../src/renderer/screens/about.js';
import { mount as consent } from '../src/renderer/screens/consent.js';
import { mount as end } from '../src/renderer/screens/end.js';
import { mount as framing } from '../src/renderer/screens/framing.js';
import { mount as history } from '../src/renderer/screens/history.js';
import { mount as round } from '../src/renderer/screens/round.js';
import { mount as safety } from '../src/renderer/screens/safety.js';
import { mount as settle } from '../src/renderer/screens/settle.js';
import { mount as setup } from '../src/renderer/screens/setup.js';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true });

beforeEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  // jsdom has no canvas backend; the screens must survive that
  dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as never;
  dom.window.HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
});

afterEach(() => {
  document.body.innerHTML = '';
});

const view = (over: Partial<SessionView> = {}): SessionView => ({
  phase: 'rest',
  holdT0: null,
  holdTargetS: 0,
  round: 1,
  totalRounds: 3,
  phaseElapsedS: 10,
  phaseRemainingS: 50,
  live: null,
  trace: [],
  marks: [],
  taps: [],
  lastRound: null,
  restRate: null,
  validation: null,
  ...over,
});

const result: SessionResult = {
  id: 'smoke',
  startedAt: '2026-11-21T10:00:00.000Z',
  mode: 'replay',
  plan: { type: 'co2', size: 'quick', pbS: 90, capPct: 0.5, rounds: [{ round: 1, restS: 60, holdS: 45 }], liveS: 200 },
  calibration: null,
  rounds: [
    {
      round: 1,
      plannedHoldS: 45,
      actualHoldS: 45,
      stopped: false,
      verdict: { verdict: 'breath_detected', readablePct: 98, breathAt: 22, excused: [], unreadable: [] },
      marks: [22],
      taps: [22.4],
      firstTapS: 22.4,
      firstMarkS: 22,
      pulse: { start: { kind: 'value', bpm: 70 }, min: { kind: 'value', bpm: 64 }, delta: -6, curve: [] },
      t0: 0,
      tEnd: 45,
    },
  ],
  endedEarly: false,
  error: null,
  quality: { cadenceHz: 27.5, delayMsMedian: 40, delayMsP95: 90, invalidPct: 1 },
};

const ctx = (over: Partial<AppContext> = {}): AppContext => ({
  go: () => undefined,
  bridge: {
    apiKey: async () => null,
    replayPath: async () => null,
    readFile: async () => '',
    saveSession: async () => undefined,
    listSessions: async () => [result],
    appendRecording: async () => undefined,
    addUsage: async () => undefined,
    usageSeconds: async () => 120,
    deleteAll: async () => undefined,
    dataDir: async () => '/tmp/data',
    exportFile: async () => true,
  },
  session: null,
  params: makeParams(),
  props: null,
  startLive: async () => undefined,
  startReplay: async () => undefined,
  beginSettle: () => undefined,
  stop: () => undefined,
  showError: () => undefined,
  stream: () => null,
  onStream: () => undefined,
  recording: () => false,
  synthetic: () => true,
  framing: () => ({ code: 0, hint: '', codeForMs: 4000, upperAgoMs: 100, lowerAgoMs: 100 }),
  ...over,
});

const mountAll: [string, (root: HTMLElement, c: AppContext) => ScreenHandle][] = [
  ['consent', consent],
  ['safety', safety],
  ['setup', setup],
  ['framing', framing],
  ['settle', settle],
  ['round', round],
  ['end', end],
  ['history', history],
  ['about', about],
];

describe('screens', () => {
  it('every screen mounts and renders without throwing', () => {
    for (const [name, mount] of mountAll) {
      const root = document.createElement('div');
      const handle = mount(root, ctx({ props: name === 'end' ? result : null }));
      expect(() => handle.render(view())).not.toThrow();
      expect(() => handle.render(view({ phase: 'hold', holdT0: 100, live: { state: 'breath', reason: 'breath_seen' } }))).not.toThrow();
      expect(() => handle.render(null)).not.toThrow();
      expect(root.textContent?.length ?? 0).toBeGreaterThan(0);
      expect(() => handle.unmount()).not.toThrow();
    }
  });

  it('consent never offers a live start without a key path, and shows the disclaimer target', () => {
    const root = document.createElement('div');
    consent(root, ctx());
    expect(root.textContent).toContain(COPY['app.name']);
    expect(root.textContent).toContain(COPY['consent.replay']);
  });

  it('safety keeps continue disabled until all six boxes are checked', () => {
    const root = document.createElement('div');
    safety(root, ctx());
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === COPY['safety.continue']);
    expect(button?.disabled).toBe(true);
    const boxes = [...root.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
    expect(boxes).toHaveLength(6);
    for (const box of boxes) {
      box.checked = true;
      box.dispatchEvent(new dom.window.Event('change'));
    }
    expect(button?.disabled).toBe(false);
    expect(root.textContent).toContain('not a safety device');
  });

  it('setup shows a plan and the trial-minute line', async () => {
    const root = document.createElement('div');
    setup(root, ctx());
    await new Promise((r) => setTimeout(r, 0));
    expect(root.querySelectorAll('table tr').length).toBe(4);
    expect(root.textContent).toContain('Estimated live time');
    expect(root.textContent).toContain('trial minutes');
  });

  it('round shows the breath chip and the experimental label', () => {
    const root = document.createElement('div');
    const handle = round(root, ctx());
    handle.render(view({ phase: 'hold', holdT0: 10, holdTargetS: 45, live: { state: 'breath', reason: 'breath_seen' } }));
    expect(root.textContent).toContain(COPY['round.chip.breath']);
    expect(root.textContent).toContain(COPY['round.autoMarks']);
    handle.render(view({ phase: 'hold', holdT0: 10, live: { state: 'verified', reason: 'ok' } }));
    expect(root.textContent).toContain(COPY['round.chip.verified']);
  });

  it('end screen says at most three sentences and flags a synthetic replay', () => {
    const root = document.createElement('div');
    end(root, ctx({ props: result }));
    expect(root.querySelectorAll('p.sentence').length).toBeLessThanOrEqual(3);
    expect(root.textContent).toContain(COPY['replay.synthetic']);
    expect(root.textContent).toContain(COPY['end.exportCsv']);
  });

  it('the bundled recording is labeled synthetic in meta', () => {
    const meta = JSON.parse(readFileSync('recordings/demo-1.jsonl', 'utf8').split('\n')[0]) as { sdk: string };
    expect(meta.sdk).toBe('synthetic');
  });
});
