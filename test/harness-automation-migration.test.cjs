const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { prepareAutomationMigration, allowAutomationMigration, readAutomationMigration, confirmAutomationMigration, automationRecoveryBlocked } = require('../electron/harness-automation-migration.cjs');
const oldBundle = '@deepseek-ai/dsh-experimental-schedule-bundle';
async function fixture(t, { profile = true, bundles = [], tasks = { a: { status: 'active' } } } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-automation-migration-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const homeDir = path.join(dir, 'home'), basePatchPath = path.join(dir, 'base.patch.yml');
  await fs.mkdir(path.join(homeDir, 'storages'), { recursive: true });
  await fs.writeFile(basePatchPath, '# owned base\n- id: unrelated\n  disabled: true\n');
  if (profile) {
    await fs.mkdir(path.join(homeDir, 'profiles/web'), { recursive: true });
    await fs.writeFile(path.join(homeDir, 'profiles/web/package.json'), JSON.stringify({ dsh: { profile: { bundles } } }));
  }
  await fs.writeFile(path.join(homeDir, 'storages/schedule.json'), JSON.stringify({ unit: { name: 'schedule', version: 1 }, global: null, tables: { tasks } }));
  return { homeDir, basePatchPath, dir };
}
test('ambiguous old web profile pauses shared active tasks using a separate official overlay, preserving bytes', async t => {
  const f = await fixture(t);
  const paths = [f.basePatchPath, path.join(f.homeDir, 'profiles/web/package.json'), path.join(f.homeDir, 'storages/schedule.json')];
  const before = await Promise.all(paths.map(p => fs.readFile(p)));
  const result = await prepareAutomationMigration(f);
  assert.equal(result.state.decision, 'hold'); assert.equal(result.state.reason, 'legacy-profile-activation-ambiguous');
  assert.notEqual(result.patchPath, f.basePatchPath);
  assert.match(await fs.readFile(result.patchPath, 'utf8'), /- id: schedule\n  disabled: true\n/);
  assert.deepEqual(await Promise.all(paths.map(p => fs.readFile(p))), before);
  const again = await prepareAutomationMigration(f);
  assert.deepEqual(again.state, result.state);
});
for (const [name, options] of Object.entries({
  'new home and profile': { profile: false, tasks: {} }, 'explicitly enabled old bundle': { bundles: [oldBundle] },
  'empty table': { tasks: {} }, 'inactive table': { tasks: { a: { status: 'inactive' } } },
})) test(`${name} is not held, and later new tasks do not become legacy`, async t => {
  const f = await fixture(t, options), first = await prepareAutomationMigration(f);
  assert.equal(first.state.decision, 'allow'); assert.equal(first.patchPath, f.basePatchPath);
  await fs.writeFile(path.join(f.homeDir, 'storages/schedule.json'), JSON.stringify({ unit: { name: 'schedule', version: 1 }, tables: { tasks: { new: {} } } }));
  assert.equal((await prepareAutomationMigration(f)).state.decision, 'allow');
});
test('missing legacy status is active and another enabled profile never establishes web consent', async t => {
  const f = await fixture(t, { tasks: { a: {} } });
  await fs.mkdir(path.join(f.homeDir, 'profiles/other'), { recursive: true });
  await fs.writeFile(path.join(f.homeDir, 'profiles/other/package.json'), JSON.stringify({ dsh: { profile: { bundles: [oldBundle] } } }));
  const result = await prepareAutomationMigration(f);
  assert.equal(result.state.decision, 'hold'); assert.equal(result.state.activeTaskCount, 1);
  assert.equal(result.state.scope, 'home-shared-schedule-via-web-launch');
});
test('new web profile over an old shared task store is held, never treated as a new home', async t => {
  const f = await fixture(t, { profile: false });
  assert.equal((await prepareAutomationMigration(f)).state.decision, 'hold');
});
test('selected old bundle never overrides a separately disabled official schedule row', async t => {
  const f = await fixture(t, { bundles: [oldBundle] });
  const patch = path.join(f.homeDir, 'profiles/web/cordis.patch.yml'), bytes = '- id: schedule\n  disabled: true\n';
  await fs.writeFile(patch, bytes);
  const result = await prepareAutomationMigration(f);
  assert.equal(result.patchPath, f.basePatchPath);
  assert.equal(await fs.readFile(patch, 'utf8'), bytes);
  assert.equal((await fs.readFile(f.basePatchPath, 'utf8')).includes('id: schedule'), false);
});
test('explicit consent is persistent and removes only the generated launch guard', async t => {
  const f = await fixture(t); await prepareAutomationMigration(f);
  await assert.rejects(allowAutomationMigration({ homeDir: f.homeDir }), /confirmation/);
  const allowed = await allowAutomationMigration({ homeDir: f.homeDir, confirmed: true });
  assert.equal(allowed.reason, 'user-confirmed-resume');
  assert.equal((await prepareAutomationMigration(f)).patchPath, f.basePatchPath);
  assert.equal((await readAutomationMigration(f.homeDir)).decision, 'allow');
  assert.equal(await fs.readFile(path.join(f.homeDir, 'desktop-automation-web.patch.yml'), 'utf8').then(v => v.includes('disabled: true')), true);
});
test('malformed task state fails closed without writing a permission marker', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.homeDir, 'storages/schedule.json'), '{broken');
  await assert.rejects(prepareAutomationMigration(f));
  assert.equal(await readAutomationMigration(f.homeDir), null);
});
test('unsafe task or marker links are refused and outside bytes are untouched', async t => {
  const f = await fixture(t), outside = path.join(f.dir, 'outside.json');
  await fs.writeFile(outside, 'outside');
  const target = path.join(f.homeDir, 'storages/schedule.json'); await fs.unlink(target); await fs.link(outside, target);
  await assert.rejects(prepareAutomationMigration(f), /Unsafe/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
});
test('recovery dialog defaults to cancel, never resumes on cancel, and checks current restart admission before consent', async t => {
  const f = await fixture(t); await prepareAutomationMigration(f); let restarts = 0;
  const restart = async () => { restarts++; return { ok: true }; };
  await confirmAutomationMigration({ ...f, restart, showDialog: async options => {
    assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 0); assert.match(options.detail, /多个 Profile 共享/); return { response: 0 };
  } });
  assert.equal(restarts, 0); assert.equal((await readAutomationMigration(f.homeDir)).decision, 'hold');
  await assert.rejects(confirmAutomationMigration({ ...f, restart, showDialog: async () => ({ response: 1 }), beforeAllow: () => { throw new Error('busy'); } }), /busy/);
  assert.equal((await readAutomationMigration(f.homeDir)).decision, 'hold');
  assert.deepEqual(await confirmAutomationMigration({ ...f, restart, showDialog: async () => ({ response: 1 }) }), { ok: true });
  assert.equal(restarts, 1); assert.equal((await readAutomationMigration(f.homeDir)).reason, 'user-confirmed-resume');
});
test('queued-only, pending permission, running and waiting states block recovery; idle does not', () => {
  for (const state of [{ queuedCount: 1 }, { pendingCount: 1 }, { status: 'running' }, { status: 'waiting' }, { canStop: true }]) {
    assert.equal(automationRecoveryBlocked(state), true);
  }
  assert.equal(automationRecoveryBlocked({ status: 'ready', queuedCount: 0, pendingCount: 0, canStop: false }), false);
});
test('activity appearing after consent is persisted refuses restart and reports the saved permission', async t => {
  const f = await fixture(t); await prepareAutomationMigration(f); let checked = 0, restarted = false;
  await assert.rejects(confirmAutomationMigration({ ...f, showDialog: async () => ({ response: 1 }),
    beforeAllow: () => { if (++checked === 2) throw new Error('queue became busy'); }, restart: () => { restarted = true; } }), /许可已保存.*未重启/);
  assert.equal(restarted, false); assert.equal((await readAutomationMigration(f.homeDir)).reason, 'user-confirmed-resume');
});
