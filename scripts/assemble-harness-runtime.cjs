const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXPECTED_HARNESS_VERSION = '0.1.2-alpha.5';
const EXPECTED_DSH_PACKAGES = 242;
const EXPECTED_VENDOR_PACKAGES = 9;
const MAX_PACK_OUTPUT = 1024 * 1024;
const MAX_RUNTIME_ENTRIES = 60_000;
const VENDOR_PACKAGES = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-logger-console',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery'
]);

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const isReleasePackage = (manifest) => manifest
  && manifest.private !== true
  && manifest.publishConfig
  && typeof manifest.name === 'string'
  && (manifest.name === '@deepseek-ai/dsh'
    || manifest.name.startsWith('@deepseek-ai/dsh-')
    || VENDOR_PACKAGES.has(manifest.name));

const discoverReleasePackages = (sourceRoot) => {
  const queue = [sourceRoot];
  const packages = [];
  let visited = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Upstream source contains a linked path: ${target}`);
      if (entry.isDirectory()) {
        queue.push(target);
        continue;
      }
      if (!entry.isFile() || entry.name !== 'package.json') continue;
      visited += 1;
      if (visited > 1000) throw new Error('Upstream package discovery exceeded its limit.');
      const manifest = readJson(target);
      if (isReleasePackage(manifest)) packages.push({ directory, manifest });
    }
  }
  packages.sort((left, right) => left.manifest.name.localeCompare(right.manifest.name, 'en'));
  const dshCount = packages.filter(({ manifest }) => manifest.name === '@deepseek-ai/dsh' || manifest.name.startsWith('@deepseek-ai/dsh-')).length;
  const vendorCount = packages.filter(({ manifest }) => VENDOR_PACKAGES.has(manifest.name)).length;
  if (dshCount !== EXPECTED_DSH_PACKAGES || vendorCount !== EXPECTED_VENDOR_PACKAGES) {
    throw new Error(`Expected ${EXPECTED_DSH_PACKAGES} DSH and ${EXPECTED_VENDOR_PACKAGES} vendor packages, got ${dshCount} and ${vendorCount}.`);
  }
  const invalidVersion = packages.find(({ manifest }) => (manifest.name === '@deepseek-ai/dsh' || manifest.name.startsWith('@deepseek-ai/dsh-'))
    && manifest.version !== EXPECTED_HARNESS_VERSION);
  if (invalidVersion) throw new Error(`${invalidVersion.manifest.name} has unexpected version ${invalidVersion.manifest.version}.`);
  return packages;
};

const runCaptured = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const append = (chunk) => { output = `${output}${chunk.toString('utf8')}`.slice(-MAX_PACK_OUTPUT); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (code === 0) resolve(output);
    else reject(new Error(`${command} exited with ${String(code ?? signal)}:\n${output.slice(-8000)}`));
  });
});

const runPool = async (items, concurrency, worker) => {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }));
};

const assertInside = (parent, child) => {
  const parentPrefix = `${path.resolve(parent)}${path.sep}`.toLowerCase();
  const resolved = path.resolve(child).toLowerCase();
  if (!resolved.startsWith(parentPrefix)) throw new Error(`Unsafe generated path: ${child}`);
};

const hydratePackages = async ({ archives, expectedPackages, runtimeRoot }) => {
  const nodeModules = path.join(runtimeRoot, 'node_modules');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harness-pack-'));
  const expected = new Map(expectedPackages.map(({ manifest }) => [manifest.name, manifest.version]));
  const seen = new Set();
  try {
    for (const [index, archive] of archives.entries()) {
      const extractRoot = path.join(scratch, String(index));
      fs.mkdirSync(extractRoot, { recursive: true });
      await runCaptured('tar.exe', ['-xzf', archive, '-C', extractRoot], { cwd: scratch });
      const packageRoot = path.join(extractRoot, 'package');
      const manifest = readJson(path.join(packageRoot, 'package.json'));
      if (!expected.has(manifest.name) || expected.get(manifest.name) !== manifest.version || seen.has(manifest.name)) {
        throw new Error(`Unexpected packed package ${manifest.name}@${manifest.version}.`);
      }
      const segments = manifest.name.split('/');
      const destination = path.join(nodeModules, ...segments);
      assertInside(nodeModules, destination);
      if (fs.existsSync(destination)) {
        if (fs.lstatSync(destination).isSymbolicLink()) throw new Error(`Refusing to replace linked package: ${destination}`);
        fs.rmSync(destination, { recursive: true, force: true });
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(packageRoot, destination);
      seen.add(manifest.name);
    }
  } finally {
    const tempPrefix = `${path.resolve(os.tmpdir())}${path.sep}`.toLowerCase();
    if (!path.resolve(scratch).toLowerCase().startsWith(tempPrefix)) throw new Error(`Unsafe scratch path: ${scratch}`);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].filter((name) => !seen.has(name));
    throw new Error(`Packed runtime is missing ${missing.length} package(s): ${missing.slice(0, 12).join(', ')}`);
  }
};

const inspectRuntime = (runtimeRoot) => {
  const queue = [runtimeRoot];
  let entries = 0;
  let files = 0;
  let bytes = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > MAX_RUNTIME_ENTRIES) throw new Error(`Harness runtime exceeds ${MAX_RUNTIME_ENTRIES} entries.`);
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Harness runtime contains a linked path: ${target}`);
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile()) {
        files += 1;
        bytes += fs.statSync(target).size;
      }
    }
  }
  return { entries, files, bytes, reparsePoints: 0 };
};

