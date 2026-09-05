'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

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
