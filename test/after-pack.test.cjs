'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const asar = require('@electron/asar');
const { finished } = require('node:stream/promises');
const { verifyPackagedPowerShell } = require('../scripts/verify-powershell-package.cjs');
const { verifyPackagedHarness } = require('../scripts/verify-harness-package.cjs');

const {
  DEFAULT_APP_RELATIVE,
  removeDefaultElectronApp
} = require('../scripts/after-pack.cjs');

const removeTemporaryTree = (target) => fs.rm(target, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100
});

test('after-pack removes only the verified Electron 43 default application', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-after-pack-'));
  context.after(() => removeTemporaryTree(root));
  const target = path.join(root, DEFAULT_APP_RELATIVE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from('verified Electron default application fixture', 'utf8');
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(target, bytes);
  const result = await removeDefaultElectronApp(
    { appOutDir: root, electronPlatformName: 'win32' },
    { expectedBytes: bytes.length, expectedSha256 }
  );
  assert.deepEqual(result, { removed: true, reason: 'verified-electron-default-app' });
  await assert.rejects(fs.access(target), { code: 'ENOENT' });
});

test('after-pack fails closed for a modified default application', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-after-pack-'));
  context.after(() => removeTemporaryTree(root));
  const target = path.join(root, DEFAULT_APP_RELATIVE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const bytes = Buffer.from('modified default application fixture', 'utf8');
  await fs.writeFile(target, bytes);
  await assert.rejects(
    removeDefaultElectronApp(
      { appOutDir: root, electronPlatformName: 'win32' },
      { expectedBytes: bytes.length, expectedSha256: '0'.repeat(64) }
    ),
    /digest/u
  );
  assert.equal((await fs.lstat(target)).isFile(), true);
});

test('after-pack is idempotent when the default application is absent', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-after-pack-'));
  context.after(() => removeTemporaryTree(root));
  const result = await removeDefaultElectronApp({ appOutDir: root, electronPlatformName: 'win32' });
  assert.deepEqual(result, { removed: false, reason: 'absent' });
});

test('PowerShell package gate rejects an altered app.asar trust anchor before payload use', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lulu-ps-package-'));
  context.after(() => removeTemporaryTree(root));
  const source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'runtime/powershell'), { recursive: true });
  await fs.writeFile(path.join(source, 'runtime/powershell/profile.json'), '{"version":"untrusted"}');
  await fs.mkdir(path.join(root, 'resources'));
  await finished(await asar.createPackage(source, path.join(root, 'resources/app.asar')));
  assert.throws(() => verifyPackagedPowerShell({ appOutDir: root, electronPlatformName: 'win32' }), /binding mismatch/);
});

test('PowerShell package gate does not accept relative output or infer another platform', () => {
  assert.throws(() => verifyPackagedPowerShell({ appOutDir: 'relative', electronPlatformName: 'win32' }), /absolute app output/);
  assert.deepEqual(verifyPackagedPowerShell({ electronPlatformName: 'linux' }), { verified: false, reason: 'non-windows' });
});

test('Harness package gate rejects an altered application identity before using runtime bytes', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lulu-harness-package-'));
  context.after(() => removeTemporaryTree(root));
  const source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'runtime/harness'), { recursive: true });
  await fs.writeFile(path.join(source, 'runtime/harness/package.json'), '{"version":"untrusted"}');
  await fs.mkdir(path.join(root, 'resources'));
  await fs.mkdir(path.join(root, 'resources/harness-host'));
  await fs.copyFile(path.join(__dirname, '../electron/harness-process-host.cjs'), path.join(root, 'resources/harness-host/harness-process-host.cjs'));
  await finished(await asar.createPackage(source, path.join(root, 'resources/app.asar')));
  await assert.rejects(verifyPackagedHarness({ appOutDir: root, electronPlatformName: 'win32' }), /binding mismatch/);
});

test('Harness package gate rejects relative paths and does not infer another platform', async () => {
  await assert.rejects(verifyPackagedHarness({ appOutDir: 'relative', electronPlatformName: 'win32' }), /absolute app output/);
  assert.deepEqual(await verifyPackagedHarness({ electronPlatformName: 'linux' }), { verified: false, reason: 'non-windows' });
});

for (const state of ['missing', 'modified']) test(`Harness package gate rejects a ${state} process host before reading runtime payload`, async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lulu-process-host-package-'));
  context.after(() => removeTemporaryTree(root));
  await fs.mkdir(path.join(root, 'resources/harness-host'), { recursive: true });
  // Deliberately not a valid ASAR: the bootstrap gate must reject first.
  await fs.writeFile(path.join(root, 'resources/app.asar'), 'unread archive fixture');
  if (state === 'modified') await fs.writeFile(path.join(root, 'resources/harness-host/harness-process-host.cjs'), 'throw new Error("altered bootstrap");');
  await assert.rejects(verifyPackagedHarness({ appOutDir: root, electronPlatformName: 'win32' }), /Harness process host/);
});
