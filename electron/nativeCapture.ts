import { sharedTexture, type WebContents } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';

export type NativeCaptureOptions = { device: string; width: number; height: number; fps: number; hdr: boolean };
export class NativeCapture {
  private child?: ChildProcessWithoutNullStreams;
  private generation = 0;
  status: { phase: string; message: string; fps?: number; dropped?: number; hdr?: boolean; width?: number; height?: number } = { phase: 'off', message: 'Off' };
  constructor(private executable: string) {}
  available() { return process.platform === 'win32' && fs.existsSync(this.executable); }
  stop() {
    ++this.generation;
    const child = this.child; this.child = undefined;
    if (child) {
      child.stdin.end('quit\n');
      const timer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 400);
      timer.unref(); child.once('exit', () => clearTimeout(timer));
    }
    if (this.status.phase !== 'error') this.status = { phase: 'off', message: 'Off' };
  }
  async start(options: NativeCaptureOptions, target: WebContents) {
    this.stop(); const generation = this.generation;
    if (!this.available()) throw new Error('Native capture is not installed. Run npm run native:build.');
    this.status = { phase: 'starting', message: 'Opening native P010 capture…', hdr: options.hdr };
    const child = spawn(this.executable, ['--pid', String(process.pid), '--device', options.device,
      '--width', String(options.width), '--height', String(options.height), '--fps', String(options.fps), '--hdr', options.hdr ? '1' : '0'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    child.stdin.on('error', () => {});
    const handles = new Set<string>();
    let closed = false, imports = 0, cleaned = false;
    const cleanup = () => {
      if (!closed || imports || cleaned || !handles.size) return;
      cleaned = true;
      const release = spawn(this.executable, ['--close-handles', String(process.pid), [...handles].join(',')], { windowsHide: true, stdio: 'ignore' });
      release.once('error', error => console.error('Native handle cleanup failed:', error.message));
      release.once('exit', code => { if (code) console.error('Native handle cleanup exited:', code); });
    };
    child.once('close', () => { closed = true; cleanup(); });
    return new Promise<void>((resolve, reject) => {
      let ready = false, width = 0, height = 0;
      const fail = (message: string) => {
        if (generation !== this.generation) { reject(new Error('Native start cancelled')); return; }
        clearTimeout(timeout); this.stop(); this.status = { phase: 'error', message };
        if (!target.isDestroyed()) target.send('native-capture-error', message);
        reject(new Error(message));
      };
      const timeout = setTimeout(() => fail('Native capture did not produce frames.'), 10000);
      child.once('error', error => fail(error.message));
      child.once('exit', code => { if (generation === this.generation) fail(`Native capture exited (${code}).`); else if (!ready) { clearTimeout(timeout); reject(new Error('Native start cancelled')); } });
      let buffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.length > 65536) { fail('Invalid native capture response'); return; }
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
        for (const line of lines) {
          let packet: any;
          try { packet = JSON.parse(line); } catch { fail('Invalid native capture response'); return; }
          if (typeof packet.handleAllocated === 'string' && /^[1-9]\d{0,19}$/.test(packet.handleAllocated)) {
            handles.add(packet.handleAllocated); continue;
          }
          if (generation !== this.generation) continue;
          if (packet.error) { fail(String(packet.error)); return; }
          if (packet.ready) {
            width = packet.width; height = packet.height;
            if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width > 4096 || height > 2160) { fail('Invalid native dimensions'); return; }
            this.status = { phase: 'starting', width, height, hdr: options.hdr,
              message: options.hdr ? 'P010 · HDR10 input selected manually' : 'P010 · SDR input' };
          }
          if (packet.stats) Object.assign(this.status, { fps: packet.fps, dropped: packet.dropped, timing: packet.timing });
          if (Number.isInteger(packet.frame) && packet.frame >= 0 && packet.frame < 3 && width && height) {
            const id = packet.frame;
            const handle = Buffer.alloc(8);
            let counted = false;
            try {
              handle.writeBigUInt64LE(BigInt(packet.handle));
              ++imports; counted = true;
              if (!ready) console.log('Native: importing first GPU texture', width, height, packet.handle);
              const imported = sharedTexture.importSharedTexture({ textureInfo: {
                pixelFormat: 'rgbaf16', codedSize: { width, height }, handle: { ntHandle: handle }, timestamp: packet.timestamp,
                colorSpace: options.hdr
                  ? { primaries: 'bt709', transfer: 'linear', matrix: 'rgb', range: 'full' }
                  : { primaries: 'bt709', transfer: 'bt709', matrix: 'rgb', range: 'full' }
              }, allReferencesReleased: () => {
                --imports; cleanup();
                if (generation === this.generation && !child.stdin.destroyed) child.stdin.write(`release ${id}\n`);
              } });
              counted = false; // ownership of the count passed to the release callback
              if (!ready) console.log('Native: texture imported');
              void sharedTexture.sendSharedTexture({ frame: target.mainFrame, importedSharedTexture: imported }, generation)
                .then(() => {
                  if (generation !== this.generation) return;
                  if (!ready) { ready = true; clearTimeout(timeout); this.status.phase = 'active'; resolve(); }
                }).catch(error => fail(String(error))).finally(() => imported.release());
            } catch (error) { if (counted) { --imports; cleanup(); } fail(String(error)); return; }
          }
        }
      });
    });
  }
}
