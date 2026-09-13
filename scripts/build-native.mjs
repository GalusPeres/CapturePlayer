import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
if (process.platform === 'win32') {
  run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-native-capture.ps1', ...process.argv.slice(2)]);
} else {
  if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Unsupported native capture platform.');
  // N-API 8 is independent of Electron's V8 ABI. Pin build headers so CI and
  // local builds compile the same interface without downloading Electron SDKs.
  const version = 'v22.20.0';
  const cache = path.join(root, '.local', 'native-headers');
  const output = path.join(root, '.local', 'native-addon');
  fs.mkdirSync(cache, { recursive: true }); fs.mkdirSync(output, { recursive: true });
  const archiveName = `node-${version}-headers.tar.gz`;
  const base = `https://nodejs.org/download/release/${version}/`;
  const checksumPath = path.join(cache, `${version}-SHASUMS256.txt`);
  if (!fs.existsSync(checksumPath)) {
    const response = await fetch(`${base}SHASUMS256.txt`);
    if (!response.ok) throw new Error('Cannot fetch Node header checksums.');
    fs.writeFileSync(checksumPath, await response.text());
  }
  const expected = fs.readFileSync(checksumPath, 'utf8').split('\n').find(line => line.endsWith(`  ${archiveName}`))?.split(' ')[0];
  if (!expected) throw new Error('Pinned Node headers are missing from the checksum manifest.');
  const archivePath = path.join(cache, archiveName);
  if (!fs.existsSync(archivePath)) {
    const archive = await fetch(`${base}${archiveName}`);
    if (!archive.ok) throw new Error('Cannot download Node build headers.');
    fs.writeFileSync(archivePath, Buffer.from(await archive.arrayBuffer()));
  }
  if (createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex') !== expected) throw new Error('Node build header checksum mismatch.');
  run('tar', ['-xzf', archivePath, '-C', cache, ...['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h']
    .map(file => `node-${version}/include/node/${file}`)]);
  const include = path.join(cache, `node-${version}`, 'include', 'node');
  const sources = ['native/portable/addon.cpp', `native/portable/${process.platform === 'darwin' ? 'mac.mm' : 'linux.cpp'}`];
  const common = ['-std=c++17', '-O2', '-fPIC', '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=captureplayer', '-I', include];
  const flags = process.platform === 'darwin'
    ? ['-dynamiclib', '-undefined', 'dynamic_lookup', '-fobjc-arc', '-mmacosx-version-min=12.0',
      '-framework', 'AVFoundation', '-framework', 'CoreMedia', '-framework', 'CoreVideo', '-framework', 'Foundation', '-framework', 'IOSurface']
    : ['-shared', '-pthread'];
  run(process.env.CXX || (process.platform === 'darwin' ? 'clang++' : 'g++'), [...common, ...sources, ...flags, '-o', path.join(output, 'captureplayer.node')]);
  console.log(`Built native ${process.platform}/${process.arch} capture addon: ${output}`);
}
