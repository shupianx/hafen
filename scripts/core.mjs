import { spawn } from "node:child_process";
import { openSync, closeSync, writeFileSync, unlinkSync } from "node:fs";
import { mkdir, readFile, writeFile, rm, mkdtemp, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buildTargets, hashFile, hashTree, bindingSources, reuseFailure } from "./core-cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = path.join(root, "core");
const lock = JSON.parse(
  await readFile(path.join(core, "upstream.lock.json"), "utf8")
);
const bin = path.join(core, ".tools", "bin");
const env = {
  ...process.env,
  GOPATH: path.join(core, ".cache", "go"),
  // gomobile changes GOPATH for generated code; keep its helper commands on
  // the same verified module cache instead of downloading a second copy.
  GOMODCACHE: path.join(core, ".cache", "go", "pkg", "mod"),
  GOCACHE: path.join(core, ".cache", "build"),
  GOBIN: bin,
  GOTOOLCHAIN: "local",
  PATH: `${bin}${path.delimiter}${process.env.PATH}`,
};
const mode = process.argv[2];
if (!["bootstrap", "test", "android", "ios", "ios-host"].includes(mode)) {
  throw new Error("Usage: node scripts/core.mjs bootstrap|test|android|ios|ios-host");
}
const options = process.argv.slice(3);
for (const option of options) {
  if (!["--force", "--check", "--adopt-legacy"].includes(option) && !/^--arch=(arm64|amd64|all)$/.test(option)) {
    throw new Error(`Unknown core option: ${option}`);
  }
}
if (options.length && !["android", "ios", "ios-host"].includes(mode)) throw new Error("Build options require android or ios");
if (options.includes("--check") && (options.includes("--force") || options.includes("--adopt-legacy"))) {
  throw new Error("--check is read-only; do not combine it with --force or --adopt-legacy");
}
const platform = mode === "ios-host" ? "ios" : mode;
const bindingPackage = mode === "ios-host" ? "./host" : "./mobile";
const arch = options.find(value => value.startsWith("--arch="))?.slice(7) || process.env.HAFEN_CORE_ARCH || process.arch;

