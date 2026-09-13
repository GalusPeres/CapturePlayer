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
let runtimeInstalled=false,importMode='cancel',importCalls=0;
const neuralStatus=()=>({phase:'off',available:runtimeInstalled,helpersAvailable:true,runtimeInstalled,message:'Off'});
Object.defineProperty(navigator.mediaDevices,'enumerateDevices',{value:async()=>[
 {deviceId:'card',kind:'videoinput',label:'Elgato 4K X'},
 {deviceId:'audio',kind:'audioinput',label:'Capture Audio'}]});
window.electronAPI={platform:'darwin',architecture:'arm64',
 getNativeCaptureStatus:async()=>({phase:'off',available:true,message:'Off'}),
 getNativeCaptureCapabilities:async()=>({hdrInputPossible:hdrPossible,reason:hdrPossible?'Tagged HDR mode available':'No P010 on this capture driver'}),
 getNeuralStatus:async()=>{++neuralQueries;return neuralStatus();},
 importNeuralRuntime:async()=>{++importCalls;if(importMode==='cancel')return {cancelled:true};if(importMode==='invalid')return {error:'Unsupported DLL'};runtimeInstalled=true;return {version:'310.8.0.0',status:neuralStatus()};},
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
  mount(platform);await wait(150);tab('View');await wait(100);
  const modes=document.querySelector('[aria-label="Video playback mode"]');
  expect(!!modes&&modes.textContent.includes(platform==='darwin'?'macOS':'Linux'),'System-specific video mode name missing');
  const diagnostics=document.querySelector('[aria-label="Performance diagnostics"]');
  expect(!!diagnostics,'Diagnostics hidden in production builds');diagnostics.click();await wait(50);
  expect(diagnostics.getAttribute('aria-checked')==='true','Production diagnostics switch does not persist');
  tab('Effects');await wait(100);
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
 const selectDll=()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Select DLL');
 expect(!!selectDll()&&!selectDll().disabled,'Missing runtime must expose Select DLL');
 selectDll().click();await wait(60);expect(!!selectDll()&&!document.querySelector('[role="alert"]'),'Cancelled import must leave setup available');
 importMode='invalid';selectDll().click();await wait(60);expect(document.querySelector('[role="alert"]')?.textContent==='Unsupported DLL','Import error was hidden');
 importMode='valid';selectDll().click();await wait(60);
 expect([...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Change DLL'),'Successful import did not update setup control');
 expect(!document.querySelector('[role="alert"]'),'Successful import kept stale error');
 expect(importCalls===3,'Unexpected import calls');
 return 'PASS: platform menus, HDR capability, FSR reset; DLL import cancel/error/success states.';
};
` }, bundle: true, outfile: path.join(dir, 'renderer.js'), platform: 'browser', define: { 'import.meta.env.DEV': 'false' },
  loader: { '.svg': 'dataurl', '.png': 'dataurl', '.ico': 'dataurl' } });
let stylesheet='';
if (process.argv.includes('--screenshot')) {
 const assets=await fs.readdir(path.join(root,'dist-vite/assets'));
 const css=assets.find(name=>name.endsWith('.css'));
 if(css) { await fs.copyFile(path.join(root,'dist-vite/assets',css),path.join(dir,'app.css'));stylesheet='<link rel="stylesheet" href="app.css">'; }
}
await fs.writeFile(path.join(dir,'index.html'),stylesheet+'<div id="root"></div><script src="renderer.js"></script>');
await fs.writeFile(path.join(dir,'main.cjs'), `
const {app,BrowserWindow}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
setTimeout(()=>{console.error('Settings test timed out');app.exit(1)},20000).unref();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:850,height:900,webPreferences:{backgroundThrottling:false,offscreen:${process.argv.includes('--screenshot')}}});
 await win.loadFile(path.join(__dirname,'index.html'));console.log(await win.webContents.executeJavaScript('window.check()'));
 if(${process.argv.includes('--screenshot')}) { await new Promise(r=>setTimeout(r,250));const shot=await win.webContents.capturePage();require('node:fs').writeFileSync(path.join(__dirname,'import-menu.png'),shot.toPNG()); }
 app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(dir, 'main.cjs')], { cwd: root, windowsHide: true, stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
