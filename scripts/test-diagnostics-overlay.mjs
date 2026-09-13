import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..'),dir=path.join(root,'.local/diagnostics-test');
await fs.mkdir(dir,{recursive:true});
await build({stdin:{resolveDir:root,loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {SettingsProvider,useSettings} from './src/context/SettingsContext';
import VideoCanvas from './src/components/VideoCanvas';
import {markCompatibilityStream} from './src/hooks/nativeVideoStream';
const root=createRoot(document.getElementById('root')),wait=ms=>new Promise(r=>setTimeout(r,ms));
const expect=(x,m)=>{if(!x)throw Error(m)};
window.electronAPI={platform:'darwin',debugFrameStats(){}};
let settings,stream;function Harness(){settings=useSettings();return <VideoCanvas stream={stream} running/>}
window.check=async()=>{
 const source=document.createElement('canvas');source.width=640;source.height=360;const ctx=source.getContext('2d');
 let t=0;const timer=setInterval(()=>{ctx.fillStyle='#153747';ctx.fillRect(0,0,640,360);ctx.fillStyle='#67bbcc';ctx.fillRect(++t%640,100,50,50)},16);
 let referenceLabels,referenceStyle;const reports=[];
 for(const mode of ['standard','webgl','native']){
  root.render(null);await wait(50);
  stream=source.captureStream(60);if(mode==='native')markCompatibilityStream(stream);
  localStorage.setItem('capturePlayerSettings',JSON.stringify({nativeRenderer:mode==='native',lowLatencyRenderer:mode==='webgl',nativeHdr:false,spatialUpscaler:false,showDiagnosticsOverlay:true,videoDevice:'fixture'}));
  root.render(<SettingsProvider key={mode}><Harness/></SettingsProvider>);await wait(2300);
  const panel=document.querySelector('[data-diagnostics-overlay]');expect(panel?.dataset.mode===mode,'Missing production overlay for '+mode+'; actual='+panel?.dataset.mode+'; processor='+typeof MediaStreamTrackProcessor+'; settings='+JSON.stringify({native:settings.nativeRenderer,gl:settings.lowLatencyRenderer}));
  const labels=[...panel.querySelectorAll('dt')].map(e=>e.textContent),style=panel.className;
  if(referenceLabels)expect(JSON.stringify(labels)===JSON.stringify(referenceLabels)&&style===referenceStyle,'Overlay fields/style differ for '+mode);
  referenceLabels=labels;referenceStyle=style;
  const fields=Object.fromEntries([...panel.querySelectorAll('dt')].map(e=>[e.textContent,e.nextElementSibling.textContent]));
  expect(fields.Signal.includes('640 × 360'),'Actual signal dimensions missing: '+JSON.stringify(fields));
  expect(parseFloat(fields['Preview delivery'])>5,'Preview frames are not measured: '+mode);
  reports.push({mode,fields});
  settings.setShowDiagnosticsOverlay(false);await wait(100);expect(!document.querySelector('[data-diagnostics-overlay]'),'Overlay did not turn off');
  settings.setShowDiagnosticsOverlay(true);await wait(1100);expect(!!document.querySelector('[data-diagnostics-overlay]'),'Overlay did not turn back on');
  if(mode!=='native')stream.getTracks().forEach(t=>t.stop());
 }
 window.finish=()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());root.unmount()};
 return reports;
};
`},bundle:true,platform:'browser',outfile:path.join(dir,'renderer.js'),loader:{'.png':'dataurl','.svg':'dataurl','.h':'text'},define:{'import.meta.hot':'undefined','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}});
const assets=await fs.readdir(path.join(root,'dist-vite/assets'));const css=assets.find(name=>name.endsWith('.css'));
await fs.copyFile(path.join(root,'dist-vite/assets',css),path.join(dir,'app.css'));
await fs.writeFile(path.join(dir,'index.html'),'<link rel="stylesheet" href="app.css"><style>html,body,#root{margin:0;width:640px;height:500px}</style><div id="root"></div><script src="renderer.js"></script>');
await fs.writeFile(path.join(dir,'main.cjs'),`
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs');
app.setPath('userData',path.join(__dirname,'profile'));setTimeout(()=>app.exit(1),20000).unref();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:640,height:500,webPreferences:{backgroundThrottling:false,offscreen:true}});
win.webContents.setFrameRate(60);
win.webContents.on('console-message',event=>{if(event.level==='warning'||event.level==='error')console.log(event.message)});
await win.loadFile(path.join(__dirname,'index.html'));const report=await win.webContents.executeJavaScript('window.check()');
fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(__dirname,'overlay.png'),(await win.webContents.capturePage()).toPNG());
await win.webContents.executeJavaScript('window.finish()');console.log('PASS: production diagnostics render real browser/WebGL/native compatibility frame measurements with identical fields and styles; overlay toggles. Generated frames on Windows, not M1 hardware.');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(dir,'main.cjs')],{cwd:root,windowsHide:true,stdio:'inherit',env});child.on('exit',code=>{process.exitCode=code??1});
