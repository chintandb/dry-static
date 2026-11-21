import { COPY } from '../../core/copy.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { button, el } from '../ui.js';

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const boxes: HTMLInputElement[] = [];
  const checks = el('div', { class: 'checks' });
  for (let i = 1; i <= 6; i += 1) {
    const id = `safety-${i}`;
    const input = el('input', { type: 'checkbox', id });
    boxes.push(input);
    checks.append(el('label', { class: 'check', for: id }, input, el('span', {}, COPY[`safety.check${i}`])));
  }

  const next = button(COPY['safety.continue'], () => ctx.go('setup'));
  next.disabled = true;
  const update = (): void => {
    next.disabled = boxes.some((b) => !b.checked);
  };
  for (const b of boxes) b.addEventListener('change', update);

  root.append(
    el(
      'section',
      { class: 'screen' },
      el('h1', {}, COPY['safety.title']),
      el('p', {}, COPY['safety.intro']),
      checks,
      el('p', { class: 'disclaimer' }, COPY['disclaimer.full']),
      el('div', { class: 'row' }, button(COPY['safety.back'], () => ctx.go('consent'), 'ghost'), next),
    ),
  );
  return { render: () => undefined, unmount: () => undefined };
}
