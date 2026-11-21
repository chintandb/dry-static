import type { SessionResult } from '../core/session.js';

export interface DryStaticBridge {
  apiKey(): Promise<string | null>;
  replayPath(): Promise<string | null>;
  readFile(path: string): Promise<string>;
  saveSession(r: SessionResult): Promise<void>;
  listSessions(): Promise<SessionResult[]>;
  appendRecording(id: string, line: string): Promise<void>;
  addUsage(seconds: number): Promise<void>;
  usageSeconds(): Promise<number>;
  deleteAll(): Promise<void>;
  dataDir(): Promise<string>;
  exportFile(defaultName: string, data: string | Uint8Array): Promise<boolean>;
}

declare global {
  interface Window {
    dryStatic: DryStaticBridge;
  }
}
