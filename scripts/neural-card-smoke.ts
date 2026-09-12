// Optional local hardware check. Uses only an explicitly named capture device.
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = process.cwd();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
app.setPath('userData', path.join(root, '.local/neural-card-profile'));
process.env.CAPTUREPLAYER_NEURAL_RUNTIME = path.join(root, '.local/neural-runtime');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
async function run() {
  await import('../electron/index');
  await app.whenReady(); await wait(2000);
  const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus();
  const js = (code: string) => win.webContents.executeJavaScript(code);
  const devices = await js(`navigator.mediaDevices.enumerateDevices().then(ds=>ds.filter(d=>d.kind==='videoinput').map(d=>({id:d.deviceId,label:d.label})))`);
  console.log('Video devices:', devices);
  const label = process.env.CAPTUREPLAYER_TEST_DEVICE;
  if (!label) { app.quit(); return; }
  const device = devices.find((d: { label: string }) => d.label === label);
  assert.ok(device, 'Exact capture device label must exist');
  const probe = await js(`(async()=>{
    const s=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:${JSON.stringify(device.id)}},width:{exact:3840},height:{exact:2160},frameRate:{exact:60}},audio:false});
    const settings=s.getVideoTracks()[0].getSettings();s.getTracks().forEach(t=>t.stop());return settings;
  })()`);
  console.log('4K60 device negotiation:', probe);
  await wait(700);
  await js(`localStorage.setItem('capturePlayerSettings',JSON.stringify({videoDevice:${JSON.stringify(device.id)},audioDevice:'',autostartWithDevices:true,captureResolution:'3840x2160',captureFrameRate:'60'}))`);
  win.reload(); await wait(5000);
  win.setFullScreen(true); await wait(1500);
  const card = await js(`(async()=>{
    const v=document.querySelector('video');if(!v||!v.srcObject)throw new Error('Missing capture video');
    const settings=v.srcObject.getVideoTracks()[0].getSettings();
    window.cardSamples=[];let previous;
    const observe=(now,meta)=>{if(previous!==undefined)window.cardSamples.push(now-previous);previous=now;v.requestVideoFrameCallback(observe)};v.requestVideoFrameCallback(observe);
    return {settings,width:v.videoWidth,height:v.videoHeight};
  })()`);
  assert.equal(card.width, 3840); assert.equal(card.height, 2160);
  await wait(5000);
  const samples: unknown[] = [];
  const quality = process.env.CAPTUREPLAYER_TEST_QUALITY || '900p';
  assert.ok(['720p', '900p', '1080p'].includes(quality));
  await js(`window.electronAPI.startNeural(${JSON.stringify(quality)},false,60)`);
  for (let i = 0; i < 12; i++) { await wait(1000); samples.push(await js(`window.electronAPI.getNeuralStatus()`)); }
  const status = await js(`window.electronAPI.getNeuralStatus()`); assert.equal(status.phase, 'active');
  const cadence = await js(`(()=>{const a=window.cardSamples.slice(60);return {frames:a.length,meanGap:a.reduce((s,n)=>s+n,0)/a.length,maxGap:Math.max(...a),over35ms:a.filter(n=>n>35).length}})()`);
  const tag = process.env.CAPTUREPLAYER_WAITABLE_PRESENT === '0' ? 'unbounded' : 'bounded';
  fs.writeFileSync(path.join(root, `.local/neural-card-${quality}-${tag}.json`), JSON.stringify({ device: device.label, probe, card, samples, cadence }, null, 2));
  fs.writeFileSync(path.join(root, '.local/neural-card.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS: actual card 4K60 negotiation and live app neural processing', { card, cadence, status });
  app.quit();
}
run().catch(e=>{console.error(e);app.exit(1)});
