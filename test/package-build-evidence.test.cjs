'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPackage } = require('@electron/asar');
const {
  DEFAULT_GENERATED_RESOURCE_POLICY,
  inspectPackagedBuild,
  inspectPeHeader,
  selectedByFilters,
  sha256
} = require('../scripts/package-build-evidence.cjs');

const acceptedIdentity = async () => ({
  ok: true,
  productName: 'DSH Desktop',
  fileDescription: 'DSH Desktop',
  internalName: 'DSH Desktop',
  fileVersion: '1.1.8',
  productVersion: '1.1.8.0',
  companyName: 'DSH Desktop',
  originalFilename: '',
  expectedVersion: '1.1.8'
});

const write = async (filePath, content) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
};

const createFixture = async (context, { generatedResources = false } = {}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-package-evidence-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const packagedRoot = path.join(root, 'packaged');
  const manifest = {
    name: 'dsh-desktop',
    version: '1.1.8',
    description: 'fixture',
    main: 'electron/main.cjs',
    author: 'DSH Desktop',
    license: 'MIT',
    private: true,
    dependencies: {},
    devDependencies: { 'electron-builder': '26.11.1' },
    build: {
      files: ['electron/**/*', 'assets/session-continuity.js', 'package.json'],
      extraResources: [
        { from: 'electron/harness-process-host.cjs', to: 'harness-host/harness-process-host.cjs' },
        { from: 'electron/terminal-pty-host.cjs', to: 'terminal/terminal-pty-host.cjs' },
        { from: 'vendor/runtime/win32-x64/node.exe', to: 'runtime/node.exe' },
        { from: 'vendor/harness/node_modules', to: 'harness/node_modules', filter: ['**/*', '!**/*.pdb'] },
        { from: 'vendor/harness/harness-runtime.json', to: 'harness/harness-runtime.json' },
        { from: 'runtime/plugin', to: 'harness-plugins/dsh-desktop-shell-env', filter: ['**/*'] }
      ]
    }
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await write(path.join(root, 'package.json'), manifestText);
  await write(path.join(app, 'package.json'), manifestText);

  const appFiles = new Map([
    ['electron/main.cjs', "require('./workspace-files.cjs');\n"],
    ['electron/workspace-files.cjs', "require('./sensitive-path-policy.cjs');\n"],
    ['electron/sensitive-path-policy.cjs', 'module.exports = "policy";\n'],
    ['electron/session-continuity-store.cjs', 'module.exports = "continuity";\n'],
    ['electron/harness-process-host.cjs', 'module.exports = "harness host";\n'],
    ['electron/terminal-pty-host.cjs', 'module.exports = "terminal host";\n'],
    ['assets/session-continuity.js', 'globalThis.sessionContinuity = true;\n']
  ]);
  for (const [relative, content] of appFiles) {
    await write(path.join(root, ...relative.split('/')), content);
    await write(path.join(app, ...relative.split('/')), content);
  }

  const resources = new Map([
    ['vendor/runtime/win32-x64/node.exe', Buffer.from('fixture node runtime')],
    ['vendor/harness/node_modules/runtime/index.js', Buffer.from('module.exports = true;\n')],
    ['vendor/harness/node_modules/runtime/ignored.pdb', Buffer.from('excluded')],
    ['vendor/harness/harness-runtime.json', Buffer.from('{"version":"fixture"}\n')],
    ['runtime/plugin/index.mjs', Buffer.from('export const name = "fixture";\n')]
  ]);
  for (const [relative, content] of resources) await write(path.join(root, ...relative.split('/')), content);

  const copiedResources = new Map([
    ['harness-host/harness-process-host.cjs', appFiles.get('electron/harness-process-host.cjs')],
    ['terminal/terminal-pty-host.cjs', appFiles.get('electron/terminal-pty-host.cjs')],
    ['runtime/node.exe', resources.get('vendor/runtime/win32-x64/node.exe')],
    ['harness/node_modules/runtime/index.js', resources.get('vendor/harness/node_modules/runtime/index.js')],
    ['harness/harness-runtime.json', resources.get('vendor/harness/harness-runtime.json')],
    ['harness-plugins/dsh-desktop-shell-env/index.mjs', resources.get('runtime/plugin/index.mjs')]
  ]);
  for (const [relative, content] of copiedResources) {
    await write(path.join(packagedRoot, 'resources', ...relative.split('/')), content);
  }

  const executable = Buffer.alloc(1024);
  executable.writeUInt16LE(0x5a4d, 0);
  executable.writeUInt32LE(0x80, 0x3c);
  executable.writeUInt32LE(0x00004550, 0x80);
  await write(path.join(packagedRoot, 'DSH Desktop.exe'), executable);
  const asarPath = path.join(packagedRoot, 'resources', 'app.asar');
  await createPackage(app, asarPath);
  let generatedResourcePolicy;
  if (generatedResources) {
    const appUpdate = Buffer.from([
      'owner: hejiahang0001-oss',
      'repo: dsh-desktop',
      'provider: github',
      'updaterCacheDirName: dsh-desktop-updater',
      ''
    ].join('\n'), 'utf8');
    const elevate = Buffer.alloc(2048);
    elevate.writeUInt16LE(0x5a4d, 0);
    elevate.writeUInt32LE(0x80, 0x3c);
    elevate.writeUInt32LE(0x00004550, 0x80);
    await write(path.join(packagedRoot, 'resources', 'app-update.yml'), appUpdate);
    await write(path.join(packagedRoot, 'resources', 'elevate.exe'), elevate);
    generatedResourcePolicy = {
      appUpdate: DEFAULT_GENERATED_RESOURCE_POLICY.appUpdate,
      elevate: {
        electronBuilderVersion: '26.11.1',
        nsisVersion: '3.0.4.1',
        bytes: elevate.length,
        sha256: sha256(elevate)
      }
    };
  }
  return { root, packagedRoot, asarPath, generatedResourcePolicy };
};

const inspectFixture = (fixture, overrides = {}) => inspectPackagedBuild({
  workspaceRoot: fixture.root,
  executablePath: path.join(fixture.packagedRoot, 'DSH Desktop.exe'),
  asarPath: fixture.asarPath,
  inspectExecutableIdentity: acceptedIdentity,
  ...overrides
});

test('package evidence binds the complete app archive and every declared extraResource tree', async (context) => {
  const fixture = await createFixture(context);
  const evidence = await inspectFixture(fixture);
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.package.version, '1.1.8');
  assert.equal(evidence.appAsar.tree.matches, true);
  assert.equal(evidence.resourceLayout.matches, true);
  assert.equal(evidence.generatedResources.matches, true);
  assert.equal(evidence.generatedResources.appUpdate.present, false);
  assert.equal(evidence.generatedResources.elevate.present, false);
  assert.ok(Object.values(evidence.resourceBindings).every((binding) => binding.matches));
  assert.match(evidence.package.configSha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.executable.sha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.appAsar.sha256, /^[a-f0-9]{64}$/);
  assert.match(evidence.fingerprint, /^[a-f0-9]{64}$/);
});

