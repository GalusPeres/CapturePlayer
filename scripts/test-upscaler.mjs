// Opt-in real-card performance test; closes its own temporary player.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
fs.mkdirSync(path.join(root,'.local'),{recursive:true});
if(process.argv.includes('--app')){
  fs.copyFileSync(path.join(root,'dist-electron/preload.js'),path.join(root,'.local/preload.js'));
  const out=path.join(root,'.local/upscaler-app-smoke.cjs');
  await build({entryPoints:[path.join(root,'scripts/upscaler-app-smoke.ts')],outfile:out,bundle:true,platform:'node',external:['electron']});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[out],{cwd:root,env,stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)));
} else {
if(!process.argv.includes('--card'))throw new Error('Pass --card for the Elgato test, or --app for application checks.');
// Keep the comparison reproducible after committing the new renderer.
const baselineCommit='cfc3d31ab6ec7524730f57cb31e3f000005531f4';
fs.writeFileSync(path.join(root,'.local/gl-baseline.ts'),execFileSync('git',['show',`${baselineCommit}:src/components/glVideoPipeline.ts`],{cwd:root}));
await build({entryPoints:[path.join(root,'scripts/upscaler-benchmark.ts')],outfile:path.join(root,'.local/upscaler-benchmark.js'),bundle:true,loader:{'.h':'text'}});
fs.writeFileSync(path.join(root,'.local/upscaler-benchmark.html'),'<!doctype html><body style="margin:0;overflow:hidden;background:black"><script src="upscaler-benchmark.js"></script>');
const host=`const {app,BrowserWindow}=require('electron');const fs=require('fs');const path=require('path');
app.setPath('userData',path.join(process.cwd(),'.local/upscaler-benchmark-profile'));
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async()=>{const w=new BrowserWindow({width:1280,height:720,frame:false,webPreferences:{backgroundThrottling:false}});w.show();await w.loadFile(path.resolve('.local/upscaler-benchmark.html'));const result=await w.webContents.executeJavaScript('window.benchmark');fs.writeFileSync('.local/upscaler-benchmark.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.quit()}).catch(e=>{console.error(e);app.exit(1)});`;
const hostPath=path.join(root,'.local/upscaler-benchmark.cjs');fs.writeFileSync(hostPath,host);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
spawn(require('electron'),[hostPath],{cwd:root,env,stdio:'inherit',windowsHide:true}).on('exit',code=>process.exitCode=code??1);
}
