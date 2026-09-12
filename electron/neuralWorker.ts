import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { NeuralQuality, NeuralStatus } from '../src/types/neural';

export type NeuralOptions = { hwnd: bigint; width: number; height: number; quality: NeuralQuality; split: boolean; strength?: number };
type Pending = { size: number; resolve: (b: Buffer) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
const MAGIC = { header: 0x33563544, frame: 0x314d5246, out: 0x3154554f, motion: 0x53544f4d, mack: 0x4b43414d, wgc: 0x57434757, wgak: 0x4b414757, window: 0x4f444e57, wack: 0x4b434157 };

export function workSize(width: number, height: number, quality: NeuralQuality) {
  const limit = quality === '720p' ? 720 : quality === '900p' ? 900 : quality === '1440p' ? 1440 : 1080;
  const scale = Math.min(1, limit / height, (limit * 16 / 9) / width);
  return { width: Math.max(64, Math.floor(width * scale / 2) * 2), height: Math.max(64, Math.floor(height * scale / 2) * 2) };
}

function command(magic: number, width: number, height: number, flags = 0) {
  const b = Buffer.alloc(24);
  b.writeUInt32LE(magic, 0); b.writeUInt32LE(width, 4); b.writeUInt32LE(height, 8); b.writeUInt32LE(flags, 12);
  return b;
}

// One outstanding request, one native frame. No VideoFrame readback or pixel
// buffers in Electron. Only fixed-size control/status packets cross the pipe.
export class NeuralWorker {
  private child?: ChildProcessWithoutNullStreams;
  private pending?: Pending;
  private buffer = Buffer.alloc(0);
  private generation = 0;
  private confirmed = false;
  private split = false;
  private strength = 100;
  private selectedQuality: NeuralQuality = 'auto';
  private lastLog = '';
  private status: NeuralStatus;

  constructor(private runtimeDir: string) {
    this.status = { phase: 'off', available: this.available(), message: 'Off' };
  }
  available() {
    return process.platform === 'win32' && ['CapturePlayerNeural.exe', 'nvngx.dll_ns-forwarder.dll', 'nvngx_dlssnr.dll'].every(f => fs.existsSync(path.join(this.runtimeDir, f)));
  }
  getStatus(): NeuralStatus { return { ...this.status, available: this.available(), selectedQuality: this.selectedQuality, strength: this.strength, split: this.split }; }
  setSplit(value: boolean) { this.split = value; }
  setStrength(value: number) { this.strength = Math.round(Math.min(100, Math.max(0, value))); }
  pause(message: string) {
    this.stop(message);
    this.status.phase = 'starting';
  }

  stop(message = 'Off', error = false) {
    ++this.generation;
    const child = this.child;
    this.child = undefined;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('Preview stopped'));
      this.pending = undefined;
    }
    this.buffer = Buffer.alloc(0);
    if (child) {
      // Ending stdin requests cleanup; kill bounds shutdown if NGX is stuck.
      child.stdin.end();
      const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 250);
      killTimer.unref();
      child.once('exit', () => clearTimeout(killTimer));
    }
    this.status = { phase: error ? 'error' : 'off', available: this.available(), message };
  }

  private request(data: Buffer, size: number, timeout = 1500): Promise<Buffer> {
    if (this.pending || !this.child) return Promise.reject(new Error('Invalid worker request state'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error('Neural processing timed out; original video restored.'));
      }, timeout);
      this.pending = { size, resolve, reject, timer };
      this.child!.stdin.write(data, error => {
        if (error && this.pending?.timer === timer) {
          clearTimeout(timer); this.pending = undefined; reject(error);
        }
      });
    });
  }

  async start(options: NeuralOptions, reduction = 0): Promise<void> {
    this.stop();
    const generation = this.generation;
    if (!this.available()) {
      this.status = { phase: 'error', available: false, message: 'Local neural runtime missing. Run npm run neural:setup.' };
      return;
    }
    const { width, height } = options;
    // WGC can include a few physical pixels of DWM border around a 4K window.
    if (![width, height].every(n => Number.isInteger(n) && n >= 64) || width > 4128 || height > 2192 || options.hwnd <= 0n) {
      this.status = { phase: 'error', available: true, message: 'Preview supports windows from 64 pixels up to 4096 × 2160.' };
      return;
    }
    const quality = reduction === 1 ? '900p' : reduction >= 2 ? '720p' : options.quality;
    const work = workSize(width, height, quality);
    this.split = options.split;
    this.setStrength(options.strength ?? this.strength);
    this.selectedQuality = options.quality;
    this.confirmed = false;
    this.lastLog = '';
    this.status = { phase: 'starting', available: true, message: 'Warming up neural rendering…', quality: `${work.width} × ${work.height}`, outputWidth: width, outputHeight: height };
    const child = spawn(path.join(this.runtimeDir, 'CapturePlayerNeural.exe'), ['--video'], {
      cwd: this.runtimeDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CAPTUREPLAYER_PARENT_PID: String(process.pid), NS_NR_SMALL: '1', NS_PHASE: '1', NS_PW: '0', NS_SPOUT: '0', NS_ARCH_SPOOF: '1' }
    });
    this.child = child;
    child.stdin.on('error', () => {}); // handled by the request/exit path
    child.stdout.on('data', (chunk: Buffer) => {
      if (generation !== this.generation) return;
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const p = this.pending;
      if (!p || this.buffer.length > 64) { this.stop('Unexpected worker response; original video restored.', true); return; }
      if (this.buffer.length >= p.size) {
        const packet = this.buffer.subarray(0, p.size);
        this.buffer = this.buffer.subarray(p.size);
        clearTimeout(p.timer); this.pending = undefined; p.resolve(packet);
      }
    });
    let logBuffer = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (generation !== this.generation) return;
      logBuffer = (logBuffer + chunk.toString()).slice(-16000);
      const lines = logBuffer.split(/\r?\n/); logBuffer = lines.pop() || '';
      for (const line of lines) {
        if (process.env.CAPTUREPLAYER_NEURAL_DEBUG === '1' && !/\[skip\]|delivered frame/.test(line)) console.error(line);
        this.lastLog = line.slice(-350);
        if (line.includes('direct feature 18 confirmed')) this.confirmed = true;
        const gpu = /eval on GPU ([\d.]+)/.exec(line);
        if (gpu) this.status.gpuMs = Number(gpu[1]);
        const cadence = /\[cadence\] present gaps p95=([\d.]+) max=([\d.]+) over25=(\d+)/.exec(line);
        if (cadence) {
          this.status.presentGapP95Ms = Number(cadence[1]);
          this.status.presentGapMaxMs = Number(cadence[2]);
          this.status.presentGapsOver25Ms = Number(cadence[3]);
        }
      }
    });
    const failed = (reason: string) => {
      if (generation === this.generation) this.stop(reason, true);
    };
    child.on('error', error => failed(error.message));
    child.on('exit', code => failed(`Neural worker exited (${code}). ${this.lastLog}`));
    try {
      const header = Buffer.alloc(64);
      [MAGIC.header, work.width, work.height, 1, 0, 1, 0, 1, 0, 0].forEach((v, i) => header.writeUInt32LE(v, i * 4));
      [1, 1, 1, -1].forEach((v, i) => header.writeFloatLE(v, 40 + i * 4));
      header.writeUInt32LE(width, 56); header.writeUInt32LE(height, 60);
      child.stdin.write(header);
      // This first prototype deliberately resets history each frame: no game
      // motion/depth buffers are available. It must not reuse incorrect motion.
      const motion = await this.request(command(MAGIC.motion, 8, 8), 24, 30000);
      if (motion.readUInt32LE(0) !== MAGIC.mack || motion.readUInt32LE(4) !== 1) throw new Error('Motion input setup failed');
      const wgc = Buffer.alloc(32);
      command(MAGIC.wgc, width, height).copy(wgc);
      wgc.writeBigUInt64LE(options.hwnd, 24);
      const capture = await this.request(wgc, 24, 10000);
      if (capture.readUInt32LE(0) !== MAGIC.wgak || capture.readUInt32LE(4) !== 1) throw new Error('Window capture failed');
      if (capture.readUInt32LE(8) !== width || capture.readUInt32LE(12) !== height) {
        // Trust the physical capture size over Electron's rounded DPI estimate.
        const actual = { ...options, width: capture.readUInt32LE(8), height: capture.readUInt32LE(12) };
        if (generation === this.generation) {
          this.stop();
          await new Promise(resolve => setTimeout(resolve, 300));
          if (this.generation === generation + 1) void this.start({ ...actual, split: this.split, strength: this.strength }, reduction);
        }
        return;
      }
      const window = await this.request(command(MAGIC.window, width, height), 24, 10000);
      if (window.readUInt32LE(0) !== MAGIC.wack || window.readUInt32LE(4) !== 1) throw new Error('Native preview window failed');
      let count = 0, frameIndex = 0, slowWindows = 0;
      let firstFrame = true;
      let times: number[] = [];
      let windowStart = performance.now();
      const started = windowStart;
      const packet = Buffer.alloc(24 + 8 * 8 * 4); // Reuse one control packet; no frame queue.
      while (generation === this.generation) {
        const index = frameIndex++ >>> 0;
        packet.writeUInt32LE(MAGIC.frame, 0); packet.writeUInt32LE(index, 4);
        packet.writeUInt32LE(1, 8); // reset temporal history
        packet.writeUInt32LE((0x8 | 0x4 | 0x40 | 0x80 | (this.strength << 8) | (this.strength === 0 ? 0x10 : 0) | (this.split ? 0x20 | (32768 << 16) : 0)) >>> 0, 12);
        const response = await this.request(packet, 28, firstFrame ? 30000 : 1500);
        if (response.readUInt32LE(0) !== MAGIC.out || response.readUInt32LE(4) !== index || response.readUInt32LE(12) !== 0) throw new Error('Invalid frame response');
        const fresh = response.readUInt32LE(8) === 1;
        if (![1, 2].includes(response.readUInt32LE(8))) throw new Error('Neural frame failed');
        if (fresh) {
          firstFrame = false;
          if (response.readUInt32LE(16) !== 1) throw new Error('Neural evaluation did not succeed');
          count++;
          const processingMs = Number(response.readBigInt64LE(20)) / 1000;
          if (!Number.isFinite(processingMs) || processingMs < 0 || processingMs > 60000) throw new Error('Invalid processing time');
          times.push(processingMs);
          if (this.confirmed) {
            this.status.phase = 'active';
            this.status.message = reduction ? `Active · auto reduced to ${quality}` : 'Active · experimental';
          }
        } else {
          // Native WGC waits on its frame-arrival event; no polling timer or
          // extra Windows timer tick is inserted into the presentation path.
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        const now = performance.now();
        if (now - windowStart >= 2000) {
          const sorted = [...times].sort((a, b) => a - b);
          const mean = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
          this.status.fps = count * 1000 / (now - windowStart);
          this.status.processingMs = mean;
          this.status.p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
          if (now - started > 4000 && times.length > 20) slowWindows = mean > 17.5 ? slowWindows + 1 : 0;
          if (slowWindows >= 3) {
            if (options.quality === 'auto' && reduction < 2) {
              this.stop('Reducing neural resolution…');
              const nextGeneration = this.generation;
              await new Promise(resolve => setTimeout(resolve, 300));
              if (nextGeneration === this.generation) void this.start({ ...options, split: this.split, strength: this.strength }, reduction + 1);
            } else {
              this.stop('60 FPS processing budget exceeded. Original video restored; try a lower AI resolution.');
            }
            return;
          }
          count = 0; times = []; windowStart = now;
        }
      }
    } catch (error) {
      failed(error instanceof Error ? error.message : String(error));
    }
  }
}
