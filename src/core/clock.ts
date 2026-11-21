/**
 * Estimates the offset between the wall clock (where taps and cues live) and the
 * SDK sample clock (where the traces live). Delivery is jittery, so take the
 * median over a window of observations rather than the latest value.
 */
export class ClockSync {
  private readonly window: number;
  private offsets: number[] = [];

  constructor(window = 100) {
    this.window = Math.max(1, window);
  }

  /** @param wallMs wall-clock milliseconds @param sampleT SDK-time seconds of the newest sample */
  observe(wallMs: number, sampleT: number): void {
    if (!Number.isFinite(wallMs) || !Number.isFinite(sampleT)) return;
    this.offsets.push(wallMs / 1000 - sampleT);
    if (this.offsets.length > this.window) this.offsets.shift();
  }

  get size(): number {
    return this.offsets.length;
  }

  /** Median offset in seconds, or null before the first observation. */
  get offset(): number | null {
    if (!this.offsets.length) return null;
    const a = [...this.offsets].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  /** Map a wall-clock time (ms) onto the SDK clock (seconds). */
  toSdkTime(wallMs: number): number | null {
    const off = this.offset;
    return off === null ? null : wallMs / 1000 - off;
  }

  /** Inverse of toSdkTime, used to place replay markers on the wall clock. */
  toWallMs(sdkT: number): number | null {
    const off = this.offset;
    return off === null ? null : (sdkT + off) * 1000;
  }
}
