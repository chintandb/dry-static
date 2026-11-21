/**
 * Headless recorder: `tsx scripts/record.ts --out <file.jsonl> [--seconds N] [--inspect]`
 *
 * Keys (raw stdin, no Enter): s = hold start, e = hold end, c = contraction felt, q = quit.
 * Writes the same JSONL format the app writes. Never logs the API key.
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadApiKey } from '../src/main/env.js';
import { isMetricRefusal, nextMetricsAfterError } from '../src/core/metrics.js';
import { validationHint } from '../src/core/copy.js';
import { rawFromDecoded } from '../src/core/normalize.js';
import { serializeLine } from '../src/core/recording.js';
import type { RecLine } from '../src/core/types.js';

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string | null = null): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const outPath = arg('out');
const seconds = Number(arg('seconds', '300'));
const inspect = flag('inspect');
if (!outPath) {
  console.error('usage: npm run record -- --out rec/hold1.jsonl [--seconds 180] [--inspect]');
  process.exit(1);
}

const root = process.cwd();
const apiKey = loadApiKey(root);
if (!apiKey) {
  console.error('\nNo API key. Put PRESAGE_API_KEY=... in .env (or export it).');
  console.error('Free key: https://physiology.presagetech.com/auth/register\n');
  process.exit(1);
}

// Loaded through a variable so TypeScript does not need the (large) package installed.
const pkg = '@smartspectra/node-sdk';
const msgPkg = '@smartspectra/node-sdk/messages';
let SDK: any;
let decodeMetrics: (buf: any) => any;
try {
  SDK = await import(pkg);
  decodeMetrics = (await import(msgPkg)).decodeMetrics;
} catch (err) {
  console.error('\nCannot load @smartspectra/node-sdk. Run `npm install` first.');
  console.error(String(err));
  process.exit(1);
}

mkdirSync(dirname(resolve(outPath)) || '.', { recursive: true });
// One file per session: replace any earlier recording at this path.
const out = createWriteStream(resolve(outPath), { flags: 'w' });
const write = (l: RecLine) => out.write(serializeLine(l) + '\n');
const wall = () => performance.now();

const breathing: number[] = [...(SDK.breathingMetrics ?? [0, 1, 2])];
const requested = [...breathing, SDK.MetricType?.PULSE_RATE ?? 15, SDK.MetricType?.TALKING ?? 13];

// The live instance. A refused metric set (code 3 or 13, from start() or an early 'error'
// event) gets one retry with breathing only; events from a replaced instance are ignored.
let sdk: any = null;
let usedFallback = false;
let metricsSeen = false;
let stopping = false;

write({
  type: 'meta', version: 1, app: 'dry-static', sdk: '3.5.0',
  createdAt: new Date().toISOString(), mode: 'record', plan: null, requestedMetrics: requested,
});

let round = 0;
let packets = 0;
let inspectsLeft = inspect ? 1 : 0;
let lastLine = '';
let lastView = 'waiting for camera';
let lastPulse = '-';
let lastRate = '-';
let holdState = '';
let holdStartedAt = 0;
let contractions = 0;
const lastKeyAt: Record<string, number> = {};
let upperCount = 0;
let lowerCount = 0;
let lastSecond = -1;
const startedAt = wall();

function attach(instance: any): void {
  instance.on('processingStatus', (status: number) => {
    if (instance !== sdk) return;
    write({ type: 'status', wallMs: wall(), status });
  });
  instance.on('validationStatus', (code: number, tsUs: number, hint: string) => {
    if (instance !== sdk) return;
    lastView = code === 0 ? 'OK' : validationHint(code, hint);
    write({ type: 'validation', wallMs: wall(), tsUs, code, hint });
  });
  instance.on('error', (code: number, message: string, retryable: boolean) => {
    if (instance !== sdk) return;
    write({ type: 'error', wallMs: wall(), code, message });
    if (!metricsSeen && !stopping && nextMetricsAfterError(code, usedFallback, breathing)) {
      void retryWithBreathing(instance, code, message);
      return;
    }
    if (!metricsSeen && usedFallback && isMetricRefusal(code)) {
      refusedTwice(code, message);
      return;
    }
    const fatal = code === 2 || code === 4 || code === 7;
    console.error(`\nSDK error ${code}: ${message}${retryable ? ' (retryable)' : ''}`);
    if (fatal) void shutdown(1);
  });

  instance.on('metrics', (buf: any, tsUs: number) => {
    if (instance !== sdk) return;
    metricsSeen = true;
    if (inspectsLeft > 0) {
      inspectsLeft -= 1;
      const decoded = decodeMetrics(buf);
      const trimmed = JSON.parse(JSON.stringify(decoded, (_k, v) => (Array.isArray(v) ? v.slice(0, 2) : v)));
      console.log('\nFirst decoded packet (arrays trimmed to 2 entries):\n');
      console.log(JSON.stringify(trimmed, null, 2));
      console.log('\nIf field names differ from the ones in src/core/normalize.ts, tell the builder.');
      void shutdown(0);
      return;
    }
    const raw = rawFromDecoded(decodeMetrics(buf), wall(), tsUs);
    packets += 1;
    upperCount += raw.upper.length;
    lowerCount += raw.lower.length;
    // Pulse and rate arrive only every second or so; keep the latest value on screen.
    if (raw.pulse.length) lastPulse = Math.round(raw.pulse[raw.pulse.length - 1][1]).toString();
    if (raw.rate.length) lastRate = raw.rate[raw.rate.length - 1][1].toFixed(1);
    lastLine = `pulse=${lastPulse} rate=${lastRate}`;
    write({ type: 'metrics', ...raw });
  });
}

/** Build, wire and start one instance. `start()` is synchronous and throws on failure. */
function startWith(metrics: number[]): void {
  const instance = new SDK.SmartSpectraSDK({ apiKey, requestedMetrics: metrics, enableTelemetry: false, logLevel: 2 });
  sdk = instance;
  attach(instance);
  instance.useCamera(SDK.CameraSelection.default);
  instance.start();
}

