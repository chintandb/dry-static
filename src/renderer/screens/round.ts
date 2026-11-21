import { COPY, fmt } from '../../core/copy.js';
import type { RoundResult, SessionView } from '../../core/session.js';
import type { PulseTrend } from '../../core/pulseTrend.js';
import type { AppContext, ScreenHandle } from '../app.js';
import { drawStrip } from '../charts/strip.js';
import { button, chip, clockText, el } from '../ui.js';

const pulseText = (value: PulseTrend['start']): string =>
  value.kind === 'value' ? `${Math.round(value.bpm)} BPM` : value.kind === 'out_of_range' ? COPY['pulse.outOfRange'] : COPY['pulse.na'];

/** The low point is only shown once its window (hold end + pulse lag) has filled. */
const pulseLine = (round: RoundResult): string => {
  const start = `Start ${pulseText(round.pulse.start)}`;
  if (round.pulseStatus === 'pending') return `${start} · ${COPY['round.pulseSettling']}`;
  const low = round.pulseStatus === 'incomplete' ? COPY['pulse.incomplete'] : pulseText(round.pulse.min);
  return `${start}, low ${low}.`;
};

const verdictText = (round: RoundResult): string =>
  round.stopped
    ? fmt('round.stopped', { time: clockText(round.actualHoldS) })
    : round.verdict.verdict === 'verified'
      ? COPY['round.chip.verified']
      : round.verdict.verdict === 'breath_detected'
        ? COPY['round.chip.breath']
        : COPY['round.chip.unreadable'];

export function mount(root: HTMLElement, ctx: AppContext): ScreenHandle {
  const roundLabel = el('p', { class: 'muted' }, '');
  const phaseLabel = el('h1', { class: 'phase' }, COPY['round.rest']);
  const timer = el('div', { class: 'timer' }, '0:00');
  const chipBox = el('div', { class: 'chip-row' });
  const reason = el('p', { class: 'muted' }, '');
  const canvas = el('canvas', { class: 'strip', width: 900, height: 220 });
  const markNote = el('p', { class: 'tiny' }, '');
  const prevBox = el('div', { class: 'prev' }, '');
  const rateBox = el('p', { class: 'muted' }, '');
  // one path for the button and S/Esc, so the cues Stop produces are recorded
  const stop = button(COPY['round.stop'], () => ctx.stop());
  // replay follows the recorded cues, so Stop is disabled there
  stop.disabled = !ctx.recording();

  root.append(
    el(
      'section',
      { class: 'screen' },
      roundLabel,
      phaseLabel,
      timer,
      chipBox,
      reason,
      canvas,
      markNote,
      prevBox,
      rateBox,
      el('div', { class: 'row' }, stop),
    ),
  );

  const chipFor = (view: SessionView): [string, 'ok' | 'warn' | 'bad' | 'idle'] => {
    if (!view.live || view.live.state === 'verified') return [COPY['round.chip.verified'], 'ok'];
    if (view.live.state === 'breath') return [COPY['round.chip.breath'], 'warn'];
    return [COPY['round.chip.unreadable'], 'bad'];
  };

  const reasonFor = (view: SessionView): string => {
    const r = view.live?.reason ?? 'ok';
    return COPY[`round.reason.${r}`] ?? '';
  };

  return {
    render: (view) => {
      if (!view) return;
      roundLabel.textContent = fmt('round.holdOf', { round: view.round, total: view.totalRounds });
      const inHold = view.phase === 'hold';
      const counting = view.phase === 'countdown';
      const finishing = view.phase === 'finishing';

      phaseLabel.textContent = inHold
        ? COPY['round.hold']
        : counting
          ? COPY['round.breathe']
          : finishing
            ? COPY['round.finishing']
            : COPY['round.rest'];
      phaseLabel.className = `phase ${inHold ? 'phase-hold' : 'phase-rest'}`;

      if (inHold) {
        timer.textContent = clockText(view.phaseElapsedS);
        timer.dataset.target = clockText(view.holdTargetS);
      } else {
        timer.textContent = counting
          ? fmt('round.countdown', { n: Math.max(1, Math.ceil(view.phaseRemainingS)) })
          : clockText(view.phaseRemainingS);
      }

      chipBox.textContent = '';
      if (inHold) {
        const [label, tone] = chipFor(view);
        chipBox.append(chip(label, tone));
        reason.textContent = reasonFor(view);
      } else {
        const last = view.lastRound;
        const lastText = last ? (last.stopped ? verdictText(last) : `${verdictText(last)} · ${last.actualHoldS.toFixed(0)} s`) : '';
        reason.textContent = finishing ? `${COPY['round.finishingNote']}${lastText ? ` ${lastText}` : ''}` : lastText;
      }

      // pulse is never shown during a hold: it is a 12 s average and lags badly
      prevBox.textContent = '';
      rateBox.textContent = '';
      if (!inHold && view.lastRound) {
        const round = view.lastRound;
        const g = document.createElement('canvas');
        g.className = 'mini';
        g.width = 420;
        g.height = 90;
        prevBox.append(
          el('h3', {}, `Round ${round.round}: ${round.stopped ? verdictText(round) : round.verdict.verdict.replace('_', ' ')}`),
          g,
          el('p', { class: 'tiny' }, `${COPY['pulse.lagNote']} ${pulseLine(round)}`),
        );
        const c = g.getContext('2d');
        if (c && round.pulse.curve.length) {
          drawStrip(c, {
            trace: [],
            holdWindow: [round.t0, round.tEnd],
            marks: [],
            taps: [],
            pulse: round.pulse.curve,
            t0: round.t0,
            t1: round.tEnd + 12,
            pulseAxis: true,
          });
        }
        if (view.restRate !== null && !finishing) rateBox.textContent = `Breathing ${Math.round(view.restRate)} a minute`;
      }

      // the live strip: the flat line is the proof that the hold is real
      if (inHold && view.holdT0 !== null) {
        const c = canvas.getContext('2d');
        const trace = view.trace.length ? view.trace : [{ t: view.holdT0, v: 0, stable: true }];
        const t1 = Math.max(trace[trace.length - 1].t, view.holdT0 + 1);
        if (c) {
          drawStrip(c, {
            trace,
            holdWindow: [view.holdT0, Math.max(t1, view.holdT0 + view.holdTargetS)],
            marks: ctx.params.autoMarksLabel === 'hidden' ? [] : view.marks,
            taps: view.taps,
            t0: view.holdT0,
            t1,
          });
        }
        markNote.textContent =
          ctx.params.autoMarksLabel === 'hidden'
            ? COPY['round.taps']
            : `${COPY['round.autoMarks']} · ${COPY['round.taps']}`;
        canvas.className = 'strip';
      } else {
        canvas.className = 'strip hidden';
        markNote.textContent = '';
      }
      // Stop is always available: hold, countdown, rest and the finishing wait
      stop.style.visibility = inHold || counting || finishing || view.phase === 'rest' ? 'visible' : 'hidden';
    },
    unmount: () => undefined,
  };
}
