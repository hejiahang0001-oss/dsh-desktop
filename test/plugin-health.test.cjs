const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PluginHealthCatalog, validPackageName } = require('../electron/plugin-health.cjs');

const writePackage = (dir, manifest) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};

const linkPackage = (root, name, target) => {
  const link = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
};

test('plugin health catalog audits fixed closure and profile dependencies without config content', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-health-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'runtime', 'node_modules');
  const dshDir = path.join(installRoot, '@deepseek-ai', 'dsh');
  const baseDir = path.join(installRoot, '@deepseek-ai', 'dsh-base');
  writePackage(dshDir, { name: '@deepseek-ai/dsh', version: '0.1.1-rc.2', dependencies: { '@deepseek-ai/dsh-base': '0.1.1-rc.2' } });
  writePackage(baseDir, { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', dsh: { bundle: { patch: './cordis.patch.yml' } } });
  const harnessHome = path.join(root, 'home');
  const profilesRoot = path.join(harnessHome, 'profiles');
  const fallback = path.join(profilesRoot, 'node_modules');
  linkPackage(fallback, '@deepseek-ai/dsh', dshDir);
  linkPackage(fallback, '@deepseek-ai/dsh-base', baseDir);
  const profile = path.join(profilesRoot, 'web');
  writePackage(profile, {
    name: 'dsh-profile-web',
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    privateMarker: 'must-not-leak'
  });
  fs.writeFileSync(path.join(profile, 'pnpm-workspace.yaml'), 'secret-profile-config');
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), 'hidden-patch-marker');

  const catalog = new PluginHealthCatalog({ harnessHome, dshPackageDir: dshDir });
  const state = await catalog.scan();
  assert.equal(state.available, true);
  assert.equal(state.runtime.status, 'healthy');
  assert.equal(state.runtime.expected, 2);
  assert.equal(state.runtime.version, '0.1.1-rc.2');
  assert.equal(state.profiles[0].status, 'healthy');
  assert.equal(state.profiles[0].bundles[0].source, 'runtime');
  assert.equal(state.profiles[0].bundles[0].declaresBundle, true);
  assert.equal(JSON.stringify(state).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(state).includes('hidden-patch-marker'), false);
  assert.equal(JSON.stringify(state).includes('secret-profile-config'), false);
  assert.equal(await catalog.resolveProfilePath(state.profiles[0].id), profile);
  assert.equal(await catalog.resolveProfilePath('../web'), null);
});

test('plugin health catalog reports missing fallback and blocks dependency links outside allowed roots', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-health-boundary-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'runtime', 'node_modules');
  const dshDir = path.join(installRoot, '@deepseek-ai', 'dsh');
  const baseDir = path.join(installRoot, '@deepseek-ai', 'dsh-base');
  writePackage(dshDir, { name: '@deepseek-ai/dsh', version: 'test', dependencies: { '@deepseek-ai/dsh-base': 'test' } });
  writePackage(baseDir, { name: '@deepseek-ai/dsh-base', dsh: { bundle: { patch: './cordis.patch.yml' } } });
  const harnessHome = path.join(root, 'home');
  const profile = path.join(harnessHome, 'profiles', 'custom');
  const outside = path.join(root, 'outside-plugin');
  writePackage(outside, { name: 'outside-plugin', version: '1.0.0', dsh: { bundle: { patch: './hidden.yml' } } });
  writePackage(profile, { dependencies: { 'outside-plugin': '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'outside-plugin'] } } });
  fs.writeFileSync(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  linkPackage(path.join(profile, 'node_modules'), 'outside-plugin', outside);

  const state = await new PluginHealthCatalog({ harnessHome, dshPackageDir: dshDir }).scan();
  assert.equal(state.runtime.status, 'degraded');
  assert.equal(state.runtime.missing, 2);
  assert.equal(state.profiles[0].status, 'degraded');
  assert.equal(state.profiles[0].dependencies[0].status, 'blocked');
  assert.equal(state.profiles[0].bundles[1].status, 'blocked');
});

test('plugin health catalog exposes only bounded compatibility evidence and blocks an invalid patch', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-health-compat-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'runtime', 'node_modules');
  const dshDir = path.join(installRoot, '@deepseek-ai', 'dsh');
  const baseDir = path.join(installRoot, '@deepseek-ai', 'dsh-base');
  writePackage(dshDir, { name: '@deepseek-ai/dsh', version: 'test', dependencies: { '@deepseek-ai/dsh-base': 'test' } });
  writePackage(baseDir, { name: '@deepseek-ai/dsh-base', dsh: { bundle: { patch: './cordis.patch.yml' } } });
  const harnessHome = path.join(root, 'home');
  const profilesRoot = path.join(harnessHome, 'profiles');
  const fallback = path.join(profilesRoot, 'node_modules');
  linkPackage(fallback, '@deepseek-ai/dsh', dshDir);
  linkPackage(fallback, '@deepseek-ai/dsh-base', baseDir);
  writePackage(path.join(fallback, 'react'), { name: 'react', version: '18.3.1' });
  const profile = path.join(profilesRoot, 'web');
  const plugin = path.join(profile, 'node_modules', '@example', 'theme');
  writePackage(plugin, {
    name: '@example/theme',
    version: '1.2.3',
    peerDependencies: { react: '^18.2.0' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    privateMarker: 'must-not-leak'
  });
  fs.writeFileSync(path.join(plugin, 'cordis.patch.yml'), '- insert: []\n');
  writePackage(profile, {
    name: 'dsh-profile-web',
    dependencies: { '@example/theme': '1.2.3' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@example/theme'] } }
  });
  fs.writeFileSync(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');

  const ready = await new PluginHealthCatalog({ harnessHome, dshPackageDir: dshDir }).scan();
  const dependency = ready.profiles[0].dependencies[0];
  assert.equal(ready.profiles[0].status, 'healthy');
  assert.equal(dependency.compatibility.status, 'verified');
  assert.equal(dependency.compatibility.sourceType, 'registry-exact');
  assert.equal(dependency.compatibility.bundlePatch, 'ready');
  assert.equal(dependency.compatibility.peers.healthy, 1);
  assert.equal(dependency.toggleable, true);
  assert.equal(JSON.stringify(dependency).includes('must-not-leak'), false);

  fs.rmSync(path.join(plugin, 'cordis.patch.yml'));
  const blocked = await new PluginHealthCatalog({ harnessHome, dshPackageDir: dshDir }).scan();
  assert.equal(blocked.profiles[0].status, 'degraded');
  assert.equal(blocked.profiles[0].dependencies[0].compatibility.status, 'blocked');
  assert.equal(blocked.profiles[0].dependencies[0].toggleable, false);
});

test('package-name validation rejects traversal and unsupported names', () => {
  assert.equal(validPackageName('@deepseek-ai/dsh-web-app'), true);
  assert.equal(validPackageName('plain-plugin'), true);
  assert.equal(validPackageName('../escape'), false);
  assert.equal(validPackageName('@scope/../../escape'), false);
  assert.equal(validPackageName('UPPERCASE'), false);
});
