const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PluginHealthCatalog, validPackageName } = require('../electron/plugin-health.cjs');
const desktopRuntime = require('../electron/harness-desktop-runtime.cjs');

const writePackage = (dir, manifest) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};

const linkPackage = (root, name, target) => {
  const link = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
};

// The bridge's pinned descriptor/CLI trust checks have their own tests. These
// tiny fixtures isolate catalog semantics without copying the official tree.
const materializedFixture = (context, { bundlePatch } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-materialized-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, 'runtime');
  const installRoot = path.join(runtimeRoot, 'node_modules');
  const dshDir = path.join(installRoot, '@deepseek-ai', 'dsh');
  const dependencyDir = path.join(installRoot, 'fixture-dependency');
  const harnessHome = path.join(root, 'home');
  writePackage(dshDir, {
    name: '@deepseek-ai/dsh', version: desktopRuntime.HARNESS_VERSION,
    dependencies: { 'fixture-dependency': '1.0.0' }
  });
  writePackage(dependencyDir, {
    name: 'fixture-dependency', version: '1.0.0',
    ...(bundlePatch === undefined ? {} : { dsh: { bundle: { patch: bundlePatch } } })
  });
  fs.writeFileSync(path.join(runtimeRoot, 'desktop-runtime.json'), '{"fixture":true}');
  const descriptor = { files: [dshDir, dependencyDir].map(dir => {
    const bytes = fs.readFileSync(path.join(dir, 'package.json'));
    return {
      path: path.relative(runtimeRoot, path.join(dir, 'package.json')).split(path.sep).join('/'),
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')
    };
  }) };
  const read = context.mock.method(desktopRuntime, 'readHarnessDesktopRuntime', candidate => {
    assert.equal(candidate, runtimeRoot);
    return { runtimeRoot, nodeModulesPath: installRoot, dshBinPath: path.join(dshDir, 'lib', 'bin.js'), descriptor };
  });
  const scan = () => new PluginHealthCatalog({ harnessHome, dshPackageDir: dshDir }).scan();
  return { root, runtimeRoot, installRoot, dshDir, dependencyDir, harnessHome, descriptor, read, scan };
};

test('official materialized closure is healthy without legacy profile projections', async (context) => {
  const fixture = materializedFixture(context);
  const state = await fixture.scan();
  assert.equal(fixture.read.mock.callCount(), 1);
  assert.equal(state.runtime.status, 'healthy');
  assert.equal(state.runtime.layout, 'official-desktop-runtime');
  assert.equal(state.runtime.expected, 2);
  assert.equal(state.runtime.healthy, 2);
  assert.equal(state.runtime.missing, 0);
  assert.equal(fs.existsSync(fixture.harnessHome), false, 'scan must not write projections or user state');
});

test('official materialized closure retains missing dependency failures', async (context) => {
  const fixture = materializedFixture(context);
  fs.rmSync(fixture.dependencyDir, { recursive: true });
  const state = await fixture.scan();
  assert.equal(state.runtime.status, 'degraded');
  assert.equal(state.runtime.expected, 2);
  assert.equal(state.runtime.healthy, 1);
  assert.equal(state.runtime.missing, 1);
  assert.deepEqual(state.runtime.issues, [{ name: 'fixture-dependency', status: 'missing' }]);
});

test('official materialized closure rejects unbound and changed package manifests', async (context) => {
  const fixture = materializedFixture(context);
  writePackage(fixture.dependencyDir, { name: 'fixture-dependency', version: '9.9.9' });
  const changed = await fixture.scan();
  assert.equal(changed.runtime.status, 'degraded');
  assert.equal(changed.runtime.misdirected, 1);
  assert.equal(changed.runtime.healthy, 1);
  assert.deepEqual(changed.runtime.issues, [{ name: 'fixture-dependency', status: 'misdirected' }]);
  fixture.descriptor.files.pop();
  const unbound = await fixture.scan();
  assert.equal(unbound.runtime.misdirected, 1);
  assert.equal(unbound.runtime.status, 'degraded');
});

