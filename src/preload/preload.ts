import { contextBridge, ipcRenderer } from 'electron';
// Binds the SDK's own IPC channels (camera, metrics) into this window.
import '@smartspectra/node-sdk/preload';

const bridge = {
  apiKey: (): Promise<string | null> => ipcRenderer.invoke('apiKey'),
  replayPath: (): Promise<string | null> => ipcRenderer.invoke('replayPath'),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('readFile', path),
  saveSession: (r: unknown): Promise<void> => ipcRenderer.invoke('saveSession', r),
  listSessions: (): Promise<unknown[]> => ipcRenderer.invoke('listSessions'),
  appendRecording: (id: string, line: string): Promise<void> => ipcRenderer.invoke('appendRecording', id, line),
  addUsage: (seconds: number): Promise<void> => ipcRenderer.invoke('addUsage', seconds),
  usageSeconds: (): Promise<number> => ipcRenderer.invoke('usageSeconds'),
  deleteAll: (): Promise<void> => ipcRenderer.invoke('deleteAll'),
  dataDir: (): Promise<string> => ipcRenderer.invoke('dataDir'),
  exportFile: (defaultName: string, data: string | Uint8Array): Promise<boolean> =>
    ipcRenderer.invoke('exportFile', defaultName, data),
};

contextBridge.exposeInMainWorld('dryStatic', bridge);
