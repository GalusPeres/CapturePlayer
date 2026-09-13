// Hidden GPU regression: pipe input/output only; never opens a preview window
// or the capture card. Pixel readback is restricted to this test harness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const width = 640, height = 360;
const input = process.argv[2] ? fs.readFileSync(process.argv[2]) : Buffer.alloc(width * height * 4);
if (!process.argv[2]) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4;
  input[i] = 30 + (x * 3 + y) % 190;
  input[i + 1] = 35 + (y * 2 + (x >> 5) * 25) % 160;
  input[i + 2] = 40 + (x + y * 3) % 180;
  input[i + 3] = 255;
}
assert.equal(input.length, width * height * 4, 'Expected 640x360 RGBA8 fixture');
const runtime = path.resolve('.local/neural-runtime');
const child = spawn(path.join(runtime, 'CapturePlayerNeural.exe'), ['--video'], {
  cwd: runtime, windowsHide: true,
  env: { ...process.env, CAPTUREPLAYER_PARENT_PID: String(process.pid), NS_NR_SMALL: '0', NS_PW: '0', NS_SPOUT: '0', NS_ARCH_SPOOF: '1', CAPTUREPLAYER_NEURAL_HDR: '0' }
});
let data = Buffer.alloc(0), tail = '', index = 0;
let importedRuntimeSeen = !process.env.NS_NR_DLL;
child.stdout.on('data', b => { data = Buffer.concat([data, b]); });
child.stderr.on('data', b => {
  tail = (tail + b.toString()).slice(-5000);
  if (process.env.NS_NR_DLL && tail.includes('NS_NR_DLL=' + process.env.NS_NR_DLL)) importedRuntimeSeen = true;
});
child.stdin.on('error', () => {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function read(size) {
  const until = Date.now() + 30000;
  while (data.length < size) {
    if (Date.now() > until || child.exitCode !== null) throw Error(`Worker failed (${child.exitCode}): ${tail}`);
    await sleep(2);
  }
  const value = data.subarray(0, size); data = data.subarray(size); return value;
}
async function tune(values, accepted = true) {
  const packet = Buffer.alloc(24); packet.writeUInt32LE(0x454e5554);
  values.forEach((v, i) => packet.writeFloatLE(v, 4 + i * 4));
  child.stdin.write(packet); const ack = await read(24);
  assert.equal(ack.readUInt32LE(0), 0x4b414e54);
  assert.equal(ack.readUInt32LE(4), Number(accepted));
  if (accepted) values.forEach((v, i) => assert.ok(Math.abs(ack.readFloatLE(8 + i * 4) - v) < .00001));
}
async function frame() {
  const packet = Buffer.alloc(24); packet.writeUInt32LE(0x314d5246);
  packet.writeUInt32LE(index++, 4); packet.writeUInt32LE(1, 8);
  child.stdin.write(packet); child.stdin.write(input); child.stdin.write(Buffer.alloc(width * height * 4));
  const out = await read(28);
  assert.equal(out.readUInt32LE(0), 0x3154554f);
  assert.equal(out.readUInt32LE(8), 1);
  assert.equal(out.readUInt32LE(12), input.length);
  assert.equal(out.readUInt32LE(16), 1, 'NGX evaluation must succeed');
  return read(input.length);
}
try {
  const header = Buffer.alloc(64);
  [0x33563544, width, height, 1, 0, 1, 0, 1, 0, 0].forEach((v, i) => header.writeUInt32LE(v, i * 4));
  [1, 1, 1, -1].forEach((v, i) => header.writeFloatLE(v, 40 + i * 4));
  child.stdin.write(header);
  const original = await frame();
  const results = [];
  for (const [name, values] of [['intensity', [0,1,1,-1]], ['tone', [1,0,1,-1]], ['structure', [1,1,0,-1]], ['skin', [1,1,1,0]]]) {
    // Isolate skin strength from the automatic mask switch: both sides use
    // manual skin values (and therefore the same enabled mask).
    let baseline = original;
    if (name === 'skin') { await tune([1,1,1,1]); baseline = await frame(); }
    await tune(values); const changed = await frame();
    let total = 0, different = 0;
    for (let i = 0; i < input.length; i++) if (i % 4 !== 3) {
      total += Math.abs(baseline[i] - changed[i]); if (baseline[i] !== changed[i]) different++;
    }
    results.push({ name, meanChannelDifference: total / (width * height * 3), changedChannels: different });
    // Skin may not be recognized in a fixture; never claim detection from a successful ACK.
    if (name !== 'skin') assert.ok(different > 100, `${name} must alter the actual model output`);
    await tune([1,1,1,-1]); assert.ok(original.equals(await frame()), 'Reset must exactly restore the original model output');
  }
  for (const values of [[NaN,1,1,-1], [1,Infinity,1,-1], [1,1,2,-1], [1,1,1,-2]]) await tune(values, false);
  assert.ok(original.equals(await frame()), 'Invalid commands must leave valid settings intact');
  assert.ok(importedRuntimeSeen, 'Worker did not acknowledge the imported runtime path');
  fs.mkdirSync('.local/benchmarks', { recursive: true });
  fs.writeFileSync('.local/benchmarks/neural-tuning-pixels.json', JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  console.log('PASS: live tuning, exact reset, invalid input rejected; no window or capture card opened', results);
} finally {
  child.stdin.end(); await sleep(400); if (child.exitCode === null) child.kill();
}
