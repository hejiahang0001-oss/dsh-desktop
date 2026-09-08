const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const VERSION = '0.1.3-alpha.2';
const COMMIT = '82a5fd61a7cf5c293cec4bdff68f455398d685e9';
const runtimeRoot = path.join(ROOT, 'vendor', `harness-hoisted-${VERSION}`);

test('V1 runtime recipe pins the official source identity and narrow build policy', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime', 'harness', 'package.json'), 'utf8'));
  const buildScript = fs.readFileSync(path.join(ROOT, 'scripts', 'build-harness-runtime.ps1'), 'utf8');
  const assembler = fs.readFileSync(path.join(ROOT, 'scripts', 'assemble-harness-runtime.cjs'), 'utf8');

  assert.match(manifest.version, /^1\.\d+\.\d+$/, 'the pinned source runtime remains governed across V1 patch releases');
  assert.equal(manifest.devDependencies['harness-build-pnpm'], 'npm:pnpm@11.7.0');
  assert.match(manifest.scripts['runtime:deploy'], /build-harness-runtime\.ps1/);
  assert.deepEqual(runtimeManifest.dshDesktop, {
    repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    tag: 'dsh-v0.1.3-alpha.2',
    commit: COMMIT,
    package: '@deepseek-ai/dsh',
    packageVersion: VERSION,
    distribution: 'source-build'
  });
  assert.match(buildScript, /--frozen-lockfile/);
  assert.match(buildScript, /--ignore-scripts/);
  assert.match(buildScript, /verify-built-package-invariants/);
  assert.match(buildScript, /node_modules\\fs-ext/);
  assert.match(buildScript, /\$NodeGyp, 'rebuild'/);
  assert.match(buildScript, /status --porcelain --untracked-files=all/);
  assert.match(buildScript, /'core.symlinks=false'/);
  assert.doesNotMatch(buildScript, /dangerously-allow-all-builds/);
  assert.match(assembler, /EXPECTED_DSH_PACKAGES = 251/);
  assert.match(assembler, /EXPECTED_VENDOR_PACKAGES = 9/);
  assert.match(assembler, /koffiPackage\.version !== '3\.1\.1'/);
});

test('assembled Harness runtime carries exact provenance and no linked paths', (context) => {
  if (!fs.existsSync(path.join(runtimeRoot, 'harness-runtime.json'))) {
    context.skip('The source-built Harness runtime is intentionally not stored in Git.');
    return;
  }
  const provenance = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'harness-runtime.json'), 'utf8'));
  const dsh = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
  const koffi = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'node_modules', 'koffi', 'package.json'), 'utf8'));
  assert.equal(dsh.version, VERSION);
  assert.equal(koffi.version, '3.1.1');
  assert.equal(provenance.harness.commit, COMMIT);
  assert.equal(provenance.harness.tag, 'dsh-v0.1.3-alpha.2');
  assert.equal(provenance.build.node, 'v24.19.0');
  assert.equal(provenance.build.pnpm, '11.7.0');
  assert.equal(provenance.build.packageCount, 260);
  assert.equal(provenance.build.packageInventorySha256, 'f28b3917e722e1843aa28da324c849f4bfd0a5f912d907365a6963b3e976a6e9');
  assert.deepEqual(provenance.build.runtimePayload, require('../scripts/harness-runtime-integrity.cjs').inspectHarnessRuntimePayload(path.join(runtimeRoot, 'node_modules')));

  const queue = [runtimeRoot];
  let entries = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      assert.ok(entries <= 60_000, 'runtime entry limit');
      assert.equal(entry.isSymbolicLink(), false, path.join(directory, entry.name));
      if (entry.isDirectory()) queue.push(path.join(directory, entry.name));
    }
  }
});
