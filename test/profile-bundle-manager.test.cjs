const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { JOURNAL_NAME, ProfileBundleManager } = require('../electron/profile-bundle-manager.cjs');

const createProfile = (root) => {
  const profilesRoot = path.join(root, 'profiles');
  const profileDir = path.join(profilesRoot, 'web');
  fs.mkdirSync(profileDir, { recursive: true });
  const manifest = {
    name: 'dsh-profile-web',
    private: true,
    dependencies: { 'community-bundle': '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'community-bundle'] } }
  };
  fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { profilesRoot, profileDir, manifest };
};

const readManifest = (profileDir) => JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));

test('profile bundle manager commits a verified external-bundle toggle and retains no journal', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-toggle-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { profilesRoot, profileDir } = createProfile(root);
  const manager = new ProfileBundleManager({ profilesRoot });
  const transaction = await manager.apply({ profileDir, packageName: 'community-bundle', enable: false });
  assert.equal(transaction.changed, true);
  assert.deepEqual(readManifest(profileDir).dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
  assert.equal(fs.existsSync(path.join(profileDir, JOURNAL_NAME)), true);
  await manager.commit(transaction.id);
  assert.equal(fs.existsSync(path.join(profileDir, JOURNAL_NAME)), false);
  assert.equal(fs.existsSync(`${path.join(profileDir, JOURNAL_NAME)}.bak`), false);
  assert.deepEqual(readManifest(profileDir).dsh.profile.bundles, ['@deepseek-ai/dsh-base']);
});

test('profile bundle manager rolls back a failed runtime validation to the exact previous manifest', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-toggle-rollback-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { profilesRoot, profileDir, manifest } = createProfile(root);
  const manager = new ProfileBundleManager({ profilesRoot });
  const transaction = await manager.apply({ profileDir, packageName: 'community-bundle', enable: false });
  await manager.rollback(transaction.id);
  assert.deepEqual(readManifest(profileDir), manifest);
  assert.equal(fs.existsSync(path.join(profileDir, JOURNAL_NAME)), false);
});

test('startup recovery restores the verified manifest backup after an interrupted toggle', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-toggle-recover-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { profilesRoot, profileDir, manifest } = createProfile(root);
  const first = new ProfileBundleManager({ profilesRoot });
  await first.apply({ profileDir, packageName: 'community-bundle', enable: false });
  const second = new ProfileBundleManager({ profilesRoot });
  const outcomes = await second.recoverPending();
  assert.deepEqual(outcomes, [{ profile: 'web', status: 'rolled-back' }]);
  assert.deepEqual(readManifest(profileDir), manifest);
  assert.equal(fs.existsSync(path.join(profileDir, JOURNAL_NAME)), false);
});

test('profile bundle manager refuses fixed bundles, invalid names, and directories outside profiles root', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-toggle-boundary-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { profilesRoot, profileDir } = createProfile(root);
  const manager = new ProfileBundleManager({ profilesRoot });
  await assert.rejects(
    manager.apply({ profileDir, packageName: '@deepseek-ai/dsh-base', enable: false }),
    /固定基础扩展层/
  );
  await assert.rejects(
    manager.apply({ profileDir, packageName: '../escape', enable: false }),
    /参数无效/
  );
  await assert.rejects(
    manager.apply({ profileDir: root, packageName: 'community-bundle', enable: false }),
    /范围校验/
  );
});

test('rollback fails closed when the Profile changed after the requested toggle', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-toggle-conflict-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { profilesRoot, profileDir } = createProfile(root);
  const manager = new ProfileBundleManager({ profilesRoot });
  const transaction = await manager.apply({ profileDir, packageName: 'community-bundle', enable: false });
  const edited = readManifest(profileDir);
  edited.userEdit = 'preserve-me';
  fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify(edited, null, 2)}\n`);
  await assert.rejects(manager.rollback(transaction.id), /避免覆盖用户编辑/);
  assert.equal(readManifest(profileDir).userEdit, 'preserve-me');
  assert.equal(fs.existsSync(path.join(profileDir, JOURNAL_NAME)), true);
});
