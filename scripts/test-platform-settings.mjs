// Hidden real React DOM test. Platform/device APIs are fixtures; no camera opens.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, '.local/platform-settings-test');
await fs.mkdir(dir, { recursive: true });
await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SettingsProvider} from './src/context/SettingsContext';
import SettingsModal from './src/components/SettingsModal/SettingsModal';
const root=createRoot(document.getElementById('root'));
let hdrPossible=false,neuralQueries=0;
Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[
 {deviceId:'card',kind:'videoinput',label:'Elgato 4K X'},
 {deviceId:'audio',kind:'audioinput',label:'Capture Audio'}]});
window.electronAPI={platform:'darwin',architecture:'arm64',
 getNativeCaptureStatus:async()=>({phase:'off',available:true,message:'Off'}),
 getNativeCaptureCapabilities:async()=>({hdrInputPossible:hdrPossible,reason:hdrPossible?'Tagged HDR mode available':'No P010 on this capture driver'}),
 getNeuralStatus:async()=>{++neuralQueries;return {phase:'off',available:true,message:'Off'};},
 getDisableGpuVsync:async()=>({enabled:false,active:false}),
 getAppVersion:async()=>'0.5.0'};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const expect=(condition,message)=>{if(!condition)throw Error(message);};
function tab(name){[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.trim()===name).click();}
function mount(platform){window.electronAPI.platform=platform;
 localStorage.setItem('capturePlayerSettings',JSON.stringify({videoDevice:'card',audioDevice:'audio',captureResolution:'2560x1440',captureFrameRate:'60',nativeRenderer:true,nativeHdr:false}));
 root.render(<SettingsProvider key={platform}><SettingsModal visible running onClose={()=>{}} onToggle={()=>{}} onApplyDevices={()=>{}}/></SettingsProvider>);}
window.check=async()=>{
 for(const platform of ['darwin','linux']){
  mount(platform);await wait(150);tab('Effects');await wait(100);
  expect(!document.querySelector('[aria-label="Neural rendering"]'),'Neural section must be absent on '+platform);
  expect(!document.querySelector('[aria-label="DLSS 5 Neural Rendering"]'),'Unsupported DLSS control leaked into '+platform);
  document.querySelector('[aria-label="FSR 1 Upscaler"]').click();await wait(50);
  expect(document.querySelector('[aria-label="FSR 1 Upscaler"]').getAttribute('aria-checked')==='true','FSR cannot be enabled');
  [...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Reset').click();await wait(50);
  expect(document.querySelector('[aria-label="FSR 1 Upscaler"]').getAttribute('aria-checked')==='false','Effects Reset needs to work without a Neural form');
  hdrPossible=false;tab('Color');await wait(100);
  expect(document.querySelector('[aria-label="HDR"]').disabled,'Unsupported HDR must be disabled');
  hdrPossible=true;navigator.mediaDevices.dispatchEvent(new Event('devicechange'));await wait(100);
  expect(!document.querySelector('[aria-label="HDR"]').disabled,'Available HDR must be selectable');
  document.querySelector('[aria-label="HDR"]').click();await wait(50);
  hdrPossible=false;navigator.mediaDevices.dispatchEvent(new Event('devicechange'));await wait(100);
  expect(!document.querySelector('[aria-label="HDR"]').disabled,'HDR must remain possible to turn off after device removal');
  document.querySelector('[aria-label="HDR"]').click();await wait(50);
  expect(document.querySelector('[aria-label="HDR"]').disabled,'Unsupported HDR must not turn back on');
 }
 expect(neuralQueries===0,'Unsupported platforms must not poll the Neural worker');
 mount('win32');await wait(100);tab('Effects');await wait(100);
 expect(!!document.querySelector('[aria-label="DLSS 5 Neural Rendering"]'),'Windows Neural control disappeared');
 root.unmount();return 'PASS: macOS/Linux hide Neural, FSR and Reset work, HDR follows device capability, Windows retains Neural.';
};
` }, bundle: true, outfile: path.join(dir, 'renderer.js'), platform: 'browser', define: { 'import.meta.env.DEV': 'false' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.ico': 'dataurl' } });
await fs.writeFile(path.join(dir,'index.html'),'<div id="root"></div><script src="renderer.js"></script>');
await fs.writeFile(path.join(dir,'main.cjs'), `
const {app,BrowserWindow}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
setTimeout(()=>{console.error('Settings test timed out');app.exit(1)},20000).unref();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 await win.loadFile(path.join(__dirname,'index.html'));console.log(await win.webContents.executeJavaScript('window.check()'));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(dir, 'main.cjs')], { cwd: root, windowsHide: true, stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
