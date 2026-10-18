'use strict';
// Host-only upgrade admission. Never rewrite official profiles or shared task rows.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const MARKER = 'desktop-automation-web-migration.json';
const OVERLAY = 'desktop-automation-web.patch.yml';
const LEGACY_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const unsafe = () => Object.assign(new Error('Unsafe automation migration path or document; automatic task recovery was not authorized.'), { code: 'HARNESS_AUTOMATION_MIGRATION_UNSAFE' });

async function checkPath(file, { optional = false, directory = false } = {}) {
  if (!path.isAbsolute(file)) throw unsafe();
  let current = path.parse(file).root;
  const parts = path.relative(current, file).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) { if (optional && error.code === 'ENOENT') return false; throw error; }
    const isDirectory = index < parts.length - 1 || directory;
    if (stat.isSymbolicLink() || (isDirectory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1))) throw unsafe();
  }
  return true;
}
async function read(file) {
  if (!await checkPath(file, { optional: true })) return null;
  const stat = await fs.stat(file);
  if (stat.size > 16 * 1024 * 1024) throw unsafe();
  return fs.readFile(file);
}
async function atomic(file, text) {
  await checkPath(path.dirname(file), { directory: true });
  await checkPath(file, { optional: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await checkPath(file, { optional: true });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
function parse(bytes) {
  try { const value = JSON.parse(bytes); if (!value || typeof value !== 'object' || Array.isArray(value)) throw unsafe(); return value; }
  catch { throw unsafe(); }
}
async function readAutomationMigration(homeDir) {
  await checkPath(homeDir, { directory: true });
  const bytes = await read(path.join(homeDir, MARKER));
  if (!bytes) return null;
  const state = parse(bytes);
  if (state.version !== 1 || state.profile !== 'web' || !['hold', 'allow'].includes(state.decision)
    || state.scope !== 'home-shared-schedule-via-web-launch' || typeof state.reason !== 'string') throw unsafe();
  return state;
}
async function allowAutomationMigration({ homeDir, confirmed }) {
  if (confirmed !== true) throw new Error('Explicit user confirmation is required to resume historical automation.');
  const state = await readAutomationMigration(homeDir);
  if (!state || state.decision !== 'hold') throw new Error('No held automation migration exists.');
  const next = { ...state, decision: 'allow', reason: 'user-confirmed-resume', confirmedAt: new Date().toISOString() };
  await atomic(path.join(homeDir, MARKER), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
async function confirmAutomationMigration({ homeDir, showDialog, beforeAllow = () => {}, restart }) {
  const state = await readAutomationMigration(homeDir);
  if (!state || state.decision !== 'hold') return { ok: false, canceled: true };
  const answer = await showDialog({ type: 'warning', title: '旧版自动化恢复', message: '是否恢复历史自动化任务？',
    detail: '旧档未记录可区分“从未启用”与“曾停用”的历史意图，当前桌面 Web 进程的自动任务执行已暂时暂停（包括暂停期间新建的任务）。任务表由此 Harness home 的多个 Profile 共享，并非当前仓库独有；独立运行的其他 Profile 不受此桌面保护控制。\n\n确认后将重启 Harness；已到期的历史任务可能立即恢复会话、调用模型或执行工具。原有任务和配置文件不会被改写。',
    buttons: ['取消，保持暂停', '确认恢复并重启'], defaultId: 0, cancelId: 0, noLink: true });
  if (answer?.response !== 1) return { ok: false, canceled: true };
  await beforeAllow();
  await allowAutomationMigration({ homeDir, confirmed: true });
  try { await beforeAllow(); }
  catch (error) { throw new Error(`恢复许可已保存，但本次未重启：${error.message}`); }
  return restart();
}
const automationRecoveryBlocked = state => Boolean(state?.canStop || ['running', 'waiting'].includes(state?.status)
  || state?.pendingCount > 0 || state?.queuedCount > 0);
async function prepareAutomationMigration({ homeDir, basePatchPath }) {
  await checkPath(homeDir, { directory: true });
  let state = await readAutomationMigration(homeDir);
  if (!state) {
    // DSH Desktop launches exactly `dsh web`; never inspect unrelated profiles.
    const profileBytes = await read(path.join(homeDir, 'profiles/web/package.json'));
    const taskBytes = await read(path.join(homeDir, 'storages/schedule.json'));
    let activeTaskCount = 0;
    if (taskBytes) {
      const document = parse(taskBytes);
      if (document.unit?.name !== 'schedule' || document.unit?.version !== 1 || !document.tables
        || !document.tables.tasks || Array.isArray(document.tables.tasks) || typeof document.tables.tasks !== 'object') throw unsafe();
      for (const task of Object.values(document.tables.tasks)) {
        if (!task || typeof task !== 'object' || Array.isArray(task) || ![undefined, 'active', 'inactive'].includes(task.status)) throw unsafe();
        if (task.status !== 'inactive') activeTaskCount++;
      }
    }
    let enabled = false;
    if (profileBytes) {
      const profile = parse(profileBytes), bundles = profile.dsh?.profile?.bundles;
      if (!Array.isArray(bundles) || bundles.some(value => typeof value !== 'string')) throw unsafe();
      enabled = bundles.includes(LEGACY_BUNDLE);
    }
    // A new Web profile in an old shared home is not a new task store. Absence
    // of its manifest cannot authorize that home's historical active tasks.
    const hold = activeTaskCount > 0 && !enabled;
    state = { version: 1, profile: 'web', scope: 'home-shared-schedule-via-web-launch',
      decision: hold ? 'hold' : 'allow', reason: hold ? 'legacy-profile-activation-ambiguous'
        : !profileBytes ? 'new-web-profile' : activeTaskCount === 0 ? 'no-historical-active-tasks' : 'legacy-bundle-selected',
      activeTaskCount, observedAt: new Date().toISOString(),
      profileSha256: profileBytes ? hash(profileBytes) : null, scheduleSha256: taskBytes ? hash(taskBytes) : null };
    // Record admission before official boot creates/normalizes a profile. This
    // distinguishes later new tasks from the upgrade's historical task set.
    await atomic(path.join(homeDir, MARKER), `${JSON.stringify(state, null, 2)}\n`);
  }
  if (state.decision === 'allow') return { state, patchPath: basePatchPath };
  const base = await read(basePatchPath);
  if (!base) throw unsafe();
  const patchPath = path.join(homeDir, OVERLAY);
  await atomic(patchPath, `${base.toString('utf8')}\n# DSH Desktop: legacy activation intent is ambiguous; original profile/tasks are untouched.\n- id: schedule\n  disabled: true\n`);
  return { state, patchPath };
}
module.exports = { prepareAutomationMigration, allowAutomationMigration, readAutomationMigration, confirmAutomationMigration, automationRecoveryBlocked };