test('package evidence verifies electron-builder generated dist resources and fingerprints them', async (context) => {
  const fixture = await createFixture(context, { generatedResources: true });
  const evidence = await inspectFixture(fixture, { generatedResourcePolicy: fixture.generatedResourcePolicy });
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.generatedResources.matches, true);
  assert.deepEqual(evidence.generatedResources.presentFiles, ['app-update.yml', 'elevate.exe']);
  assert.equal(evidence.generatedResources.appUpdate.matches, true);
  assert.equal(evidence.generatedResources.appUpdate.fields.owner, 'hejiahang0001-oss');
  assert.equal(evidence.generatedResources.elevate.matches, true);
  assert.equal(evidence.generatedResources.elevate.looksLikePe, true);
  assert.equal(evidence.generatedResources.elevate.producer.electronBuilderVersion, '26.11.1');
  assert.equal(evidence.generatedResources.elevate.producer.nsisVersion, '3.0.4.1');
  assert.equal(evidence.resourceLayout.matches, true);
  assert.equal(evidence.resourceLayout.unexpected.length, 0);

  await fs.rm(path.join(fixture.packagedRoot, 'resources', 'app-update.yml'));
  await fs.rm(path.join(fixture.packagedRoot, 'resources', 'elevate.exe'));
  const packEvidence = await inspectFixture(fixture, { generatedResourcePolicy: fixture.generatedResourcePolicy });
  assert.equal(packEvidence.accepted, true);
  assert.notEqual(packEvidence.fingerprint, evidence.fingerprint);
});

test('package evidence rejects altered generated dist metadata and elevate binaries', async (context) => {
  const fixture = await createFixture(context, { generatedResources: true });
  await fs.writeFile(
    path.join(fixture.packagedRoot, 'resources', 'app-update.yml'),
    'owner: attacker\nrepo: dsh-desktop\nprovider: github\nupdaterCacheDirName: dsh-desktop-updater\n'
  );
  let evidence = await inspectFixture(fixture, { generatedResourcePolicy: fixture.generatedResourcePolicy });
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.generatedResources.appUpdate.matches, false);
  assert.ok(evidence.resourceLayout.unexpected.includes('app-update.yml'));

  const expectedUpdate = [
    'owner: hejiahang0001-oss',
    'repo: dsh-desktop',
    'provider: github',
    'updaterCacheDirName: dsh-desktop-updater',
    ''
  ].join('\n');
  await fs.writeFile(path.join(fixture.packagedRoot, 'resources', 'app-update.yml'), expectedUpdate);
  const elevatePath = path.join(fixture.packagedRoot, 'resources', 'elevate.exe');
  const alteredElevate = await fs.readFile(elevatePath);
  alteredElevate[alteredElevate.length - 1] ^= 0xff;
  await fs.writeFile(elevatePath, alteredElevate);
  evidence = await inspectFixture(fixture, { generatedResourcePolicy: fixture.generatedResourcePolicy });
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.generatedResources.elevate.matches, false);
  assert.equal(evidence.generatedResources.elevate.looksLikePe, true);
  assert.ok(evidence.resourceLayout.unexpected.includes('elevate.exe'));
});

