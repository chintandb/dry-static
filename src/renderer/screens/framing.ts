import { COPY, validationHint } from '../../core/copy.js';
import { DEFAULT_PARAMS } from '../../core/params.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { button, el } from '../ui.js';

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const props = (ctx.props ?? {}) as { cantSee?: boolean };
  const video = el('video', { class: 'preview', autoplay: true, playsinline: true, muted: true });
  const hint = el('p', { class: 'hint' }, COPY['framing.waiting']);
  const canvas = el('canvas', { class: 'guide', width: 640, height: 360 });

  const next = button(COPY['framing.continue'], () => ctx.beginSettle());
  next.disabled = true;

  ctx.onStream((stream) => {
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  });

  const drawGuide = (): void => {
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = 'rgba(216, 230, 238, 0.45)';
    g.lineWidth = 2;
    g.setLineDash([8, 8]);
    const w = canvas.width * 0.44;
    const h = canvas.height * 0.5;
    g.strokeRect((canvas.width - w) / 2, canvas.height * 0.18, w, h);
    g.fillStyle = 'rgba(216, 230, 238, 0.6)';
    g.font = '13px system-ui, sans-serif';
    g.fillText(COPY['framing.guide'], 18, canvas.height - 16);
  };
  drawGuide();

  root.append(
    el(
      'section',
      { class: 'screen' },
      el('h1', {}, COPY['framing.title']),
      el('p', {}, props.cantSee ? COPY['framing.cantSee'] : COPY['framing.intro']),
      el('div', { class: 'preview-wrap' }, video, canvas),
      hint,
      el('div', { class: 'row' }, button(COPY['safety.back'], () => ctx.go('setup'), 'ghost'), next),
    ),
  );

  return {
    render: () => {
      const status = ctx.framing();
      hint.textContent = status.code < 0 ? COPY['framing.waiting'] : validationHint(status.code, status.hint);
      const bothTraces = (status.upperAgoMs ?? Infinity) < 2000 && (status.lowerAgoMs ?? Infinity) < 2000;
      const okLongEnough = status.code === 0 && status.codeForMs >= DEFAULT_PARAMS.framingOkS * 1000;
      next.disabled = !(bothTraces && okLongEnough);
    },
    unmount: () => {
      video.srcObject = null;
    },
  };
}
