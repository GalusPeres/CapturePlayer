// Hidden synthetic GPU check. Does not open the capture card or show test images.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve('.local/fsr-supersampling-test');
await fs.mkdir(root, { recursive: true });
await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import {createGlVideoPipeline} from './src/components/glVideoPipeline';
import {getFsrSize} from './src/components/fsrSizing';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(test,message)=>{if(!test)throw Error(message)};
window.run=async()=>{
 for(const [sw,sh,ow,oh,expected] of [[2560,1440,2560,1440,'3840x2160:true'],[1920,1080,1920,1080,'2560x1440:true'],[1280,720,2560,1440,'2560x1440:false'],[3840,2160,3840,2160,'3840x2160:false'],[2560,1440,1280,720,'1280x720:false']]){
   const t=getFsrSize(sw,sh,ow,oh);assert(t.width+'x'+t.height+':'+t.supersampling===expected,'Wrong size selection');
 }
 const source=document.createElement('canvas');source.width=2560;source.height=1440;
 const ctx=source.getContext('2d');const pixels=ctx.createImageData(source.width,source.height);
 // Aliased sloping edges, with broad constant patches on each side.
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
   const i=(y*source.width+x)*4;const v=x<600+y*.43?32:224;
   pixels.data.set([v,v,v,255],i);
 }
 ctx.putImageData(pixels,0,0);
 const frame=new VideoFrame(source,{timestamp:0});
 const canvas=document.createElement('canvas');canvas.width=2560;canvas.height=1440;document.body.append(canvas);
 const pipeline=createGlVideoPipeline(canvas),gl=canvas.getContext('webgl2');
 const neutral={brightness:1,contrast:1,saturation:1,hueDeg:0,blurPx:0,sharpen:0,crisp:false};
 const draw=fsr=>pipeline.render(frame,{...neutral,upscaler:fsr,upscaleSharpness:0},1);
 const read=()=>{const data=new Uint8Array(2560*1440*4);gl.readPixels(0,0,2560,1440,gl.RGBA,gl.UNSIGNED_BYTE,data);return data};
 draw(false);const original=read();draw(true);const filtered=read();
 assert(canvas.dataset.fsrInternalSize==='3840x2160'&&canvas.dataset.upscaler==='supersampling','No real 4K intermediate');
 let softened=0,flatError=0;
 for(let y=0;y<1440;y++)for(let x=0;x<2560;x++){
   const i=(y*2560+x)*4;
   if(filtered[i]>36&&filtered[i]<220)++softened;
   if(x<200||x>2200)flatError=Math.max(flatError,Math.abs(filtered[i]-original[i]));
 }
 assert(softened>1000,'No visible smoothing on sloped edge');assert(flatError<=1,'Flat colors changed');
 pipeline.render(frame,{...neutral,upscaler:true,upscaleSharpness:1},1);const sharp=read();
 assert(sharp.some((v,i)=>Math.abs(v-filtered[i])>2),'Sharpness stopped working');
 draw(false);const restored=read();assert(restored.every((v,i)=>v===original[i]),'Off did not restore original');
 assert(gl.getError()===gl.NO_ERROR,'WebGL error');
 const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 const results=[];
 for(const fsr of [false,true]){
   const times=[];
   for(let i=0;i<65;i++){
     const q=ext?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);
     draw(fsr);if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.flush();}
     await wait(16);
     if(q){for(let n=0;n<100&&!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE);n++)await wait(2);
       if(!gl.getParameter(ext.GPU_DISJOINT_EXT)&&gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)&&i>=15)times.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
       gl.deleteQuery(q);
     }
   }
   times.sort((a,b)=>a-b);results.push({fsr,samples:times.length,gpuMeanMs:times.reduce((a,b)=>a+b,0)/times.length,gpuP95Ms:times[Math.floor(times.length*.95)]});
 }
 const result={gpu:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unknown',softenedEdgePixels:softened,flatError,results};
 pipeline.dispose();frame.close();return result;
};
` }, bundle: true, loader: { '.h': 'text' }, outfile: path.join(root,'renderer.js') });
await fs.writeFile(path.join(root,'index.html'),'<div></div><script src="renderer.js"></script>');
await fs.writeFile(path.join(root,'main.cjs'),`
const {app,BrowserWindow}=require('electron');const path=require('node:path');const fs=require('node:fs');
app.setPath('userData',path.join(__dirname,'profile'));
setTimeout(()=>{console.error('Supersampling test timed out');app.exit(1)},45000).unref();
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 await w.loadFile(path.join(__dirname,'index.html'));
 const result=await w.webContents.executeJavaScript('window.run()');
 fs.writeFileSync(path.join(__dirname,'result.json'),JSON.stringify(result,null,2));
 console.log('PASS: real 4K intermediate, edge smoothing, flat colors, sharpness, off/on restoration');
 console.log(JSON.stringify(result));app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
`);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[path.join(root,'main.cjs')],{env,windowsHide:true,stdio:'inherit'});
process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)));
