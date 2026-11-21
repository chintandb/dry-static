/**
 * Every tunable number in the app. envelopeK, envelopeAbsFrac and breathFrac may be tuned on
 * real recordings, within +/-50% of these defaults. holdIgnoreS and the tapExcuse* values were
 * set from the first real recording (21 Nov 2026, see docs/BENCHMARK.md).
 */
export const DEFAULT_PARAMS = {
  /** settle-in length, seconds (45 not 60, to save trial minutes) */
  settleS: 45,
  /** calibration looks at the last N seconds of settle-in */
  calibWindowS: 30,
  /** detrend window for calibration amplitude */
  detrendMedianS: 4,
  /** noise is never taken below this share of the breath amplitude (caps SNR at 1000) */
  noiseFloorFrac: 0.001,
  /** minimum breath SNR for a trace to be usable for hold verification */
  primarySnrMin: 3,
  /** minimum breath SNR for the abdominal trace to be used for contractions */
  contractionSnrMin: 2,

  /**
   * The start of a hold is ignored this long. On real recordings the chest keeps settling
   * for 5 to 8 s after the breath taken before the hold.
   */
  holdIgnoreS: 8,
  /**
   * An excursion the user marked as a contraction (a tap from this long before it to this
   * long after it) is not counted as a breath: on real recordings a felt contraction moves
   * the chest trace about as much as a small breath. A breath is only reported once the
   * "after" window has passed without such a tap.
   */
  tapExcuseBeforeS: 1.5,
  tapExcuseAfterS: 3,
  /** only an excursion this short can be excused by a tap; a sneaked breath lasts longer */
  tapExcuseMaxS: 2.5,
  /** no sample for this long means the hold is not readable */
  gapS: 1.5,
  /** a validation warning must persist this long before the hold is unreadable */
  badStateS: 1.5,
  /** longest single excursion (exhale, re-inhale) the breath detector has to catch */
  breathWindowS: 6,
  /**
   * Trailing detrend window for breath detection. A sneaked breath is usually one-sided
   * (exhale then re-inhale, so the trace only dips), and a centered median as wide as the
   * dip follows it down and cancels it. The baseline therefore looks only backward and
   * spans twice `breathWindowS`, so a 6 s excursion is never more than half its window.
   */
  breathMedianS: 12,
  /** smoothing for breath detection */
  breathSmoothS: 0.5,
  /** the smoothed trace must stay past the threshold this long to count as a breath */
  breathMinS: 0.4,
  /**
   * An excursion (dip or rise) must exceed this fraction of the calibrated amplitude. `A` is
   * p95 - p5, so a breath exactly as big as normal breathing peaks at 0.5 x A: a threshold
   * of 0.5 would put a full-size sneaked breath exactly on it. 0.4 keeps a margin and
   * still sits far above a contraction jerk (about 0.08 x A).
   */
  breathFrac: 0.4,
  /** a hold is "partly readable" below this percentage of readable time */
  readablePctMin: 90,

  /** contractions start this long after the hold begins */
  contractionStartS: 10,
  /** baseline envelope window, measured inside the hold */
  contractionBaselineFromS: 3,
  contractionBaselineToS: 10,
  contractionMedianS: 2,
  envelopeS: 0.5,
  envelopeK: 3,
  /**
   * Floor for a contraction, as a share of the calibrated breath amplitude. A floor of 0.15
   * would reject a typical contraction: a 0.3 s jerk of amplitude 0.4 against a 2.0 breath
   * amplitude gives a 0.5 s RMS envelope of only 0.10-0.20 x A. 0.10 sits inside the tuning
   * band and still ignores single-sample spikes.
   */
  envelopeAbsFrac: 0.1,
  refractoryS: 2,
  tapTolS: 1.5,

  /** pulse averages over 12 s, so look this far past the end of a hold */
  pulseLagS: 10,
  pulseMin: 40,
  pulseMax: 110,

  /** framing: kOk must hold this long before continuing */
  framingOkS: 3,
  countdownS: 3,
  /** samples used for the wall-clock<->SDK-clock offset estimate */
  clockWindow: 100,

  /** how auto contraction marks are labeled; 'experimental' until real recordings validate them */
  autoMarksLabel: 'experimental' as 'experimental' | 'validated' | 'hidden',
} as const;

export type Params = {
  -readonly [K in keyof typeof DEFAULT_PARAMS]: (typeof DEFAULT_PARAMS)[K] extends string
    ? string
    : number;
} & { autoMarksLabel: 'experimental' | 'validated' | 'hidden' };

export function makeParams(overrides: Partial<Params> = {}): Params {
  return { ...(DEFAULT_PARAMS as unknown as Params), ...overrides };
}