/** Stop and destroy an instance; native state is process-global, so this must finish first. */
async function retire(instance: any): Promise<void> {
  try {
    await instance?.stopAsync?.();
  } catch {
    /* not running */
  }
  try {
    await instance?.destroy?.();
  } catch {
    /* already down */
  }
}

function refusedTwice(code: number, message: string): void {
  console.error(`\nThe API key was refused even for breathing only (SDK error ${code}: ${message}).`);
  console.error('Check which metrics the key is allowed to use, then try again.');
  void shutdown(1);
}

async function retryWithBreathing(from: any, code: number, message: string): Promise<void> {
  const next = nextMetricsAfterError(code, usedFallback, breathing);
  if (!next || from !== sdk || stopping) return;
  usedFallback = true;
  console.warn(`\nRequested metric set refused (SDK error ${code}: ${message}). Retrying with breathing only.`);
  sdk = null;
  await retire(from);
  if (stopping) return;
  try {
    startWith(next);
    console.log(`Recording to ${outPath} (breathing only)`);
    console.log('Keys: s = hold start   e = hold end   c = contraction felt   q = quit\n');
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    refusedTwice(typeof e?.code === 'number' ? e.code : 0, String(e?.message ?? err));
  }
}

const ticker = setInterval(() => {
  const t = (wall() - startedAt) / 1000;
  if (Math.floor(t) !== lastSecond) {
    lastSecond = Math.floor(t);
    const cadence = t > 1 ? (upperCount / t).toFixed(0) : '0';
    const view = lastView.length > 48 ? `${lastView.slice(0, 47)}…` : lastView;
    const hold = holdStartedAt
      ? `HOLD ${((wall() - holdStartedAt) / 1000).toFixed(0)}s c=${contractions} | `
      : holdState;
    process.stdout.write(`\r\x1b[2K t=${lastSecond}s ${hold}upper≈${cadence}/s lower=${lowerCount} ${lastLine} | view: ${view}`);
  }
}, 200);

const hardStop = setTimeout(() => {
  console.log(`\nReached --seconds ${seconds}. Stopping.`);
  void shutdown(0);
}, seconds * 1000);

const taps: Record<string, 'hold_start' | 'hold_end' | 'contraction'> = {
  s: 'hold_start', e: 'hold_end', c: 'contraction',
};
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (key: string) => {
  if (key === '\u0003' || key === 'q') {
    void shutdown(0);
    return;
  }
  const k = key.toLowerCase();
  const kind = taps[k];
  if (!kind) return;
  // A held-down key repeats about 12 times a second; count one press per key per 0.8 s.
  const now = wall();
  if (now - (lastKeyAt[k] ?? -Infinity) < 800) {
    lastKeyAt[k] = now;
    return;
  }
  lastKeyAt[k] = now;
  // Keys only make sense in order: s starts a hold, c and e need a hold in progress.
  const holding = holdStartedAt !== 0;
  if ((kind === 'hold_start' && holding) || (kind !== 'hold_start' && !holding)) {
    process.stdout.write(`\n  ${k} ignored: ${holding ? 'a hold is already running (tap e to end it)' : 'no hold running (tap s to start one)'}\n`);
    return;
  }
  if (kind === 'contraction') {
    write({ type: 'tap', wallMs: wall(), kind: 'contraction' });
    contractions += 1;
    process.stdout.write('\n  c -> contraction\n');
    return;
  }
  if (kind === 'hold_start') {
    round += 1;
    holdStartedAt = wall();
    contractions = 0;
  } else {
    holdState = `last hold ${((wall() - holdStartedAt) / 1000).toFixed(0)}s | `;
    holdStartedAt = 0;
  }
  write({ type: 'cue', wallMs: wall(), phase: kind, round: Math.max(1, round) });
  process.stdout.write(`\n  ${key} -> ${kind} (round ${Math.max(1, round)})\n`);
});

async function shutdown(code: number): Promise<void> {
  stopping = true;
  clearInterval(ticker);
  clearTimeout(hardStop);
  try {
    await sdk?.stopAsync?.();
    await sdk?.destroy?.();
  } catch {
    /* already down */
  }
  out.end(() => {
    console.log(`\nWrote ${outPath} (${packets} packets).`);
    process.exit(code);
  });
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

try {
  startWith(requested);
  console.log(`Recording to ${outPath}`);
  console.log('Keys: s = hold start   e = hold end   c = contraction felt   q = quit\n');
} catch (err) {
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e?.code === 'number' ? e.code : 0;
  if (usedFallback) {
    // an 'error' event during start() already began the breathing-only retry
  } else if (nextMetricsAfterError(code, usedFallback, breathing)) {
    write({ type: 'error', wallMs: wall(), code, message: String(e?.message ?? err) });
    await retryWithBreathing(sdk, code, String(e?.message ?? err));
  } else {
    console.error(`Could not start: ${String(err)}`);
    void shutdown(1);
  }
}
