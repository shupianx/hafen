import { spawnSync } from 'node:child_process';
import { lstat, realpath, rm, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const apply = process.argv.slice(2).includes('--apply');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Use clean:build [-- --apply]');
// Deliberately exclude archives, AAR/XCFramework, Go modules, Pods and npm dependencies.
const names = ['core/.cache/build', 'build/ios/Simulator', 'build/ios/DerivedData', 'build/simulator'];
const targets = [];
for (const name of names) {
  const target = path.join(root, name);
  let info;
  try { info = await lstat(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (info.isSymbolicLink() || !info.isDirectory() || await realpath(target) !== target) throw new Error(`Unexpected cache path: ${target}`);
  const size = spawnSync('du', ['-sk', target], { encoding: 'utf8' });
  if (size.error) throw size.error;
  if (size.status !== 0) throw new Error(`Cannot measure ${target}: ${size.stderr}`);
  const bytes = Number(size.stdout.trim().split(/\s+/)[0]) * 1024;
  targets.push({ name, target, bytes });
  console.log(`${(bytes / 1024 ** 3).toFixed(2)} GiB  ${name}`);
}
console.log(`Total: ${(targets.reduce((sum, t) => sum + t.bytes, 0) / 1024 ** 3).toFixed(2)} GiB`);
if (!apply) {
  console.log('Preview only. Run npm run clean:build -- --apply to remove these rebuildable caches.');
} else {
  try { await lstat(path.join(root, 'core/.build.lock')); throw new Error('Core build lock exists; finish that command before cleanup.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const processes = spawnSync('ps', ['-axo', 'comm='], { encoding: 'utf8' });
  if (processes.error) throw processes.error;
  if (processes.status !== 0) throw new Error('Cannot check active builds; cleanup aborted.');
  const builders = new Set(['go', 'gomobile', 'gobind', 'compile', 'xcodebuild', 'ninja', 'clang', 'clang++', 'ld', 'swift-frontend']);
  const active = processes.stdout.split('\n').map(line => line.trim()).filter(line => builders.has(path.basename(line)));
  if (active.length) throw new Error(`Build processes are still active; cleanup aborted: ${active.join(', ')}`);
  const before = await statfs(root);
  for (const { name, target } of targets) {
    if (await realpath(target) !== target) throw new Error(`Cache path changed: ${target}`);
    await rm(target, { recursive: true });
    console.log(`Removed ${name}`);
  }
  const after = await statfs(root);
  console.log(`Free space change: ${((after.bavail * after.bsize - before.bavail * before.bsize) / 1024 ** 3).toFixed(2)} GiB`);
  console.log('Core artifacts, release archives and downloaded dependencies retained.');
}
