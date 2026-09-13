// Local experimental Windows distribution, isolated from the normal release.
const { build } = require('../package.json');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getRceditBundle } = require('app-builder-lib/out/toolsets/windows');
module.exports = {
  ...build,
  appId: 'com.captureplayer.neural-test',
  productName: 'CapturePlayer Neural Test',
  extraMetadata: { name: 'captureplayer-neural-test', productName: 'CapturePlayer Neural Test' },
  publish: null,
  directories: { ...build.directories, output: '.local/neural-package' },
  extraFiles: [
    { from: '.local/native-capture', to: 'native-capture', filter: ['CapturePlayerCapture.exe'] },
    { from: '.local/neural-runtime', to: 'neural-runtime', filter: ['CapturePlayerNeural.exe', 'nvngx.dll_ns-forwarder.dll', 'nvngx_dlssnr.dll', 'NeuralScreen-LICENSE.txt'] },
    { from: '.local/windows-redist', to: 'native-capture', filter: ['*.dll'] },
    { from: '.local/windows-redist', to: 'neural-runtime', filter: ['*.dll'] },
    { from: 'docs/DLSS5-EXPERIMENT.md', to: 'DLSS5-EXPERIMENT.md' },
    { from: 'docs/NATIVE-RENDERER.md', to: 'NATIVE-RENDERER.md' }
  ],
  toolsets: { winCodeSign: '1.1.0' },
  // The legacy resource-editor archive contains macOS symlinks which cannot
  // be unpacked by an ordinary Windows account. Use its Windows-only bundle.
  win: { ...build.win, extraFiles: [], signAndEditExecutable: false, target: [{ target: 'nsis', arch: ['x64'] }] },
  afterPack: async context => {
    await require('./verify-native-package.cjs')(context);
    const editor = await getRceditBundle('1.1.0');
    await promisify(execFile)(editor.x64, [
      path.join(context.appOutDir, 'CapturePlayer Neural Test.exe'),
      '--set-icon', path.resolve(__dirname, '../src/assets/icons/icon.ico'),
      '--set-version-string', 'ProductName', 'CapturePlayer Neural Test',
      '--set-version-string', 'FileDescription', 'CapturePlayer Neural Test',
      '--set-version-string', 'CompanyName', 'galusperes',
      '--set-file-version', context.packager.appInfo.version,
      '--set-product-version', context.packager.appInfo.version
    ], { windowsHide: true });
  },
  nsis: { ...build.nsis, artifactName: 'CapturePlayer.NeuralTest.Setup.${version}.${ext}', shortcutName: 'CapturePlayer Neural Test' }
};
