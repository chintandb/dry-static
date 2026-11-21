import { COPY, errorScreen, fmt } from '../core/copy.js';
import { REQUESTED_METRICS } from '../core/metrics.js';
import { makeParams, type Params } from '../core/params.js';
import { serializeLine } from '../core/recording.js';
import { SessionController as Controller, type SessionResult, type SessionView } from '../core/session.js';
import { planTable } from '../core/table.js';
import type { Cue, Packet, RecLine, TablePlan, Tap, TracePoint, ValidationEvent } from '../core/types.js';
import type { DryStaticBridge } from './bridge.js';
import { createReplaySource, type ReplaySource } from './replaySource.js';
import type { Source } from './source.js';
import { button, el } from './ui.js';

export type ScreenName = 'consent' | 'safety' | 'setup' | 'framing' | 'settle' | 'round' | 'end' | 'history' | 'about';

/** Screens that need the camera/SDK (or the replay) running. Leaving them stops it. */
const LIVE_FLOW: ReadonlySet<ScreenName> = new Set<ScreenName>(['framing', 'settle', 'round']);

/**
 * SDK error codes that end a run when the error carries no `retryable` flag (a rejected
 * start(), or a replayed error line); every other code is treated as retryable:
 * kAuthenticationFailed 2, kCreditExhausted 4, kInputUnavailable 7, kMetricNotAuthorized 13
 * (after the source's own fallback) and kSustainedLowFrameRate 14.
 */
const FATAL_CODES: ReadonlySet<number> = new Set([2, 4, 7, 13, 14]);

/** What the End screen is given: the result and the traces for its strips. */
export interface EndProps {
  result: SessionResult;
  traces: { primary: TracePoint[]; contraction: TracePoint[] };
}

export interface ScreenHandle {
  render(view: SessionView | null): void;
  unmount(): void;
}

export interface AppContext {
  go(screen: ScreenName, props?: unknown): void;
  bridge: DryStaticBridge;
  session: Controller | null;
  params: Params;
  props: unknown;
  startLive(plan: TablePlan): Promise<void>;
  startReplay(): Promise<void>;
  beginSettle(): void;
  /** Stop button and S/Esc: one path, so the cues it produces are recorded. Live only. */
  stop(): void;
  showError(code: number | 'no_key', message?: string): void;
  stream(): MediaStream | null;
  onStream(cb: (s: MediaStream) => void): void;
  recording(): boolean;
  synthetic(): boolean;
  framing(): FramingStatus;
}

export interface FramingStatus {
  code: number;
  hint: string;
  /** how long the current code has held, in ms */
  codeForMs: number;
  /** ms since the last sample of each trace arrived (null if never) */
  upperAgoMs: number | null;
  lowerAgoMs: number | null;
}

type ScreenModule = (root: HTMLElement, ctx: AppContext) => ScreenHandle;

export class App implements AppContext {
  readonly bridge: DryStaticBridge;
  readonly params: Params = makeParams();
  session: Controller | null = null;
  props: unknown = null;

  private screenHost: HTMLElement;
  private footer: HTMLElement;
  private overlay: HTMLElement;
  private current: ScreenHandle | null = null;
  private currentName: ScreenName | null = null;
  private screens = new Map<ScreenName, ScreenModule>();

  private source: Source | null = null;
  /** the replay source while a replay runs: its clock is the session's "now" */
  private replay: ReplaySource | null = null;
  private plan: TablePlan | null = null;
  private sessionId = '';
  private mode: 'live' | 'replay' = 'live';
  private finished = false;
  /** performance.now() of the last successful live source.start(), until the source stops */
  private liveSince: number | null = null;
  /** the most recent stop; a new source never starts before it has finished */
  private stopping: Promise<void> = Promise.resolve();
  /** the last finished session, kept after the controller is released */
  lastResult: SessionResult | null = null;
  private mediaStream: MediaStream | null = null;
  private isSynthetic = false;
  private lastCode = -1;
  private lastHint = '';
  private codeSince = 0;
  private upperAt: number | null = null;
  private lowerAt: number | null = null;
  private streamCbs = new Set<(s: MediaStream) => void>();

