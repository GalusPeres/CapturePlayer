import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
process.env.CAPTUREPLAYER_NEURAL_RUNTIME = path.join(root, '.local/neural-runtime');
app.setPath('userData', path.join(root, '.local/neural-app-test-profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream', 'fps=60');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  await import('../electron/index');
  await app.whenReady();
  await wait(2000);
  const win = BrowserWindow.getAllWindows()[0];
  // Keep physical input from changing scripted assertions during this test.
  win.setIgnoreMouseEvents(true);
  win.webContents.on('before-input-event', event => event.preventDefault());
  win.webContents.on('console-message', details => console.log('Renderer:', details.message));
  win.show(); win.focus();
  const js = async (code: string) => {
    console.log('Step:', code.slice(0, 90));
    return win.webContents.executeJavaScript(code);
  };
  const waitActive = async () => {
    await wait(600);
    for (let i = 0; i < 40; i++) {
      const status = await js(`window.electronAPI.getNeuralStatus()`);
      if (status.phase === 'active') return;
      if (status.phase === 'error') throw new Error(status.message);
      await wait(200);
    }
    throw new Error('Preview did not resume');
  };
  console.log('Page:', win.webContents.getURL());
  const setup = await js(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({video:true});
    const deviceId = stream.getVideoTracks()[0].getSettings().deviceId;
    stream.getTracks().forEach(t=>t.stop());
    localStorage.setItem('capturePlayerSettings', JSON.stringify({videoDevice:deviceId,audioDevice:'',autostartWithDevices:true,captureResolution:'1920x1080',captureFrameRate:'60'}));
    return deviceId;
  })()`);
  assert.ok(setup);
  win.reload(); await wait(3000);
  await js(`document.querySelector('[aria-label="Open Settings"]').click()`);
  await wait(500);
  await js(`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='View').click()`);
  await wait(1500);
  assert.equal(await js(`document.querySelector('[aria-label="DLSS 5 Neural Rendering"]').disabled`), false);
  await js(`document.querySelector('[aria-label="DLSS 5 Neural Rendering"]').click()`);
  await wait(6000);
  const active = await js(`window.electronAPI.getNeuralStatus()`);
  console.log('Application switch:', active);
  assert.equal(active.phase, 'active');
  const other = new BrowserWindow({ width: 400, height: 250, x: 1500, y: 40 });
  await other.loadURL('data:text/html,<body>Focus test</body>');
  other.show(); other.focus();
  await wait(2200);
  assert.equal(win.isFocused(), false);
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).phase, 'active', 'Focus loss keeps NR active');
  other.destroy(); win.focus();
  await js(`(() => { const slider = document.querySelector('[aria-label="Effect strength"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '45'); slider.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await wait(300);
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).strength, 45);
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(root, '.local/neural-settings.png'), shot.toPNG());
  await js(`document.querySelector('[aria-label="DLSS 5 Neural Rendering"]').click()`);
  await wait(500);
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).phase, 'off');
  // Resize/fullscreen rebuild safely and preserve user settings.
  await js(`document.querySelector('[aria-label="DLSS 5 Neural Rendering"]').click()`);
  await wait(4000);
  win.setSize(1000, 700);
  await waitActive();
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).phase, 'active');
  win.setFullScreen(true); await waitActive();
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).phase, 'active');
  win.setFullScreen(false); await waitActive();
  win.minimize(); await wait(700);
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).message, 'Paused while minimized');
  win.restore(); await waitActive();
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).phase, 'active');
  await js(`document.querySelector('[aria-label="AI processing resolution"]').click()`);
  await js(`[...document.querySelectorAll('[data-neural-controls] li')].find(e=>e.textContent==='900p · balanced').click()`);
  await waitActive();
  const changed = await js(`window.electronAPI.getNeuralStatus()`);
  assert.equal(changed.phase, 'active'); assert.equal(changed.selectedQuality, '900p'); assert.equal(changed.strength, 45);
  win.setSize(1100, 700);
  await js(`window.electronAPI.stopNeural()`);
  await wait(1200);
  assert.equal((await js(`window.electronAPI.getNeuralStatus()`)).phase, 'off', 'Manual stop cancels resize restart');
  console.log('PASS: capture, toggle, focus, strength slider, resize, fullscreen, minimize/restore, live quality, stop race');
  app.quit();
}
run().catch(error => { console.error(error); app.exit(1); });
