/** First-contraction history: one solid line from taps, one dashed line from auto marks. */
export function drawHistory(
  ctx: CanvasRenderingContext2D,
  sessions: { taps: number[]; marks: number[] }[],
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0d1216';
  ctx.fillRect(0, 0, w, h);
  const all = sessions.flatMap((s) => [...s.taps, ...s.marks]);
  if (all.length === 0) {
    ctx.fillStyle = '#8fa3ad';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Nothing to plot yet.', 14, h / 2);
    return;
  }
  const hi = Math.max(...all);
  const lo = Math.min(...all);
  const pad = 26;
  const xOf = (i: number): number =>
    sessions.length === 1 ? w / 2 : pad + (i / Math.max(1, sessions.length - 1)) * (w - 2 * pad);
  const yOf = (v: number): number => (hi - lo < 1e-6 ? h / 2 : h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad));

  ctx.strokeStyle = '#1d2830';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  const line = (series: (i: number) => number | null, color: string, dash: number[]): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let pen = false;
    sessions.forEach((_, i) => {
      const v = series(i);
      if (v === null) {
        pen = false;
        return;
      }
      const x = xOf(i);
      const y = yOf(v);
      if (!pen) {
        ctx.moveTo(x, y);
        pen = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.setLineDash([]);
  };

  line((i) => (sessions[i].taps.length ? sessions[i].taps[0] : null), '#7fc8a9', []);
  line((i) => (sessions[i].marks.length ? sessions[i].marks[0] : null), '#e0a458', [6, 6]);

  ctx.fillStyle = '#8fa3ad';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`${Math.round(hi)} s`, 4, pad);
  ctx.fillText(`${Math.round(lo)} s`, 4, h - pad);
}