  constructor(root: HTMLElement) {
    this.bridge = window.dryStatic;
    this.screenHost = document.createElement('main');
    this.footer = document.createElement('footer');
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay hidden';
    this.footer.className = 'footer';
    this.footer.append(
      el('span', {}, COPY['app.name']),
      el('span', { class: 'spacer' }),
      button(COPY['consent.about'], () => this.go('about'), 'ghost'),
    );
    root.append(this.screenHost, this.footer, this.overlay);
  }

  register(name: ScreenName, mod: ScreenModule): this {
    this.screens.set(name, mod);
    return this;
  }

  start(): void {
    this.go('consent');
    const loop = (): void => {
      this.advance(this.now());
      // advance() may have finished and released the session
      const session = this.session;
      this.current?.render(session ? session.view(this.now()) : null);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    // Animation frames stop entirely while the window is hidden or occluded, but timers keep
    // running (throttled), so the phase clock and the screen routing get their own timer.
    setInterval(() => this.advance(this.now()), 250);
    // closing or reloading the window must not leave the camera on or the usage uncounted
    window.addEventListener('beforeunload', () => {
      void this.stopEverything();
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (this.mode === 'live' && this.session) {
          const tap: Tap = { wallMs: performance.now(), kind: 'contraction' };
          this.session.onTap(tap);
          this.record({ type: 'tap', ...tap });
        }
        return;
      }
      if (ev.key === 's' || ev.key === 'S' || ev.key === 'Escape') this.stop();
    });
  }

  go(screen: ScreenName, props: unknown = null): void {
    const mod = this.screens.get(screen);
    if (!mod) throw new Error(`no screen named ${screen}`);
    // Leaving the live flow (Framing Back, footer About, End, ...) releases the camera/SDK.
    // stopEverything() detaches the session and source synchronously, so the new screen never
    // sees them; the stop itself finishes in the background and every start awaits it.
    if (!LIVE_FLOW.has(screen) && (this.source || this.session)) void this.stopEverything();
    this.current?.unmount();
    this.screenHost.textContent = '';
    this.props = props;
    this.currentName = screen;
    this.current = mod(this.screenHost, this);
    this.hideError();
  }

  // -------------------------------------------------------------- live / replay