const main = async () => {
  const sourceRoot = path.resolve(readArgument('source-root') || '');
  const runtimeRoot = path.resolve(readArgument('runtime-root') || '');
  const nodePath = path.resolve(readArgument('node') || '');
  const pnpmPath = path.resolve(readArgument('pnpm') || '');
  const repository = readArgument('repository');
  const tag = readArgument('tag');
  const commit = readArgument('commit');
  if (!sourceRoot || !runtimeRoot || !nodePath || !pnpmPath || !repository || !tag || !commit) {
    throw new Error('Missing source-root, runtime-root, node, pnpm, repository, tag, or commit.');
  }
  if (!fs.existsSync(path.join(runtimeRoot, 'node_modules'))) throw new Error(`Incomplete deployment root: ${runtimeRoot}`);
  const releasePackages = discoverReleasePackages(sourceRoot);
  const packRoot = path.join(sourceRoot, 'dist', `dsh-desktop-runtime-pack-${process.pid}`);
  if (fs.existsSync(packRoot)) throw new Error(`Pack directory already exists: ${packRoot}`);
  fs.mkdirSync(packRoot, { recursive: true });
  const childEnvironment = {
    ...process.env,
    CI: '1',
    npm_config_verify_deps_before_run: 'false',
    PATH: `${path.dirname(nodePath)}${path.delimiter}${process.env.PATH || ''}`
  };
  await runPool(releasePackages, 8, async ({ directory }) => {
    await runCaptured(nodePath, [pnpmPath, '--dir', directory, 'pack', '--pack-destination', packRoot], {
      cwd: sourceRoot,
      env: childEnvironment
    });
  });
  const archives = fs.readdirSync(packRoot)
    .filter((name) => name.endsWith('.tgz'))
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((name) => path.join(packRoot, name));
  if (archives.length !== releasePackages.length) {
    throw new Error(`Expected ${releasePackages.length} tarballs, got ${archives.length}.`);
  }
  await hydratePackages({ archives, expectedPackages: releasePackages, runtimeRoot });

  const dshPackage = readJson(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'));
  const koffiPackage = readJson(path.join(runtimeRoot, 'node_modules', 'koffi', 'package.json'));
  const requiredPeers = ['dsh-settings', 'dsh-session-persistence', 'dsh-session-title-llm', 'dsh-jobs', 'dsh-subagent-in-process-driver'];
  for (const name of requiredPeers) {
    if (!fs.existsSync(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', name, 'package.json'))) {
      throw new Error(`Harness runtime is missing required peer @deepseek-ai/${name}.`);
    }
  }
  if (dshPackage.version !== EXPECTED_HARNESS_VERSION) throw new Error(`Unexpected DSH runtime version ${dshPackage.version}.`);
  if (koffiPackage.version !== '3.1.1') throw new Error(`Expected locked koffi 3.1.1, got ${koffiPackage.version}.`);

  const provenance = {
    version: 1,
    harness: { name: dshPackage.name, version: dshPackage.version, repository, tag, commit },
    build: {
      node: process.version,
      pnpm: readJson(path.join(path.dirname(pnpmPath), '..', 'package.json')).version,
      packageCount: releasePackages.length,
      dependencyResolution: 'upstream-frozen-lockfile',
      packagePayload: 'upstream-pnpm-pack',
      installScripts: ['koffi', 'node-pty', '@deepseek-ai/dsh-subprocess-local']
    }
  };
  fs.writeFileSync(path.join(runtimeRoot, 'harness-runtime.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  const layout = inspectRuntime(runtimeRoot);
  process.stdout.write(`${JSON.stringify({ ok: true, provenance, layout })}\n`);
};

void main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
