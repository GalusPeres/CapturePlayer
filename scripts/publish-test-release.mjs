import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+-(?:alpha|beta|rc)\.\d+$/.test(version)) throw new Error('Test releases require an alpha/beta/rc version.');
const sha = process.env.GITHUB_SHA;
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('Missing workflow commit SHA.');
const output = path.join(root, 'dist', 'test-release');
const names = [`CapturePlayer.Setup.${version}.exe`, `CapturePlayer.${version}.portable.exe`,
  `CapturePlayer.${version}.AppImage`, `CapturePlayer.${version}.arm64.dmg`];
const files = names.map(name => path.join(output, name));
const sums = files.map((file, index) => {
  if (!fs.existsSync(file) || fs.statSync(file).size < 1024 * 1024) throw new Error(`Missing build artifact: ${names[index]}`);
  return `${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${names[index]}`;
});
const checksum = path.join(output, 'SHA256SUMS.txt');
fs.writeFileSync(checksum, `${sums.join('\n')}\n`);
const result = spawnSync('gh', ['release', 'create', `v${version}`, ...files, checksum,
  '--target', sha, '--title', `CapturePlayer ${version} — Test release`, '--prerelease', '--latest=false',
  '--notes-file', path.join(root, 'docs', 'TEST-RELEASE.md')], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`GitHub prerelease creation failed (${result.status}).`);
