import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTargets } from './core-cache.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mobile = path.join(root, 'apps/mobile');
const mode = process.argv[2];
if (!['android', 'android-preview', 'ios'].includes(mode)) throw new Error('Use android, android-preview or ios');
const raw = process.argv.slice(3);
const dryRun = raw.includes('--dry-run');
const arch = raw.find(arg => arg.startsWith('--arch='))?.slice(7) || process.env.HAFEN_CORE_ARCH || process.arch;
const extra = raw.filter(arg => arg !== '--dry-run' && !arg.startsWith('--arch='));
const platform = mode === 'ios' ? 'ios' : 'android';
const targets = buildTargets(platform, arch);
function run(command, args, cwd = mobile) {
  if (dryRun) { console.log(JSON.stringify({ command, args, cwd })); return; }
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const infoFile = path.join(root, 'core/artifacts/ios/HafenCore.xcframework/Info.plist');
const hostInfoFile = path.join(root, 'core/artifacts/ios-host/HafenHost.xcframework/Info.plist');
const hostBefore = platform === 'ios' ? await readFile(hostInfoFile).catch(e => { if (e.code !== 'ENOENT') throw e; return null; }) : null;
const before = platform === 'ios' ? await readFile(infoFile).catch(e => { if (e.code !== 'ENOENT') throw e; return null; }) : null;
run(process.execPath, [path.join(root, 'scripts/core.mjs'), platform, `--arch=${arch === 'x64' ? 'amd64' : arch}`], root);
if (platform === 'ios') run(process.execPath, [path.join(root, 'scripts/core.mjs'), 'ios-host', `--arch=${arch === 'x64' ? 'amd64' : arch}`], root);
if (platform === 'ios' && !dryRun) {
  const after = await readFile(infoFile);
  // CocoaPods generates slice-specific copy scripts. Refresh them when the
  // XCFramework's architecture layout changes, not on a normal cache hit.
  if (!before?.equals(after) || !hostBefore?.equals(await readFile(hostInfoFile)) || !(await readFile(path.join(mobile, 'ios/Pods/Manifest.lock'), 'utf8').catch(() => '')).includes('HafenHost')) run('bundle', ['exec', 'pod', 'install'], path.join(mobile, 'ios'));
}
const abi = targets.map(target => target.endsWith('/arm64') ? 'arm64-v8a' : 'x86_64').join(',');
if (mode === 'android-preview') {
  // Fresh app packaging avoids unused ZIP space left by incremental APK updates.
  // Dependency and Go caches are retained.
  run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [':app:clean', ':app:assemblePreview', `-PreactNativeArchitectures=${abi}`, ...extra], path.join(mobile, 'android'));
} else {
  const args = platform === 'ios'
    ? ['run-ios', '--buildFolder', path.join(root, 'build/ios/Simulator'), ...extra]
    : ['run-android', '--active-arch-only', ...extra];
  run(process.execPath, [path.join(root, 'node_modules/react-native/cli.js'), ...args]);
}
