import { COPY } from '../../core/copy.js';
import type { SessionResult } from '../../core/session.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { drawHistory } from '../charts/history.js';
import { button, el } from '../ui.js';

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const canvas = el('canvas', { class: 'chart', width: 880, height: 240 });
  const list = el('div', { class: 'session-list' });
  const note = el('p', { class: 'muted' }, '');

  const load = (): void => {
    void ctx.bridge.listSessions().then((sessions: SessionResult[]) => {
      const points = sessions
        .slice()
        .reverse()
        .map((s) => ({
          taps: s.rounds.map((r) => r.firstTapS).filter((v): v is number => v !== null),
          marks: s.rounds.map((r) => r.firstMarkS).filter((v): v is number => v !== null),
        }));
      const c = canvas.getContext('2d');
      if (c) drawHistory(c, points, canvas.width, canvas.height);

      list.textContent = '';
      if (sessions.length === 0) {
        note.textContent = COPY['history.empty'];
        return;
      }
      note.textContent = '';
      for (const session of sessions) {
        const verified = session.rounds.filter((r) => r.verdict.verdict === 'verified').length;
        list.append(
          el(
            'div',
            { class: 'session-row' },
            el('span', {}, new Date(session.startedAt).toLocaleString()),
            el('span', {}, `${session.rounds.length} rounds · ${verified} verified`),
            el('span', { class: 'tiny' }, session.mode),
          ),
        );
      }
    });
  };

  const del = button(COPY['history.delete'], () => {
    if (!window.confirm(COPY['history.deleteConfirm'])) return;
    void ctx.bridge.deleteAll().then(() => {
      note.textContent = COPY['history.deleteDone'];
      load();
    });
  }, 'ghost');

  root.append(
    el(
      'section',
      { class: 'screen' },
      el('h1', {}, COPY['history.title']),
      el('h3', {}, COPY['history.firstContraction']),
      canvas,
      el('p', { class: 'tiny' }, `${COPY['history.autoLine']} (dashed)`),
      el('h3', {}, COPY['history.sessions']),
      list,
      note,
      el('div', { class: 'row' }, button(COPY['common.back'], () => ctx.go('consent'), 'ghost'), del),
    ),
  );

  load();
  return { render: () => undefined, unmount: () => undefined };
}
