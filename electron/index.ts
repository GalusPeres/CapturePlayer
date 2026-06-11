// electron/index.ts - CapturePlayer main process
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';

let mainWin: BrowserWindow | null = null;

// Launch settings live in their own file because command-line switches must be
// applied before the app is ready - long before the renderer (localStorage) exists.
const launchSettingsPath = path.join(app.getPath('userData'), 'launch-settings.json');

type LaunchSettings = { disableGpuVsync?: boolean };

function readLaunchSettings(): LaunchSettings {
  try {
    return JSON.parse(fs.readFileSync(launchSettingsPath, 'utf8')) as LaunchSettings;
  } catch {
    return {};
  }
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Keep capture frames in GPU memory (zero-copy) on their way to the renderer.
app.commandLine.appendSwitch('video-capture-use-gpu-memory-buffer');

// Opt-in (View tab): present frames without waiting for vsync. Measured
// 2026-06-10: saves ~2 frames of input lag on 60 Hz displays. Best together
// with VRR (G-Sync/FreeSync); on fixed-refresh displays it can cause tearing,
// which is why it is off by default. Takes effect on app restart.
if (readLaunchSettings().disableGpuVsync) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 800,
    minHeight: 450,
    frame: false,
    backgroundColor: '#000000',
    icon: path.join(__dirname, '../src/assets/icons/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
      nodeIntegration: false
    }
  });

  mainWin = win;

  const URL = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : `file://${path.join(__dirname, '../dist-vite/index.html')}`;

  win.loadURL(URL);

  win.once('ready-to-show', () => {
    // Default aspect ratio 16:9, can be changed later
    win.setAspectRatio(16 / 9);
    win.show();
  });

  win.on('closed', () => {
    mainWin = null;
  });
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handler: Check if window exists and is always on top
ipcMain.handle('is-always-on-top', () => {
  return mainWin ? mainWin.isAlwaysOnTop() : false;
});

// IPC Handler: Set always on top to an explicit state.
ipcMain.handle('set-always-on-top', (_event, enabled: boolean) => {
  if (!mainWin) return false;
  mainWin.setAlwaysOnTop(enabled);
  return mainWin.isAlwaysOnTop();
});

// IPC Handler: Close application
ipcMain.handle('close-app', () => {
  app.quit();
});

ipcMain.on('debug-frame-stats', (_event, payload: unknown) => {
  if (!app.isPackaged) {
    console.log('[frame-stats]', JSON.stringify(payload));
  }
});

ipcMain.on('debug-audio-stats', (_event, payload: unknown) => {
  if (!app.isPackaged) {
    console.log('[audio-stats]', JSON.stringify(payload));
  }
});

// IPC Handler: Set window aspect ratio
ipcMain.handle('set-aspect-ratio', (_event, ratio: number | null) => {
  if (mainWin) {
    if (ratio) {
      mainWin.setAspectRatio(ratio);
    } else {
      // "0" or "null" = no fixed aspect ratio
      mainWin.setAspectRatio(0);
    }
  }
});

// IPC Handlers: opt-in vsync-off launch flag (View tab). 'enabled' is the saved
// preference, 'active' what this running instance was actually started with.
ipcMain.handle('get-disable-gpu-vsync', () => ({
  enabled: !!readLaunchSettings().disableGpuVsync,
  active: app.commandLine.hasSwitch('disable-gpu-vsync')
}));

ipcMain.handle('set-disable-gpu-vsync', (_event, enabled: boolean) => {
  try {
    const next: LaunchSettings = { ...readLaunchSettings(), disableGpuVsync: !!enabled };
    fs.writeFileSync(launchSettingsPath, JSON.stringify(next, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save launch settings:', error);
    return false;
  }
});

ipcMain.handle('relaunch-app', () => {
  // In dev the app is tied to the Vite dev server, which dies together with
  // this process - a relaunch would come up against a dead server (black
  // window). Only self-relaunch in the packaged app.
  if (!app.isPackaged) return false;
  app.relaunch();
  app.exit(0);
  return true;
});

// IPC Handler: Open external URLs in default browser
ipcMain.handle('open-external', async (_event, url: string) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Failed to open external URL:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
});
