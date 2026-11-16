import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export function buildTargets(platform, arch = process.arch) {
  if (arch === 'x64') arch = 'amd64';
  if (!['arm64', 'amd64', 'all'].includes(arch)) {
    throw new Error('Use --arch=arm64, --arch=amd64 or --arch=all');
  }
  const architectures = arch === 'all' ? ['arm64', 'amd64'] : [arch];
  if (platform === 'android') return architectures.map(a => `android/${a}`);
  if (platform === 'ios') return ['ios/arm64', ...architectures.map(a => `iossimulator/${a}`)];
  throw new Error(`Unknown platform: ${platform}`);
}

export async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

// Framework symlinks are included, as in the original manifests, but may not
// escape the artifact or create recursive directory loops.
export async function hashTree(filename, base = path.dirname(filename)) {
  const files = {};
  const boundary = await realpath(filename);
  async function visit(current, ancestors) {
    const resolved = await realpath(current);
    if (resolved !== boundary && !resolved.startsWith(boundary + path.sep)) {
      throw new Error(`Artifact symlink escapes its root: ${current}`);
    }
    if ((await stat(current)).isDirectory()) {
      if (ancestors.has(resolved)) throw new Error(`Artifact symlink cycle: ${current}`);
      const next = new Set([...ancestors, resolved]);
      for (const child of (await readdir(current)).sort()) await visit(path.join(current, child), next);
    } else {
      files[path.relative(base, current).split(path.sep).join('/')] = await hashFile(current);
    }
  }
  await visit(filename, new Set());
  return files;
}

export async function bindingSources(core) {
  const files = await hashTree(path.join(core, 'mobile'), core);
  for (const name of Object.keys(files)) if (name.endsWith('_test.go')) delete files[name];
  for (const name of ['go.mod', 'go.sum']) files[name] = await hashFile(path.join(core, name));
  return files;
}

export function reuseFailure(manifest, expected) {
  if (!manifest || manifest.platform !== expected.platform) return 'manifest missing or wrong platform';
  if (!isDeepStrictEqual(manifest.upstream, expected.upstream)) return 'upstream lock changed';
  const sources = { ...manifest.bindingSources };
  // Test-only edits do not change the mobile library.
  for (const name of Object.keys(sources)) if (name.endsWith('_test.go')) delete sources[name];
  if (!isDeepStrictEqual(sources, expected.bindingSources)) return 'core sources or dependencies changed';
  if (!Object.keys(expected.files).length || !isDeepStrictEqual(manifest.files, expected.files)) {
    return 'artifact files missing, added or modified';
  }
  if (!manifest.build || !isDeepStrictEqual(manifest.build.recipe, expected.recipe)) return 'build recipe changed';
  if (!Array.isArray(manifest.build.targets) || !expected.targets.every(target => manifest.build.targets.includes(target))) return 'requested architecture missing';
  return null;
}
