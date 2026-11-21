import { SmartSpectraSDK, MetricType, breathingMetrics } from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import { nextMetricsAfterError, REQUESTED_METRICS } from '../core/metrics.js';
import { createNormalizeState, normalizeRaw, rawFromDecoded } from '../core/normalize.js';
import type { Packet, RawPacket } from '../core/types.js';
import type { Source, SourceEvents } from './source.js';

/** The SDK's own types are not available without the native package; this is all we call. */
interface SdkLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
  on(event: string, cb: (...args: never[]) => void): unknown;
}

/** Numeric SDK code from a rejected call. IPC failures carry string codes; those count as 0. */
function errorInfo(err: unknown): { code: number; message: string } {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'number' ? e.code : 0;
  const message = typeof e?.message === 'string' && e.message ? e.message : 'start failed';
  return { code, message };
}

function safeDestroy(instance: SdkLike | null): void {
  try {
    instance?.destroy();
  } catch {
    // destroy is idempotent and best effort
  }
}

/** Live source: camera → SDK → normalized packets, plus the SDK's own preview stream. */
export function createSdkSource(apiKey: string): Source {
  const handlers: Partial<SourceEvents> = {};
  const state = createNormalizeState();
  let sdk: SdkLike | null = null;
  // true between start() and stop(); a refusal arriving while stopping must not reopen the camera
  let active = false;
  let usedFallback = false;
  let metricsFlowing = false;
  // the breathing-only retry, when one is running or has run for this start()
  let fallbackRun: Promise<void> | null = null;

  const emit = <K extends keyof SourceEvents>(ev: K, ...args: Parameters<SourceEvents[K]>): void => {
    const f = handlers[ev] as ((...a: unknown[]) => void) | undefined;
    if (f) f(...args);
  };

  /**
   * One retry with breathing only, when a refused metric set (code 3 or 13) arrives before
   * any metrics. Returns null when the error is not a refusal, the retry already happened,
   * or `from` is no longer the live instance. The returned promise emits 'error' and
   * rejects if the retry fails too.
   */
  const tryFallback = (from: SdkLike, code: number): Promise<void> | null => {
    if (!active || from !== sdk || metricsFlowing) return null;
    const next = nextMetricsAfterError(code, usedFallback, breathingMetrics);
    if (!next) return null;
    usedFallback = true;
    // tear the refused session down before standing up the next one: SDK state is process-global
    safeDestroy(from);
    const replacement = build(next);
    sdk = replacement;
    fallbackRun = replacement.start().catch((err: unknown) => {
      if (sdk === replacement) {
        const { code: c, message } = errorInfo(err);
        emit('error', c, message);
      }
      throw err;
    });
    return fallbackRun;
  };

  const build = (metrics: number[]): SdkLike => {
    const instance = new SmartSpectraSDK({ apiKey, requestedMetrics: metrics, enableTelemetry: false }) as unknown as SdkLike;
    // Events from an instance that was replaced or stopped are ignored.
    instance.on('metrics', (buf: Uint8Array) => {
      if (instance !== sdk) return;
      metricsFlowing = true;
      const wallMs = performance.now();
      const raw: RawPacket = rawFromDecoded(decodeMetrics(buf), wallMs, 0);
      const packet: Packet = normalizeRaw(raw, state);
      emit('packet', packet, raw, wallMs);
    });
    instance.on('validationStatus', (code: number, tsUs: number, hint: string) => {
      if (instance !== sdk) return;
      emit('validation', { wallMs: performance.now(), tsUs, code, hint });
    });
    instance.on('streamAvailable', (stream: MediaStream) => {
      if (instance !== sdk) return;
      emit('stream', stream);
    });
    instance.on('error', (code: number, message: string, retryable?: boolean) => {
      if (instance !== sdk) return;
      // kMetricNotAuthorized usually arrives here rather than from start()
      const run = tryFallback(instance, code);
      if (run) {
        run.catch(() => undefined); // already reported through 'error'
        return;
      }
      emit('error', code, message, retryable);
    });
    return instance;
  };

  return {
    async start(): Promise<void> {
      safeDestroy(sdk);
      active = true;
      usedFallback = false;
      metricsFlowing = false;
      fallbackRun = null;
      const first = build([...REQUESTED_METRICS]);
      sdk = first;
      try {
        await first.start();
      } catch (err) {
        // An 'error' event may already have switched to breathing only (destroying `first`
        // rejects its pending start); that retry's outcome is the result.
        if (!fallbackRun) {
          const { code, message } = errorInfo(err);
          const run = tryFallback(first, code);
          if (!run) {
            // a start canceled by stop() is not an error worth showing
            if (active && sdk === first) emit('error', code, message);
            throw err;
          }
        }
      }
      if (fallbackRun) await fallbackRun;
    },
    async stop(): Promise<void> {
      active = false;
      const current = sdk;
      try {
        await current?.stop();
      } catch {
        // stopping is best effort (it rejects on an IPC timeout); the camera is released below
      } finally {
        safeDestroy(current);
        if (sdk === current) sdk = null;
      }
    },
    on(ev, f): void {
      handlers[ev] = f as never;
    },
  };
}

export const PULSE_CODE = MetricType.PULSE_RATE;
