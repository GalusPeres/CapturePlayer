// electron/preload.ts - CapturePlayer preload script
import { contextBridge, ipcRenderer } from 'electron';

// Expose Electron APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  isAlwaysOnTop: () => ipcRenderer.invoke('is-always-on-top'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  setAspectRatio: (ratio: number | null) => ipcRenderer.invoke('set-aspect-ratio', ratio),
  debugFrameStats: (payload: unknown) => ipcRenderer.send('debug-frame-stats', payload),
  debugAudioStats: (payload: unknown) => ipcRenderer.send('debug-audio-stats', payload),
  // Open external links (GitHub, Ko-fi etc.)
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url)
});
