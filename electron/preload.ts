// electron/preload.ts - CapturePlayer preload script
import { contextBridge, ipcRenderer, desktopCapturer, screen } from 'electron';

// Expose Electron APIs to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  isAlwaysOnTop:     () => ipcRenderer.invoke('is-always-on-top'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  closeApp:          () => ipcRenderer.invoke('close-app'),
  setAspectRatio:    (ratio: number | null) => ipcRenderer.invoke('set-aspect-ratio', ratio),
  // Open external links (GitHub, Ko-fi etc.)
  openExternal:      (url: string) => ipcRenderer.invoke('open-external', url),
  
  // Screen capture with thumbnails converted to base64
  getScreenSources: async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null
    }));
  },
  getDisplayInfo: () => screen.getAllDisplays(),
});