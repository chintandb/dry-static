/**
 * npm 11 can skip dependency install scripts, which leaves Electron without its binary.
 * Run Electron's own installer once if the binary is missing, so `npm start` and
 * `npm run replay` work straight after `npm install`.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const electronDir = dirname(require.resolve('electron/package.json'));

if (!existsSync(join(electronDir, 'path.txt'))) {
  console.log('Electron binary missing; downloading it once...');
  const r = spawnSync(process.execPath, [join(electronDir, 'install.js')], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('Could not download Electron. Run: node node_modules/electron/install.js');
    process.exit(r.status ?? 1);
  }
}
