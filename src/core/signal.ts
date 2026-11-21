/** Small, pure signal helpers. Parallel arrays: `t` in seconds (increasing), `v` values. */

const median = (xs: number[]): number => {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return Number.NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** Centered moving median over a time window (seconds). */
export function movingMedian(t: number[], v: number[], windowS: number): number[] {
  const half = windowS / 2;
  const out = new Array<number>(v.length);
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < v.length; i += 1) {
    // right edge: t[hi] <= t[i] + half. (Comparing differences without a lower
    // bound would let a stale `hi` sit *behind* i and skew the window.)
    while (hi + 1 < v.length && t[hi + 1] <= t[i] + half) hi += 1;
    while (lo < hi && t[lo] < t[i] - half) lo += 1;
    out[i] = median(v.slice(lo, hi + 1));
  }
  return out;
}

/** Centered moving mean over a time window (seconds). */
export function movingMean(t: number[], v: number[], windowS: number): number[] {
  const half = windowS / 2;
  const out = new Array<number>(v.length);
  let lo = 0;
  let hi = -1;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < v.length; i += 1) {
    while (hi + 1 < v.length && t[hi + 1] <= t[i] + half) {
      hi += 1;
      if (Number.isFinite(v[hi])) {
        sum += v[hi];
        count += 1;
      }
    }
    while (lo < hi && t[lo] < t[i] - half) {
      if (Number.isFinite(v[lo])) {
        sum -= v[lo];
        count -= 1;
      }
      lo += 1;
    }
    out[i] = count ? sum / count : Number.NaN;
  }
  return out;
}

/** Trailing RMS over a time window (seconds). */
export function rollingRms(t: number[], v: number[], windowS: number): number[] {
  const out = new Array<number>(v.length);
  let lo = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < t.length; i += 1) {
    if (Number.isFinite(v[i])) {
      sum += v[i] * v[i];
      count += 1;
    }
    while (lo < i && t[i] - t[lo] > windowS) {
      if (Number.isFinite(v[lo])) {
        sum -= v[lo] * v[lo];
        count -= 1;
      }
      lo += 1;
    }
    out[i] = count ? Math.sqrt(Math.max(0, sum) / count) : Number.NaN;
  }
  return out;
}

/** Percentile with linear interpolation, p in 0-100. */
export function percentile(xs: number[], p: number): number {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return Number.NaN;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (a.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (rank - lo);
}

/** Median of absolute successive differences — a robust noise estimate. */
export function medianAbsDiff(v: number[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < v.length; i += 1) {
    if (Number.isFinite(v[i]) && Number.isFinite(v[i - 1])) diffs.push(Math.abs(v[i] - v[i - 1]));
  }
  return median(diffs);
}

/** Sample cadence in Hz (1 / median dt). 0 when there are fewer than two points. */
export function cadenceHz(t: number[]): number {
  const tt = t.filter(Number.isFinite);
  if (tt.length < 2) return 0;
  const dt: number[] = [];
  for (let i = 1; i < tt.length; i += 1) {
    const d = tt[i] - tt[i - 1];
    if (d > 0) dt.push(d);
  }
  const m = median(dt);
  return m > 0 ? 1 / m : 0;
}

export interface Series {
  t: number[];
  v: number[];
}

export function toSeries(points: { t: number; v: number }[]): Series {
  return { t: points.map((p) => p.t), v: points.map((p) => p.v) };
}

export function medianOf(xs: number[]): number {
  return median(xs);
}