function run(command, args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: core,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (capture)
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${command} failed (${code})`));
      else resolve(output.trim());
    });
  });
}

const goEnvironment = JSON.parse(await run("go", ["env", "-json", "GOVERSION", "GOFLAGS", "GOEXPERIMENT", "GOWORK"], true));
if (goEnvironment.GOVERSION !== lock.goVersion) {
  throw new Error(
    `Use ${lock.goVersion}; changing the toolchain requires revalidating mobile artifacts.`
  );
}
let build;
let sources;
let outputDir;
let artifact;
let manifestPath;
if (["android", "ios", "ios-host"].includes(mode)) {
  outputDir = path.join(core, "artifacts", mode);
  artifact = path.join(outputDir, mode === "android" ? "hafen.aar" : mode === "ios-host" ? "HafenHost.xcframework" : "HafenCore.xcframework");
  manifestPath = path.join(outputDir, "manifest.json");
  sources = await bindingSources(core);
  const recipe = {
    tags: mode === "ios-host" ? "hafen_host,with_utls,with_quic" : "with_gvisor,with_utls,with_quic",
    bindingPackage,
    ldflags: `-s -w -checklinkname=0 -X github.com/sagernet/sing-box/constant.Version=${lock.version.slice(1)}`,
    trimpath: true,
    platformArgs: mode === "android" ? ["-androidapi=24", "-javapkg=com.hafen.core", "-libname=hafen"] : ["-iosversion=15.1"],
    goEnvironment,
    gomobileVersion: lock.gomobileVersion,
    // SDK/JDK installation paths are not compilation options: setting the same
    // local SDK path for Gradle must not invalidate a verified mobile library.
    environment: Object.fromEntries(["CGO_CFLAGS", "CGO_CPPFLAGS", "CGO_CXXFLAGS", "CGO_LDFLAGS", "CC", "CXX"].map(key => [key, process.env[key] || ""])),
    builderHashes: {
      "core.mjs": await hashFile(fileURLToPath(import.meta.url)),
      "core-cache.mjs": await hashFile(path.join(root, "scripts/core-cache.mjs")),
    },
  };
  build = { recipe, targets: buildTargets(platform, arch) };
  let manifest;
  let files = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    files = await hashTree(artifact, outputDir);
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  // One-time opt-in migration of the original full-architecture manifests.
  // Validate the actual binaries and all original source hashes before adopting.
  if (options.includes("--adopt-legacy")) {
    if (!manifest || manifest.build) throw new Error("Adoption requires an original manifest without build metadata");
    if (goEnvironment.GOFLAGS || goEnvironment.GOEXPERIMENT || goEnvironment.GOWORK ||
        ["CGO_CFLAGS", "CGO_CPPFLAGS", "CGO_CXXFLAGS", "CGO_LDFLAGS", "CC", "CXX"].some(key => process.env[key])) {
      throw new Error("Do not adopt a legacy build with custom Go/C compiler flags");
    }
    let targets;
    if (mode === "android") {
      const entries = (await run("unzip", ["-Z1", artifact], true)).split("\n");
      targets = [
        ...(entries.includes("jni/arm64-v8a/libhafen.so") ? ["android/arm64"] : []),
        ...(entries.includes("jni/x86_64/libhafen.so") ? ["android/amd64"] : []),
      ];
    } else {
      const info = JSON.parse(await run("plutil", ["-convert", "json", "-o", "-", path.join(artifact, "Info.plist")], true));
      targets = info.AvailableLibraries.flatMap(library => library.SupportedArchitectures.map(cpu =>
        `${library.SupportedPlatformVariant === "simulator" ? "iossimulator" : "ios"}/${cpu === "x86_64" ? "amd64" : cpu}`));
    }
    if (!buildTargets(platform, "all").every(target => targets.includes(target))) throw new Error("Legacy artifact does not contain the original architectures");
    manifest.build = { recipe, targets, adoptedLegacy: true };
    const failure = reuseFailure(manifest, { platform: mode, upstream: lock, bindingSources: sources, files, ...build });
    if (failure) throw new Error(`Cannot adopt legacy artifact: ${failure}`);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Verified and adopted existing ${mode} artifact; no compilation.`);
    process.exit(0);
  }
  const failure = reuseFailure(manifest, { platform: mode, upstream: lock, bindingSources: sources, files, ...build });
  if (!options.includes("--force") && !failure) {
    console.log(`Reusing verified ${mode} core (${build.targets.join(", ")}); no compilation.`);
    process.exit(0);
  }
  if (options.includes("--check")) throw new Error(`Core requires a rebuild: ${failure}`);
  console.log(`Building ${mode} core (${build.targets.join(", ")}): ${options.includes("--force") ? "forced" : failure}`);
}
await mkdir(bin, { recursive: true });
const lockPath = path.join(core, ".build.lock");
let lockFd;
try {
  lockFd = openSync(lockPath, "wx");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  throw new Error(`Another core command holds ${lockPath}. If it was interrupted, verify its PID has exited before removing the lock.`);
}
writeFileSync(lockFd, JSON.stringify({ pid: process.pid, mode }) + "\n");
process.once("exit", () => { closeSync(lockFd); unlinkSync(lockPath); });
// The Go checksum database remains enabled. No mutable branch or local replace.
const module = JSON.parse(
  await run(
    "go",
    ["mod", "download", "-json", `${lock.module}@${lock.version}`],
    true
  )
);
if (
  module.Sum !== lock.sum ||
  module.GoModSum !== lock.goModSum ||
  module.Origin?.Hash !== lock.commit
) {
  throw new Error("Upstream source does not match upstream.lock.json");
}
const selected = JSON.parse(
  await run("go", ["list", "-m", "-json", lock.module], true)
);
if (selected.Version !== lock.version || selected.Replace)
  throw new Error("Unexpected sing-box dependency override");

