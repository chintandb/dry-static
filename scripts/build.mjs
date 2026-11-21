/**
 * Build the three bundles the app needs, then copy the static shell.
 *
 * main      -> dist/main.cjs      (node, cjs; electron + the native SDK stay external)
 * preload   -> dist/preload.cjs   (node, cjs; the SDK preload is inlined so sandbox: true works)
 * renderer  -> dist/renderer.js   (browser, esm)
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });

const shared = { bundle: true, sourcemap: true, logLevel: 'info', target: 'node20' };

await build({
  ...shared,
  entryPoints: [join(root, 'src/main/main.ts')],
  outfile: join(dist, 'main.cjs'),
  platform: 'node',
  format: 'cjs',
  external: ['electron', '@smartspectra/node-sdk', '@smartspectra/node-sdk/*'],
});

// The SDK preload is inlined so the window can keep `sandbox: true`. On a machine where the
// native package is not installed yet (CI, a fresh clone before `npm install`), fall back to
// an external require and say so instead of failing the whole build.
const sdkInstalled = (() => {
  try {
    return Boolean(import.meta.resolve('@smartspectra/node-sdk/preload'));
  } catch {
    return false;
  }
})();
if (!sdkInstalled) {
  console.warn('warning: @smartspectra/node-sdk is not installed; the preload will require it at runtime.');
}

await build({
  ...shared,
  entryPoints: [join(root, 'src/preload/preload.ts')],
  outfile: join(dist, 'preload.cjs'),
  platform: 'node',
  format: 'cjs',
  external: sdkInstalled ? ['electron'] : ['electron', '@smartspectra/node-sdk/preload'],
});

await build({
  ...shared,
  target: 'chrome120',
  entryPoints: [join(root, 'src/renderer/main.ts')],
  outfile: join(dist, 'renderer.js'),
  platform: 'browser',
  format: 'esm',
  // The sandboxed renderer cannot resolve bare module specifiers, so the SDK's renderer
  // and messages entry points (both browser-safe) must be bundled in, not left external.
  external: sdkInstalled ? [] : ['@smartspectra/node-sdk', '@smartspectra/node-sdk/*'],
});

copyFileSync(join(root, 'src/renderer/index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'src/renderer/styles.css'), join(dist, 'styles.css'));
console.log('built dist/');
