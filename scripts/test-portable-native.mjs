import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
if (!['linux', 'darwin'].includes(process.platform)) throw new Error('Run the portable addon tests on Linux or macOS.');
const include = path.join(root, '.local/native-headers/node-v22.20.0/include/node');
const output = path.join(root, '.local/native-addon/captureplayer-test.node');
const args = ['-std=c++17', '-O2', '-fPIC', '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=captureplayer', '-I', include,
  'native/portable/addon.cpp', 'native/portable/mock.cpp', '-pthread',
  ...(process.platform === 'darwin' ? ['-dynamiclib', '-undefined', 'dynamic_lookup'] : ['-shared']), '-o', output];
const compile = spawnSync(process.env.CXX || (process.platform === 'darwin' ? 'clang++' : 'g++'), args, { cwd: root, stdio: 'inherit' });
if (compile.error || compile.status !== 0) throw new Error('Native callback test compilation failed.');
const addon = require(output);
const options = { device: 'test', width: 640, height: 360, fps: 60, hdr: false };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let received = [];
try {
  assert.throws(() => addon.start({ ...options, width: 0 }, () => {}), /Invalid capture/);
  assert.throws(() => addon.start({ ...options, device: 'fail' }, () => {}), /test open failed/);
  addon.start(options, frame => received.push(frame));
  await sleep(150);
  assert.equal(received.length, 3, 'Backpressure must bound retained native buffers to three');
  const old = received.splice(0);
  addon.stop();
  addon.start(options, frame => { received.push(frame); addon.release(frame.token); });
  await sleep(30);
  assert.equal(received.length, 0, 'Frames retained by the old renderer must remain owned after restart');
  for (const frame of old) addon.release(frame.token);
  await sleep(100);
  assert.ok(received.length > 10, 'Releasing old frames must unblock the new session');
  assert.ok(received.some(frame => frame.dropped > 0), 'Dropped deliveries must be counted');
  addon.stop(); const stoppedCount = received.length;
  await sleep(30); assert.equal(received.length, stoppedCount, 'No old-generation deliveries after stop');
  let error = '';
  addon.start({ ...options, device: 'error' }, frame => {
    if (frame.error) error = frame.error; else addon.release(frame.token);
  });
  await sleep(100); assert.equal(error, 'test capture disconnected');
  addon.stop();
  // Also test the actual platform module's argument validation without opening
  // a camera (important for macOS hosted runners without camera permission).
  const actual = require(path.join(root, '.local/native-addon/captureplayer.node'));
  assert.throws(() => actual.start({ ...options, fps: 0 }, () => {}), /Invalid capture/);
  actual.stop();
  fs.writeFileSync(path.join(root, '.local/native-addon/ownership-test.json'), JSON.stringify({ platform: process.platform, arch: process.arch,
    passed: true, cases: ['argument validation', 'open failure', 'bounded buffers', 'restart with retained frames', 'release', 'stop', 'device error'],
    hardwareCaptureTested: false }, null, 2));
  console.log('PASS: native callback ownership, bounded buffers, restart, cancellation, and error delivery. No capture hardware tested.');
} finally { addon.stop(); }
