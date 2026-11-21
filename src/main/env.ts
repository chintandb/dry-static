import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read PRESAGE_API_KEY from the environment, else from <root>/.env.
 * The value is never logged, stored, or returned anywhere except to the SDK.
 */
export function loadApiKey(rootDir: string): string | null {
  const fromEnv = process.env.PRESAGE_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  const file = join(rootDir, '.env');
  if (!existsSync(file)) return null;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== 'PRESAGE_API_KEY') continue;
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    return value || null;
  }
  return null;
}
