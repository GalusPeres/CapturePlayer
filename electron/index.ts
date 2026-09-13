// electron/index.ts - CapturePlayer main process
import { app, BrowserWindow, ipcMain, shell, screen, globalShortcut, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { createNativeCapture } from './nativeCaptureFactory';
import { NeuralWorker } from './neuralWorker';
import { NeuralRuntimeStore } from './neuralRuntime';
import type { NeuralQuality } from '../src/types/neural';
import { normalizeNeuralTuning } from '../src/types/neural';

let mainWin: BrowserWindow | null = null;
let neural: NeuralWorker | undefined;
const neuralHelperDirectory = process.env.CAPTUREPLAYER_NEURAL_RUNTIME || (app.isPackaged
  ? path.join(path.dirname(app.getPath('exe')), 'neural-runtime')
  : path.join(app.getAppPath(), '.local', 'neural-runtime'));
const neuralRuntime = new NeuralRuntimeStore(path.join(app.getPath('userData'), 'neural-runtime'));
let importingNeural = false;
const nativeCapture = createNativeCapture();
ipcMain.handle('native-capture-status', () => ({ ...nativeCapture.status, available: nativeCapture.available() }));
ipcMain.handle('native-capture-capabilities', (event, options) => {
  if (event.sender !== mainWin?.webContents || !options || typeof options.device !== 'string' || options.device.length > 250 ||
    ![options.width, options.height, options.fps].every(Number.isInteger) || options.width < 64 || options.width > 4096 ||
    options.height < 64 || options.height > 2160 || options.fps < 1 || options.fps > 120) throw new Error('Invalid capability query');
  return 'inspect' in nativeCapture ? nativeCapture.inspect(options) : { hdrInputPossible: nativeCapture.available(), reason: 'HDR10/PQ input must match the console and capture-card settings.' };
});
ipcMain.handle('native-capture-stop', () => nativeCapture.stop());
ipcMain.handle('native-capture-start', async (event, options) => {
  if (event.sender !== mainWin?.webContents || !options || typeof options.device !== 'string' || options.device.length > 250 ||
    typeof options.hdr !== 'boolean' || ![options.width, options.height, options.fps].every(Number.isInteger) ||
    options.width < 64 || options.width > 4096 || options.height < 64 || options.height > 2160 || options.fps < 1 || options.fps > 120) throw new Error('Invalid native capture options');
  pauseNeuralForCapture();
  await nativeCapture.start(options, event.sender);
});
let neuralIntent = false;
let neuralCapturePaused = false;
let neuralRestart: NodeJS.Timeout | undefined;
const neuralPreferences = { quality: 'auto' as NeuralQuality, split: false, strength: 100 };
const neuralTuningPath = path.join(app.getPath('userData'), 'neural-tuning.json');
let neuralTuning = normalizeNeuralTuning(undefined);
try { neuralTuning = normalizeNeuralTuning(JSON.parse(fs.readFileSync(neuralTuningPath, 'utf8'))); } catch { /* First launch or invalid file: use defaults. */ }
let tuningSaveTimer: NodeJS.Timeout | undefined;
function saveNeuralTuning() {
  clearTimeout(tuningSaveTimer); tuningSaveTimer = undefined;
  try {
    fs.mkdirSync(path.dirname(neuralTuningPath), { recursive: true });
    fs.writeFileSync(neuralTuningPath, JSON.stringify(neuralTuning));
  } catch (error) { console.error('Could not save neural tuning', error); }
}
app.on('before-quit', () => { if (tuningSaveTimer) saveNeuralTuning(); });
const getNeural = () => {
  neural ??= new NeuralWorker(neuralHelperDirectory, () => neuralRuntime.file);
  neural.setTuning(neuralTuning);
  return neural;
};

ipcMain.handle('neural-tuning', (event, value: unknown) => {
  if (event.sender !== mainWin?.webContents || !value || typeof value !== 'object') throw new Error('Invalid neural tuning');
  neuralTuning = normalizeNeuralTuning(value);
  getNeural().setTuning(neuralTuning);
  clearTimeout(tuningSaveTimer);
  tuningSaveTimer = setTimeout(saveNeuralTuning, 400);
  return neuralTuning;
});

ipcMain.handle('neural-status', () => getNeural().getStatus());
ipcMain.handle('neural-import-runtime', async event => {
  if (!mainWin || event.sender !== mainWin.webContents || process.platform !== 'win32') throw new Error('Unavailable');
  if (importingNeural || ['active', 'starting'].includes(getNeural().getStatus().phase))
    return { error: 'Turn Neural Rendering off before changing its DLL.' };
  importingNeural = true;
  try {
    const selected = await dialog.showOpenDialog(mainWin, {
      title: 'Select nvngx_dlssnr.dll', properties: ['openFile'],
      filters: [{ name: 'NVIDIA Neural Rendering DLL', extensions: ['dll'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return { cancelled: true };
    const result = await neuralRuntime.importFile(selected.filePaths[0]);
    stopNeural('Runtime imported. Ready to enable Neural Rendering.');
    return { ...result, status: getNeural().getStatus() };
  } catch (error) { return { error: error instanceof Error ? error.message : 'Could not import the DLL.' }; }
  finally { importingNeural = false; }
});
function stopNeural(message = 'Off') {
  neuralIntent = false;
  neuralCapturePaused = false;
  clearTimeout(neuralRestart);
  neural?.stop(message);
}
function pauseNeuralForCapture() {
  if (!neuralIntent || !neural || !['active', 'starting'].includes(neural.getStatus().phase)) return;
  neuralCapturePaused = true;
  clearTimeout(neuralRestart);
  neural.pause('Waiting for capture to restart…');
}
ipcMain.handle('neural-capture-pause', (event) => {
  if (event.sender !== mainWin?.webContents) return;
  pauseNeuralForCapture();
});
ipcMain.handle('neural-capture-ready', (event) => {
  if (event.sender !== mainWin?.webContents || !neuralCapturePaused) return;
  neuralCapturePaused = false;
  if (neuralIntent) startNeural();
});
function startNeural() {
  const win = mainWin;
  if (importingNeural || !neuralIntent || neuralCapturePaused || !win || win.isDestroyed() || win.isMinimized()) return;
  const bounds = win.getContentBounds();
  const display = screen.getDisplayMatching(bounds);
  const handle = win.getNativeWindowHandle();
  if (process.platform !== 'win32' || handle.length < 8) return;
  void getNeural().start({
    hwnd: handle.readBigUInt64LE(), width: Math.round(bounds.width * display.scaleFactor),
    height: Math.round(bounds.height * display.scaleFactor), hdr: nativeCapture.status.phase === 'active' && !!nativeCapture.status.hdr,
    vsync: !app.commandLine.hasSwitch('disable-gpu-vsync'), ...neuralPreferences
  });
}
ipcMain.handle('neural-stop', () => { stopNeural(); return getNeural().getStatus(); });
ipcMain.handle('neural-split', (_event, split: unknown) => {
  if (typeof split === 'boolean') { neuralPreferences.split = split; getNeural().setSplit(split); }
});
ipcMain.handle('neural-strength', (_event, strength: unknown) => {
  if (typeof strength === 'number' && Number.isFinite(strength)) {
    neuralPreferences.strength = Math.round(Math.min(100, Math.max(0, strength)));
    getNeural().setStrength(neuralPreferences.strength);
  }
});
ipcMain.handle('neural-start', (event, quality: unknown, split: unknown, strength: unknown = 100) => {
  const win = mainWin;
  if (!win || event.sender !== win.webContents || !['auto', '720p', '900p', '1080p', '1440p'].includes(String(quality)) || typeof split !== 'boolean' || typeof strength !== 'number' || !Number.isFinite(strength)) return getNeural().getStatus();
  Object.assign(neuralPreferences, { quality, split, strength: Math.round(Math.min(100, Math.max(0, strength))) });
  neuralIntent = true;
  clearTimeout(neuralRestart);
  startNeural();
  return getNeural().getStatus();
});

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
  const adaptNeural = () => {
    if (!neuralIntent || !neural || !['active', 'starting'].includes(neural.getStatus().phase)) return;
    clearTimeout(neuralRestart);
    neural.pause(win.isMinimized() ? 'Paused while minimized' : 'Adjusting preview size…');
    if (!win.isMinimized()) neuralRestart = setTimeout(startNeural, 350);
  };
  win.on('resize', adaptNeural);
  win.on('minimize', adaptNeural);
  win.on('restore', adaptNeural);
  let previousScale = screen.getDisplayMatching(win.getContentBounds()).scaleFactor;
  win.on('move', () => {
    const scale = screen.getDisplayMatching(win.getContentBounds()).scaleFactor;
    if (scale !== previousScale) { previousScale = scale; adaptNeural(); }
  });
  const displayChanged = () => adaptNeural();
  screen.on('display-metrics-changed', displayChanged);
  win.webContents.on('did-start-loading', () => { stopNeural(); nativeCapture.stop(); });
  win.webContents.on('render-process-gone', () => { stopNeural(); nativeCapture.stop(); });

  const URL = process.env.VITE_DEV_SERVER_URL
    ? process.env.VITE_DEV_SERVER_URL
    : `file://${path.join(__dirname, '../dist-vite/index.html')}`;

  win.loadURL(URL);

  win.once('ready-to-show', () => {
    // Default aspect ratio 16:9, can be changed later
    win.setAspectRatio(16 / 9);
    win.show();
  });

  // Native fullscreen switches instantly (no slow browser-fullscreen
  // animation); the renderer is told about changes to keep its UI in sync.
  win.on('enter-full-screen', () => win.webContents.send('fullscreen-changed', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen-changed', false));

  win.on('closed', () => {
    stopNeural(); nativeCapture.stop();
    screen.removeListener('display-metrics-changed', displayChanged);
    mainWin = null;
  });
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') await neuralRuntime.initialize(path.join(neuralHelperDirectory, 'nvngx_dlssnr.dll'));
  createMainWindow();
  globalShortcut.register('CommandOrControl+Alt+Backspace', () => stopNeural('Stopped with Ctrl+Alt+Backspace.'));
});
app.on('before-quit', () => { stopNeural(); nativeCapture.stop(); });
app.on('will-quit', () => globalShortcut.unregisterAll());

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

// IPC Handler: native fullscreen toggle. The windowed bounds are remembered
// on entering so the drag-out below can restore the exact previous size.
let lastWindowedBounds: Electron.Rectangle | null = null;

ipcMain.handle('set-fullscreen', (_event, enabled: boolean) => {
  const win = mainWin;
  if (!win) return;
  if (enabled && !win.isFullScreen()) {
    lastWindowedBounds = win.getBounds();
  }
  win.setFullScreen(!!enabled);
});

// Manual window drag: pulls the window out of fullscreen while keeping it
// under the cursor (native app-region dragging cannot start from fullscreen).
// The aspect-ratio lock is suspended for the duration and the size pinned on
// every move - otherwise Electron's ratio enforcement re-sizes the window a
// little on each position change and it visibly grows while dragging.
let dragSession: { offsetX: number; offsetY: number; width: number; height: number } | null = null;

ipcMain.handle('begin-fullscreen-drag', (_event, cursor: { x: number; y: number }) => {
  const win = mainWin;
  if (!win || !win.isFullScreen()) return;

  // Keep the cursor at the same relative horizontal position on the restored
  // window as it had on the screen (like Windows does for maximized windows).
  const fsBounds = win.getBounds();
  const grabFraction = Math.min(1, Math.max(0, (cursor.x - fsBounds.x) / Math.max(1, fsBounds.width)));

  win.once('leave-full-screen', () => {
    win.setAspectRatio(0);
    // Use the size the window had before entering fullscreen - at this point
    // Electron has not necessarily restored it yet.
    const bounds = lastWindowedBounds ?? win.getBounds();
    dragSession = {
      offsetX: Math.round(bounds.width * grabFraction),
      offsetY: 16,
      width: bounds.width,
      height: bounds.height
    };
    win.setBounds({
      x: Math.round(cursor.x - dragSession.offsetX),
      y: Math.round(cursor.y - dragSession.offsetY),
      width: dragSession.width,
      height: dragSession.height
    });
  });
  win.setFullScreen(false);
});

ipcMain.on('fullscreen-drag-move', (_event, cursor: { x: number; y: number }) => {
  if (!mainWin || !dragSession) return;
  mainWin.setBounds({
    x: Math.round(cursor.x - dragSession.offsetX),
    y: Math.round(cursor.y - dragSession.offsetY),
    width: dragSession.width,
    height: dragSession.height
  });
});

ipcMain.on('fullscreen-drag-end', () => {
  if (mainWin && dragSession) {
    mainWin.setAspectRatio(lastAspectRatio);
  }
  dragSession = null;
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
let lastAspectRatio = 0;

ipcMain.handle('set-aspect-ratio', (_event, ratio: number | null) => {
  lastAspectRatio = ratio || 0;
  if (mainWin) {
    // While a manual drag runs, the ratio lock stays suspended; it is
    // restored from lastAspectRatio when the drag ends.
    if (!dragSession) {
      mainWin.setAspectRatio(lastAspectRatio);
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
