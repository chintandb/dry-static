/**
 * Write a synthetic 3-hold recording: `tsx scripts/synth.ts <out.jsonl> [seed]`.
 * For demos and tests only. Hold verdicts on this data say nothing about physiology.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { synthSession } from '../src/core/synth.js';
import { serializeLine } from '../src/core/recording.js';
import { planTable } from '../src/core/table.js';

const out = process.argv[2] ?? 'recordings/synthetic-1.jsonl';
const seed = Number(process.argv[3] ?? 1);

// Hold times follow a real plan (settle 45 s, then rest + 3 s countdown before each hold),
// so the replay demo looks exactly like a live session.
const plan = planTable({ pbS: 120, type: 'co2', size: 'quick', capPct: 0.5 });
const jerks = [[0.62, 0.72], [0.55, 0.68, 0.8], [0.5, 0.62, 0.74, 0.86]];
let cursor = 45;
const holds = plan.rounds.map((round, i) => {
  const startS = cursor + round.restS + 3;
  const hold = {
    startS,
    durS: round.holdS,
    contractionsAtS: (jerks[i] ?? [0.7]).map((f) => Math.round(startS + f * round.holdS)),
  };
  cursor = startS + round.holdS;
  return hold;
});

const lines = synthSession({ seed, totalS: cursor + 8, plan, holds });

mkdirSync(dirname(out) || '.', { recursive: true });
writeFileSync(out, lines.map(serializeLine).join('\n') + '\n');
console.log(`wrote ${out}: ${lines.length} lines, seed ${seed}`);
console.log('This file is synthetic. Label it as such wherever it is shown.');
