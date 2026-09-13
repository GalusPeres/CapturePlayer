// Hidden NV12 -> D3D11 shader -> shared FP16 -> Chromium color test.
// Synthetic input only: no camera is opened and no test image is shown.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const dir = path.resolve('.local/native-nv12-test');
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, 'index.html'), '<canvas width="256" height="64"></canvas>');
await fs.writeFile(path.join(dir, 'preload.cjs'), `
const {sharedTexture}=require('electron');
sharedTexture.setSharedTextureReceiver(async({importedSharedTexture})=>{
 const frame=importedSharedTexture.getVideoFrame();
 try{const c=document.querySelector('canvas');const ctx=c.getContext('2d');ctx.drawImage(frame,0,0);
 c.dataset.samples=JSON.stringify(Array.from({length:8},(_,i)=>Array.from(ctx.getImageData(i*32+16,32,1,1).data)));
 }finally{frame.close();importedSharedTexture.release()}
});
`);
await fs.writeFile(path.join(dir, 'main.cjs'), `
const {app,BrowserWindow,sharedTexture}=require('electron');const {spawn}=require('node:child_process');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));
let child;const finish=code=>{child?.stdin.end('quit\\n');setTimeout(()=>{child?.kill();app.exit(code)},150)};
setTimeout(()=>{console.error('NV12 test timed out');finish(1)},15000).unref();
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),backgroundThrottling:false}});
 await w.loadFile(path.join(__dirname,'index.html'));
 child=spawn(path.resolve('.local/native-capture/CapturePlayerCapture.exe'),['--nv12-test','--pid',String(process.pid)],{windowsHide:true});
 child.stdin.on('error',()=>{});let buffer='';
 child.stdout.on('data',data=>{buffer+=data.toString();const lines=buffer.split(/\\r?\\n/);buffer=lines.pop();
 for(const line of lines){const packet=JSON.parse(line);if(packet.error){console.error(packet.error);finish(1);return;}
 if(!Number.isInteger(packet.frame))continue;
 const handle=Buffer.alloc(8);handle.writeBigUInt64LE(BigInt(packet.handle));
 const texture=sharedTexture.importSharedTexture({textureInfo:{pixelFormat:'rgbaf16',codedSize:{width:256,height:64},handle:{ntHandle:handle},
 timestamp:packet.timestamp,colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'rgb',range:'full'}},
 allReferencesReleased:()=>{if(!child.stdin.destroyed)child.stdin.write('release '+packet.frame+'\\n')}});
 sharedTexture.sendSharedTexture({frame:w.webContents.mainFrame,importedSharedTexture:texture}).finally(()=>texture.release());
 }});
 const samples=await w.webContents.executeJavaScript(\`(async()=>{for(let i=0;i<100;i++){
 const samples=document.querySelector('canvas').dataset.samples;if(samples)return JSON.parse(samples);
 await new Promise(r=>setTimeout(r,50));}throw Error('No NV12 samples')})()\`);
 const expected=[[0,0,0],[255,255,255],[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255],[255,255,0]];
 for(let i=0;i<8;i++)for(let c=0;c<3;c++)if(Math.abs(samples[i][c]-expected[i][c])>5)throw Error('NV12 color mismatch '+JSON.stringify(samples));
 console.log('PASS: NV12 limited-range BT.709 GPU conversion, black/white and six color patches');finish(0);
}).catch(error=>{console.error(error);finish(1)});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(dir, 'main.cjs')], { windowsHide: true, stdio: 'inherit', env });
child.on('exit', code => { process.exitCode = code ?? 1; });