if (mode === "bootstrap") {
  for (const tool of ["gomobile", "gobind"]) {
    await run("go", [
      "install",
      `github.com/sagernet/gomobile/cmd/${tool}@${lock.gomobileVersion}`,
    ]);
  }
  // bind needs the installed tools, not init's optional OpenAL setup.
  // Upstream init installs gobind@latest and would undo our version pin.
  await mkdir(path.join(env.GOPATH, "pkg", "gomobile"), { recursive: true });
} else if (mode === "test") {
  await run("go", [
    "test",
    "-mod=readonly",
    "-race",
    // Pinned upstream Vision deliberately passes TLS field addresses via uintptr.
    // Keep race/checkptr elsewhere; scope this exception to that upstream package.
    "-gcflags=github.com/sagernet/sing-vmess/vless=-d=checkptr=0",
    "-tags=with_gvisor,with_utls,with_quic",
    "-ldflags=-checklinkname=0",
    "./mobile",
  ]);
  await run("go", ["test", "-mod=readonly", "-race", "-tags=hafen_host,with_utls,with_quic", "-ldflags=-checklinkname=0", "./host"]);
} else {
  for (const tool of ["gomobile", "gobind"]) {
    const info = await run("go", ["version", "-m", path.join(bin, tool)], true);
    if (
      !info.includes(`github.com/sagernet/gomobile\t${lock.gomobileVersion}`)
    ) {
      throw new Error(
        "Run npm run core:bootstrap with the pinned toolchain first."
      );
    }
  }
  if (mode === "ios-host") {
    const dependencies = await run("go", ["list", `-tags=${build.recipe.tags}`, "-deps", bindingPackage], true);
    if (dependencies.split("\n").some(name => name.includes("gvisor") || name === "github.com/sagernet/sing-box/protocol/tun")) {
      throw new Error("The iOS host must not link the packet engine");
    }
  }
  await mkdir(outputDir, { recursive: true });
  const generatedTargets =
    mode === "android"
      ? ["arm64", "amd64"]
      : ["ios-arm64", "iossimulator-arm64", "iossimulator-amd64"];
  for (const target of generatedTargets) {
    await rm(path.join(core, "build", target), {
      recursive: true,
      force: true,
    });
  }
  const staging = await mkdtemp(path.join(outputDir, ".build-"));
  const stagedArtifact = path.join(staging, path.basename(artifact));
  // Upstream's build_shared/flags.go uses this linker switch for its Go integrations.
  const args = [
    "bind",
    "-v",
    "-trimpath",
    `-tags=${build.recipe.tags}`,
    `-ldflags=${build.recipe.ldflags}`,
    "-o",
    stagedArtifact,
  ];
  args.push(`-target=${build.targets.join(",")}`, ...build.recipe.platformArgs);
  try {
    await run(path.join(bin, "gomobile"), [...args, bindingPackage]);
    if (!isDeepStrictEqual(sources, await bindingSources(core))) throw new Error("Core sources changed during compilation; retaining previous artifact");
    const files = await hashTree(stagedArtifact, staging);
    const temporaryManifest = path.join(staging, "manifest.json");
    await writeFile(temporaryManifest, JSON.stringify({ upstream: lock, platform: mode, bindingSources: sources, files, build }, null, 2) + "\n");
    const previous = path.join(staging, "previous");
    let hadPrevious = false;
    try { await rename(artifact, previous); hadPrevious = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try {
      await rename(stagedArtifact, artifact);
      await rename(temporaryManifest, manifestPath);
    } catch (error) {
      await rm(artifact, { recursive: true, force: true });
      if (hadPrevious) await rename(previous, artifact);
      throw error;
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
    for (const target of generatedTargets) await rm(path.join(core, "build", target), { recursive: true, force: true });
  }
}
