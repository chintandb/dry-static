import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionResult } from '../core/session.js';

export interface Storage {
  dataDir: string;
  saveSession(r: SessionResult): void;
  listSessions(): SessionResult[];
  appendRecording(id: string, line: string): void;
  addUsage(seconds: number): void;
  usageSeconds(): number;
  deleteAll(): void;
}

const safeName = (id: string): string => id.replace(/[^a-zA-Z0-9._-]/g, '_');

/** Everything lives in one folder, plain files, so "delete all data" is one directory. */
export function createStorage(baseDir: string): Storage {
  const sessionsDir = join(baseDir, 'sessions');
  const recordingsDir = join(baseDir, 'recordings');
  const usageFile = join(baseDir, 'usage.json');

  const ensure = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
  };

  return {
    dataDir: baseDir,

    saveSession(r: SessionResult): void {
      ensure(sessionsDir);
      writeFileSync(join(sessionsDir, `${safeName(r.id)}.json`), JSON.stringify(r, null, 2), 'utf8');
    },

    listSessions(): SessionResult[] {
      if (!existsSync(sessionsDir)) return [];
      const out: SessionResult[] = [];
      for (const name of readdirSync(sessionsDir)) {
        if (!name.endsWith('.json')) continue;
        try {
          out.push(JSON.parse(readFileSync(join(sessionsDir, name), 'utf8')) as SessionResult);
        } catch {
          // a half-written session file must never stop the history from opening
        }
      }
      return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
    },

    appendRecording(id: string, line: string): void {
      ensure(recordingsDir);
      appendFileSync(join(recordingsDir, `${safeName(id)}.jsonl`), `${line}\n`, 'utf8');
    },

    addUsage(seconds: number): void {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      ensure(baseDir);
      const current = this.usageSeconds();
      writeFileSync(usageFile, JSON.stringify({ seconds: current + seconds }), 'utf8');
    },

    usageSeconds(): number {
      if (!existsSync(usageFile)) return 0;
      try {
        const parsed = JSON.parse(readFileSync(usageFile, 'utf8')) as { seconds?: number };
        return Number(parsed.seconds) || 0;
      } catch {
        return 0;
      }
    },

    deleteAll(): void {
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}
