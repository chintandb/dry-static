import { describe, expect, it } from 'vitest';
import { COPY } from '../src/core/copy.js';
import { parsePb } from '../src/renderer/screens/setup.js';

describe('parsePb', () => {
  it('accepts a whole number of seconds', () => {
    expect(parsePb('90')).toEqual({ ok: true, pbS: 90 });
    expect(parsePb(' 45 ')).toEqual({ ok: true, pbS: 45 });
    expect(parsePb('30')).toEqual({ ok: true, pbS: 30 });
    expect(parsePb('600')).toEqual({ ok: true, pbS: 600 });
  });

  it('rejects everything else with copy', () => {
    for (const bad of ['', 'abc', '5', '10', '29', '601', '700', '12.5', '-30']) {
      const result = parsePb(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toBe(COPY['setup.invalidPb']);
    }
  });

  it('states the accepted range in its message', () => {
    const result = parsePb('10');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/30.*600/);
  });
});
