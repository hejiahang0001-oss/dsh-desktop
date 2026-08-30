const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');

const CHANNEL = 'dsh-credential-v1';
const validEnvelope = (value) => value?.version === 1 && typeof value.ciphertext === 'string' && value.ciphertext.length < 4 * 1024 * 1024;
const validRef = (value) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
const validKey = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63}$/.test(value);
const assertRegular = async (filePath) => {
  try { const info = await fsp.lstat(filePath); if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error('凭据文件类型或大小无效。'); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

class CredentialVault {
  constructor({ homeDir, crypto, parseLegacy }) {
    this.homeDir = homeDir; this.crypto = crypto; this.parseLegacy = parseLegacy;
    this.filePath = path.join(homeDir, '.credentials.dpapi.json');
    this.legacyPath = path.join(homeDir, '.credentials.yaml');
    this.storage = new AtomicJsonFile({ filePath: this.filePath, validator: validEnvelope });
    this.state = null; this.queue = Promise.resolve();
  }
  async init({ deferMigration = false } = {}) {
    if (!this.crypto.isEncryptionAvailable()) throw new Error('Windows 凭据保护不可用；原凭据未改动，请使用原版本或修复系统后重试。');
    await fsp.mkdir(this.homeDir, { recursive: true });
    for (const target of [this.homeDir, path.dirname(this.homeDir)]) if ((await fsp.lstat(target)).isSymbolicLink()) throw new Error('凭据目录不允许使用目录链接。');
    const exists = await assertRegular(this.filePath);
    await assertRegular(`${this.filePath}.bak`);
    const hasLegacy = await assertRegular(this.legacyPath);
    const loaded = await this.storage.read({ fallback: null });
    if (loaded.value) {
      try { this.state = JSON.parse(this.crypto.decryptString(Buffer.from(loaded.value.ciphertext, 'base64'))); }
      catch { throw new Error('无法解密软件凭据。请使用原 Windows 账户；便携版跨电脑需重新填写 Key。'); }
      if (this.state?.version !== 1 || !this.state.refs || !this.state.records || !Number.isInteger(this.state.revision)) throw new Error('软件凭据结构无效，拒绝覆盖。');
    } else if (exists) throw new Error('软件凭据已损坏，拒绝以空凭据覆盖。');
    else {
      const document = hasLegacy ? await fsp.readFile(this.legacyPath, 'utf8') : '';
      const parsed = document ? this.parseLegacy(document) : { refs: new Map(), records: new Map() };
      this.state = { version: 1, revision: 0, refs: Object.fromEntries(parsed.refs), records: Object.fromEntries(parsed.records),
        ...(document ? { migrationDigest: createHash('sha256').update(document).digest('hex') } : {}) };
      await this.persist(this.state);
    }
    if (hasLegacy) {
      const text = await fsp.readFile(this.legacyPath, 'utf8');
      const parsed = this.parseLegacy(text);
      // A legacy writer racing this upgrade must never be silently discarded.
      const hash = createHash('sha256').update(text).digest('hex');
      if (this.state.migrationDigest !== hash && (JSON.stringify(Object.fromEntries(parsed.refs)) !== JSON.stringify(this.state.refs)
        || JSON.stringify(Object.fromEntries(parsed.records)) !== JSON.stringify(this.state.records))) throw new Error('检测到旧版凭据变更；请关闭旧版并重新启动，原文件已保留。');
      if (!this.state.migrationDigest) await this.persist({ ...this.state, migrationDigest: hash });
      if (!deferMigration) await this.finalizeMigration();
    }
    return this.status();
  }
  status() { return { configured: Boolean(this.state?.refs?.DEEPSEEK_API_KEY), source: 'windows-dpapi', encrypted: true }; }
  finalizeMigration() {
    const operation = this.queue.then(() => this.finalizeMigrationInternal());
    this.queue = operation.catch(() => {}); return operation;
  }
  async finalizeMigrationInternal() {
    if (!this.state?.migrationDigest || !await assertRegular(this.legacyPath)) return;
    const text = await fsp.readFile(this.legacyPath, 'utf8');
    if (createHash('sha256').update(text).digest('hex') !== this.state.migrationDigest) throw new Error('迁移期间旧凭据被修改，原文件已保留。');
    await fsp.unlink(this.legacyPath);
    const next = { ...this.state }; delete next.migrationDigest;
    await this.persist(next);
  }
  async persist(next) {
    this.parseLegacy(JSON.stringify({ version: 1, refs: next.refs, records: next.records }));
    const plain = JSON.stringify(next);
    if (Buffer.byteLength(plain) > 2 * 1024 * 1024) throw new Error('凭据容量超限。');
    const encrypted = this.crypto.encryptString(plain);
    if (this.crypto.decryptString(encrypted) !== plain) throw new Error('凭据加密回读失败。');
    await this.storage.write({ version: 1, ciphertext: encrypted.toString('base64') });
    const verified = await this.storage.read({ fallback: null });
    if (!verified.value || this.crypto.decryptString(Buffer.from(verified.value.ciphertext, 'base64')) !== plain) throw new Error('凭据落盘回读失败。');
    this.state = next;
  }
  handle(request) {
    const operation = this.queue.then(() => this.dispatch(request));
    this.queue = operation.catch(() => {}); return operation;
  }
  async dispatch(request) {
    if (!this.state) throw new Error('凭据服务未初始化。');
    const { operation, key, value, revision } = request || {};
    if (operation === 'snapshot') return structuredClone(this.state);
    const record = operation === 'put-record' || operation === 'delete-record';
    if (!['put-ref', 'delete-ref', 'put-record', 'delete-record'].includes(operation) || !(record ? validKey(key) : validRef(key)) || key === '__proto__') throw new Error('无效的凭据操作。');
    if (revision !== this.state.revision) throw new Error('凭据已变化，请重试。');
    const next = structuredClone(this.state);
    const entries = record ? next.records : next.refs;
    if (operation.startsWith('put-')) {
      if (!record && (typeof value !== 'string' || !value || value.length > 65536)) throw new Error('凭据值无效。');
      if (record && (!value || !['api-key', 'grant'].includes(value.kind))) throw new Error('凭据记录无效。');
      Object.defineProperty(entries, key, { value, enumerable: true, configurable: true, writable: true });
    } else delete entries[key];
    next.revision++; await this.persist(next); return structuredClone(next);
  }
}

const attachCredentialChannel = (child, vault) => {
  const listener = async (request) => {
    if (request?.channel !== CHANNEL || typeof request.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(request.requestId)) return;
    let response;
    try { response = { ok: true, value: await vault.handle(request) }; }
    catch { response = { ok: false, error: '凭据读取或保存失败，原凭据未被空值覆盖。请检查 Windows 账户、文件权限后重试。' }; }
    if (child.connected) child.send({ channel: CHANNEL, requestId: request.requestId, ...response }, () => {});
  };
  child.on('message', listener); return () => child.off('message', listener);
};
module.exports = { CredentialVault, attachCredentialChannel, validEnvelope };
