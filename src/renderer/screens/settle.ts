import { COPY } from '../../core/copy.js';
import { DEFAULT_PARAMS } from '../../core/params.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { el } from '../ui.js';

/** Settle-in: a dim ring fills with time. No numbers on purpose. */
export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const canvas = el('canvas', { class: 'ring', width: 220, height: 220 });
  root.append(
    el(
      'section',
      { class: 'screen screen-center' },
      el('h1', {}, COPY['settle.title']),
      el('p', {}, COPY['settle.intro']),
      ctx.synthetic() ? el('p', { class: 'tiny' }, COPY['replay.synthetic']) : null,
      canvas,
    ),
  );

  return {
    render: (view) => {
      const elapsed = view?.phaseElapsedS ?? 0;
      const total = ctx.params.settleS || DEFAULT_PARAMS.settleS;
      const frac = Math.max(0, Math.min(1, elapsed / total));
      const g = canvas.getContext('2d');
      if (!g) return;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.lineWidth = 10;
      g.strokeStyle = '#1d2830';
      g.beginPath();
      g.arc(cx, cy, 90, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = '#7fc8a9';
      g.beginPath();
      g.arc(cx, cy, 90, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      g.stroke();
    },
    unmount: () => undefined,
  };
}
