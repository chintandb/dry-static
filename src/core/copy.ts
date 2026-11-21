/**
 * Every user-facing string. Plain, short, US English, no ranking or celebration.
 * Nothing here may contain a word from `BANNED` (see test/copy.test.ts), except the
 * disclaimer and the six safety lines, which have to name what the app is not.
 */

export const BANNED: string[] = [
  'hypoxia',
  'hypoxic',
  'safe',
  'safely',
  'guarantee',
  'guaranteed',
  'prevent',
  'prevents',
  'diagnose',
  'diagnosis',
  'treat',
  'treatment',
  'cure',
  'stress',
  'anxiety',
  'medical',
];

/** Strings that must use the banned vocabulary on purpose. */
export const ALLOWLIST_PREFIXES = ['disclaimer.', 'safety.check'];

export const COPY: Record<string, string> = {
  'disclaimer.full':
    'DRY STATIC is a training aid for dry breath-hold practice. It is not a medical device. It does not measure oxygen or carbon dioxide, it cannot detect a blackout, and it is not a safety device. Never use it in or near water. People with heart, lung, blood-pressure or seizure conditions, and anyone pregnant, should talk to a doctor before starting breath-hold training. SmartSpectra metrics are for general wellness and informational purposes only and have not been cleared by the FDA.',

  'app.name': 'DRY STATIC',
  'app.tagline': 'A camera-verified dry apnea trainer.',

  'safety.check1': "I'm on dry land, not in or near water.",
  'safety.check2': "I'm seated or lying down, not standing or driving.",
  'safety.check3': 'Someone nearby knows what I am doing.',
  'safety.check4': 'I will not hyperventilate before a hold.',
  'safety.check5': 'I will stop at the first strong urge to breathe.',
  'safety.check6':
    'I understand this app does not measure oxygen, cannot detect a blackout, and is not a safety device.',

  'consent.title': 'Before you start',
  'consent.what':
    'DRY STATIC runs a CO2 or O2 table: timed holds and rests, one after another. The camera watches your chest and waist so the app can check that each hold stayed still.',
  'consent.camera':
    'Your camera feed goes to this Mac and to Presage for processing. Nothing else leaves the machine.',
  'consent.data':
    'The app stores session summaries and signal numbers, never video or images, in its own data folder. Telemetry is off.',
  'consent.agree': 'I agree, set up a session',
  'consent.replay': 'Try replay (no camera, no key)',
  'consent.about': 'About & Data',

  'safety.title': 'Check all six',
  'safety.intro': 'All six are required before the camera opens.',
  'safety.continue': 'Continue',
  'safety.back': 'Back',

  'setup.title': 'Session setup',
  'setup.pb': 'Your current personal best static, in seconds (used only to size holds)',
  'setup.type': 'Table type',
  'setup.type.co2': 'CO2: hold fixed, rest shrinks',
  'setup.type.o2': 'O2: rest fixed, hold grows',
  'setup.size': 'Size',
  'setup.size.quick': 'Quick (3 rounds)',
  'setup.size.standard': 'Standard (5 rounds)',
  'setup.size.full': 'Full (8 rounds)',
  'setup.cap': 'Hold cap, as a share of your personal best',
  'setup.plan': 'Round plan',
  'setup.hold': 'Hold',
  'setup.rest': 'Rest',
  'setup.round': 'Round',
  'setup.estimate': 'Estimated live time',
  'setup.budget': '≈ {used} of ~50 trial minutes used on this Mac',
  'setup.start': 'Start framing',
  'setup.invalidPb': 'Enter a whole number of seconds from 30 to 600.',

  'framing.title': 'Framing',
  'framing.intro':
    'Sit back so the camera sees your chest and your waist. Plain, light clothing helps. Keep the light in front of you.',
  'framing.guide': 'Line your chest up with the outline.',
  'framing.ready': 'Ready',
  'framing.waiting': 'Waiting for a steady view…',
  'framing.continue': 'Start settle-in',
  'framing.retry': 'Retry',
  'framing.cantSee':
    "We can't see your breathing clearly. Check the light, and make sure your chest and waist are in view.",

  'settle.title': 'Settle in',
  'settle.intro': "Breathe normally. Don't talk.",
  'settle.remaining': '{s} s',
  'settle.learned': 'Breathing signal learned.',

  'round.rest': 'REST',
  'round.breathe': 'BREATHE',
  'round.hold': 'HOLD',
  'round.countdown': 'Starting in {n}',
  'round.holdOf': 'Round {round} of {total}',
  'round.target': 'Target {target}',
  'round.stop': 'Stop',
  'round.chip.verified': 'HOLD VERIFIED',
  'round.chip.breath': 'BREATH DETECTED',
  'round.chip.unreadable': 'NOT READABLE',
  'round.reason.ok': 'The trace stayed flat.',
  'round.reason.starting': 'Checking the first few seconds.',
  'round.reason.no_signal': 'No signal right now.',
  'round.reason.validation': 'The camera lost the view.',
  'round.reason.talking': 'Talking breaks the trace.',
  'round.reason.breath': 'A breath-sized movement was visible.',
  'round.autoMarks': 'Auto marks (experimental)',
  'round.taps': 'Your taps',
  'round.stopped': 'Stopped at {time}.',
  'round.pulseHidden': 'Pulse is hidden during a hold.',
  'round.pulseSettling': 'pulse: settling',
  'round.finishing': 'FINISHING',
  'round.finishingNote': 'Waiting a few seconds for the last pulse reading. Stop skips it.',

  'end.title': 'Session end',
  'end.early': 'Session ended early. Finished rounds are kept.',
  'end.exportCsv': 'Export CSV',
  'end.exportPng': 'Export PNG',
  'end.history': 'History',
  'end.done': 'Done',
  'end.pulseLine': 'Pulse: start {start}, low {min}.',

  'history.title': 'History',
  'history.empty': 'No sessions yet.',
  'history.firstContraction': 'First contraction per session (your taps)',
  'history.autoLine': 'Auto marks (experimental)',
  'history.sessions': 'Sessions',
  'history.delete': 'Delete all data',
  'history.deleteConfirm': 'Delete every session and recording on this Mac?',
  'history.deleteDone': 'All data deleted.',

  'about.title': 'About & Data',
  'about.cadence': 'Measured cadence: {hz} Hz',
  'about.delay': 'Delivery delay: {median} ms median, {p95} ms p95',
  'about.invalid': 'Invalid samples: {pct}%',
  'about.telemetry': 'Telemetry: off. No cloud insights are requested.',
  'about.location': 'Data folder: {path}',
  'about.delete': 'Delete all data',
  'about.back': 'Back',

  'summary.verified': '{n} of {total} holds verified.',
  'summary.contraction': 'First contraction (your taps): {avg} average. Auto marks agreed with {matched} of {taps} taps.',
  'summary.contractionNoAuto': 'First contraction (your taps): {avg} average.',
  'summary.pulse': 'Pulse fell from {start} to {min} during round {round}.',
  'summary.pulseFlat': 'Pulse held steady during round {round}.',

  'pulse.outOfRange': "outside the SDK's valid range",
  'pulse.lagNote': 'Pulse is a 12-second average, so it lags.',
  'pulse.na': 'not available',
  'pulse.incomplete': 'not available (window not complete)',

  'error.title.generic': 'Something went wrong (code {code})',
  'error.body.generic': 'The message was: {message}',

  'replay.synthetic':
    'This replay is a synthetic recording generated for the demo. It is not a measurement of a person.',
  'replay.badFile':
    'This file is not a DRY STATIC recording: the meta line is missing or unreadable.',
  'replay.noFile': 'No replay file was given on the command line.',
  'replay.readFailed': 'Could not read {path}',

  'common.retry': 'Retry',
  'common.back': 'Back',
  'common.close': 'Close',
};

