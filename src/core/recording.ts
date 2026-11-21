import type { RecLine } from './types.js';

export type MetaLine = Extract<RecLine, { type: 'meta' }>;

export function serializeLine(l: RecLine): string {
  return JSON.stringify(l);
}

export interface ParsedRecording {
  lines: RecLine[];
  badLines: number;
  meta: MetaLine | null;
}

/**
 * Parse a JSONL recording. Bad JSON lines are skipped and counted; blank lines are
 * ignored. A file cut mid-hold is fine: the last line may simply be absent.
 */
export function parseRecording(text: string): ParsedRecording {
  const lines: RecLine[] = [];
  let badLines = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as RecLine;
      if (!obj || typeof (obj as { type?: unknown }).type !== 'string') {
        badLines += 1;
        continue;
      }
      lines.push(obj);
    } catch {
      badLines += 1;
    }
  }
  const meta = (lines.find((l) => l.type === 'meta') as MetaLine | undefined) ?? null;
  return { lines, badLines, meta };
}
