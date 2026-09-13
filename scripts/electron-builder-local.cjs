// Local unsigned Windows builds without the legacy archive's macOS symlinks.
const { build } = require('../package.json');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getRceditBundle } = require('app-builder-lib/out/toolsets/windows');
module.exports = {
  ...build,
  publish: null,
  directories: { ...build.directories, output: 'dist/manual-neural-local' },
  win: { ...build.win, signAndEditExecutable: false, target: [{ target: 'nsis', arch: ['x64'] }] },
  afterPack: async context => {
    await require('./verify-native-package.cjs')(context);
    const editor = await getRceditBundle('1.1.0');
    await promisify(execFile)(editor.x64, [
      path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`),
      '--set-icon', path.resolve(__dirname, '../src/assets/icons/icon.ico'),
      '--set-version-string', 'ProductName', context.packager.appInfo.productName,
      '--set-version-string', 'FileDescription', context.packager.appInfo.productName,
      '--set-version-string', 'CompanyName', 'galusperes',
      '--set-file-version', context.packager.appInfo.version,
      '--set-product-version', context.packager.appInfo.version,
    ], { windowsHide: true });
  },
};
