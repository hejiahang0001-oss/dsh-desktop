const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const VERSION = '0.1.5-alpha.1';
const COMMIT = '5dda764ed3aa172535a7967b06ff95d9cbfe536a';
const runtimeRoot = path.join(ROOT, 'vendor', `harness-hoisted-${VERSION}-desktop-security-2`);

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
    tag: 'dsh-v0.1.5-alpha.1',
    commit: COMMIT,
    package: '@deepseek-ai/dsh',
    packageVersion: VERSION,
    distribution: 'source-build'
  });
  assert.match(buildScript, /--frozen-lockfile/);
  assert.match(buildScript, /--ignore-scripts/);
  assert.match(buildScript, /verify-built-package-invariants/);
  assert.doesNotMatch(buildScript, /fs-ext|\$NodeGyp/);
  assert.match(buildScript, /node-addon-system\/flock/);
  assert.match(buildScript, /status --porcelain --untracked-files=all/);
  assert.match(buildScript, /'core.symlinks=false'/);
  assert.match(buildScript, /'core.autocrlf=false'/);
  assert.match(buildScript, /apply-harness-security\.cjs/);
  assert.match(buildScript, /audit-harness-runtime\.cjs/);
  assert.doesNotMatch(buildScript, /dangerously-allow-all-builds/);
  assert.match(assembler, /EXPECTED_DSH_PACKAGES = 258/);
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
  assert.equal(provenance.harness.tag, 'dsh-v0.1.5-alpha.1');
  assert.equal(provenance.build.node, 'v24.19.0');
  assert.equal(provenance.build.pnpm, '11.7.0');
  assert.equal(provenance.build.packageCount, 267);
  assert.equal(provenance.build.dependencyResolution, 'desktop-security-frozen-lockfile');
  assert.equal(provenance.build.security.revision, 'desktop-security-2');
  assert.equal(provenance.build.security.lockSha256, require('../runtime/harness-security/overrides.json').lockSha256);
  assert.equal(provenance.build.packageInventorySha256, '8efa42e476fd2da21ad1dafeb53ad2dc63dbf606c4a79099e8726814a35d13dd');
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

test('security runtime preserves preset parsing, protobuf, URI, IP and HTTP behavior', async (context) => {
  if (!fs.existsSync(path.join(runtimeRoot, 'harness-runtime.json'))) {
    context.skip('Ignored Windows runtime is checked after the pinned build/download.'); return;
  }
  const load = createRequire(path.join(runtimeRoot, 'security-behavior.cjs'));
  const policy = require('../runtime/harness-security/overrides.json');
  for (const [selector, fixed] of Object.entries(policy.overrides)) {
    const name = selector.slice(0, selector.lastIndexOf('@'));
    const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'node_modules', name, 'package.json')));
    assert.equal(manifest.version, fixed);
  }
  const yaml = load('js-yaml');
  assert.deepEqual(yaml.load('base: &base\n  enabled: true\npreset:\n  <<: *base\n  name: desktop\n').preset, { enabled: true, name: 'desktop' });
  const protobuf = load('protobufjs');
  const Message = protobuf.parse('syntax = "proto3"; message Data { string name = 1; int32 count = 2; }').root.lookupType('Data');
  assert.equal(Message.decode(Message.encode({ name: '中文', count: 12 }).finish()).name, '中文');
  assert.equal(load('fast-uri').parse('https://example.invalid/path').host, 'example.invalid');
  assert.equal(new (load('ip-address').Address6)('::1').isLoopback(), true);
  assert.deepEqual(load('qs').parse('a=1&a=2'), { a: ['1', '2'] });
  const { Hono } = load('hono');
  const app = new Hono(); app.get('/health', (c) => c.json({ ok: true }));
  assert.deepEqual(await (await app.request('http://localhost/health')).json(), { ok: true });
  assert.equal(typeof load('@hono/node-server').serve, 'function');
  assert.equal(typeof load('@deepseek-ai/node-addon-system/flock').tryLockExclusive, 'function');
  assert.equal(fs.existsSync(path.join(runtimeRoot, 'node_modules', 'fs-ext')), false);
});
