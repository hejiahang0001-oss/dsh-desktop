const { createHash, randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');
const { validPackageName } = require('./plugin-health.cjs');

const JOURNAL_NAME = 'package.json.dsh-desktop-toggle.json';
const MAX_MANIFEST_BYTES = 1_048_576;

const isInsideOrEqual = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const validManifest = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && value.dependencies
  && typeof value.dependencies === 'object'
  && !Array.isArray(value.dependencies)
  && Array.isArray(value.dsh?.profile?.bundles)
  && value.dsh.profile.bundles.every(validPackageName);

const validJournal = (value) => Boolean(value)
  && value.version === 1
  && typeof value.id === 'string'
  && /^[0-9a-f-]{36}$/.test(value.id)
  && validPackageName(value.packageName)
  && ['enable', 'disable'].includes(value.action)
  && /^[0-9a-f]{64}$/.test(value.previousHash)
  && /^[0-9a-f]{64}$/.test(value.nextHash);

const clone = (value) => JSON.parse(JSON.stringify(value));
const valueHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const lstatOrNull = async (target) => {
  try { return await fsp.lstat(target); } catch { return null; }
};

const readJson = async (target, validator) => {
  const info = await lstatOrNull(target);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) return null;
  try {
    const value = JSON.parse(await fsp.readFile(target, 'utf8'));
    return validator(value) ? value : null;
  } catch {
    return null;
  }
};

