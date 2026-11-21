/**
 * Writes `recordings/demo-1.jsonl`: the recording that ships with the app.
 *
 * It is SYNTHETIC and labeled as such (meta.sdk = "synthetic"). It exists so `npm run
 * replay` works with no key, no camera and no SDK, and so the round screen shows all three
 * states: a verified hold, a hold where a breath was sneaked in, and another verified hold.
 *
 *   npm run demo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { serializeLine } from '../src/core/recording.js';
import { synthSession } from '../src/core/synth.js';
import { planTable } from '../src/core/table.js';

const plan = planTable({ pbS: 90, type: 'co2', size: 'quick', capPct: 0.5 });

// times are relative to each hold start; synthSession wants absolute session times
const holds = [
  { contractionsAtS: [22, 33], sneakAtRelS: undefined as number | undefined },
  { contractionsAtS: [24, 34], sneakAtRelS: 22 },
  { contractionsAtS: [20, 30, 40], sneakAtRelS: undefined },
];

let cursor = 45; // settle-in
const placed = plan.rounds.map((round, i) => {
  const startS = cursor + round.restS + 3;
  const hold = {
    startS,
    durS: round.holdS,
    contractionsAtS: holds[i].contractionsAtS.map((t) => t + startS),
    sneakBreathAtS: holds[i].sneakAtRelS === undefined ? undefined : startS + holds[i].sneakAtRelS,
  };
  cursor = startS + round.holdS;
  return hold;
});

const totalS = cursor + 6;
const lines = synthSession({ seed: 12, plan, holds: placed, totalS, pulseDrop: 7 });
mkdirSync('recordings', { recursive: true });
writeFileSync('recordings/demo-1.jsonl', lines.map(serializeLine).join('\n') + '\n');
writeFileSync(
  'recordings/demo-1.expected.json',
  `${JSON.stringify(
    {
      note: 'Synthetic recording. Expected verdicts come from the generator, not from physiology.',
      rounds: placed.map((h, i) => ({
        round: i + 1,
        verdict: h.sneakBreathAtS === undefined ? 'verified' : 'breath_detected',
      })),
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote recordings/demo-1.jsonl (${lines.length} lines, ${totalS} s, plan ${plan.type}/${plan.size})`);
console.log('Synthetic. Label it as such wherever it is shown.');
