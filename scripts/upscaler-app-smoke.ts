import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
app.setPath('userData',path.join(process.cwd(),'.local/upscaler-app-profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream','fps=60');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
async function run(){
  await import('../electron/index');await app.whenReady();await wait(1500);
  const win=BrowserWindow.getAllWindows()[0];win.show();win.setIgnoreMouseEvents(true);
  const errors:string[]=[];
  win.webContents.on('console-message',details=>{if(/failed|falling back|context lost/i.test(details.message))errors.push(details.message)});
  const js=(code:string)=>win.webContents.executeJavaScript(code);
  await js(`(async()=>{const s=await navigator.mediaDevices.getUserMedia({video:true});const d=s.getVideoTracks()[0].getSettings().deviceId;s.getTracks().forEach(t=>t.stop());localStorage.setItem('capturePlayerSettings',JSON.stringify({videoDevice:d,audioDevice:'',captureResolution:'1280x720',captureFrameRate:'60',autostartWithDevices:false,spatialUpscaler:true,lowLatencyRenderer:true,upscalerSharpness:20}));})()`);
  win.reload();await wait(1500);
  await js(`(()=>{
    window.testFrames=0;window.testTracks=[];
    const Original=window.MediaStreamTrackProcessor;
    window.MediaStreamTrackProcessor=new Proxy(Original,{construct(target,args){
      window.testTracks.push(args[0].track);const processor=new target(...args);
      const getReader=processor.readable.getReader.bind(processor.readable);
      processor.readable.getReader=()=>{const reader=getReader();const read=reader.read.bind(reader);reader.read=async()=>{const result=await read();if(result.value)window.testFrames++;return result};return reader};return processor;
    }});
    document.querySelector('[aria-label="Start Capture"]').click();
  })()`);
  const moving=async()=>{
    await wait(800);const before=await js('window.testFrames');await wait(500);
    const result=await js(`({frames:window.testFrames,live:window.testTracks.at(-1)?.readyState,canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height}))})`);
    assert.ok(result.frames>before+10,JSON.stringify(result));assert.equal(result.live,'live');return result;
  };
  console.log('Initial',await moving());
  win.setFullScreen(true);console.log('Fullscreen',await moving());
  assert.equal(await js(`document.querySelector('canvas').height`),1440);
  win.setFullScreen(false);await wait(400);win.setSize(900,600);console.log('Resized',await moving());
  await js(`document.querySelector('[aria-label="Open Settings"]').click()`);await wait(300);
  await js(`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='View').click()`);await wait(300);
  await js(`document.querySelector('[aria-label="FSR 1 upscaler"]').scrollIntoView({block:'center'})`);
  fs.writeFileSync('.local/upscaler-settings.png',(await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('[aria-label="FSR 1 upscaler"]').click()`);console.log('Off',await moving());
  assert.equal(await js(`document.querySelector('canvas').width`),1280);
  await js(`document.querySelector('[aria-label="FSR 1 upscaler"]').click()`);console.log('On again',await moving());
  await js(`(()=>{const s=document.querySelector('#upscale-sharpness');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'70');s.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await wait(400);
  assert.equal(await js(`document.querySelector('#upscale-sharpness').value`),'70');
  assert.deepEqual(errors,[]);
  console.log('PASS: FSR shader, live frames, resize, fullscreen, toggle, sharpness; capture track remains live');
  app.quit();
}
run().catch(e=>{console.error(e);app.exit(1)});