export function fmt(id: string, vars: Record<string, string | number> = {}): string {
  const template = COPY[id];
  if (template === undefined) return id;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole,
  );
}

/** SDK validation codes to short instructions. Unknown codes fall back to the SDK hint. */
export function validationHint(code: number, sdkHint: string): string {
  const table: Record<number, string> = {
    0: 'Ready',
    1: 'Face the camera',
    2: 'Only one person in view',
    3: 'Move to the center',
    4: 'Add light in front of you',
    5: 'Too much light behind or on you',
    6: 'The camera needs to see your chest and waist: sit back or tilt the camera down',
    7: 'Camera adjusting…',
    8: 'Camera too slow: add light',
    9: 'Hold still',
    10: 'Move back a little',
    11: 'Move closer',
    12: 'Move down a little',
    13: 'Move up a little',
    14: 'Face the camera directly',
  };
  return table[code] ?? sdkHint;
}

export interface ErrorScreen {
  title: string;
  body: string;
  action: 'replay' | 'restart' | 'retry' | 'fallback' | 'settings';
}

export function errorScreen(code: number | 'no_key'): ErrorScreen {
  if (code === 'no_key') {
    return {
      title: 'No API key set',
      body: 'Put PRESAGE_API_KEY in a .env file next to package.json (see .env.example), then restart. You can also watch the bundled replay with no key and no camera.',
      action: 'replay',
    };
  }
  const table: Record<number, ErrorScreen> = {
    2: {
      title: 'API key not accepted',
      body: 'Check PRESAGE_API_KEY in .env, then restart the app.',
      action: 'restart',
    },
    3: {
      title: 'This key cannot use that signal',
      body: 'The app will retry with the fallback set of signals.',
      action: 'fallback',
    },
    4: {
      title: 'Trial minutes used up',
      body: 'The free Presage trial has a limited number of measurement minutes. You can watch the bundled replay instead.',
      action: 'replay',
    },
    5: {
      title: "Can't reach Presage",
      body: 'Check the connection and retry.',
      action: 'retry',
    },
    6: {
      title: "Can't reach Presage",
      body: 'The service returned an error. Check the connection and retry.',
      action: 'retry',
    },
    7: {
      title: 'No camera found',
      body: 'Check camera permission for this app in System Settings, then retry.',
      action: 'settings',
    },
    13: {
      title: "This key can't use a requested signal",
      body: 'Retry with the fallback set of signals.',
      action: 'fallback',
    },
    14: {
      title: 'Camera too slow',
      body: 'Add light in front of you and close other camera apps, then retry.',
      action: 'retry',
    },
  };
  const known = table[code];
  if (known) return known;
  return {
    title: fmt('error.title.generic', { code }),
    body: 'The app could not continue. Retry, or watch the bundled replay.',
    action: 'retry',
  };
}
