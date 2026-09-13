import { sharedTexture, systemPreferences, type WebContents, type SharedTextureImportTextureInfo } from 'electron';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import type { NativeCaptureOptions } from './nativeCapture';

type NativeFrame = SharedTextureImportTextureInfo & {
  token: number; width: number; height: number; dropped: number; error?: string;
};
type CaptureAddon = {
  start(options: NativeCaptureOptions, callback: (frame: NativeFrame) => void): void;
  stop(): void;
  release(token: number): void;
  inspect(options: NativeCaptureOptions): { hdrInputPossible: boolean; reason: string };
};
export class PortableNativeCapture {
  private addon?: CaptureAddon;
  private loadError = '';
  private generation = 0;
  private cancelStart?: () => void;
  private watchdog?: NodeJS.Timeout;
  status: { phase: string; message: string; fps?: number; dropped?: number; hdr?: boolean; width?: number; height?: number } = { phase: 'off', message: 'Off' };
  constructor(private modulePath: string) {}
  available() {
    if (this.addon) return true;
    if (!fs.existsSync(this.modulePath)) return false;
    try {
      // N-API uses a stable ABI; the platform addon stays outside app.asar.
      this.addon = createRequire(this.modulePath)(this.modulePath) as CaptureAddon;
      return true;
    } catch (error) { this.loadError = String(error); return false; }
  }
  stop() {
    ++this.generation;
    clearInterval(this.watchdog); this.watchdog = undefined;
    this.cancelStart?.(); this.cancelStart = undefined;
    this.addon?.stop();
    if (this.status.phase !== 'error') this.status = { phase: 'off', message: 'Off' };
  }
  inspect(options: NativeCaptureOptions) {
    if (!this.available()) return { hdrInputPossible: false, reason: 'Native capture is unavailable on this installation.' };
    return this.addon!.inspect(options);
  }
  async start(options: NativeCaptureOptions, target: WebContents) {
    this.stop(); const generation = this.generation;
    if (!this.available()) throw new Error(this.loadError || 'Native capture is not built for this platform. Run npm run native:build.');
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('camera') !== 'granted') {
      if (!await systemPreferences.askForMediaAccess('camera')) throw new Error('Camera access is required for native capture.');
    }
    if (generation !== this.generation) throw new Error('Native start cancelled.');
    const addon = this.addon!;
    this.status = { phase: 'starting', message: process.platform === 'darwin' ? 'Opening AVFoundation capture…' : 'Opening V4L2 capture…', hdr: options.hdr };
    await new Promise<void>((resolve, reject) => {
      let active = false, stopped = false, frames = 0, lastStats = performance.now(), lastFrame = performance.now();
      const fail = (error: unknown) => {
        if (stopped || generation !== this.generation) return;
        stopped = true; clearTimeout(timeout); clearInterval(this.watchdog); this.watchdog = undefined; this.cancelStart = undefined;
        // Never stop/join the producer from inside its native callback stack.
        queueMicrotask(() => { if (generation === this.generation) this.stop(); });
        const message = error instanceof Error ? error.message : String(error);
        this.status = { phase: 'error', message };
        if (!target.isDestroyed()) target.send('native-capture-error', message);
        reject(new Error(message));
      };
      const timeout = setTimeout(() => fail('Native capture did not produce importable frames.'), 10000);
      this.cancelStart = () => { stopped = true; clearTimeout(timeout); reject(new Error('Native start cancelled.')); };
      try {
        addon.start(options, packet => {
          if (packet.error) { fail(packet.error); return; }
          if (stopped || generation !== this.generation || target.isDestroyed()) { addon.release(packet.token); return; }
          lastFrame = performance.now();
          let transferred = false;
          try {
            if (!Number.isInteger(packet.width) || !Number.isInteger(packet.height) || packet.width !== options.width || packet.height !== options.height)
              throw new Error('The native capture format changed. Restart capture with the new resolution.');
            const imported = sharedTexture.importSharedTexture({ textureInfo: {
              codedSize: { width: packet.width, height: packet.height }, pixelFormat: packet.pixelFormat,
              colorSpace: packet.colorSpace, timestamp: packet.timestamp, handle: packet.handle
            }, allReferencesReleased: () => addon.release(packet.token) });
            transferred = true;
            void sharedTexture.sendSharedTexture({ frame: target.mainFrame, importedSharedTexture: imported }, generation)
              .then(() => {
                if (stopped || generation !== this.generation) return;
                if (!active) {
                  active = true; clearTimeout(timeout); this.cancelStart = undefined;
                  this.watchdog = setInterval(() => {
                    if (performance.now() - lastFrame > 3000) fail('The native capture device stopped delivering frames. Check the signal and restart capture.');
                  }, 1000);
                  this.watchdog.unref();
                  this.status = { phase: 'active', hdr: options.hdr, width: packet.width, height: packet.height,
                    message: `${process.platform === 'darwin' ? 'AVFoundation · IOSurface' : 'V4L2 · DMA-BUF'} · ${packet.pixelFormat} · ${options.hdr ? 'HDR' : 'SDR'}` };
                  resolve();
                }
                ++frames; const now = performance.now();
                if (now - lastStats >= 1000) {
                  this.status.fps = frames * 1000 / (now - lastStats); this.status.dropped = packet.dropped;
                  frames = 0; lastStats = now;
                }
              }).catch(fail).finally(() => imported.release());
          } catch (error) { if (!transferred) addon.release(packet.token); fail(error); }
        });
      } catch (error) { fail(error); }
    });
  }
}
