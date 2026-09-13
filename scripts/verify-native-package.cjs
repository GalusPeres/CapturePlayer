// electron-builder hook: never ship a missing or wrong-architecture native backend.
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');
module.exports = async ({ electronPlatformName, appOutDir, packager, arch }) => {
  if (electronPlatformName !== 'win32') {
    const resources = electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(appOutDir, 'resources');
    const addon = path.join(resources, 'native-capture', 'captureplayer.node');
    if (!fs.existsSync(addon) || fs.statSync(addon).size < 4096) throw new Error(`Missing native capture addon: ${addon}`);
    const header = fs.readFileSync(addon).subarray(0, 64);
    const target = Arch[arch];
    if (electronPlatformName === 'darwin') {
      const cpu = target === 'arm64' ? 0x0100000c : target === 'x64' ? 0x01000007 : -1;
      if (header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== cpu)
        throw new Error(`Native macOS addon does not match ${target}. Build it on the matching Mac runner.`);
    } else {
      const machine = target === 'x64' ? 62 : target === 'arm64' ? 183 : -1;
      if (header.subarray(0, 4).toString('hex') !== '7f454c46' || header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== machine)
        throw new Error(`Native Linux addon does not match ${target}.`);
    }
    console.log(`Verified packaged ${electronPlatformName} capture addon.`);
    return;
  }
  const required = [
    'CapturePlayerCapture.exe', 'msvcp140.dll', 'msvcp140_1.dll',
    'msvcp140_2.dll', 'msvcp140_atomic_wait.dll', 'msvcp140_codecvt_ids.dll',
    'vcruntime140.dll', 'vcruntime140_1.dll'
  ];
  for (const name of required) {
    const file = path.join(appOutDir, 'native-capture', name);
    const descriptor = fs.openSync(file, 'r');
    try {
      const header = Buffer.alloc(2);
      if (fs.readSync(descriptor, header, 0, 2, 0) !== 2 || header.toString() !== 'MZ') {
        throw new Error(`Invalid native Windows binary: ${file}`);
      }
    } finally { fs.closeSync(descriptor); }
  }
  console.log('Verified native Windows capture helper and app-local C++ runtime.');
  for (const name of ['CapturePlayerNeural.exe', 'nvngx.dll_ns-forwarder.dll', 'NeuralScreen-LICENSE.txt', ...required.slice(1)]) {
    const file = path.join(appOutDir, 'neural-runtime', name);
    if (!fs.existsSync(file) || fs.statSync(file).size < 100) throw new Error(`Missing packaged Neural helper/dependency: ${name}`);
  }
  if (packager.appInfo.productFilename !== 'CapturePlayer Neural Test' && fs.existsSync(path.join(appOutDir, 'neural-runtime', 'nvngx_dlssnr.dll')))
    throw new Error('The NVIDIA model DLL must not be bundled in the public package.');
  console.log('Verified Neural helpers and manual-runtime package separation.');
};
