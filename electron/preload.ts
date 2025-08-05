// electron/preload.ts - CapturePlayer preload script
import { contextBridge, ipcRenderer } from 'electron';

// Expose Electron APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  isAlwaysOnTop:     () => ipcRenderer.invoke('is-always-on-top'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  closeApp:          () => ipcRenderer.invoke('close-app'),
  setAspectRatio:    (ratio: number | null) => ipcRenderer.invoke('set-aspect-ratio', ratio),
  // Open external links (GitHub, Ko-fi etc.)
  openExternal:      (url: string) => ipcRenderer.invoke('open-external', url),
});