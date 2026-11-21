import { describe, expect, it } from 'vitest';
import {
  ALLOWLIST_PREFIXES,
  BANNED,
  COPY,
  errorScreen,
  fmt,
  validationHint,
} from '../src/core/copy.js';

const whole = (word: string, text: string): boolean => new RegExp(`\\b${word}\\b`, 'i').test(text);
const allowlisted = (id: string): boolean => ALLOWLIST_PREFIXES.some((prefix) => id.startsWith(prefix));

describe('copy', () => {
  it('no banned words in copy', () => {
    const offenders: string[] = [];
    for (const [id, text] of Object.entries(COPY)) {
      if (allowlisted(id)) continue;
      for (const word of BANNED) {
        if (whole(word, text)) offenders.push(`${id}: ${word}`);
      }
    }
    for (let code = 0; code <= 20; code += 1) {
      const hint = validationHint(code, 'sdk hint');
      for (const word of BANNED) if (whole(word, hint)) offenders.push(`validationHint(${code}): ${word}`);
      const screen = errorScreen(code);
      for (const word of BANNED) {
        if (whole(word, screen.title) || whole(word, screen.body)) offenders.push(`errorScreen(${code}): ${word}`);
      }
    }
    const noKey = errorScreen('no_key');
    for (const word of BANNED) if (whole(word, noKey.body)) offenders.push(`errorScreen(no_key): ${word}`);
    expect(offenders).toEqual([]);
  });

  it('whole-word only', () => {
    expect(whole('safe', 'Safety')).toBe(false);
    expect(whole('safe', 'Stay safe')).toBe(true);
  });

  it('disclaimer verbatim', () => {
    expect(COPY['disclaimer.full']).toBe(
      'DRY STATIC is a training aid for dry breath-hold practice. It is not a medical device. It does not measure oxygen or carbon dioxide, it cannot detect a blackout, and it is not a safety device. Never use it in or near water. People with heart, lung, blood-pressure or seizure conditions, and anyone pregnant, should talk to a doctor before starting breath-hold training. SmartSpectra metrics are for general wellness and informational purposes only and have not been cleared by the FDA.',
    );
  });

  it('safety checks are all present and gate on six', () => {
    for (let i = 1; i <= 6; i += 1) expect(COPY[`safety.check${i}`]).toBeTruthy();
    expect(COPY['safety.check1']).toBe("I'm on dry land, not in or near water.");
    expect(COPY['safety.check6']).toContain('not a safety device');
  });

  it('validationHint', () => {
    expect(validationHint(6, 'x')).toContain('chest and waist');
    expect(validationHint(99, 'x')).toBe('x');
  });

  it('errorScreen covers the SDK error codes the app handles', () => {
    for (const code of [2, 4, 5, 6, 7, 13, 14, 'no_key'] as const) {
      expect(errorScreen(code).title.length).toBeGreaterThan(0);
      expect(errorScreen(code).body.length).toBeGreaterThan(0);
    }
    expect(errorScreen(4).action).toBe('replay');
    expect(errorScreen(99).title).toContain('99');
  });

  it('fmt fills vars', () => {
    expect(fmt('summary.verified', { n: 3, total: 3 })).toBe('3 of 3 holds verified.');
    expect(fmt('summary.contraction', { avg: '0:38', matched: 5, taps: 6 })).toBe(
      'First contraction (your taps): 0:38 average. Auto marks agreed with 5 of 6 taps.',
    );
    expect(fmt('missing.id')).toBe('missing.id');
  });
});
