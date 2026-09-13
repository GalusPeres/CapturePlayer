// Hidden Electron integration test. --obs additionally reads the running OBS
// Virtual Camera, never opens a hardware card or changes OBS configuration.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, '.local/capture-compatibility-test');
const liveObs = process.argv.includes('--obs');
await fs.mkdir(dir, { recursive: true });
await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SettingsProvider} from './src/context/SettingsContext';
import {useCaptureStream} from './src/hooks/useCaptureStream';
import {useSettings} from './src/context/SettingsContext';
import NativeVideo from './src/components/NativeVideo';
import {getCompatibilityTrack} from './src/hooks/nativeVideoStream';
let capture, settings, starts=0, stops=0, gumCalls=[], nativeFails=false;
const realGum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
const realEnumerate=navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
const root=createRoot(document.getElementById('root'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const expect=(condition,message)=>{if(!condition)throw Error(message)};
window.electronAPI={platform:'win32',stopNativeCapture:async()=>{++stops},
 startNativeCapture:async()=>{++starts;if(nativeFails)throw Error('Requested native NV12/P010 capture mode unavailable on this device.') }};
let sourceCanvas=document.createElement('canvas');sourceCanvas.width=640;sourceCanvas.height=360;
const ctx=sourceCanvas.getContext('2d');let timer=setInterval(()=>{ctx.fillStyle='#228844';ctx.fillRect(0,0,640,360)},16);
let audioContexts=0;
// No actual audio output in this test; only verify audio graph lifetime.
window.AudioContext=class {state='running';destination={};constructor(){++audioContexts}
 createMediaStreamSource(){return {connect(){},disconnect(){}}}createGain(){return {gain:{value:0},connect(){},disconnect(){}}}
 async resume(){}async close(){this.state='closed'} };
let label='Test NV12 Capture';
Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{configurable:true,value:async()=>[{deviceId:'card',kind:'videoinput',label}]});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async options=>{
 gumCalls.push(options);
 if(options.video)return sourceCanvas.captureStream(60);
 if(options.audio)return new MediaStream([new MediaStreamTrackGenerator({kind:'audio'})]);
 throw Error('Empty constraints');
}});
function Harness(){capture=useCaptureStream();settings=useSettings();return capture.stream?
 <NativeVideo stream={capture.stream} hdr={settings.nativeHdr&&!getCompatibilityTrack(capture.stream)} zoom={100}
 filters={{upscaler:true,upscaleSharpness:0.5}}/>:null;}
