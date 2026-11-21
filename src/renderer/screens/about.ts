import { COPY, fmt } from '../../core/copy.js';
import type { SessionResult } from '../../core/session.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { button, el } from '../ui.js';

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const quality = el('div', { class: 'quality' });
  const path = el('p', { class: 'muted' }, '');

  void ctx.bridge.listSessions().then((sessions: SessionResult[]) => {
    const last = sessions[0];
    quality.textContent = '';
    if (!last) {
      quality.append(el('p', { class: 'muted' }, COPY['history.empty']));
      return;
    }
    quality.append(
      el('p', {}, fmt('about.cadence', { hz: last.quality.cadenceHz.toFixed(1) })),
      el(
        'p',
        {},
        fmt('about.delay', {
          median: Math.round(last.quality.delayMsMedian),
          p95: Math.round(last.quality.delayMsP95),
        }),
      ),
      el('p', {}, fmt('about.invalid', { pct: last.quality.invalidPct.toFixed(1) })),
    );
  });

  void ctx.bridge.dataDir().then((dir) => {
    path.textContent = fmt('about.location', { path: dir });
  });

  root.append(
    el(
      'section',
      { class: 'screen' },
      el('h1', {}, COPY['about.title']),
      quality,
      el('p', {}, COPY['about.telemetry']),
      path,
      el('p', { class: 'disclaimer' }, COPY['disclaimer.full']),
      el(
        'div',
        { class: 'row' },
        button(COPY['about.back'], () => ctx.go('consent'), 'ghost'),
        button(COPY['about.delete'], () => {
          if (!window.confirm(COPY['history.deleteConfirm'])) return;
          void ctx.bridge.deleteAll();
        }, 'ghost'),
      ),
    ),
  );

  return { render: () => undefined, unmount: () => undefined };
}
