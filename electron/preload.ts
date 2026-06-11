// electron/preload.ts - CapturePlayer preload script
import { contextBridge, ipcRenderer } from 'electron';

// Expose Electron APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  isAlwaysOnTop: () => ipcRenderer.invoke('is-always-on-top'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('set-always-on-top', enabled),
  closeApp: () => ipcRenderer.invoke('close-app'),
  setAspectRatio: (ratio: number | null) => ipcRenderer.invoke('set-aspect-ratio', ratio),
  setFullscreen: (enabled: boolean) => ipcRenderer.invoke('set-fullscreen', enabled),
  beginFullscreenDrag: (cursor: { x: number; y: number }) => ipcRenderer.invoke('begin-fullscreen-drag', cursor),
  fullscreenDragMove: (cursor: { x: number; y: number }) => ipcRenderer.send('fullscreen-drag-move', cursor),
  fullscreenDragEnd: () => ipcRenderer.send('fullscreen-drag-end'),
  onFullscreenChanged: (callback: (fullscreen: boolean) => void) => {
    const listener = (_event: unknown, fullscreen: boolean) => callback(fullscreen);
    ipcRenderer.on('fullscreen-changed', listener);
    return () => {
      ipcRenderer.removeListener('fullscreen-changed', listener);
    };
  },
  debugFrameStats: (payload: unknown) => ipcRenderer.send('debug-frame-stats', payload),
  debugAudioStats: (payload: unknown) => ipcRenderer.send('debug-audio-stats', payload),
  // Opt-in vsync-off launch flag (lower input lag, needs restart)
  getDisableGpuVsync: () => ipcRenderer.invoke('get-disable-gpu-vsync'),
  setDisableGpuVsync: (enabled: boolean) => ipcRenderer.invoke('set-disable-gpu-vsync', enabled),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  // Open external links (GitHub, Ko-fi etc.)
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url)
});