window.check=async()=>{
 localStorage.setItem('capturePlayerSettings',JSON.stringify({nativeRenderer:true,nativeHdr:false,videoDevice:'card',audioDevice:'',captureResolution:'640x360',captureFrameRate:'60'}));
 root.render(<SettingsProvider><Harness/></SettingsProvider>);await wait(100);
 await capture.start();await wait(50);
 expect(capture.stream.getVideoTracks().length===1,'Native video-only start lost its video track');
 expect(gumCalls.length===0&&audioContexts===0,'No audio must not request a microphone or open AudioContext');
 const originalTrack=capture.stream.getVideoTracks()[0], originalStream=capture.stream, initialStarts=starts, initialStops=stops;
 await capture.changeAudio('audio');await wait(50);
 expect(capture.stream.getAudioTracks().length===1,'Audio could not be attached');
 await capture.changeAudio('');await wait(50);
 expect(capture.stream.getAudioTracks().length===0,'No audio did not release its track');
 expect(capture.stream.getVideoTracks()[0]===originalTrack&&originalTrack.readyState==='live','Audio change replaced/stopped video');
 expect(capture.stream===originalStream,'Audio change replaced the MediaStream and restarted the browser renderer');
 expect(starts===initialStarts&&stops===initialStops,'Audio change reopened native capture');
 capture.stop();await wait(100);
 nativeFails=true;await capture.start();await wait(1200);
 expect(!!getCompatibilityTrack(capture.stream),'Unsupported native format did not select compatibility capture');
 expect(Number(document.querySelector('canvas')?.dataset.nativeFrames)>5,'Compatibility frames did not reach NativeVideo');
 expect(document.querySelector('canvas').dataset.captureTransport==='compatibility','Wrong renderer transport');
 expect(document.querySelector('canvas').dataset.upscaler==='fsr1','FSR did not process compatibility video');
 expect(!document.querySelector('[role=alert]'),'Compatibility renderer reported an error');
 capture.stop();await wait(100);
 label='OBS Virtual Camera';nativeFails=false;const beforeObs=starts;
 await capture.start();await wait(100);
 expect(starts===beforeObs&&!!getCompatibilityTrack(capture.stream),'OBS attempted the incompatible native capture API');
 expect(capture.stream.getAudioTracks().length===0,'OBS requested audio despite No audio device');
 capture.stop();await wait(100);
 // Real HDR failures must stay visible, never silently pass through SDR.
 label='Test HDR Capture';nativeFails=true;settings.setNativeHdr(true);await wait(50);
 const beforeHdr=gumCalls.length;let rejected=false;
 try{await capture.start()}catch{rejected=true}
 expect(rejected&&gumCalls.length===beforeHdr,'Failed hardware HDR silently fell back to SDR');
 settings.setNativeHdr(false);await wait(50);
 if(${liveObs}) {
   Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:realEnumerate});
   Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:realGum});
   const devices=await realEnumerate();const obs=devices.find(d=>d.kind==='videoinput'&&/obs.*virtual|obs-camera/i.test(d.label));
   if(!obs)throw Error('Live OBS Virtual Camera not found: '+devices.filter(d=>d.kind==='videoinput').map(d=>d.label).join(', '));
   settings.setCaptureResolution('auto');await wait(50);
   await capture.start({videoDevice:obs.deviceId,audioDevice:''});await wait(3000);
   const canvas=document.querySelector('canvas');
   expect(Number(canvas?.dataset.nativeFrames)>20,'Live OBS did not deliver enough frames: '+document.querySelector('[role=alert]')?.textContent);
   expect(canvas.dataset.nativeRenderer==='sdr','Live OBS test must use HDR off');
   expect(capture.stream.getAudioTracks().length===0,'Live OBS video-only capture opened audio');
   console.log('LIVE_OBS='+JSON.stringify({frames:canvas.dataset.nativeFrames,width:canvas.dataset.sourceWidth,height:canvas.dataset.sourceHeight,transport:canvas.dataset.captureTransport,fsr:canvas.dataset.upscaler}));
   capture.stop();await wait(100);
 }
 clearInterval(timer);root.unmount();
 return 'PASS: Native video without audio; audio-only changes retain video; format fallback draws with FSR; OBS uses compatibility capture with HDR off; HDR failures remain explicit.';
};
` }, bundle: true, loader: { '.h': 'text' }, outfile: path.join(dir, 'renderer.js'), platform: 'browser', define: { 'import.meta.env.DEV': 'false', 'process.env.NODE_ENV': '"production"' } });
await fs.writeFile(path.join(dir,'index.html'),'<style>html,body,#root{margin:0;width:1280px;height:720px}canvas{width:100%;height:100%}</style><div id="root"></div><script src="renderer.js"></script>');
await fs.writeFile(path.join(dir,'main.cjs'), `
const {app,BrowserWindow,session}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
setTimeout(()=>{console.error('Capture compatibility test timed out');app.exit(1)},30000).unref();
app.whenReady().then(async()=>{
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(true));
 session.defaultSession.setPermissionCheckHandler(()=>true);
 const win=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',event=>{if(event.message.startsWith('LIVE_OBS='))console.log(event.message)});
 await win.loadFile(path.join(__dirname,'index.html'));
 console.log(await win.webContents.executeJavaScript('window.check()'));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(dir, 'main.cjs')], { cwd: root, windowsHide: true, stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
