// Exercise the packaged main process, preload and real import IPC in a hidden
// window. Only the OS file picker is substituted; no capture device is opened.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, '.local/packaged-neural-import-test');
await fs.mkdir(dir, { recursive: true });
const profile = await fs.mkdtemp(path.join(dir, 'profile-'));
const packaged = path.join(root, 'dist/manual-neural-local/win-unpacked');
const source = path.join(root, '.local/neural-runtime/nvngx_dlssnr.dll');
await fs.writeFile(path.join(dir, 'main.cjs'), `
const electron=require('electron');const fs=require('node:fs');const path=require('node:path');
const {app}=electron;
app.setPath('userData',process.env.IMPORT_TEST_PROFILE);
const OriginalWindow=electron.BrowserWindow;
class HiddenWindow extends OriginalWindow {constructor(options){super({...options,show:false});}show(){}showInactive(){}}
const Module=require('node:module');const load=Module._load;
const hiddenElectron={...electron,BrowserWindow:HiddenWindow};
Module._load=function(id,...args){return id==='electron'?hiddenElectron:load.call(this,id,...args)};
electron.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.env.IMPORT_TEST_SOURCE]});
setTimeout(()=>{console.error('Packaged import timed out');app.exit(1)},20000).unref();
app.on('browser-window-created',(_event,win)=>{
 win.webContents.once('did-finish-load',async()=>{try{
   const before=await win.webContents.executeJavaScript('window.electronAPI.getNeuralStatus()');
   if(!before.helpersAvailable)throw Error('Packaged helpers unavailable');
   if(process.env.IMPORT_TEST_RESTART==='1'){
     if(!before.runtimeInstalled||!before.available)throw Error('Packaged restart lost imported DLL');
     console.log('PASS: packaged restart retains imported DLL');
   }else{
     if(before.runtimeInstalled||before.available)throw Error('Model DLL unexpectedly bundled');
     const result=await win.webContents.executeJavaScript('window.electronAPI.importNeuralRuntime()');
     if(result.error||!result.status?.available||result.version!=='310.8.0.0')throw Error(JSON.stringify(result));
     console.log('PASS: packaged preload -> authenticated import IPC -> validated user-data DLL; no model bundled');
   }
   app.exit(0);
 }catch(error){console.error(error);app.exit(1)}});
});
try{require(path.join(process.env.IMPORT_TEST_PACKAGE,'resources/app.asar/dist-electron/index.js'))}
catch(error){console.error(error);app.exit(1)}
`);
for (const restart of ['0', '1']) {
  const env = { ...process.env, IMPORT_TEST_PROFILE: profile, IMPORT_TEST_SOURCE: source, IMPORT_TEST_PACKAGE: packaged,
    IMPORT_TEST_RESTART: restart, CAPTUREPLAYER_NEURAL_RUNTIME: path.join(packaged, 'neural-runtime'),
    CAPTUREPLAYER_NATIVE_CAPTURE: path.join(packaged, 'native-capture/CapturePlayerCapture.exe') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL;
  const child = spawn(require('electron'), [path.join(dir, 'main.cjs')], { cwd: root, windowsHide: true, stdio: 'inherit', env });
  const code = await new Promise(resolve => child.on('exit', resolve));
  if (code !== 0) { process.exitCode = code ?? 1; break; }
}
