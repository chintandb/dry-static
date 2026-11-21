import type { TracePoint } from '../../core/types.js';

/**
 * Maps a series onto canvas pixels. Gaps longer than `gapS` become `NaN` points, which
 * `moveTo`/`lineTo` handling below turns into path breaks, so a dropout is visible as a
 * hole rather than a straight line across.
 */
export function scaleSeries(
  points: { t: number; v: number }[],
  t0: number,
  t1: number,
  w: number,
  h: number,
  pad: number,
  gapS = 1.5,
): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const span = Math.max(1e-6, t1 - t0);
  const values = points.map((p) => p.v);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const inner = Math.max(1, h - 2 * pad);
  const out: { x: number; y: number }[] = [];
  let prevT = Number.NaN;
  for (const p of points) {
    const x = pad + ((p.t - t0) / span) * (w - 2 * pad);
    const y = hi - lo < 1e-9 ? h / 2 : pad + ((hi - p.v) / (hi - lo)) * inner;
    if (Number.isFinite(prevT) && p.t - prevT > gapS) out.push({ x: Number.NaN, y: Number.NaN });
    out.push({ x, y });
    prevT = p.t;
  }
  return out;
}

export interface StripOptions {
  trace: TracePoint[];
  holdWindow?: [number, number];
  marks?: number[];
  taps?: number[];
  pulse?: { t: number; bpm: number }[];
  t0: number;
  t1: number;
  height?: number;
  /** draw the pulse curve on its own scale, below the trace */
  pulseAxis?: boolean;
}

const COLORS = {
  bg: '#0d1216',
  grid: '#1d2830',
  trace: '#d8e6ee',
  shade: 'rgba(70, 130, 180, 0.12)',
  mark: '#e0a458',
  tap: '#7fc8a9',
  pulse: '#9fb8c8',
  text: '#8fa3ad',
};

export function drawStrip(ctx: CanvasRenderingContext2D, opts: Omit<StripOptions, 'height'> & { height?: number }): void {
  const { canvas } = ctx;
  const w = canvas.width;
  const h = opts.height ?? canvas.height;
  const pad = 10;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  if (opts.holdWindow) {
    const [a, b] = opts.holdWindow;
    const span = Math.max(1e-6, opts.t1 - opts.t0);
    const x0 = pad + ((a - opts.t0) / span) * (w - 2 * pad);
    const x1 = pad + ((b - opts.t0) / span) * (w - 2 * pad);
    ctx.fillStyle = COLORS.shade;
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
  }

  const traceH = opts.pulseAxis ? h * 0.72 : h;
  const points = scaleSeries(opts.trace, opts.t0, opts.t1, w, traceH, pad);
  ctx.strokeStyle = COLORS.trace;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      pen = false;
      continue;
    }
    if (!pen) {
      ctx.moveTo(p.x, p.y);
      pen = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();

  const xOf = (t: number): number => pad + ((t - opts.t0) / Math.max(1e-6, opts.t1 - opts.t0)) * (w - 2 * pad);

  for (const mark of opts.marks ?? []) {
    const x = xOf(mark);
    ctx.strokeStyle = COLORS.mark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, pad * 0.4);
    ctx.lineTo(x, traceH - pad * 0.4);
    ctx.stroke();
  }
  for (const tap of opts.taps ?? []) {
    const x = xOf(tap);
    ctx.strokeStyle = COLORS.tap;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, traceH - pad * 0.4);
    ctx.lineTo(x, traceH + Math.min(18, h - traceH - 2));
    ctx.stroke();
  }

  if (opts.pulseAxis && opts.pulse && opts.pulse.length) {
    const top = traceH + 6;
    const bottom = h - 6;
    const values = opts.pulse.map((p) => p.bpm);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    ctx.strokeStyle = COLORS.pulse;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    opts.pulse.forEach((p, i) => {
      const x = xOf(p.t);
      const y = hi - lo < 1e-9 ? (top + bottom) / 2 : bottom - ((p.bpm - lo) / (hi - lo)) * (bottom - top);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${hi}`, 4, top + 10);
    ctx.fillText(`${lo}`, 4, bottom);
  }
}
