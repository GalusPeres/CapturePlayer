// Test the real Mac/Linux Electron transport with delayed GPU/IPC fixtures.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const root = path.resolve(import.meta.dirname, '..'), dir = path.join(root, '.local/portable-delivery-test');
await fs.mkdir(dir, { recursive: true });
const require = createRequire(import.meta.url);
await build({ entryPoints: [path.join(root,'electron/portableNativeCapture.ts')], bundle: true, platform: 'node', format: 'cjs',
 outfile:path.join(dir,'capture.cjs'), plugins:[{name:'fixture-electron',setup(build){
  build.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'fixture'}));
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'module.exports=global.__captureElectron;',loader:'js'}));
 }}] });
let callback, released=[], sent=[], pending=[], importFailure=false, sendFailure=false;
global.__captureElectron={systemPreferences:{getMediaAccessStatus:()=> 'granted'},sharedTexture:{
 importSharedTexture({textureInfo,allReferencesReleased}) {
  if(importFailure)throw Error('GPU import failed');
  return {token:textureInfo.timestamp,release:allReferencesReleased};
 },
 sendSharedTexture({importedSharedTexture}) {
  if(sendFailure)throw Error('IPC send failed');
  sent.push(importedSharedTexture.token);return new Promise(resolve=>pending.push(resolve));
 }
}};
const addon={start(_options,cb){callback=cb},stop(){},release(token){released.push(token)}};
const {PortableNativeCapture}=require(path.join(dir,'capture.cjs'));
const capture=new PortableNativeCapture('fixture');capture.addon=addon;
const target={isDestroyed:()=>false,mainFrame:{},send(){}};
const options={device:'card',width:2560,height:1440,fps:60,hdr:false};
const frame=token=>({token,timestamp:token,width:2560,height:1440,pixelFormat:'nv12',dropped:0,handle:{},colorSpace:{}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
try {
 const start=capture.start(options,target);callback(frame(1));callback(frame(2));callback(frame(3));
 assert.deepEqual(sent,[1]);assert.deepEqual(released,[2],'Only stale waiting frames should be released');
 pending.shift()();await start;await tick();assert.deepEqual(sent,[1,3],'Newest frame should follow a blocked delivery');
 callback(frame(4));capture.stop();assert.ok(released.includes(4),'Stop leaked a waiting native buffer');
 pending.shift()();await tick();assert.equal(sent.length,2,'Stop delivered an old-generation frame');
 assert.equal(new Set(released).size,released.length,'A native frame was released twice');
 assert.deepEqual([...released].sort(),[1,2,3,4]);
 importFailure=true;const failed=capture.start(options,target);callback(frame(5));await assert.rejects(failed,/GPU import failed/);await tick();
 assert.ok(released.includes(5),'Failed import leaked its native frame');
 importFailure=false;sendFailure=true;const failedSend=capture.start(options,target);callback(frame(6));await assert.rejects(failedSend,/IPC send failed/);await tick();
 assert.ok(released.includes(6),'Synchronous send failure leaked an imported texture');
 console.log('PASS: one in-flight send; newest waiting frame; stop/generation cancellation; exact-once release; import and send failures. Simulated transport, no Mac/Linux hardware.');
} finally {capture.stop();delete global.__captureElectron;}
