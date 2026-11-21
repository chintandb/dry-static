import { app, BrowserWindow, dialog, ipcMain, session as electronSession } from 'electron';
import { bindSmartSpectraIpc } from '@smartspectra/node-sdk/main';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SessionResult } from '../core/session.js';
import { loadApiKey } from './env.js';
import { createStorage } from './storage.js';

const APP_ROOT = resolve(__dirname, '..');
// `electron . --replay` uses the bundled recording; `--replay=path` or `--replay path` can
// point somewhere else (handy when reviewing a fresh recording).
const replayIndex = process.argv.findIndex((a) => a === '--replay' || a.startsWith('--replay='));
const isReplay = replayIndex >= 0;
const replayPathFromArgs = isReplay
  ? process.argv[replayIndex].includes('=')
    ? process.argv[replayIndex].split('=')[1]
    : process.argv[replayIndex + 1] && !process.argv[replayIndex + 1].startsWith('-')
      ? process.argv[replayIndex + 1]
      : undefined
  : undefined;

let win: BrowserWindow | null = null;
let storage = createStorage(join(app.getPath('userData'), 'data'));

const replayDefault = join(APP_ROOT, 'recordings', 'demo-1.jsonl');

/**
 * Camera only: a 'media' request from our own bundled page whose media types, when listed,
 * are video alone. Any microphone ('audio') request is denied.
 */
function isCameraOnlyRequest(permission: string, details: unknown, fallbackUrl: string): boolean {
  if (permission !== 'media') return false;
  const d = (details ?? {}) as { requestingUrl?: string; mediaTypes?: string[] };
  const url = d.requestingUrl || fallbackUrl;
  if (!url.startsWith('file://')) return false;
  if (d.mediaTypes !== undefined && !d.mediaTypes.every((t) => t === 'video')) return false;
  return true;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0d1216',
    title: 'DRY STATIC',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // A covered or hidden window must keep its timers running: phases, holds and replay
      // pacing are time-based and Chromium would otherwise throttle them to about 1 Hz.
      backgroundThrottling: false,
    },
  });
  bindSmartSpectraIpc(win);
  // The window only ever shows the bundled local page: no pop-ups, no navigation away.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  void win.loadFile(join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  storage = createStorage(join(app.getPath('userData'), 'data'));

  // Grant only the camera, and only to our own bundled page. Microphone requests are denied.
  electronSession.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(isCameraOnlyRequest(permission, details, contents?.getURL() ?? ''));
  });

  const replayPath = (): string | null => {
    if (replayPathFromArgs) return resolve(replayPathFromArgs);
    return isReplay ? replayDefault : null;
  };

  ipcMain.handle('apiKey', () => loadApiKey(APP_ROOT));
  ipcMain.handle('replayPath', () => replayPath());
  // The renderer may read exactly one file: the replay recording chosen on the command line.
  ipcMain.handle('readFile', (_e, path: string) => {
    const allowed = replayPath();
    if (!allowed || resolve(path) !== allowed) throw new Error('read not allowed');
    return readFileSync(allowed, 'utf8');
  });
  ipcMain.handle('saveSession', (_e, r: SessionResult) => storage.saveSession(r));
  ipcMain.handle('listSessions', () => storage.listSessions());
  ipcMain.handle('appendRecording', (_e, id: string, line: string) => storage.appendRecording(id, line));
  ipcMain.handle('addUsage', (_e, seconds: number) => storage.addUsage(seconds));
  ipcMain.handle('usageSeconds', () => storage.usageSeconds());
  ipcMain.handle('deleteAll', () => storage.deleteAll());
  ipcMain.handle('dataDir', () => storage.dataDir);
  ipcMain.handle('exportFile', async (_e, defaultName: string, data: string | Uint8Array) => {
    if (!win) return false;
    const result = await dialog.showSaveDialog(win, { defaultPath: join(app.getPath('downloads'), defaultName) });
    if (result.canceled || !result.filePath) return false;
    writeFileSync(result.filePath, typeof data === 'string' ? data : Buffer.from(data));
    return true;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