  async startLive(plan: TablePlan): Promise<void> {
    // a previous run (or one still stopping) must be fully released before the SDK starts again
    await this.stopEverything();
    this.mode = 'live';
    this.plan = plan;
    this.finished = false;
    this.isSynthetic = false;
    const key = await this.bridge.apiKey();
    if (!key) {
      this.showError('no_key');
      return;
    }
    this.sessionId = `live-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    this.record({
      type: 'meta',
      version: 1,
      app: 'dry-static',
      sdk: '3.5.0',
      createdAt: new Date().toISOString(),
      mode: 'live',
      plan,
      requestedMetrics: [...REQUESTED_METRICS],
    });
    // loaded lazily: the live source pulls in the native SDK, and replay must work without it
    const { createSdkSource } = await import('./sdkSource.js');
    const source = createSdkSource(key);
    this.source = source;
    this.wire(source);
    try {
      await source.start();
    } catch {
      return; // the source emitted the SDK error; the overlay explains it
    }
    // the user may have left (or an error stopped it) while the camera was starting
    if (this.source !== source) return;
    this.liveSince = performance.now();
    this.go('framing');
  }

  async startReplay(): Promise<void> {
    await this.stopEverything();
    const path = await this.bridge.replayPath();
    if (!path) {
      this.showError(0, COPY['replay.noFile']);
      return;
    }
    let text: string;
    try {
      text = await this.bridge.readFile(path);
    } catch {
      this.showError(0, fmt('replay.readFailed', { path }));
      return;
    }
    const source = createReplaySource(text, 4);
    if (!source.meta || source.meta.type !== 'meta') {
      this.showError(0, COPY['replay.badFile']);
      return;
    }
    this.mode = 'replay';
    this.finished = false;
    this.isSynthetic = String(source.meta.sdk ?? '').startsWith('synthetic');
    this.plan = source.meta.plan ?? planTable({ pbS: 120, type: 'co2', size: 'quick', capPct: 0.5 });
    this.sessionId = `replay-${Date.now()}`;
    // the session runs on the recording's own clock (see replaySource.ts)
    this.session = new Controller({
      plan: this.plan,
      mode: 'replay',
      params: this.params,
      startWallMs: source.firstWallMs,
      id: this.sessionId,
      startedAt: new Date().toISOString(),
    });
    this.source = source;
    this.replay = source;
    this.wire(source);
    this.go('settle');
    await source.start();
  }

  /** Framing finished: the settle window and the phase clock start now. */
  beginSettle(): void {
    // always a fresh controller: an old one may be 'done' or 'calibration_failed'
    if (this.mode === 'live' && this.plan) {
      const now = performance.now();
      this.session = new Controller({
        plan: this.plan,
        mode: 'live',
        params: this.params,
        startWallMs: now,
        id: this.sessionId,
        startedAt: new Date().toISOString(),
      });
      this.finished = false;
      this.record({ type: 'cue', wallMs: now, phase: 'settle_start', round: 0 });
    }
    this.go('settle');
  }

  stop(): void {
    // replay follows the recorded cues; Stop is disabled there
    if (this.mode !== 'live' || !this.session) return;
    for (const cue of this.session.stopHold(performance.now())) this.record({ type: 'cue', ...cue });
    this.advance(performance.now());
  }

  stream(): MediaStream | null {
    return this.mediaStream;
  }

  onStream(cb: (s: MediaStream) => void): void {
    this.streamCbs.add(cb);
    if (this.mediaStream) cb(this.mediaStream);
  }

  recording(): boolean {
    return this.mode === 'live';
  }

  synthetic(): boolean {
    return this.isSynthetic;
  }

  framing(): FramingStatus {
    const now = performance.now();
    return {
      code: this.lastCode,
      hint: this.lastHint,
      codeForMs: this.lastCode >= 0 ? now - this.codeSince : 0,
      upperAgoMs: this.upperAt === null ? null : now - this.upperAt,
      lowerAgoMs: this.lowerAt === null ? null : now - this.lowerAt,
    };
  }

  // -------------------------------------------------------------- internals

  /** The session clock: performance.now() live, the recording's clock in replay. */
  private now(): number {
    return this.mode === 'replay' && this.replay ? this.replay.now() : performance.now();
  }

  /** Advance the live phase clock and move between screens as the session phase changes. */
  private advance(now: number): void {
    const session = this.session;
    if (!session) return;
    for (const cue of session.tick(now)) this.record({ type: 'cue', ...cue });
    if (this.finished) return;
    const phase = session.view(now).phase;
    if (phase === 'done') {
      this.finish();
      return;
    }
    if (phase === 'calibration_failed') {
      // drop the failed controller so the next Settle starts fresh; the camera stays on
      // for reframing
      if (this.currentName === 'settle') {
        this.session = null;
        this.go('framing', { cantSee: true });
      }
      return;
    }
    if (phase !== 'settle' && this.currentName === 'settle') this.go('round');
  }

  /** Save the result, release the session and the source, and show the End screen. */
  private finish(): void {
    const session = this.session;
    if (this.finished || !session) return;
    this.finished = true;
    const result = session.result();
    const traces = session.traces();
    this.lastResult = result;
    void this.bridge.saveSession(result);
    void this.stopEverything();
    const props: EndProps = { result, traces };
    this.go('end', props);
  }

  /** Live SDK seconds, from the successful start until now; counted once per run. */
  private countUsage(): void {
    if (this.liveSince === null) return;
    const seconds = Math.max(0, (performance.now() - this.liveSince) / 1000);
    this.liveSince = null;
    void this.bridge.addUsage(seconds);
  }

  private wire(source: Source): void {
    // events from a source that was stopped or replaced are ignored
    const stale = (): boolean => this.source !== source;
    source.on('packet', (packet: Packet, _raw, wallMs: number) => {
      if (stale()) return;
      const now = performance.now();
      if (packet.upper.length) this.upperAt = now;
      if (packet.lower.length) this.lowerAt = now;
      this.session?.onPacket({ ...packet, wallMs });
      if (this.mode !== 'live') return;
      this.record({
        type: 'metrics',
        wallMs,
        tsUs: Math.round(wallMs * 1000),
        upper: packet.upper.map((p) => [Math.round(p.t * 1e6), p.v, p.stable]),
        lower: packet.lower.map((p) => [Math.round(p.t * 1e6), p.v, p.stable]),
        rate: packet.rate.map((p) => [Math.round(p.t * 1e6), p.v, p.conf, p.stable]),
        pulse: packet.pulse.map((p) => [Math.round(p.t * 1e6), p.v, p.conf, p.stable]),
        talking: packet.talking.map((p) => [Math.round(p.t * 1e6), p.detected]),
      });
    });

    source.on('validation', (e: ValidationEvent) => {
      if (stale()) return;
      if (e.code !== this.lastCode) {
        this.lastCode = e.code;
        this.codeSince = performance.now();
      }
      this.lastHint = e.hint;
      this.session?.onValidation(e);
      if (this.mode === 'live') this.record({ type: 'validation', ...e });
    });

    source.on('cue', (cue: Cue) => {
      if (stale()) return;
      this.session?.onCue(cue);
      if (this.mode === 'live') this.record({ type: 'cue', ...cue });
    });

    source.on('tap', (tap: Tap) => {
      if (!stale()) this.session?.onTap(tap);
    });

    source.on('stream', (stream: MediaStream) => {
      if (stale()) return;
      this.mediaStream = stream;
      for (const cb of this.streamCbs) cb(stream);
    });

    source.on('error', (code: number, message: string, retryable?: boolean) => {
      if (stale()) return;
      if (this.mode === 'live') this.record({ type: 'error', wallMs: performance.now(), code, message });
      const session = this.session;
      if (!session) {
        // before Settle there is no run to keep: the overlay explains and offers the way out
        this.showError(code, message);
        return;
      }
      const fatal = typeof retryable === 'boolean' ? !retryable : FATAL_CODES.has(code);
      // a retryable error keeps the run going; any gap it causes shows up as "not readable"
      if (!fatal) return;
      // the run ends: rounds so far are saved and the End screen shows the error
      session.fail(code, message);
      this.finish();
    });

    source.on('ended', () => {
      if (!stale()) this.finish();
    });
  }

  private record(line: RecLine): void {
    if (this.mode !== 'live' || !this.sessionId) return;
    void this.bridge.appendRecording(this.sessionId, serializeLine(line));
  }

  showError(code: number | 'no_key', message?: string): void {
    const info = errorScreen(code);
    this.overlay.className = 'overlay';
    this.overlay.textContent = '';
    const actionLabel =
      info.action === 'replay'
        ? COPY['consent.replay']
        : info.action === 'settings'
          ? COPY['framing.retry']
          : COPY['common.retry'];
    const card = el(
      'div',
      { class: 'overlay-card' },
      el('h2', {}, info.title),
      el('p', {}, info.body),
      message ? el('p', { class: 'muted' }, message) : null,
      el(
        'div',
        { class: 'row' },
        button(actionLabel, () => {
          if (info.action === 'replay') {
            this.hideError();
            void this.startReplay();
          } else if (info.action === 'retry' || info.action === 'fallback') {
            this.hideError();
            void this.stopEverything().then(() => (this.mode === 'live' ? this.go('consent') : this.startReplay()));
          } else {
            this.hideError();
            this.go('consent');
          }
        }),
        button(
          COPY['common.close'],
          () => {
            this.hideError();
            // closing an error must not leave the camera on behind a dead screen
            const from = this.currentName;
            void this.stopEverything().then(() => {
              if (from && LIVE_FLOW.has(from) && this.currentName === from) this.go(this.mode === 'live' ? 'setup' : 'consent');
            });
          },
          'ghost',
        ),
      ),
    );
    this.overlay.append(card);
  }

  hideError(): void {
    this.overlay.className = 'overlay hidden';
    this.overlay.textContent = '';
  }

  /**
   * Release the session and the source and count live usage. The detach is synchronous;
   * the stop is chained after any earlier one so two SDK instances never overlap.
   */
  async stopEverything(): Promise<void> {
    const source = this.source;
    this.source = null;
    this.replay = null;
    this.session = null;
    this.countUsage();
    this.mediaStream = null;
    this.streamCbs.clear();
    this.lastCode = -1;
    this.lastHint = '';
    this.upperAt = null;
    this.lowerAt = null;
    this.stopping = this.stopping
      .then(() => source?.stop())
      .catch(() => undefined); // stopping is best effort
    await this.stopping;
  }
}