test('official materialized closure rejects directory links and manifest hardlinks', async (context) => {
  const fixture = materializedFixture(context);
  const moved = path.join(fixture.installRoot, 'relocated-dependency');
  fs.renameSync(fixture.dependencyDir, moved);
  linkPackage(fixture.installRoot, 'fixture-dependency', moved);
  const linked = await fixture.scan();
  assert.equal(linked.runtime.status, 'degraded');
  assert.equal(linked.runtime.misdirected, 1);
  fs.unlinkSync(fixture.dependencyDir);
  fs.renameSync(moved, fixture.dependencyDir);
  fs.linkSync(path.join(fixture.dependencyDir, 'package.json'), path.join(fixture.root, 'manifest-alias.json'));
  const hardlinked = await fixture.scan();
  assert.equal(hardlinked.runtime.status, 'degraded');
  assert.equal(hardlinked.runtime.misdirected, 1);
});

test('an invalid official descriptor cannot fall back to healthy legacy projections', async (context) => {
  const fixture = materializedFixture(context);
  fixture.read.mock.restore();
  const fallback = path.join(fixture.harnessHome, 'profiles', 'node_modules');
  linkPackage(fallback, '@deepseek-ai/dsh', fixture.dshDir);
  linkPackage(fallback, 'fixture-dependency', fixture.dependencyDir);
  const state = await fixture.scan();
  assert.equal(state.available, false);
  assert.equal(state.runtime.status, 'unavailable');
});

test('the product runtime directory cannot downgrade when its descriptor is missing', async (context) => {
  const fixture = materializedFixture(context);
  fixture.read.mock.restore();
  const directoryName = process.platform === 'win32'
    ? desktopRuntime.HARNESS_RUNTIME_DIRECTORY.toUpperCase()
    : desktopRuntime.HARNESS_RUNTIME_DIRECTORY;
  const productRoot = path.join(fixture.root, directoryName);
  fs.renameSync(fixture.runtimeRoot, productRoot);
  fs.unlinkSync(path.join(productRoot, 'desktop-runtime.json'));
  const dshDir = path.join(productRoot, 'node_modules', '@deepseek-ai', 'dsh');
  const fallback = path.join(fixture.harnessHome, 'profiles', 'node_modules');
  linkPackage(fallback, '@deepseek-ai/dsh', dshDir);
  linkPackage(fallback, 'fixture-dependency', path.join(productRoot, 'node_modules', 'fixture-dependency'));
  const state = await new PluginHealthCatalog({ harnessHome: fixture.harnessHome, dshPackageDir: dshDir }).scan();
  assert.equal(state.available, false);
  assert.equal(state.runtime.status, 'unavailable');
});

