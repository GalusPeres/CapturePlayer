// Integration test on the local RTX: animated synthetic video, not a capture
// card latency test. The test windows close automatically after each run.
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const appTest = process.argv.includes('--app');
const pixelTest = process.argv.includes('--pixels');
const cardTest = process.argv.includes('--card');
const testName = appTest ? 'neural-app-smoke' : pixelTest ? 'neural-pixel-smoke' : cardTest ? 'neural-card-smoke' : 'neural-smoke';
const output = path.join(root, `.local/${testName}.cjs`);
if (appTest || cardTest) fs.copyFileSync(path.join(root, 'dist-electron/preload.js'), path.join(root, '.local/preload.js'));
await build({ entryPoints: [path.join(root, `scripts/${testName}.ts`)], outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env };
env.CAPTUREPLAYER_NEURAL_DEBUG = '1';
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [output], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
child.on('exit', code => process.exitCode = code ?? 1);
