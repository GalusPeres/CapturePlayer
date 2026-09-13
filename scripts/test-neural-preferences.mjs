// Real main/preload IPC and clean process restarts; only the GPU worker and
// device/runtime discovery are fixtures. Never opens the user's capture card.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, '.local/neural-preferences-test');
await fs.mkdir(dir, { recursive: true });
const profile = await fs.mkdtemp(path.join(dir, 'profile-'));
const fixtures = {
 neuralWorker: `export class NeuralWorker {
  status={phase:'off',available:true}; constructor(){globalThis.testNeural=this;this.starts=0}
  getStatus(){return this.status} setTuning(){} setStrength(){} setSplit(){}
  start(options){++this.starts;this.options=options;this.status={phase:'active',available:true}}
  stop(){this.status={phase:'off',available:true}} pause(){this.status={phase:'starting',available:true}}
 }`,
 neuralRuntime: `export class NeuralRuntimeStore {file='fixture';async initialize(){} }`,
 nativeCaptureFactory: `export const createNativeCapture=()=>({status:{phase:'off'},available:()=>true,stop(){}})`,
};
await build({entryPoints:[path.join(root,'electron/index.ts')],bundle:true,platform:'node',external:['electron'],outfile:path.join(dir,'index.cjs'),plugins:[{
 name:'hardware-fixtures',setup(b){b.onResolve({filter:/^\.\/(neuralWorker|neuralRuntime|nativeCaptureFactory)$/},args=>({path:args.path.slice(2),namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixtures[args.path],loader:'ts'}))}
}]});
await build({entryPoints:[path.join(root,'electron/preload.ts')],bundle:true,platform:'node',external:['electron'],outfile:path.join(dir,'preload.js')});
await fs.writeFile(path.join(dir,'blank.html'),'<title>Preferences test</title>');
await fs.writeFile(path.join(dir,'main.cjs'),`
const electron=require('electron'),{app}=electron,path=require('node:path'),Module=require('node:module');
app.setPath('userData',process.env.PREFERENCES_PROFILE);
class HiddenWindow extends electron.BrowserWindow {
 constructor(options){super({...options,show:false})}show(){}showInactive(){}
 loadURL(){return this.loadFile(path.join(__dirname,'blank.html'))}
}
const load=Module._load;Module._load=function(id,...args){return id==='electron'?{...electron,BrowserWindow:HiddenWindow,globalShortcut:{register(){},unregisterAll(){}}}:load.call(this,id,...args)};
const assert=(value,message)=>{if(!value)throw Error(message)};
setTimeout(()=>app.exit(1),15000).unref();
app.on('browser-window-created',(_event,win)=>{
 win.webContents.once('did-finish-load',async()=>{try{
  const call=expression=>win.webContents.executeJavaScript('window.electronAPI.'+expression);
  let state=await call('getNeuralStatus()');const step=process.env.PREFERENCES_STEP;
  assert(global.testNeural.starts===0,'Started before capture was ready');
  if(step==='0'){
   assert(!state.enabled,'New profile should start disabled');
   await call('setNeuralQuality("1440p")');
   await call('startNeural("1440p",true,47)');
   assert(global.testNeural.starts===0,'Enabling should wait for capture');
   await call('resumeNeuralAfterCapture()');assert(global.testNeural.starts===1,'Ready did not start');
   await call('pauseNeuralForCapture()');assert((await call('getNeuralStatus()')).enabled,'Capture pause lost intent');
   await call('resumeNeuralAfterCapture()');assert(global.testNeural.starts===2,'Capture restart did not resume');
   await call('stopNeural()');await call('startNeural("1440p",true,47)');assert(global.testNeural.starts===3,'Off/on stalled without another capture-ready event');
  }else if(step==='1'){
   assert(state.enabled&&state.selectedQuality==='1440p'&&state.strength===47&&state.split,'Restart lost preferences: '+JSON.stringify(state));
   await call('resumeNeuralAfterCapture()');assert(global.testNeural.starts===1,'Restart did not resume when capture became ready');
   assert(global.testNeural.options.quality==='1440p'&&global.testNeural.options.strength===47&&global.testNeural.options.split,'Restored worker got wrong preferences');
   await call('stopNeural()');await call('setNeuralQuality("900p")');
  }else{
   assert(!state.enabled&&state.selectedQuality==='900p','Explicit off / inactive quality were not persisted');
   await call('resumeNeuralAfterCapture()');assert(global.testNeural.starts===0,'Explicitly disabled Neural auto-started');
  }
  console.log('PASS: preferences restart step '+step);app.quit();
 }catch(e){console.error(e);app.exit(1)}});
});
require('./index.cjs');
`);
for (const step of ['0','1','2']) {
 const env={...process.env,PREFERENCES_PROFILE:profile,PREFERENCES_STEP:step};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
 const child=spawn(require('electron'),[path.join(dir,'main.cjs')],{cwd:root,windowsHide:true,stdio:'inherit',env});
 const code=await new Promise(resolve=>child.on('exit',resolve));
 if(code!==0){process.exitCode=code??1;break;}
}
