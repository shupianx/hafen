import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTargets, hashTree, bindingSources, reuseFailure } from '../core-cache.mjs';

test('development targets use the host architecture; universal and device slices remain available', () => {
  assert.deepEqual(buildTargets('android', 'arm64'), ['android/arm64']);
  assert.deepEqual(buildTargets('android', 'x64'), ['android/amd64']);
  assert.deepEqual(buildTargets('ios', 'arm64'), ['ios/arm64', 'iossimulator/arm64']);
  assert.deepEqual(buildTargets('ios', 'amd64'), ['ios/arm64', 'iossimulator/amd64']);
  assert.deepEqual(buildTargets('ios', 'all'), ['ios/arm64', 'iossimulator/arm64', 'iossimulator/amd64']);
  assert.throws(() => buildTargets('android', 'armv7'));
});

function fixture() {
  const expected = { platform: 'android', upstream: { version: 'v1', sum: 'verified' }, bindingSources: { 'go.mod': 'a', 'mobile/main.go': 'b' }, files: { 'hafen.aar': 'c' }, recipe: { flags: ['trimpath'] }, targets: ['android/arm64'] };
  const manifest = { ...structuredClone(expected), build: { recipe: expected.recipe, targets: buildTargets('android', 'all') } };
  return { expected, manifest };
}

test('a verified universal artifact is reused without rebuilding a smaller dev artifact', () => {
  const { expected, manifest } = fixture();
  manifest.bindingSources['mobile/main_test.go'] = 'old test';
  assert.equal(reuseFailure(manifest, expected), null);
});

test('source, dependency lock, output, build recipe and architecture changes invalidate reuse', () => {
  for (const change of [
    m => { m.bindingSources['mobile/main.go'] = 'changed'; },
    m => { m.bindingSources['mobile/new.go'] = 'new source'; },
    m => { m.upstream.sum = 'different dependency'; },
    m => { m.files['hafen.aar'] = 'corrupted'; },
    m => { m.files['extra'] = 'unexpected'; },
    m => { m.build.recipe = { flags: ['different'] }; },
    m => { m.build.targets = ['android/amd64']; },
    m => { delete m.build; },
  ]) {
    const { expected, manifest } = fixture();
    change(manifest);
    assert.ok(reuseFailure(manifest, expected));
  }
});

test('source inventory detects new/deleted production files while excluding test-only edits', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hafen-cache-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'mobile'));
  for (const f of ['go.mod', 'go.sum', 'mobile/main.go', 'mobile/main_test.go']) await writeFile(path.join(dir, f), 'initial');
  const before = await bindingSources(dir);
  await writeFile(path.join(dir, 'mobile/main_test.go'), 'new test');
  assert.deepEqual(await bindingSources(dir), before);
  await writeFile(path.join(dir, 'mobile/extra.go'), 'new production code');
  assert.notDeepEqual(await bindingSources(dir), before);
  await rm(path.join(dir, 'mobile/extra.go'));
  await writeFile(path.join(dir, 'go.sum'), 'new dependency');
  assert.notDeepEqual(await bindingSources(dir), before);
});

test('artifact hashing follows internal framework symlinks and refuses escapes or cycles', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hafen-framework-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const artifact = path.join(dir, 'artifact');
  await mkdir(artifact);
  await writeFile(path.join(artifact, 'binary'), 'binary');
  await symlink('binary', path.join(artifact, 'alias'));
  const hashes = await hashTree(artifact);
  assert.equal(hashes['artifact/binary'], hashes['artifact/alias']);
  await symlink('.', path.join(artifact, 'cycle'));
  await assert.rejects(hashTree(artifact), /cycle/);
  await rm(path.join(artifact, 'cycle'));
  await writeFile(path.join(dir, 'outside'), 'outside');
  await symlink('../outside', path.join(artifact, 'escape'));
  await assert.rejects(hashTree(artifact), /escapes/);
});

test('mobile entry points pass a single preview ABI and a stable absolute iOS build folder', () => {
  const script = fileURLToPath(new URL('../mobile.mjs', import.meta.url));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args, '--dry-run'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split('\n').map(line => JSON.parse(line));
  };
  const preview = run('android-preview', '--arch=arm64');
  assert.ok(preview[1].args.includes('-PreactNativeArchitectures=arm64-v8a'));
  const all = run('android-preview', '--arch=all');
  assert.ok(all[1].args.includes('-PreactNativeArchitectures=arm64-v8a,x86_64'));
  assert.ok(run('android')[1].args.includes('--active-arch-only'));
  const iosCommands = run('ios');
  assert.ok(iosCommands[1].args.includes('ios-host'));
  const ios = iosCommands[2].args;
  assert.ok(path.isAbsolute(ios[ios.indexOf('--buildFolder') + 1]));
});

