// electron/index.ts - CapturePlayer main process
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';

let mainWin: BrowserWindow | null = null;

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
      hardwareAcceleration: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
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

// Performance optimization flags
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('enable-hardware-overlays');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-checker-imaging');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('max-active-webgl-contexts', '16');

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

// IPC Handler: Toggle always on top state
ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWin) return false;
  const now = !mainWin.isAlwaysOnTop();
  mainWin.setAlwaysOnTop(now);
  return now;
});

// IPC Handler: Close application
ipcMain.handle('close-app', () => {
  app.quit();
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

