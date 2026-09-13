// Hidden GPU integration test: no capture device is opened and no pattern is shown.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve('.local/native-hdr-test');
await fs.mkdir(root, { recursive: true });
await build({ stdin: { contents: `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import NativeVideo from './src/components/NativeVideo';
  const root=createRoot(document.getElementById('root'));
  (window as any).testFilters=(filters:any,zoom=100,hdr=true)=>root.render(<NativeVideo hdr={hdr} zoom={zoom} filters={filters} />);
  (window as any).testFilters({});
  `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, loader: { '.h': 'text' }, outfile: path.join(root, 'renderer.js'), platform: 'browser' });
await fs.writeFile(path.join(root, 'index.html'), '<style>html,body,#root,canvas{margin:0;width:256px;height:64px}</style><div id="root"></div><script src="renderer.js"></script>');
await fs.writeFile(path.join(root, 'preload.cjs'), `
  const {sharedTexture}=require('electron');
  sharedTexture.setSharedTextureReceiver(async({importedSharedTexture})=>{
    const frame=importedSharedTexture.getVideoFrame();
    try{window.postMessage({type:'captureplayer:native-frame',frame},'*',[frame]);}
    finally{frame.close();importedSharedTexture.release();}
  });`);
await fs.writeFile(path.join(root, 'main.cjs'), `
const {app,BrowserWindow,sharedTexture}=require('electron');
const {spawn}=require('node:child_process');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
let child;const finish=(code)=>{child?.stdin.end('quit\\n');setTimeout(()=>{child?.kill();app.exit(code)},150)};
setTimeout(()=>{console.error('HDR test timed out');finish(1)},20000).unref();
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:256,height:64,webPreferences:{preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false}});
 w.webContents.on('console-message',(_e,_level,message)=>console.log(message));
 await w.loadFile(path.join(__dirname,'index.html'));
 child=spawn(path.resolve('.local/native-capture/CapturePlayerCapture.exe'),['--color-test','--hdr','1','--pid',String(process.pid)],{windowsHide:true});
 child.stdin.on('error',()=>{});let buffer='';
 child.stdout.on('data',data=>{buffer+=data.toString();const lines=buffer.split(/\\r?\\n/);buffer=lines.pop();
   for(const line of lines){const p=JSON.parse(line);if(p.error){console.error(p.error);finish(1);return;}
    if(!Number.isInteger(p.frame))continue;
    const handle=Buffer.alloc(8);handle.writeBigUInt64LE(BigInt(p.handle));
    const texture=sharedTexture.importSharedTexture({textureInfo:{pixelFormat:'rgbaf16',codedSize:{width:256,height:64},handle:{ntHandle:handle},timestamp:p.timestamp,
      colorSpace:{primaries:'bt709',transfer:'linear',matrix:'rgb',range:'full'}},
      allReferencesReleased:()=>{if(!child.stdin.destroyed)child.stdin.write('release '+p.frame+'\\n')}});
    sharedTexture.sendSharedTexture({frame:w.webContents.mainFrame,importedSharedTexture:texture}).finally(()=>texture.release());
   }
 });
 const result=await w.webContents.executeJavaScript(\`(async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   for(let i=0;i<100;i++){if(Number(document.querySelector('canvas')?.dataset.nativeFrames)>10)break;await wait(100);}
   const c=document.querySelector('canvas');c.dataset.hdrProbe='pending';
   for(let i=0;i<50;i++){await wait(100);if(c.dataset.hdrProbe.startsWith('['))return JSON.parse(c.dataset.hdrProbe);}
   throw Error(document.querySelector('[role=alert]')?.textContent||'No HDR probe response');
 })()\`);
 console.log('HDR_SAMPLES='+JSON.stringify(result));
 const linear=value=>Math.sign(value)*(Math.abs(value)<=0.04045?Math.abs(value)/12.92:Math.pow((Math.abs(value)+0.055)/1.055,2.4));
 const expected=[[10/203,10/203,10/203],[80/203,80/203,80/203],[1,1,1],[1000/203,1000/203,1000/203],[4000/203,4000/203,4000/203],
   [1.660491,-0.124550,-0.018151],[-0.587641,1.132900,-0.100579],[-0.072850,-0.008349,1.118730]];
 if(result.length!==8)throw Error('Missing HDR test patches');
 for(let i=0;i<8;i++)for(let c=0;c<3;c++){
   const actual=linear(result[i][c]), wanted=expected[i][c];
   const tolerance=i<5?Math.abs(wanted)*0.015:0.015;
   if(!Number.isFinite(actual)||Math.abs(actual-wanted)>tolerance)throw Error('HDR color mismatch at patch '+i+', channel '+c+': '+actual+' expected '+wanted);
 }
 console.log('PASS: P010 limited-range PQ -> shared FP16 -> extended-sRGB canvas (8 patches)');
 const adjusted=await w.webContents.executeJavaScript(\`(async()=>{
   window.testFilters({brightness:0.8,contrast:1.2,saturation:0,hueDeg:0});
   await new Promise(r=>setTimeout(r,250));const c=document.querySelector('canvas');c.dataset.hdrProbe='pending';
   for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(c.dataset.hdrProbe.startsWith('['))return JSON.parse(c.dataset.hdrProbe);}
   throw Error('Color controls probe timed out');
 })()\`);
 for(let i=0;i<8;i++){
   const gray=result[i].slice(0,3).map(x=>(x*0.8-0.5)*1.2+0.5).reduce((sum,x,c)=>sum+x*[0.213,0.715,0.072][c],0);
   for(let c=0;c<3;c++)if(Math.abs(adjusted[i][c]-gray)>0.008)throw Error('HDR color controls mismatch at '+i);
 }
 if(adjusted[4][0]<=1)throw Error('HDR highlights were clamped by color controls');
 console.log('PASS: live HDR brightness, contrast and saturation controls; highlights retained');
 const fsrResult=await w.webContents.executeJavaScript(\`(async()=>{
   window.testFilters({upscaler:true,upscaleSharpness:0.2});await new Promise(r=>setTimeout(r,250));
   const c=document.querySelector('canvas');c.dataset.hdrProbe='pending';
   for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(c.dataset.hdrProbe.startsWith('['))return {mode:c.dataset.upscaler,pixels:JSON.parse(c.dataset.hdrProbe)};}
   throw Error('FSR probe timed out');
 })()\`);
 if(fsrResult.mode!=='fsr1')throw Error('Native FSR did not activate');
 for(let i=0;i<8;i++)for(let c=0;c<3;c++){
   if(!Number.isFinite(fsrResult.pixels[i][c])||Math.abs(fsrResult.pixels[i][c]-result[i][c])>0.025)throw Error('FSR failed to preserve HDR color '+i);
 }
 console.log('PASS: native FSR EASU/RCAS enabled, HDR patches and negative gamut values retained');
 const supersampled=await w.webContents.executeJavaScript(\`(async()=>{
   // Exact physical source/output size, independent of Windows display scaling.
   document.getElementById('root').style.width=(256/devicePixelRatio)+'px';
   document.getElementById('root').style.height=(64/devicePixelRatio)+'px';
   document.querySelector('canvas').style.width='100%';document.querySelector('canvas').style.height='100%';
   window.testFilters({upscaler:true,upscaleSharpness:0.2});await new Promise(r=>setTimeout(r,250));
   const c=document.querySelector('canvas');c.dataset.hdrProbe='pending';
   for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(c.dataset.hdrProbe.startsWith('['))return {mode:c.dataset.upscaler,size:c.dataset.fsrInternalSize,pixels:JSON.parse(c.dataset.hdrProbe)};}
   throw Error('Supersampling probe timed out');
 })()\`);
 if(supersampled.mode!=='supersampling'||supersampled.size!=='384x96')throw Error('Matching-size HDR did not supersample: '+JSON.stringify(supersampled));
 for(let i=0;i<8;i++)for(let c=0;c<3;c++)if(!Number.isFinite(supersampled.pixels[i][c])||Math.abs(supersampled.pixels[i][c]-result[i][c])>0.025)throw Error('Supersampling changed flat HDR color '+i);
 console.log('PASS: equal-resolution HDR supersampling, highlights and negative gamut retained');
 const switched=await w.webContents.executeJavaScript(\`(async()=>{
   window.testFilters({upscaler:true,upscaleSharpness:0.2},100,false);
   await new Promise(r=>setTimeout(r,400));
   const c=document.querySelector('canvas');const before=Number(c.dataset.nativeFrames);
   await new Promise(r=>setTimeout(r,100));
   if(document.querySelector('[role=alert]'))throw Error(document.querySelector('[role=alert]').textContent);
   if(!(Number(c.dataset.nativeFrames)>before)||c.dataset.nativeRenderer!=='sdr')throw Error('SDR frame loop stopped');
   window.testFilters({upscaler:true,upscaleSharpness:0.2},100,true);
   await new Promise(r=>setTimeout(r,400));
   const hdr=document.querySelector('canvas');
   if(document.querySelector('[role=alert]')||hdr.dataset.nativeRenderer!=='hdr'||Number(hdr.dataset.nativeFrames)<2)throw Error('HDR restart failed');
   return true;
 })()\`);
 if(!switched)throw Error('Renderer toggle failed');
 console.log('PASS: HDR → SDR → HDR keeps receiving and drawing frames with FSR enabled');
 const zoomResult=await w.webContents.executeJavaScript(\`(async()=>{
   window.testFilters({},50);await new Promise(r=>setTimeout(r,250));
   const c=document.querySelector('canvas');c.dataset.hdrProbe='pending';
   for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,100));if(c.dataset.hdrProbe.startsWith('['))return JSON.parse(c.dataset.hdrProbe);}
   throw Error('Zoom probe timed out');
 })()\`);
 for(const i of [0,1,6,7])if(zoomResult[i].slice(0,3).some(x=>x!==0))throw Error('Zoom exposed pixels outside the video rectangle');
 if(!zoomResult[3].slice(0,3).some(x=>x>0.1))throw Error('Zoom lost the center image');
 console.log('PASS: 50% zoom preserves centered image and black borders');
 finish(0);
}).catch(e=>{console.error(e);finish(1)});
`);
const testEnv = { ...process.env }; delete testEnv.ELECTRON_RUN_AS_NODE;
const run = spawn(require('electron'), [path.join(root, 'main.cjs')], { windowsHide: true, stdio: 'inherit', env: testEnv });
process.exitCode = await new Promise(resolve => run.on('exit', code => resolve(code ?? 1)));