test('core command reuses real manifests, expands requested ABIs and retains a good artifact on compiler failure', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hafen-core-command-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of ['scripts', 'core/mobile', 'core/.tools/bin', 'bin']) await mkdir(path.join(dir, name), { recursive: true });
  for (const name of ['core.mjs', 'core-cache.mjs']) await copyFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), path.join(dir, 'scripts', name));
  const upstream = { module: 'example/core', version: 'v1.0.0', goVersion: 'go1.26.1', gomobileVersion: 'v0.1.12', sum: 'sum', goModSum: 'modsum', commit: 'commit' };
  await writeFile(path.join(dir, 'core/upstream.lock.json'), JSON.stringify(upstream));
  for (const name of ['go.mod', 'go.sum', 'mobile/main.go']) await writeFile(path.join(dir, 'core', name), 'original');
  async function executable(filename, body) {
    await writeFile(filename, `#!${process.execPath}\n${body}`);
    await chmod(filename, 0o755);
  }
  await executable(path.join(dir, 'bin/go'), `
    const args = process.argv.slice(2);
    if (args[0] === 'env') console.log(JSON.stringify({GOVERSION:'go1.26.1',GOFLAGS:'',GOEXPERIMENT:'',GOWORK:''}));
    else if (args[0] === 'mod') console.log(JSON.stringify({Sum:'sum',GoModSum:'modsum',Origin:{Hash:'commit'}}));
    else if (args[0] === 'list') console.log(JSON.stringify({Version:'v1.0.0'}));
    else if (args[0] === 'version') console.log('github.com/sagernet/gomobile\\tv0.1.12');
    else process.exit(1);
  `);
  await executable(path.join(dir, 'core/.tools/bin/gomobile'), `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync('calls.jsonl', JSON.stringify(args)+'\\n');
    fs.writeFileSync(args[args.indexOf('-o')+1], 'new artifact');
    if (process.env.HAFEN_TEST_FAIL) process.exit(2);
  `);
  const execute = (args = [], env = {}) => spawnSync(process.execPath, [path.join(dir, 'scripts/core.mjs'), 'android', ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, ...env },
  });
  const calls = async () => (await readFile(path.join(dir, 'core/calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(execute(['--arch=arm64']).status, 0);
  assert.equal((await calls()).length, 1);
  assert.ok((await calls())[0].includes('-target=android/arm64'));
  assert.match(execute(['--arch=arm64']).stdout, /Reusing verified/);
  assert.match(execute(['--arch=arm64'], { ANDROID_HOME: '/another/sdk/location', JAVA_HOME: '/another/jdk/location' }).stdout, /Reusing verified/);
  assert.equal((await calls()).length, 1);
  assert.equal(execute(['--arch=all']).status, 0);
  assert.equal((await calls()).length, 2);
  assert.match(execute(['--arch=arm64']).stdout, /Reusing verified/);
  const artifact = path.join(dir, 'core/artifacts/android/hafen.aar');
  const manifest = path.join(dir, 'core/artifacts/android/manifest.json');
  const saved = await readFile(manifest);
  const failed = execute(['--arch=arm64', '--force'], { HAFEN_TEST_FAIL: '1' });
  assert.notEqual(failed.status, 0);
  assert.deepEqual(await readFile(manifest), saved);
  assert.equal(await readFile(artifact, 'utf8'), 'new artifact');
  assert.ok(!(await readdir(path.join(dir, 'core'))).includes('.build.lock'));
  assert.ok(!(await readdir(path.dirname(artifact))).some(name => name.startsWith('.build-')));
  await writeFile(path.join(dir, 'core/mobile/main.go'), 'changed source');
  assert.notEqual(execute(['--arch=arm64', '--check']).status, 0);
  assert.equal((await calls()).length, 3); // Failed compilation counted; --check did not build.
  assert.equal(execute(['--arch=arm64']).status, 0);
  assert.equal((await calls()).length, 4);
});

test('cleanup previews without deleting, refuses active builds, and preserves artifacts and archives', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hafen-clean-command-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const generated = ['core/.cache/build', 'build/ios/Simulator', 'build/ios/DerivedData'];
  const protectedPaths = ['core/artifacts/android', 'core/.cache/go', 'build/ios/Hafen-1.xcarchive'];
  for (const name of ['scripts', 'bin', ...generated, ...protectedPaths]) await mkdir(path.join(dir, name), { recursive: true });
  for (const name of [...generated, ...protectedPaths]) await writeFile(path.join(dir, name, 'keep-or-remove'), 'data');
  await copyFile(fileURLToPath(new URL('../clean-build.mjs', import.meta.url)), path.join(dir, 'scripts/clean-build.mjs'));
  const fakePs = path.join(dir, 'bin/ps');
  await writeFile(fakePs, `#!${process.execPath}\nif (process.env.HAFEN_TEST_ACTIVE) console.log('/usr/bin/xcodebuild');\n`);
  await chmod(fakePs, 0o755);
  const execute = (args, env = {}) => spawnSync(process.execPath, [path.join(dir, 'scripts/clean-build.mjs'), ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, ...env },
  });
  assert.equal(execute([]).status, 0);
  assert.equal(execute(['--apply'], { HAFEN_TEST_ACTIVE: '1' }).status, 1);
  for (const name of generated) assert.equal(await readFile(path.join(dir, name, 'keep-or-remove'), 'utf8'), 'data');
  assert.equal(execute(['--apply']).status, 0);
  for (const name of generated) await assert.rejects(readFile(path.join(dir, name, 'keep-or-remove')), { code: 'ENOENT' });
  for (const name of protectedPaths) assert.equal(await readFile(path.join(dir, name, 'keep-or-remove'), 'utf8'), 'data');
});
