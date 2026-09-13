// Read-only live benchmark. Does not change capture, zoom, effects or VSync.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
const port=Number(process.argv[2]||19287),seconds=Math.min(60,Math.max(5,Number(process.argv[3]||15)));
const label=(process.argv[4]||'native').replace(/[^a-z0-9_-]/gi,'-');
const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page=targets.find(p=>p.type==='page'&&(p.url.includes('dist-vite/index.html')||/^http:\/\/(127\.0\.0\.1|localhost):3000\//.test(p.url)));
if(!page)throw Error('Live CapturePlayer page not found');
const ws=new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
let serial=0;const pending=new Map();
ws.onmessage=e=>{const p=JSON.parse(e.data);if(p.id&&pending.has(p.id)){const {resolve,reject,timer}=pending.get(p.id);pending.delete(p.id);clearTimeout(timer);p.error?reject(p.error):resolve(p.result)}};
ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Player disconnected during measurement'))}pending.clear()};
const call=(method,params)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('Measurement timed out'))},(seconds+10)*1000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
const cpu=new Promise((resolve,reject)=>{
 const child=spawn('powershell.exe',['-NoProfile','-File','scripts/measure-player-cpu.ps1','-Seconds',String(seconds),'-DebugPort',String(port)],{windowsHide:true});
 let data='',error='';child.stdout.on('data',d=>data+=d);child.stderr.on('data',d=>error+=d);child.on('error',reject);child.on('exit',code=>{try{code?reject(Error(error)):resolve(JSON.parse(data))}catch(e){reject(e)}});
});
try {
 const measured=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
   const intervals=[],longTasks=[],telemetry=[];let last=0;
   const settings=()=>JSON.parse(localStorage.getItem('capturePlayerSettings'));
   const initial=settings();const neuralBefore=await window.electronAPI.getNeuralStatus();
   const neuralConfig=n=>JSON.stringify([n.phase,n.selectedQuality,n.strength,n.split,n.outputWidth,n.outputHeight,n.tuning,n.appliedTuning]);
   const sample=async()=>telemetry.push({native:await window.electronAPI.getNativeCaptureStatus(),neural:await window.electronAPI.getNeuralStatus()});
   const receive=e=>{if(e.source!==window||e.data?.type!=='captureplayer:native-frame')return;const now=performance.now();if(last)intervals.push(now-last);last=now;};
   const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({entryTypes:['longtask']});
   window.addEventListener('message',receive);const timer=setInterval(()=>void sample(),2000);
   await new Promise(r=>setTimeout(r,${seconds*1000}));
   clearInterval(timer);window.removeEventListener('message',receive);observer.disconnect();await sample();
   const sorted=[...intervals].sort((a,b)=>a-b);const mean=intervals.reduce((a,b)=>a+b,0)/intervals.length;
   const c=document.querySelector('canvas[data-native-renderer]');
   return {seconds:${seconds},settings:initial,settingsChanged:JSON.stringify(initial)!==JSON.stringify(settings()),neuralBefore,
     neuralChanged:telemetry.some(t=>neuralConfig(t.neural)!==neuralConfig(neuralBefore)),
     softwareFrameIntervals:{count:intervals.length,fps:1000/mean,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],p99:sorted[Math.floor(sorted.length*.99)],max:sorted.at(-1),over25:intervals.filter(t=>t>25).length,over40:intervals.filter(t=>t>40).length},
     longTasks,telemetry,canvas:c?{width:c.width,height:c.height,...c.dataset}:null,vsync:await window.electronAPI.getDisableGpuVsync()};
 })()`});
 if(measured.exceptionDetails)throw Error(JSON.stringify(measured.exceptionDetails));
 const result={date:new Date().toISOString(),label,measurement:'Software timing; not controller-to-photon latency',...measured.result.value,cpu:await cpu};
 // Always expose the worst sampled output window, not only the last (often
 // clean) window. Input delivery can be smooth while Neural presentation stalls.
 const gaps=result.telemetry.map(t=>t.neural.presentGapMaxMs).filter(Number.isFinite);
 result.neuralSubmissionMaxMs=gaps.length?Math.max(...gaps):null;
 await fs.mkdir('.local/benchmarks',{recursive:true});const file=path.resolve(`.local/benchmarks/${label}-${Date.now()}.json`);await fs.writeFile(file,JSON.stringify(result,null,2));
 console.log(JSON.stringify({file,intervals:result.softwareFrameIntervals,neuralSubmissionMaxMs:result.neuralSubmissionMaxMs,cpu:result.cpu.totalSystemCpuPercent,changed:result.settingsChanged||result.neuralChanged,settingsChanged:result.settingsChanged,neuralChanged:result.neuralChanged,canvas:result.canvas,latest:result.telemetry.at(-1)}));
} finally {ws.close();await cpu.catch(()=>{});}
