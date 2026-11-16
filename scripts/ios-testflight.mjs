import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const action = process.argv[2];
const team = process.env.HAFEN_TEAM_ID;
const bundle = process.env.HAFEN_BUNDLE_ID || 'com.coolab.hafen';
const version = process.env.HAFEN_VERSION || '0.1.0';
const build = process.env.HAFEN_BUILD_NUMBER || '1';
if (!['archive', 'upload'].includes(action)) throw Error('Use archive or upload');
if (!/^[A-Z0-9]{10}$/.test(team || '')) throw Error('Set HAFEN_TEAM_ID to your 10-character Apple Team ID');
if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+){2,}$/.test(bundle)) throw Error('Invalid HAFEN_BUNDLE_ID');
if (!/^\d{1,4}(?:\.\d{1,2}){0,2}$/.test(build)) throw Error('Invalid HAFEN_BUILD_NUMBER');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid HAFEN_VERSION');
const output = path.join(root, 'build/ios');
const archive = path.join(output, `Hafen-${build}.xcarchive`);
mkdirSync(output, { recursive: true });

let args;
if (action === 'archive') {
  if (existsSync(archive)) throw Error(`Archive already exists: ${archive}. Choose a new build number.`);
  const info = path.join(root, 'core/artifacts/ios/HafenCore.xcframework/Info.plist');
  const before = existsSync(info) ? readFileSync(info) : null;
  const core = spawnSync(process.execPath, [path.join(root, 'scripts/core.mjs'), 'ios'], { cwd: root, stdio: 'inherit' });
  if (core.error) throw core.error;
  if (core.status !== 0) process.exit(core.status ?? 1);
  if (!before?.equals(readFileSync(info))) {
    const pods = spawnSync('bundle', ['exec', 'pod', 'install'], { cwd: path.join(root, 'apps/mobile/ios'), stdio: 'inherit' });
    if (pods.error) throw pods.error;
    if (pods.status !== 0) process.exit(pods.status ?? 1);
  }
  args = [
    '-workspace', 'apps/mobile/ios/Hafen.xcworkspace', '-scheme', 'Hafen',
    '-configuration', 'Release', '-destination', 'generic/platform=iOS',
    '-archivePath', archive, '-derivedDataPath', path.join(output, 'DerivedData'),
    '-allowProvisioningUpdates', `DEVELOPMENT_TEAM=${team}`, `HAFEN_BUNDLE_ID=${bundle}`,
    `CURRENT_PROJECT_VERSION=${build}`, `MARKETING_VERSION=${version}`, 'archive',
  ];
} else {
  const app = path.join(archive, 'Products/Applications/Hafen.app');
  if (!existsSync(app)) throw Error('Create the signed archive first');
  const readPlist = (file, key) => {
    const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, file], { encoding: 'utf8' });
    if (result.status !== 0) throw Error(`Cannot read ${key} from archive`);
    return result.stdout.trim();
  };
  for (const [file, id] of [[path.join(app, 'Info.plist'), bundle],
    [path.join(app, 'PlugIns/HafenTunnel.appex/Info.plist'), `${bundle}.PacketTunnel`]]) {
    if (readPlist(file, 'CFBundleIdentifier') !== id ||
        readPlist(file, 'CFBundleVersion') !== build ||
        readPlist(file, 'CFBundleShortVersionString') !== version) {
      throw Error('Archive identifiers/version do not match the requested upload');
    }
  }
  if (!existsSync(path.join(app, 'main.jsbundle'))) throw Error('Release JS bundle missing');
  if (spawnSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' }).status !== 0)
    throw Error('Archive signature verification failed');
  const options = path.join(output, `ExportOptions-${build}.plist`);
  writeFileSync(options, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>teamID</key><string>${team}</string>
<key>signingStyle</key><string>automatic</string>
<key>testFlightInternalTestingOnly</key><true/>
<key>manageAppVersionAndBuildNumber</key><false/>
<key>uploadSymbols</key><true/>
</dict></plist>
`);
  args = ['-exportArchive', '-archivePath', archive, '-exportPath', path.join(output, `upload-${build}`),
    '-exportOptionsPlist', options, '-allowProvisioningUpdates'];
}
const result = spawnSync('xcodebuild', args, { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
