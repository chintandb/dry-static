import { COPY } from '../../core/copy.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { button, el } from '../ui.js';

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const node = el(
    'section',
    { class: 'screen screen-narrow' },
    el('h1', {}, COPY['app.name']),
    el('p', { class: 'lede' }, COPY['app.tagline']),
    el('h2', {}, COPY['consent.title']),
    el('p', {}, COPY['consent.what']),
    el('p', {}, COPY['consent.camera']),
    el('p', {}, COPY['consent.data']),
    el(
      'div',
      { class: 'row' },
      button(COPY['consent.agree'], () => ctx.go('safety')),
      button(COPY['consent.replay'], () => void ctx.startReplay(), 'ghost'),
    ),
  );
  root.append(node);
  return { render: () => undefined, unmount: () => undefined };
}
