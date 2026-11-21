import type { CapPct, TablePlan, TableSize, TableType } from './types.js';

const ROUNDS: Record<TableSize, number> = { quick: 3, standard: 5, full: 8 };
const COUNTDOWN_S = 3;
const SETTLE_S = 45;
/** shortest hold a table ever asks for */
const MIN_HOLD_S = 15;
/**
 * Accepted personal best range. The floor is 30 s so the 15 s minimum hold never exceeds
 * the cap: 0.5 x 30 = 15. A lower PB would make the floor ask for more than `capPct` of it.
 */
export const PB_MIN_S = 30;
export const PB_MAX_S = 600;

/**
 * Build a CO2 or O2 dry table.
 *
 * Holds are capped at `capPct` of the entered personal best, with a 15 s floor. The PB
 * range starts at 30 s, so the floor never pushes a hold past the cap.
 * There is deliberately no max-attempt mode: the cap is a conservative choice and
 * the README says so.
 */
export function planTable(i: {
  pbS: number;
  type: TableType;
  size: TableSize;
  capPct: CapPct;
}): TablePlan {
  if (!Number.isInteger(i.pbS) || i.pbS < PB_MIN_S || i.pbS > PB_MAX_S) {
    throw new RangeError(`pbS must be a whole number of seconds between ${PB_MIN_S} and ${PB_MAX_S}`);
  }
  const n = ROUNDS[i.size];
  const hold = Math.max(MIN_HOLD_S, Math.round(i.capPct * i.pbS));

  const rounds: TablePlan['rounds'] = [];
  if (i.type === 'co2') {
    const start = i.size === 'quick' ? 60 : 90;
    const step = i.size === 'quick' ? 10 : 15;
    for (let r = 0; r < n; r += 1) {
      rounds.push({ round: r + 1, restS: Math.max(30, start - step * r), holdS: hold });
    }
  } else {
    const restS = i.size === 'quick' ? 60 : 90;
    const h0 = Math.round(0.6 * hold);
    for (let r = 0; r < n; r += 1) {
      const holdS = n === 1 ? hold : Math.round(h0 + ((hold - h0) * r) / (n - 1));
      rounds.push({ round: r + 1, restS, holdS: Math.max(MIN_HOLD_S, Math.min(hold, holdS)) });
    }
  }

  const liveS = SETTLE_S + rounds.reduce((sum, r) => sum + r.restS + r.holdS + COUNTDOWN_S, 0);
  return { type: i.type, size: i.size, pbS: i.pbS, capPct: i.capPct, rounds, liveS };
}

/** "≈ 5:39 live" */
export function formatLive(s: number): string {
  const total = Math.max(0, Math.round(s));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `≈ ${m}:${String(sec).padStart(2, '0')} live`;
}