test('runtime bundle metadata accepts the official ordered patch-list declaration', async (context) => {
  const fixture = materializedFixture(context, { bundlePatch: ['./first.yml', './second.yml'] });
  const profile = path.join(fixture.harnessHome, 'profiles', 'web');
  writePackage(profile, { dependencies: {}, dsh: { profile: { bundles: ['fixture-dependency'] } } });
  fs.writeFileSync(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  const state = await fixture.scan();
  assert.equal(state.runtime.status, 'healthy');
  assert.equal(state.profiles[0].status, 'healthy');
  assert.equal(state.profiles[0].bundles[0].declaresBundle, true);
  assert.equal(state.profiles[0].bundles[0].source, 'runtime');
});

test('a relocated official runtime cannot downgrade when its descriptor is missing', async (context) => {
  const fixture = materializedFixture(context);
  fixture.read.mock.restore();
  writePackage(fixture.runtimeRoot, { name: '@deepseek-ai/dsh-desktop-runtime', version: desktopRuntime.HARNESS_VERSION });
  fs.unlinkSync(path.join(fixture.runtimeRoot, 'desktop-runtime.json'));
  const fallback = path.join(fixture.harnessHome, 'profiles', 'node_modules');
  linkPackage(fallback, '@deepseek-ai/dsh', fixture.dshDir);
  linkPackage(fallback, 'fixture-dependency', fixture.dependencyDir);
  const state = await fixture.scan();
  assert.equal(state.available, false);
  assert.equal(state.runtime.status, 'unavailable');
});

test('runtime bundle metadata does not accept a malformed patch-list declaration', async (context) => {
  const fixture = materializedFixture(context, { bundlePatch: ['./first.yml', 7] });
  const profile = path.join(fixture.harnessHome, 'profiles', 'web');
  writePackage(profile, { dependencies: {}, dsh: { profile: { bundles: ['fixture-dependency'] } } });
  fs.writeFileSync(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  const state = await fixture.scan();
  assert.equal(state.profiles[0].status, 'degraded');
  assert.equal(state.profiles[0].bundles[0].status, 'not-bundle');
});

test('descriptorless fixtures retain the legacy projection contract even at the new version', async (context) => {
  const fixture = materializedFixture(context);
  fs.unlinkSync(path.join(fixture.runtimeRoot, 'desktop-runtime.json'));
  const fallback = path.join(fixture.harnessHome, 'profiles', 'node_modules');
  linkPackage(fallback, '@deepseek-ai/dsh', fixture.dshDir);
  linkPackage(fallback, 'fixture-dependency', fixture.dependencyDir);
  const state = await fixture.scan();
  assert.equal(fixture.read.mock.callCount(), 0);
  assert.equal(state.runtime.status, 'healthy');
  assert.equal(state.runtime.expected, 2);
});

test('plugin health catalog audits fixed closure and profile dependencies without config content', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-health-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'runtime', 'node_modules');
  const dshDir = path.join(installRoot, '@deepseek-ai', 'dsh');
  const baseDir = path.join(installRoot, '@deepseek-ai', 'dsh-base');
  writePackage(dshDir, {
    name: '@deepseek-ai/dsh',
    version: '0.1.2-alpha.2',
    dependencies: { '@deepseek-ai/dsh-base': '0.1.2-alpha.2', '@deepseek-ai/dsh-skill': '0.1.2-alpha.2', '@deepseek-ai/dsh-mcp-client': '0.1.2-alpha.2', '@deepseek-ai/dsh-host-plugin-inventory': '0.1.2-alpha.2' },
    peerDependencies: { 'optional-native-accelerator': '^1.0.0' },
    peerDependenciesMeta: { 'optional-native-accelerator': { optional: true } }
  });
  writePackage(baseDir, { name: '@deepseek-ai/dsh-base', version: '0.1.2-alpha.2', dsh: { bundle: { patch: './cordis.patch.yml' } } });
  for (const name of ['dsh-skill', 'dsh-mcp-client', 'dsh-host-plugin-inventory']) {
    writePackage(path.join(installRoot, '@deepseek-ai', name), { name: `@deepseek-ai/${name}`, version: '0.1.2-alpha.2' });
  }
  const harnessHome = path.join(root, 'home');
  const profilesRoot = path.join(harnessHome, 'profiles');
  const fallback = path.join(profilesRoot, 'node_modules');
  linkPackage(fallback, '@deepseek-ai/dsh', dshDir);
  linkPackage(fallback, '@deepseek-ai/dsh-base', baseDir);
  for (const name of ['dsh-skill', 'dsh-mcp-client', 'dsh-host-plugin-inventory']) {
    linkPackage(fallback, `@deepseek-ai/${name}`, path.join(installRoot, '@deepseek-ai', name));
  }
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
  assert.equal(state.runtime.expected, 5);
  assert.equal(state.runtime.version, '0.1.2-alpha.2');
  assert.equal(state.runtime.capabilities.skills.status, 'ready');
  assert.equal(state.runtime.capabilities.mcp.version, '0.1.2-alpha.2');
  assert.equal(state.runtime.capabilities.pluginInventory.status, 'ready');
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

test('plugin health catalog reports a declared runtime dependency that cannot be resolved', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plugin-health-unresolved-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installRoot = path.join(root, 'runtime', 'node_modules');
  const dshDir = path.join(installRoot, '@deepseek-ai', 'dsh');
  writePackage(dshDir, {
    name: '@deepseek-ai/dsh',
    version: 'test',
    dependencies: { '@deepseek-ai/dsh-missing': 'test' }
  });
  const harnessHome = path.join(root, 'home');
  linkPackage(path.join(harnessHome, 'profiles', 'node_modules'), '@deepseek-ai/dsh', dshDir);

  const state = await new PluginHealthCatalog({ harnessHome, dshPackageDir: dshDir }).scan();
  assert.equal(state.runtime.status, 'degraded');
  assert.equal(state.runtime.expected, 2);
  assert.equal(state.runtime.healthy, 1);
  assert.equal(state.runtime.missing, 1);
  assert.deepEqual(state.runtime.issues, [{ name: '@deepseek-ai/dsh-missing', status: 'missing' }]);
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