const unlinkIfPresent = async (target) => {
  try { await fsp.unlink(target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
};

class ProfileBundleManager {
  constructor({ profilesRoot }) {
    this.profilesRoot = path.resolve(profilesRoot);
    this.transactions = new Map();
    this.activeProfiles = new Set();
  }

  async _profileDirectory(profileDir) {
    const target = path.resolve(profileDir);
    if (!isInsideOrEqual(this.profilesRoot, target) || path.dirname(target) !== this.profilesRoot || path.basename(target) === 'node_modules') {
      throw new Error('Profile 目录未通过范围校验。');
    }
    const info = await lstatOrNull(target);
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('Profile 目录不可用。');
    return target;
  }

  async _cleanupJournal(profileDir) {
    const journalPath = path.join(profileDir, JOURNAL_NAME);
    await unlinkIfPresent(journalPath);
    await unlinkIfPresent(`${journalPath}.bak`);
  }

  async apply({ profileDir, packageName, enable }) {
    if (!validPackageName(packageName) || typeof enable !== 'boolean') throw new Error('扩展切换参数无效。');
    const directory = await this._profileDirectory(profileDir);
    if (this.activeProfiles.has(directory)) throw new Error('此 Profile 已有扩展变更正在处理。');
    const journalPath = path.join(directory, JOURNAL_NAME);
    if (await lstatOrNull(journalPath)) throw new Error('此 Profile 存在待恢复的扩展变更。');
    const manifestPath = path.join(directory, 'package.json');
    const store = new AtomicJsonFile({ filePath: manifestPath, validator: validManifest });
    const current = await store.read({ fallback: null });
    if (current.source !== 'primary' || !validManifest(current.value)) throw new Error('Profile 清单不可安全修改。');
    if (!Object.hasOwn(current.value.dependencies, packageName)) throw new Error('固定基础扩展层不可由桌面版关闭。');
    const currentlyEnabled = current.value.dsh.profile.bundles.includes(packageName);
    if (currentlyEnabled === enable) return Object.freeze({ changed: false, enabled: enable });

    const previous = clone(current.value);
    const next = clone(current.value);
    const bundles = next.dsh.profile.bundles;
    if (enable) bundles.push(packageName);
    else next.dsh.profile.bundles = bundles.filter((name) => name !== packageName);
    const transaction = {
      version: 1,
      id: randomUUID(),
      packageName,
      action: enable ? 'enable' : 'disable',
      previousHash: valueHash(previous),
      nextHash: valueHash(next),
      createdAt: new Date().toISOString()
    };
    const journalStore = new AtomicJsonFile({ filePath: journalPath, validator: validJournal });
    this.activeProfiles.add(directory);
    try {
      await journalStore.write(transaction);
      await store.write(next);
      const verified = await store.read({ fallback: null });
      if (verified.source !== 'primary' || valueHash(verified.value) !== transaction.nextHash) {
        throw new Error('Profile 清单写入后验证失败。');
      }
      this.transactions.set(transaction.id, { directory, manifestPath, journalPath, previous, next, transaction });
      return Object.freeze({ changed: true, id: transaction.id, enabled: enable });
    } catch (error) {
      let restored = false;
      try {
        const currentManifest = await readJson(manifestPath, validManifest);
        const currentHash = currentManifest ? valueHash(currentManifest) : '';
        if (currentHash === transaction.previousHash) restored = true;
        else if (currentHash === transaction.nextHash) {
          await store.write(previous);
          const verified = await store.read({ fallback: null });
          restored = verified.source === 'primary' && valueHash(verified.value) === transaction.previousHash;
        }
      } catch {
        // Recovery remains available from the verified manifest backup and journal.
      }
      if (restored) await this._cleanupJournal(directory);
      this.activeProfiles.delete(directory);
      throw error;
    }
  }

  async commit(id) {
    const context = this.transactions.get(id);
    if (!context) throw new Error('扩展变更事务不存在。');
    const current = await readJson(context.manifestPath, validManifest);
    if (!current || valueHash(current) !== context.transaction.nextHash) throw new Error('Profile 清单在重启期间发生变化。');
    await this._cleanupJournal(context.directory);
    this.transactions.delete(id);
    this.activeProfiles.delete(context.directory);
    return Object.freeze({ ok: true });
  }

  async rollback(id) {
    const context = this.transactions.get(id);
    if (!context) throw new Error('扩展变更事务不存在。');
    const before = await readJson(context.manifestPath, validManifest);
    if (!before || valueHash(before) !== context.transaction.nextHash) {
      throw new Error('Profile 清单在回退前发生变化；为避免覆盖用户编辑，已保留事务日志。');
    }
    const store = new AtomicJsonFile({ filePath: context.manifestPath, validator: validManifest });
    await store.write(context.previous);
    const current = await store.read({ fallback: null });
    if (current.source !== 'primary' || valueHash(current.value) !== context.transaction.previousHash) {
      throw new Error('Profile 清单回退验证失败。');
    }
    await this._cleanupJournal(context.directory);
    this.transactions.delete(id);
    this.activeProfiles.delete(context.directory);
    return Object.freeze({ ok: true });
  }

  async recoverPending() {
    let entries = [];
    try { entries = await fsp.readdir(this.profilesRoot, { withFileTypes: true }); } catch { return Object.freeze([]); }
    const outcomes = [];
    const profiles = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== 'node_modules')
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
      .slice(0, 16);
    for (const entry of profiles) {
      const directory = path.join(this.profilesRoot, entry.name);
      const journalPath = path.join(directory, JOURNAL_NAME);
      const journalInfo = await lstatOrNull(journalPath);
      if (!journalInfo) continue;
      const journal = await readJson(journalPath, validJournal);
      if (!journal) {
        outcomes.push(Object.freeze({ profile: entry.name, status: 'failed' }));
        continue;
      }
      const manifestPath = path.join(directory, 'package.json');
      const backupPath = `${manifestPath}.bak`;
      const [primary, backup] = await Promise.all([
        readJson(manifestPath, validManifest),
        readJson(backupPath, validManifest)
      ]);
      const primaryHash = primary ? valueHash(primary) : '';
      const backupHash = backup ? valueHash(backup) : '';
      if (primaryHash === journal.previousHash) {
        await this._cleanupJournal(directory);
        outcomes.push(Object.freeze({ profile: entry.name, status: 'cleaned' }));
      } else if (primaryHash === journal.nextHash && backupHash === journal.previousHash) {
        const store = new AtomicJsonFile({ filePath: manifestPath, validator: validManifest });
        await store.write(backup);
        const verified = await store.read({ fallback: null });
        if (verified.source !== 'primary' || valueHash(verified.value) !== journal.previousHash) {
          outcomes.push(Object.freeze({ profile: entry.name, status: 'failed' }));
          continue;
        }
        await this._cleanupJournal(directory);
        outcomes.push(Object.freeze({ profile: entry.name, status: 'rolled-back' }));
      } else {
        outcomes.push(Object.freeze({ profile: entry.name, status: 'conflict' }));
      }
    }
    return Object.freeze(outcomes);
  }
}

module.exports = {
  JOURNAL_NAME,
  ProfileBundleManager,
  validJournal,
  validManifest,
  valueHash
};
