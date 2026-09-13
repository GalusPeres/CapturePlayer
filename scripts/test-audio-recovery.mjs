// Real browser MediaStreams, simulated OS/audio-device interruptions. No speakers or camera opened.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, '.local/audio-recovery-test'); await fs.mkdir(dir, { recursive: true });
await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
import {AudioPlayback,audioDiagnostics} from './src/hooks/audioPlayback';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const expect=(condition,message)=>{if(!condition)throw Error(message)};
let contexts=[],calls=[],hold,fail=false,resumeCount=0;
window.electronAPI={platform:'linux'};
window.AudioContext=class {
 state='running';destination={};baseLatency=.01;outputLatency=.02;onstatechange=null;
 constructor(options){contexts.push(this);this.options=options}
 createMediaStreamSource(){return {connect(){},disconnect(){}}}
 createGain(){return {gain:{value:0},connect(){},disconnect(){}}}
 async close(){this.state='closed'}
 async resume(){++resumeCount;this.state='running';this.onstatechange?.()}
};
const audio=()=>new MediaStreamTrackGenerator({kind:'audio'});
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async constraints=>{
 calls.push(constraints);if(fail)throw Error('Audio device temporarily absent');
 const stream=new MediaStream([audio()]);if(hold)await hold(stream);return stream;
}});
window.check=async()=>{
 const video=new MediaStreamTrackGenerator({kind:'video'}),first=audio(),stream=new MediaStream([video,first]);
 const playback=new AudioPlayback(stream,'chosen-card',75,'linux');
 expect(contexts[0].options.latencyHint==='interactive','Linux still forces a fragile fixed buffer');
 contexts[0].state='suspended';contexts[0].onstatechange();await wait(650);
 expect(resumeCount===1&&calls.length===0,'Suspension should resume output without reopening capture');
 expect(audioDiagnostics().state==='Playing','Successful resume was not reported');
 first.stop();first.dispatchEvent(new Event('ended'));await wait(450);
 expect(calls.length===1&&calls[0].video===false&&calls[0].audio.deviceId.exact==='chosen-card','Recovery did not reopen only the selected audio device');
 expect(stream.getAudioTracks()[0]!==first&&stream.getVideoTracks()[0]===video&&video.readyState==='live','Recovery changed video or retained ended audio');
 const recovered=stream.getAudioTracks()[0];
 Object.defineProperty(recovered,'muted',{configurable:true,value:true});recovered.dispatchEvent(new Event('mute'));
 await wait(100);Object.defineProperty(recovered,'muted',{value:false});recovered.dispatchEvent(new Event('unmute'));await wait(2100);
 expect(calls.length===1,'A brief mute unnecessarily reopened audio');
 let release,pendingStream;hold=async stream=>{pendingStream=stream;await new Promise(resolve=>release=resolve)};
 recovered.stop();recovered.dispatchEvent(new Event('ended'));await wait(400);
 expect(!!release,'Interrupted input did not start recovery');
 await playback.changeDevice('');release();await wait(100);hold=undefined;
 expect(stream.getAudioTracks().length===0&&pendingStream.getAudioTracks()[0].readyState==='ended','Late recovery revived audio after No audio device');
 const before=calls.length;window.dispatchEvent(new Event('focus'));await wait(200);
 expect(calls.length===before,'No audio device still triggers recovery');
 await playback.changeDevice('chosen-card');
 const broken=stream.getAudioTracks()[0];fail=true;broken.stop();broken.dispatchEvent(new Event('ended'));await wait(4200);
 const afterFailures=calls.length;await wait(1200);
 expect(calls.length===afterFailures,'Automatic retry loop is unbounded');
 fail=false;navigator.mediaDevices.dispatchEvent(new Event('devicechange'));await wait(250);
 expect(audioDiagnostics().state==='Playing','Device return did not recover after bounded retries');
 playback.stop();const stopped=calls.length;
 navigator.mediaDevices.dispatchEvent(new Event('devicechange'));window.dispatchEvent(new Event('focus'));await wait(650);
 expect(calls.length===stopped,'Stopped playback retained recovery listeners');
 expect(video.readyState==='live','Audio controller stopped video');stream.getTracks().forEach(track=>track.stop());
 return 'PASS: output resume; audio-only device recovery; brief mute; cancellation by No audio; bounded retry; device return; stop cleanup; Linux buffer policy.';
};
` }, bundle: true, outfile: path.join(dir, 'renderer.js'), platform: 'browser' });
await fs.writeFile(path.join(dir,'index.html'),'<script src="renderer.js"></script>');
await fs.writeFile(path.join(dir,'main.cjs'), `
const {app,BrowserWindow}=require('electron');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
setTimeout(()=>app.exit(1),20000).unref();
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 await win.loadFile(path.join(__dirname,'index.html'));console.log(await win.webContents.executeJavaScript('window.check()'));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(dir,'main.cjs')],{cwd:root,windowsHide:true,stdio:'inherit',env});
child.on('exit',code=>{process.exitCode=code??1});
