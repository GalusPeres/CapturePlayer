// Exercise real shared GPU handle allocation/cleanup without a card or window.
import {spawn} from 'node:child_process';
import path from 'node:path';
const executable=path.resolve('.local/native-capture/CapturePlayerCapture.exe');
for(let run=0;run<3;run++) {
  const child=spawn(executable,['--color-test','--hdr','1','--pid',String(process.pid)],{windowsHide:true});
  const handles=new Set();let buffer='';
  const timer=setTimeout(()=>child.kill(),10000);
  child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{
    buffer+=chunk;const lines=buffer.split(/\r?\n/);buffer=lines.pop();
    for(const line of lines) {
      const packet=JSON.parse(line);
      if(packet.handleAllocated)handles.add(packet.handleAllocated);
      if(handles.size===3&&!child.stdin.writableEnded)child.stdin.end('quit\n');
    }
  });
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
  clearTimeout(timer);
  if(handles.size!==3)throw Error(`Expected three allocations, received ${handles.size}`);
  const release=spawn(executable,['--close-handles',String(process.pid),[...handles].join(',')],{windowsHide:true,stdio:'inherit'});
  const released=await new Promise((resolve,reject)=>{release.on('error',reject);release.on('exit',resolve)});
  if(code!==0||released!==0)throw Error('Native shared GPU handle lifecycle failed');
}
console.log('PASS: three producer restarts, nine parent-owned GPU handles released successfully');
