import { COPY } from '../../core/copy.js';
import { formatLive, PB_MAX_S, PB_MIN_S, planTable } from '../../core/table.js';
import type { CapPct, TablePlan, TableSize, TableType } from '../../core/types.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { button, el } from '../ui.js';

export function parsePb(input: string): { ok: true; pbS: number } | { ok: false; message: string } {
  const text = input.trim();
  if (text === '') return { ok: false, message: COPY['setup.invalidPb'] };
  if (!/^\d+$/.test(text)) return { ok: false, message: COPY['setup.invalidPb'] };
  const pbS = Number(text);
  if (pbS < PB_MIN_S || pbS > PB_MAX_S) return { ok: false, message: COPY['setup.invalidPb'] };
  return { ok: true, pbS };
}

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  let pbS = 90;
  let type: TableType = 'co2';
  let size: TableSize = 'quick';
  let capPct: CapPct = 0.5;

  const pb = el('input', { type: 'number', min: PB_MIN_S, max: PB_MAX_S, step: 1, value: 90, class: 'field' });
  const error = el('p', { class: 'error' });
  const planBox = el('div', { class: 'plan' });
  const usage = el('p', { class: 'muted' });

  const select = <T extends string>(label: string, options: [T, string][], current: T, onPick: (v: T) => void): HTMLElement => {
    const field = el('select', { class: 'field' });
    for (const [value, text] of options) {
      const opt = el('option', { value }, text);
      if (value === current) opt.selected = true;
      field.append(opt);
    }
    field.addEventListener('change', () => onPick(field.value as T));
    return el('label', { class: 'stack' }, el('span', {}, label), field);
  };

  const currentPlan = (): TablePlan => planTable({ pbS, type, size, capPct });

  const renderPlan = (): void => {
    planBox.textContent = '';
    let plan: TablePlan;
    try {
      plan = currentPlan();
    } catch {
      error.textContent = COPY['setup.invalidPb'];
      return;
    }
    error.textContent = '';
    const table = el('table', { class: 'grid' });
    table.append(
      el('tr', {}, el('th', {}, COPY['setup.round']), el('th', {}, COPY['setup.rest']), el('th', {}, COPY['setup.hold'])),
    );
    for (const round of plan.rounds) {
      table.append(el('tr', {}, el('td', {}, String(round.round)), el('td', {}, formatLive(round.restS)), el('td', {}, formatLive(round.holdS))));
    }
    planBox.append(
      el('h3', {}, COPY['setup.plan']),
      table,
      el('p', {}, `${COPY['setup.estimate']}: ${formatLive(plan.liveS)}`),
    );
    next.disabled = false;
  };

  const next = button(COPY['setup.start'], () => {
    const parsed = parsePb(pb.value);
    if (!parsed.ok) {
      error.textContent = parsed.message;
      return;
    }
    pbS = parsed.pbS;
    void ctx.startLive(currentPlan());
  });
  next.disabled = true;

  pb.addEventListener('input', () => {
    const parsed = parsePb(pb.value);
    if (parsed.ok) {
      pbS = parsed.pbS;
      renderPlan();
    } else {
      error.textContent = parsed.message;
      next.disabled = true;
    }
  });

  const controls = el(
    'div',
    { class: 'controls' },
    el('label', { class: 'stack' }, el('span', {}, COPY['setup.pb']), pb),
    error,
    select('', [
      ['co2', COPY['setup.type.co2']],
      ['o2', COPY['setup.type.o2']],
    ], type, (v) => {
      type = v as TableType;
      renderPlan();
    }),
    select('', [
      ['quick', COPY['setup.size.quick']],
      ['standard', 'Standard (5 rounds)'],
      ['full', 'Full (8 rounds)'],
    ], size, (v) => {
      size = v as TableSize;
      renderPlan();
    }),
    select('', [
      ['0.5', '50%'],
      ['0.55', '55%'],
      ['0.6', '60%'],
    ], '0.5', (v) => {
      capPct = Number(v) as CapPct;
      renderPlan();
    }),
  );

  root.append(
    el(
      'section',
      { class: 'screen' },
      el('h1', {}, COPY['setup.title']),
      controls,
      planBox,
      usage,
      el('div', { class: 'row' }, button(COPY['safety.back'], () => ctx.go('safety'), 'ghost'), next),
    ),
  );

  renderPlan();
  void ctx.bridge.usageSeconds().then((seconds) => {
    usage.textContent = COPY['setup.budget'].replace('{used}', `${Math.round(seconds / 60)} min`);
  });

  return {
    render: () => undefined,
    unmount: () => undefined,
  };
}
