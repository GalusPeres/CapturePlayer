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
import {mergeFrameStats} from './src/components/frameDeliveryDiagnostics';
const root=createRoot(document.getElementById('root')),wait=ms=>new Promise(r=>setTimeout(r,ms));
const expect=(x,m)=>{if(!x)throw Error(m)};
let neuralCalls=0;
const neuralFixture={phase:'active',available:true,quality:'1280 × 720',outputWidth:2560,outputHeight:1440,hdrOutput:true,strength:50,
 fps:59.8,processingMs:8.2,p95Ms:10.4,gpuMs:5.3,presentGapP95Ms:17.1,presentGapMaxMs:33.4,presentGapsOver25Ms:1};
let neuralStatus=neuralFixture;
window.electronAPI={platform:'darwin',debugFrameStats(){},getNeuralStatus:async()=>{++neuralCalls;return neuralStatus}};
let settings,stream;function Harness(){settings=useSettings();return <VideoCanvas stream={stream} running/>}
window.check=async()=>{
 const merged=mergeFrameStats({width:640,height:360,sampleDurationMs:500,displayFps:40,maxFrameMs:60,stallCount:1},
 {width:640,height:360,sampleDurationMs:1500,displayFps:60,maxFrameMs:17,stallCount:0});
 expect(merged.maxFrameMs===60&&merged.stallCount===1&&merged.displayFps===55,'Slower UI sampling lost an earlier hitch or misweighted FPS');
 const source=document.createElement('canvas');source.width=640;source.height=360;const ctx=source.getContext('2d');
 let t=0;const timer=setInterval(()=>{ctx.fillStyle='#153747';ctx.fillRect(0,0,640,360);ctx.fillStyle='#67bbcc';ctx.fillRect(++t%640,100,50,50)},16);
 let referenceLabels,referenceStyle;const reports=[];
 for(const mode of ['standard','webgl','native']){
  neuralStatus=neuralFixture;neuralCalls=0;
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
  expect(fields['Neural stage avg / p95']==='8.2 / 10.4 ms'&&fields['Neural GPU evaluation']==='5.3 ms','Neural measurements missing');
  expect(fields['Neural output'].includes('HDR')&&fields['Neural present p95 / max']==='17.1 / 33.4 ms','Neural output/cadence missing');
  expect(fields['Controller-to-screen lag']==='Not measured'&&fields['GPU utilization']==='Not measured','Unsupported metrics must not be invented');
  expect(neuralCalls<=2,'Diagnostics polled more often than once per 2 seconds');
  reports.push({mode,fields});
  settings.setShowDiagnosticsOverlay(false);await wait(100);expect(!document.querySelector('[data-diagnostics-overlay]'),'Overlay did not turn off');
  const callsWhileOff=neuralCalls;await wait(2100);expect(neuralCalls===callsWhileOff,'Diagnostics kept polling while hidden');
  neuralStatus={...neuralFixture,phase:'off'};
  settings.setShowDiagnosticsOverlay(true);await wait(1100);expect(!!document.querySelector('[data-diagnostics-overlay]'),'Overlay did not turn back on');
  const gpuLabel=[...document.querySelectorAll('[data-diagnostics-overlay] dt')].find(e=>e.textContent==='Neural GPU evaluation');
  expect(gpuLabel.nextElementSibling.textContent==='—','Stopped Neural retained stale GPU timing');
  if(mode!=='native')stream.getTracks().forEach(t=>t.stop());
 }
 window.finish=()=>{clearInterval(timer);stream.getTracks().forEach(t=>t.stop());root.unmount()};
 return reports;
};
`},bundle:true,platform:'browser',outfile:path.join(dir,'renderer.js'),loader:{'.png':'dataurl','.svg':'dataurl','.h':'text'},define:{'import.meta.hot':'undefined','import.meta.env.DEV':'false','process.env.NODE_ENV':'"production"'}});
const assets=await fs.readdir(path.join(root,'dist-vite/assets'));const css=assets.find(name=>name.endsWith('.css'));
await fs.copyFile(path.join(root,'dist-vite/assets',css),path.join(dir,'app.css'));
await fs.writeFile(path.join(dir,'index.html'),'<link rel="stylesheet" href="app.css"><style>html,body,#root{margin:0;width:640px;height:720px}</style><div id="root"></div><script src="renderer.js"></script>');
await fs.writeFile(path.join(dir,'main.cjs'),`
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs');
app.setPath('userData',path.join(__dirname,'profile'));setTimeout(()=>app.exit(1),30000).unref();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:640,height:720,webPreferences:{backgroundThrottling:false,offscreen:true}});
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
