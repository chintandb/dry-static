import { COPY, errorScreen, fmt, verdictLabel } from '../../core/copy.js';
import type { PulseTrend } from '../../core/pulseTrend.js';
import { summarize, toCsv, type RoundResult, type SessionResult } from '../../core/session.js';
import type { AppContext, EndProps, ScreenHandle } from '../app.js';
import { drawStrip } from '../charts/strip.js';
import { button, clockText, el } from '../ui.js';

const pulseText = (value: PulseTrend['start']): string =>
  value.kind === 'value' ? `${Math.round(value.bpm)} BPM` : value.kind === 'out_of_range' ? COPY['pulse.outOfRange'] : COPY['pulse.na'];

/** A stopped hold is shown as "stopped at M:SS", with no judgment. */
const roundTitle = (round: RoundResult): string =>
  round.stopped
    ? `Round ${round.round} · ${fmt('round.stopped', { time: clockText(round.actualHoldS) })}`
    : `Round ${round.round} · ${round.actualHoldS.toFixed(0)} s · ${verdictLabel(round.verdict)}`;

const pulseLine = (round: RoundResult): string =>
  fmt('end.pulseLine', {
    start: pulseText(round.pulse.start),
    min: round.pulseStatus === 'incomplete' ? COPY['pulse.incomplete'] : pulseText(round.pulse.min),
  });

/** The stretches of a hold the camera could not read, labeled with what they were lost to. */
const lostFor = (round: RoundResult): { from: number; to: number; label: string }[] =>
  (round.verdict.lost ?? []).map((l) => ({ from: l.from, to: l.to, label: COPY[`verdict.lost.${l.reason}`] ?? '' }));

/** End props are { result, traces } from the app; a bare SessionResult is still accepted. */
function readProps(ctx: AppContext): EndProps | null {
  const props = ctx.props as EndProps | SessionResult | null;
  if (props && 'result' in props) return props;
  const result = props ?? ctx.session?.result() ?? null;
  if (!result) return null;
  return { result, traces: ctx.session?.traces() ?? { primary: [], contraction: [] } };
}

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const props = readProps(ctx);
  if (!props) {
    root.append(el('section', { class: 'screen' }, el('h1', {}, COPY['end.title'])));
    return { render: () => undefined, unmount: () => undefined };
  }
  const { result, traces } = props;

  const strips = el('div', { class: 'strips' });

  for (const round of result.rounds) {
    const canvas = el('canvas', { class: 'strip', width: 900, height: 200 });
    strips.append(
      el(
        'div',
        { class: 'strip-block' },
        el('h3', {}, roundTitle(round)),
        canvas,
        el('p', { class: 'tiny' }, pulseLine(round)),
      ),
    );
    const c = canvas.getContext('2d');
    if (c) {
      drawStrip(c, {
        trace: traces.primary.filter((p) => p.t >= round.t0 - 2 && p.t <= round.tEnd + 12),
        holdWindow: [round.t0, round.tEnd],
        marks: round.marks,
        taps: round.taps,
        pulse: round.pulse.curve,
        t0: round.t0 - 2,
        t1: round.tEnd + 12,
        pulseAxis: round.pulse.curve.length > 0,
        lost: lostFor(round),
      });
    }
  }

  // an error that ended the run is explained here; the overlay is only for errors before Settle
  const info = result.error ? errorScreen(result.error.code) : null;
  const errorBanner = info
    ? el(
        'div',
        { class: 'banner banner-error' },
        el('h2', {}, info.title),
        el('p', {}, info.body),
        result.error?.message ? el('p', { class: 'muted' }, result.error.message) : null,
      )
    : null;

  const sentences = summarize(result).map((text) => el('p', { class: 'sentence' }, text));

  const exportCsv = button(COPY['end.exportCsv'], () => {
    void ctx.bridge.exportFile(`dry-static-${result.id}.csv`, toCsv(result));
  }, 'ghost');

  const exportPng = button(COPY['end.exportPng'], () => {
    const width = 900;
    const rowHeight = 200;
    const sheet = document.createElement('canvas');
    sheet.width = width;
    sheet.height = 40 + rowHeight * Math.max(1, result.rounds.length);
    const g = sheet.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0d1216';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.fillStyle = '#d8e6ee';
    g.font = '16px system-ui, sans-serif';
    g.fillText(`DRY STATIC · ${result.startedAt}`, 16, 26);
    result.rounds.forEach((round, i) => {
      const block = document.createElement('canvas');
      block.width = width;
      block.height = rowHeight;
      const bc = block.getContext('2d');
      if (!bc) return;
      drawStrip(bc, {
        trace: traces.primary.filter((p) => p.t >= round.t0 - 2 && p.t <= round.tEnd + 12),
        holdWindow: [round.t0, round.tEnd],
        marks: round.marks,
        taps: round.taps,
        pulse: round.pulse.curve,
        t0: round.t0 - 2,
        t1: round.tEnd + 12,
        pulseAxis: round.pulse.curve.length > 0,
        lost: lostFor(round),
      });
      g.drawImage(block, 0, 30 + i * rowHeight);
    });
    sheet.toBlob((blob) => {
      if (!blob) return;
      void blob.arrayBuffer().then((buf) => ctx.bridge.exportFile(`dry-static-${result.id}.png`, new Uint8Array(buf)));
    }, 'image/png');
  }, 'ghost');

  root.append(
    el(
      'section',
      { class: 'screen' },
      el('h1', {}, COPY['end.title']),
      errorBanner,
      result.endedEarly ? el('p', { class: 'banner' }, COPY['end.early']) : null,
      ctx.synthetic() ? el('p', { class: 'tiny' }, COPY['replay.synthetic']) : null,
      ...sentences,
      strips,
      el(
        'div',
        { class: 'row' },
        exportCsv,
        exportPng,
        button(COPY['end.history'], () => ctx.go('history'), 'ghost'),
        button(COPY['end.done'], () => ctx.go('consent')),
      ),
    ),
  );

  return { render: () => undefined, unmount: () => undefined };
}
