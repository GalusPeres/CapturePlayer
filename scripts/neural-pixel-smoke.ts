// Pixel readback is confined to this regression harness, never the player.
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = process.cwd();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
app.setPath('userData', path.join(root, '.local/neural-pixel-profile'));
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.on('window-all-closed', () => {});
const report: unknown[] = [];
async function run() {
  await app.whenReady();
  const win = new BrowserWindow({ width: 1280, height: 720, minWidth: 1280, minHeight: 720, thickFrame: false, frame: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0"><canvas width="1280" height="720"></canvas><script>
    const c=document.querySelector('canvas'),x=c.getContext('2d');
    const g=x.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#294363');g.addColorStop(1,'#dac08a');x.fillStyle=g;x.fillRect(0,0,1280,720);
    for(let i=0;i<30;i++){x.fillStyle=i%2?'#8b733a':'#376731';x.fillRect(i*63,200+(i%3)*30,35,200);}
    ['#ff0000','#00ff00','#0000ff','#808080'].forEach((c,i)=>{x.fillStyle=c;x.fillRect(40+i*160,40,120,120)});
    x.fillStyle='white';x.font='32px sans-serif';x.fillText('Static color and strength regression',40,660);
    </script>`));
  win.show(); win.focus(); await wait(700);
  for (const work of [{ width: 1280, height: 720 }, { width: 640, height: 360 }]) {
    let baseline: Buffer | undefined;
    for (const fast of ['0', '1']) {
      const runtime = path.join(root, '.local/neural-runtime');
      const child = spawn(path.join(runtime, 'CapturePlayerNeural.exe'), ['--video'], { cwd: runtime, windowsHide: true,
        env: { ...process.env, CAPTUREPLAYER_PARENT_PID: String(process.pid), CAPTUREPLAYER_FAST_PATH: fast, NS_NR_SMALL: '1', NS_PW: '0', NS_SPOUT: '0', NS_ARCH_SPOOF: '1' } });
      let data = Buffer.alloc(0), tail = '';
      child.stdout.on('data', b => { data = Buffer.concat([data, b]); });
      child.stderr.on('data', b => { tail = (tail + b.toString()).slice(-3000); });
      child.stdin.on('error', () => {});
      const read = async (size: number) => {
        const until = Date.now() + 30000;
        while (data.length < size) {
          if (Date.now() > until || child.exitCode !== null) throw new Error(`Worker read failed ${child.exitCode}: ${tail}`);
          await wait(1);
        }
        const result = data.subarray(0, size); data = data.subarray(size); return result;
      };
      const command = (magic: number, w: number, h: number, size = 24) => {
        const b = Buffer.alloc(size); b.writeUInt32LE(magic); b.writeUInt32LE(w, 4); b.writeUInt32LE(h, 8); return b;
      };
      try {
        const header = Buffer.alloc(64);
        [0x33563544, work.width, work.height, 1, 0, 1, 0, 1, 0, 0].forEach((n, i) => header.writeUInt32LE(n, i * 4));
        [1, 1, 1, -1].forEach((n, i) => header.writeFloatLE(n, 40 + i * 4));
        header.writeUInt32LE(1280, 56); header.writeUInt32LE(720, 60); child.stdin.write(header);
        child.stdin.write(command(0x53544f4d, 8, 8)); assert.equal((await read(24)).readUInt32LE(4), 1);
        const wgc = command(0x57434757, 1280, 720, 32); wgc.writeBigUInt64LE(win.getNativeWindowHandle().readBigUInt64LE(), 24);
        child.stdin.write(wgc); const ack = await read(24); assert.equal(ack.readUInt32LE(4), 1); assert.equal(ack.readUInt32LE(8), 1280);
        child.stdin.write(command(0x4f444e57, 1280, 720)); assert.equal((await read(24)).readUInt32LE(4), 1);
        const frame = async (strength: number, bypass = false) => {
          for (let attempt = 0; attempt < 30; attempt++) {
            const packet = command(0x314d5246, attempt, 1, 280);
            packet.writeUInt32LE(0x8 | 0x4 | 0x2 | 0x80 | (strength << 8) | (bypass ? 0x10 : 0), 12);
            child.stdin.write(packet); const out = await read(28); const size = out.readUInt32LE(12);
            if (!size) { await wait(20); continue; }
            assert.equal(size, 1280 * 720 * 4); return read(size);
          }
          throw new Error('No captured pixels');
        };
        const raw = await frame(100, true);
        for (const [i, rgb] of [[0, [255, 0, 0]], [1, [0, 255, 0]], [2, [0, 0, 255]]] as const) {
          const offset = (90 * 1280 + 90 + i * 160) * 4;
          assert.deepEqual([...raw.subarray(offset, offset + 3)], rgb, 'Capture channel order must be RGB');
        }
        const full = await frame(100), half = await frame(50), zero = await frame(0);
        let zeroMax = 0, deltaFull = 0, deltaHalf = 0;
        for (let i = 0; i < raw.length; i += 4) for (let channel = 0; channel < 3; channel++) {
          const p = i + channel;
          zeroMax = Math.max(zeroMax, Math.abs(raw[p] - zero[p]));
          deltaFull += Math.abs(raw[p] - full[p]); deltaHalf += Math.abs(raw[p] - half[p]);
        }
        assert.ok(zeroMax <= 1, `0% must preserve original: error ${zeroMax}`);
        assert.ok(deltaFull > 10000, 'Real neural effect must change pixels');
        assert.ok(deltaHalf / deltaFull > .35 && deltaHalf / deltaFull < .7, '50% must reduce effect approximately halfway');
        if (baseline) assert.ok(baseline.equals(full), 'Optimized GPU copy must produce identical neural pixels');
        else baseline = Buffer.from(full);
        report.push({ work, fast, zeroMax, halfRatio: deltaHalf / deltaFull, identical: fast === '1' });
      } finally { child.stdin.end(); await wait(400); if (child.exitCode === null) child.kill(); }
    }
  }
  win.destroy();
  fs.writeFileSync(path.join(root, '.local/neural-pixels.json'), JSON.stringify(report, null, 2));
  console.log('PASS: RGB channels, original at 0%, half strength, identical old/new pixels at native and scaled AI sizes', report);
  app.quit();
}
run().catch(e => { console.error(e); app.exit(1); });