test('production generated-resource policy is pinned to electron-builder 26.11.1 and NSIS 3.0.4.1', () => {
  assert.deepEqual(DEFAULT_GENERATED_RESOURCE_POLICY.appUpdate, {
    owner: 'hejiahang0001-oss',
    repo: 'dsh-desktop',
    provider: 'github',
    updaterCacheDirName: 'dsh-desktop-updater'
  });
  assert.deepEqual(DEFAULT_GENERATED_RESOURCE_POLICY.elevate, {
    electronBuilderVersion: '26.11.1',
    nsisVersion: '3.0.4.1',
    bytes: 107_520,
    sha256: '9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37'
  });
});

test('package evidence rejects a stale transitive app dependency and changes the fingerprint', async (context) => {
  const fixture = await createFixture(context);
  const before = await inspectFixture(fixture);
  await fs.writeFile(path.join(fixture.root, 'electron', 'sensitive-path-policy.cjs'), 'module.exports = "changed";\n');
  const after = await inspectFixture(fixture);
  assert.equal(after.accepted, false);
  assert.equal(after.appAsar.tree.matches, false);
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.ok(after.appAsar.tree.mismatched.includes('electron/sensitive-path-policy.cjs'));
});

test('package evidence rejects stale Harness provenance and desktop plugin resources', async (context) => {
  const fixture = await createFixture(context);
  const before = await inspectFixture(fixture);
  await fs.writeFile(path.join(fixture.packagedRoot, 'resources', 'harness', 'harness-runtime.json'), '{"version":"stale"}\n');
  let after = await inspectFixture(fixture);
  assert.equal(after.accepted, false);
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.ok(Object.values(after.resourceBindings).some((binding) => !binding.matches));

  await fs.writeFile(
    path.join(fixture.packagedRoot, 'resources', 'harness', 'harness-runtime.json'),
    await fs.readFile(path.join(fixture.root, 'vendor', 'harness', 'harness-runtime.json'))
  );
  await fs.writeFile(path.join(fixture.root, 'runtime', 'plugin', 'index.mjs'), 'export const name = "changed";\n');
  after = await inspectFixture(fixture);
  assert.equal(after.accepted, false);
  assert.ok(Object.values(after.resourceBindings).some((binding) => !binding.matches));
});

test('package evidence rejects missing, unexpected and excluded resource files', async (context) => {
  const fixture = await createFixture(context);
  await fs.rm(path.join(fixture.packagedRoot, 'resources', 'runtime', 'node.exe'));
  await write(path.join(fixture.packagedRoot, 'resources', 'unexpected.bin'), 'unexpected');
  const evidence = await inspectFixture(fixture);
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.resourceLayout.matches, false);
  assert.ok(evidence.resourceLayout.missing.includes('runtime/node.exe'));
  assert.ok(evidence.resourceLayout.unexpected.includes('unexpected.bin'));
  assert.equal(selectedByFilters('runtime/ignored.pdb', ['**/*', '!**/*.pdb']), false);
  assert.equal(selectedByFilters('runtime/.gitkeep', ['**/*']), false);
});

test('package evidence requires a real PE header before trusting injected VersionInfo', async (context) => {
  const fixture = await createFixture(context);
  const validBytes = await fs.readFile(path.join(fixture.packagedRoot, 'DSH Desktop.exe'));
  assert.equal(inspectPeHeader(validBytes).valid, true);
  const fake = Buffer.alloc(512);
  fake.writeUInt16LE(0x5a4d, 0);
  await fs.writeFile(path.join(fixture.packagedRoot, 'DSH Desktop.exe'), fake);
  const evidence = await inspectFixture(fixture);
  assert.equal(evidence.accepted, false);
  assert.equal(evidence.executable.looksLikePe, false);
});

test('package evidence rejects a mismatched executable identity', async (context) => {
  const fixture = await createFixture(context);
  const evidence = await inspectFixture(fixture, {
    inspectExecutableIdentity: async () => ({ ...(await acceptedIdentity()), ok: false })
  });
  assert.equal(evidence.accepted, false);
});
