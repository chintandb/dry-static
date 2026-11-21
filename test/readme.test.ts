import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNED, COPY } from '../src/core/copy.js';

const whole = (word: string, text: string): boolean => new RegExp(`\\b${word}\\b`, 'i').test(text);

const docs = ['README.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

describe('README and docs', () => {
  const text = readFileSync('README.md', 'utf8');

  it('no banned words outside the disclaimer', () => {
    for (const file of docs) {
      const body = readFileSync(file, 'utf8').split(COPY['disclaimer.full']).join('');
      const offenders = BANNED.filter((word) => whole(word, body)).map((word) => `${file}: ${word}`);
      expect(offenders).toEqual([]);
    }
  });

  it('quotes the disclaimer verbatim', () => {
    expect(text).toContain(COPY['disclaimer.full']);
  });

  it('shows both quickstarts', () => {
    expect(text).toContain('npm run replay');
    expect(text).toContain('cp .env.example .env');
  });

  it('labels the bundled recording as synthetic', () => {
    expect(text).toContain('synthetic');
  });
});
