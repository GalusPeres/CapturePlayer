import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

// Only the runtime actually exercised by this experimental integration is
// accepted. Structural PE checks alone cannot establish runtime compatibility.
export const SUPPORTED_NEURAL_RUNTIME = {
  sha256: 'dcc0dc2414aedec4a8e084647070383be068554042587180c20c784d4772d36f',
  bytes: 165840496,
  version: '310.8.0.0',
};
const filename = 'nvngx_dlssnr.dll';

export async function validateNeuralRuntime(file: string) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== SUPPORTED_NEURAL_RUNTIME.bytes)
      throw new Error('Unsupported DLL. Select the tested nvngx_dlssnr.dll version 310.8.0.0.');
    const header = Buffer.alloc(64);
    await handle.read(header, 0, header.length, 0);
    const offset = header.readUInt32LE(60);
    if (header.toString('ascii', 0, 2) !== 'MZ' || offset < 64 || offset > stat.size - 26)
      throw new Error('The selected file is not a valid Windows DLL.');
    const pe = Buffer.alloc(26); await handle.read(pe, 0, pe.length, offset);
    if (pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664 || pe.readUInt16LE(24) !== 0x20b || !(pe.readUInt16LE(22) & 0x2000))
      throw new Error('Neural Rendering requires the Windows x64 runtime DLL.');
    const hash = createHash('sha256'), chunk = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      hash.update(chunk.subarray(0, bytesRead)); position += bytesRead;
    }
    if (hash.digest('hex') !== SUPPORTED_NEURAL_RUNTIME.sha256)
      throw new Error('This DLL differs from the tested runtime. The previous installation has been kept.');
  } finally { await handle.close(); }
}

export class NeuralRuntimeStore {
  file: string | undefined;
  constructor(private directory: string) {}
  private get installedFile() { return path.join(this.directory, SUPPORTED_NEURAL_RUNTIME.sha256, filename); }
  async initialize(legacyFile?: string) {
    this.file = undefined;
    for (const file of [this.installedFile, legacyFile]) {
      if (!file) continue;
      try { await validateNeuralRuntime(file); this.file = file; return; }
      catch { /* An absent/unrecognized runtime leaves the manual importer available. */ }
    }
  }
  async importFile(source: string) {
    if (path.basename(source).toLowerCase() !== filename)
      throw new Error('Select nvngx_dlssnr.dll, not a different DLSS DLL.');
    await fs.mkdir(this.directory, { recursive: true });
    const staged = path.join(this.directory, `import-${randomUUID()}.dll`);
    try {
      // Copy only the chosen DLL. Never load code or copy neighboring files
      // from the user-selected directory. Verify the copy before activating it.
      const stat = await fs.stat(source);
      if (!stat.isFile() || stat.size !== SUPPORTED_NEURAL_RUNTIME.bytes)
        throw new Error('Unsupported DLL. Select the tested nvngx_dlssnr.dll version 310.8.0.0.');
      await fs.copyFile(source, staged);
      await validateNeuralRuntime(staged);
      await fs.mkdir(path.dirname(this.installedFile), { recursive: true });
      let installed = false;
      try { await validateNeuralRuntime(this.installedFile); installed = true; } catch { /* First import. */ }
      if (!installed) await fs.rename(staged, this.installedFile);
      this.file = this.installedFile;
      return { version: SUPPORTED_NEURAL_RUNTIME.version };
    } finally { await fs.rm(staged, { force: true }); }
  }
}
