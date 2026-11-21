import { beforeEach, describe, expect, it, vi } from 'vitest';

type StartPlan = (sdk: FakeSdkShape) => Promise<void>;
interface FakeSdkShape {
  opts: { requestedMetrics: number[] };
  destroyed: boolean;
  stopped: boolean;
  fire(event: string, ...args: unknown[]): void;
}

const fake = vi.hoisted(() => {
  const instances: FakeSdkShape[] = [];
  const startPlans: StartPlan[] = [];
  const stopPlans: (() => Promise<void>)[] = [];
  class FakeSdk {
    opts: { requestedMetrics: number[] };
    destroyed = false;
    stopped = false;
    listeners = new Map<string, (...args: unknown[]) => void>();
    rejectPending: ((e: Error) => void) | null = null;
    constructor(opts: { requestedMetrics: number[] }) {
      this.opts = opts;
      instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void): this {
      this.listeners.set(event, cb);
      return this;
    }
    fire(event: string, ...args: unknown[]): void {
      this.listeners.get(event)?.(...args);
    }
    start(): Promise<void> {
      const plan = startPlans.shift();
      if (!plan) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        this.rejectPending = reject;
        plan(this).then(resolve, reject);
      });
    }
    stop(): Promise<void> {
      this.stopped = true;
      return stopPlans.shift()?.() ?? Promise.resolve();
    }
    destroy(): void {
      this.destroyed = true;
      // like the real SDK: pending calls reject once the instance is gone
      this.rejectPending?.(Object.assign(new Error('destroyed'), { code: 'SMARTSPECTRA_DESTROYED' }));
    }
  }
  return { instances, startPlans, stopPlans, FakeSdk };
});

vi.mock('@smartspectra/node-sdk/renderer', () => ({
  SmartSpectraSDK: fake.FakeSdk,
  MetricType: { PULSE_RATE: 15 },
  breathingMetrics: [0, 1, 2],
}));
vi.mock('@smartspectra/node-sdk/messages', () => ({ decodeMetrics: () => ({}) }));

const { createSdkSource } = await import('../src/renderer/sdkSource.js');

const refused = (code: number): Error => Object.assign(new Error(`refused ${code}`), { code });
const never = (): Promise<void> => new Promise<void>(() => undefined);
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function sourceWithErrors() {
  const source = createSdkSource('key');
  const errors: [number, string][] = [];
  source.on('error', (code, message) => errors.push([code, message]));
  return { source, errors };
}

beforeEach(() => {
  fake.instances.length = 0;
  fake.startPlans.length = 0;
  fake.stopPlans.length = 0;
});

describe('sdkSource metric fallback', () => {
  it('retries once with breathing only when start() rejects with 13', async () => {
    fake.startPlans.push(() => Promise.reject(refused(13)));
    const { source, errors } = sourceWithErrors();
    await source.start();
    expect(fake.instances).toHaveLength(2);
    expect(fake.instances[0].destroyed).toBe(true);
    expect(fake.instances[1].opts.requestedMetrics).toEqual([0, 1, 2]);
    expect(errors).toEqual([]);
  });

  it('retries when 13 arrives as an error event while start() is pending', async () => {
    fake.startPlans.push(async (sdk) => {
      sdk.fire('error', 13, 'not authorized');
      return never();
    });
    const { source, errors } = sourceWithErrors();
    await source.start();
    expect(fake.instances).toHaveLength(2);
    expect(fake.instances[0].destroyed).toBe(true);
    expect(fake.instances[1].opts.requestedMetrics).toEqual([0, 1, 2]);
    expect(errors).toEqual([]);
  });

  it('retries when 3 arrives as an error event after start() resolved but before metrics', async () => {
    const { source, errors } = sourceWithErrors();
    await source.start();
    fake.instances[0].fire('error', 3, 'configuration failed');
    await tick();
    expect(fake.instances).toHaveLength(2);
    expect(fake.instances[0].destroyed).toBe(true);
    expect(fake.instances[1].opts.requestedMetrics).toEqual([0, 1, 2]);
    expect(errors).toEqual([]);
  });

  it('emits the error when the breathing-only retry fails too', async () => {
    fake.startPlans.push(() => Promise.reject(refused(13)), () => Promise.reject(refused(13)));
    const { source, errors } = sourceWithErrors();
    await expect(source.start()).rejects.toThrow('refused 13');
    expect(fake.instances).toHaveLength(2);
    expect(errors).toEqual([[13, 'refused 13']]);
  });

  it('emits a refusal from the retry instance instead of retrying again', async () => {
    fake.startPlans.push(() => Promise.reject(refused(13)));
    const { source, errors } = sourceWithErrors();
    await source.start();
    fake.instances[1].fire('error', 13, 'still not authorized');
    await tick();
    expect(fake.instances).toHaveLength(2);
    expect(errors).toEqual([[13, 'still not authorized']]);
  });

  it('does not fall back once metrics are flowing', async () => {
    const { source, errors } = sourceWithErrors();
    await source.start();
    fake.instances[0].fire('metrics', new Uint8Array());
    fake.instances[0].fire('error', 13, 'late');
    await tick();
    expect(fake.instances).toHaveLength(1);
    expect(errors).toEqual([[13, 'late']]);
  });

  it('forwards the SDK retryable flag with the error', async () => {
    const source = createSdkSource('key');
    const seen: [number, string, boolean | undefined][] = [];
    source.on('error', (code, message, retryable) => seen.push([code, message, retryable]));
    await source.start();
    fake.instances[0].fire('metrics', new Uint8Array());
    fake.instances[0].fire('error', 5, 'network blip', true);
    fake.instances[0].fire('error', 2, 'bad key', false);
    expect(seen).toEqual([
      [5, 'network blip', true],
      [2, 'bad key', false],
    ]);
  });

  it('does not fall back on other codes', async () => {
    fake.startPlans.push(() => Promise.reject(refused(2)));
    const { source, errors } = sourceWithErrors();
    await expect(source.start()).rejects.toThrow('refused 2');
    expect(fake.instances).toHaveLength(1);
    expect(errors).toEqual([[2, 'refused 2']]);
  });
});

describe('sdkSource stop', () => {
  it('destroys the instance even when stop() rejects', async () => {
    fake.stopPlans.push(() => Promise.reject(new Error('ack timed out')));
    const { source } = sourceWithErrors();
    await source.start();
    await source.stop();
    expect(fake.instances[0].stopped).toBe(true);
    expect(fake.instances[0].destroyed).toBe(true);
  });

  it('a refusal while stopping does not reopen the camera', async () => {
    fake.stopPlans.push(async () => {
      fake.instances[0].fire('error', 13, 'during stop');
    });
    const { source } = sourceWithErrors();
    await source.start();
    await source.stop();
    expect(fake.instances).toHaveLength(1);
    expect(fake.instances[0].destroyed).toBe(true);
  });
});
