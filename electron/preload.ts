// electron/preload.ts - CapturePlayer preload script
import { contextBridge, ipcRenderer, sharedTexture } from 'electron';

// Shared GPU frames cross worlds using the browser transfer mechanism.
sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }) => {
  const frame = importedSharedTexture.getVideoFrame();
  try { window.postMessage({ type: 'captureplayer:native-frame', frame }, '*', [frame]); }
  finally { frame.close(); importedSharedTexture.release(); }
});

// Expose Electron APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  architecture: process.arch,
  getNativeCaptureCapabilities: (options: unknown) => ipcRenderer.invoke('native-capture-capabilities', options),
  startNativeCapture: (options: unknown) => ipcRenderer.invoke('native-capture-start', options),
  stopNativeCapture: () => ipcRenderer.invoke('native-capture-stop'),
  getNativeCaptureStatus: () => ipcRenderer.invoke('native-capture-status'),
  getNeuralStatus: () => ipcRenderer.invoke('neural-status'),
  importNeuralRuntime: () => ipcRenderer.invoke('neural-import-runtime'),
  startNeural: (quality: string, split: boolean, strength = 100) => ipcRenderer.invoke('neural-start', quality, split, strength),
  stopNeural: () => ipcRenderer.invoke('neural-stop'),
  pauseNeuralForCapture: () => ipcRenderer.invoke('neural-capture-pause'),
  resumeNeuralAfterCapture: () => ipcRenderer.invoke('neural-capture-ready'),
  setNeuralSplit: (split: boolean) => ipcRenderer.invoke('neural-split', split),
  setNeuralStrength: (strength: number) => ipcRenderer.invoke('neural-strength', strength),
  setNeuralTuning: (tuning: unknown) => ipcRenderer.invoke('neural-tuning', tuning),
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
