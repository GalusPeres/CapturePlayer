import { app, BrowserWindow, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { NeuralWorker, workSize } from '../electron/neuralWorker';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const root = process.cwd();
const results: unknown[] = [];
const cardLabel = process.env.CAPTUREPLAYER_TEST_DEVICE;
app.setPath('userData', path.join(root, '.local/neural-test-profile'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
if (cardLabel) app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  assert.deepEqual(workSize(3840, 2160, '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(workSize(3840, 2160, '720p'), { width: 1280, height: 720 });
  const unavailable = new NeuralWorker(path.join(root, '.local/not-a-runtime'));
  await unavailable.start({ hwnd: 1n, width: 1280, height: 720, quality: 'auto', split: false });
  assert.equal(unavailable.getStatus().phase, 'error');
  console.log('Displays:', screen.getAllDisplays().map(d => ({ size: d.size, scaleFactor: d.scaleFactor })));
  for (const spec of cardLabel ? [
    { width: 3840, height: 2160, quality: '900p' as const },
    { width: 3840, height: 2160, quality: '1080p' as const }
  ] : [
    { width: 1280, height: 720, quality: '720p' as const },
    { width: 3840, height: 2160, quality: '720p' as const },
    { width: 3840, height: 2160, quality: 'auto' as const }
  ]) {
    const worker = new NeuralWorker(path.join(root, '.local/neural-runtime'));
    const win = new BrowserWindow({ width: spec.width, height: spec.height, minWidth: spec.width, minHeight: spec.height, useContentSize: true, enableLargerThanScreen: true, thickFrame: false, frame: false, webPreferences: { backgroundThrottling: false } });
    const html = cardLabel ? `<html><body style="margin:0;background:black;overflow:hidden"><video autoplay muted style="width:100vw;height:100vh;object-fit:contain"></video></body></html>` : `<html><body style="margin:0;overflow:hidden;background:#131923"><canvas id="c"></canvas><script>
      const c=document.getElementById('c'),x=c.getContext('2d'); c.width=innerWidth; c.height=innerHeight;
      function draw(t) { const g=x.createLinearGradient(0,0,c.width,c.height);g.addColorStop(0,'#284366');g.addColorStop(1,'#dcc295');x.fillStyle=g;x.fillRect(0,0,c.width,c.height);
      for(let i=0;i<40;i++){ x.fillStyle=i%2?'#d4cfbd':'#265335'; x.fillRect((i*135+t/16)%c.width,100+i*32,80,400); }
      x.fillStyle='white';x.font='48px sans-serif';x.fillText('CapturePlayer neural GPU test '+Math.floor(t),40,70);requestAnimationFrame(draw); }requestAnimationFrame(draw);
      </script></body></html>`;
    // file:// gives the real capture probe a secure media context.
    if (cardLabel) {
      const file = path.join(root, '.local/neural-card-4k.html'); fs.writeFileSync(file, html);
      await win.loadFile(file);
      const captured = await win.webContents.executeJavaScript(`(async()=>{
        const devices=await navigator.mediaDevices.enumerateDevices();
        const d=devices.find(d=>d.kind==='videoinput' && d.label===${JSON.stringify(cardLabel)});
        if(!d)throw new Error('Capture card not found');
        const s=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:d.deviceId},width:{exact:3840},height:{exact:2160},frameRate:{exact:60}},audio:false});
        const v=document.querySelector('video');v.srcObject=s;await v.play();return s.getVideoTracks()[0].getSettings();
      })()`);
      console.log('Actual card:', captured); assert.equal(captured.width, 3840); assert.equal(captured.height, 2160); assert.equal(captured.frameRate, 60);
    } else await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    win.show();
    win.focus();
    await wait(600);
    const b = win.getContentBounds();
    const scale = screen.getDisplayMatching(b).scaleFactor;
    void worker.start({ hwnd: win.getNativeWindowHandle().readBigUInt64LE(), width: Math.round(b.width * scale), height: Math.round(b.height * scale), quality: spec.quality, split: false });
    let active = false;
    const samples = [];
    for (let second = 0; second < 18; second++) {
      await wait(1000);
      const status = worker.getStatus();
      samples.push(status);
      console.log(JSON.stringify({ spec, second, ...status }));
      if (status.phase === 'active') active = true;
      if (status.phase === 'active' && spec.width === 3840) assert.ok((status.outputWidth ?? 0) >= 3840 && (status.outputHeight ?? 0) >= 2160, 'Must really process 4K');
      if (status.phase === 'error') break;
      if (second === 6) worker.setSplit(true);
      if (second === 8) worker.setSplit(false);
    }
    results.push({ spec, active, samples });
    worker.stop();
    assert.equal(worker.getStatus().phase, 'off');
    await wait(500);
    win.destroy();
    if (!active) throw new Error('Neural rendering never became active');
  }
  fs.writeFileSync(path.join(root, cardLabel ? '.local/neural-card-4k.json' : '.local/neural-benchmark.json'), JSON.stringify(results, null, 2));
  console.log('PASS: real GPU evaluation, 4K output, A/B switching and stop. Results in .local/neural-benchmark.json');
  app.quit();
}).catch(error => {
  console.error(error);
  fs.writeFileSync(path.join(root, '.local/neural-benchmark.json'), JSON.stringify(results, null, 2));
  app.exit(1);
});
