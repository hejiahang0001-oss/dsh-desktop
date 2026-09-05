const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  classifyDependencySource,
  inspectThirdPartyCompatibility,
  satisfiesSupportedRange
} = require('../electron/plugin-compatibility.cjs');

const writePackage = (directory, manifest) => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};

test('exact registry plugin reports a bounded verified compatibility summary', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-compat-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profiles = path.join(root, 'profiles');
  const profile = path.join(profiles, 'web');
  const plugin = path.join(profile, 'node_modules', '@example', 'theme');
  const react = path.join(profiles, 'node_modules', 'react');
  writePackage(react, { name: 'react', version: '18.3.1' });
  writePackage(plugin, {
    name: '@example/theme',
    version: '1.2.3',
    scripts: { prepare: 'build', test: 'test', postinstall: '' },
    peerDependencies: { react: '^18.2.0' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-runtime'] }
    },
    privateMarker: 'must-not-leak'
  });
  fs.writeFileSync(path.join(plugin, 'cordis.patch.yml'), '- insert: []\n');

  const result = await inspectThirdPartyCompatibility({
    packageDir: plugin,
    profileDir: profile,
    dependencySpec: '1.2.3'
  });

  assert.deepEqual(result, {
    status: 'verified',
    sourceType: 'registry-exact',
    bundlePatch: 'ready',
    clientPlatform: 'web',
    peers: { status: 'ready', expected: 1, healthy: 1, missing: 0, mismatched: 0, unverified: 0 },
    installHooks: []
  });
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(result).includes('cordis.patch.yml'), false);
});

test('bundle patch traversal and unresolved peers fail closed', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-compat-blocked-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, 'profiles', 'web');
  const plugin = path.join(profile, 'node_modules', 'outside-theme');
  writePackage(plugin, {
    name: 'outside-theme',
    version: '1.0.0',
    peerDependencies: { react: '^18.2.0' },
    dsh: { bundle: { patch: '../outside.yml' }, client: { platform: 'web' } }
  });
  fs.writeFileSync(path.join(profile, 'node_modules', 'outside.yml'), 'hidden');

  const result = await inspectThirdPartyCompatibility({
    packageDir: plugin,
    profileDir: profile,
    dependencySpec: 'github:example/outside-theme'
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.sourceType, 'git');
  assert.equal(result.bundlePatch, 'blocked');
  assert.equal(result.peers.status, 'missing');
  assert.deepEqual(result.installHooks, []);
});

test('a peer reached through the Harness fallback must resolve inside the fixed runtime', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-compat-fallback-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, 'home', 'profiles', 'web');
  const plugin = path.join(profile, 'node_modules', '@example', 'theme');
  const fallback = path.join(root, 'home', 'profiles', 'node_modules', 'react');
  const runtimeModulesDir = path.join(root, 'runtime', 'node_modules');
  const runtimeReact = path.join(runtimeModulesDir, 'react');
  writePackage(runtimeReact, { name: 'react', version: '18.3.1' });
  fs.mkdirSync(path.dirname(fallback), { recursive: true });
  fs.symlinkSync(runtimeReact, fallback, process.platform === 'win32' ? 'junction' : 'dir');
  writePackage(plugin, {
    name: '@example/theme',
    version: '1.2.3',
    peerDependencies: { react: '^18.2.0' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
  });
  fs.writeFileSync(path.join(plugin, 'cordis.patch.yml'), '- insert: []\n');

  const allowed = await inspectThirdPartyCompatibility({ packageDir: plugin, profileDir: profile, runtimeModulesDir, dependencySpec: '1.2.3' });
  assert.equal(allowed.status, 'verified');
  assert.equal(allowed.peers.healthy, 1);

  const blocked = await inspectThirdPartyCompatibility({ packageDir: plugin, profileDir: profile, runtimeModulesDir: path.join(root, 'other-runtime'), dependencySpec: '1.2.3' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.peers.missing, 1);
});

test('dependency source and supported peer ranges are deterministic', () => {
  assert.equal(classifyDependencySource('1.2.3'), 'registry-exact');
  assert.equal(classifyDependencySource('^1.2.3'), 'registry-range');
  assert.equal(classifyDependencySource('latest'), 'registry-tag');
  assert.equal(classifyDependencySource('link:../plugin'), 'local');
  assert.equal(classifyDependencySource('git+https://github.com/example/plugin.git'), 'git');
  assert.equal(satisfiesSupportedRange('18.3.1', '^18.2.0'), true);
  assert.equal(satisfiesSupportedRange('19.0.0', '^18.2.0'), false);
  assert.equal(satisfiesSupportedRange('1.2.9', '~1.2.3'), true);
  assert.equal(satisfiesSupportedRange('1.3.0', '~1.2.3'), false);
  assert.equal(satisfiesSupportedRange('1.2.3', 'workspace:*'), null);
  assert.equal(satisfiesSupportedRange('0.1.2-rc.1', '0.1.2-rc.1'), true);
  assert.equal(satisfiesSupportedRange('0.1.2-rc.1', '0.1.2-alpha.5'), false);
  assert.equal(satisfiesSupportedRange('0.1.2-rc.1', '^0.1.2'), null);
});
