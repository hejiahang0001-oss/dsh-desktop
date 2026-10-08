const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { CredentialVault, attachCredentialChannel } = require('../electron/credential-vault.cjs');
const { AtomicJsonFile } = require('../electron/atomic-json-store.cjs');
const { EventEmitter } = require('node:events');

const fixture = async (t) => {
  const homeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-vault-test-'));
  t.after(() => fsp.rm(homeDir, { recursive: true, force: true }));
  const key = randomBytes(32);
  const crypto = { isEncryptionAvailable: () => true,
    encryptString: (value) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decryptString: (value) => { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); } };
  const parseLegacy = (text) => { const data = JSON.parse(text); return { refs: new Map(Object.entries(data.refs || {})), records: new Map(Object.entries(data.records || {})) }; };
  return { homeDir, crypto, parseLegacy, vault: new CredentialVault({ homeDir, crypto, parseLegacy }) };
};
test('credential migration verifies encrypted storage before removing the original plaintext', async (t) => {
  const f = await fixture(t); const secret = 'fixture-secret-not-real';
  await fsp.writeFile(f.vault.legacyPath, JSON.stringify({ refs: { DEEPSEEK_API_KEY: secret }, records: {} }));
  await f.vault.init();
  assert.equal(f.vault.status().configured, true);
  await assert.rejects(fsp.stat(f.vault.legacyPath), { code: 'ENOENT' });
  assert.equal((await fsp.readFile(f.vault.filePath, 'utf8')).includes(secret), false);
  const reopened = new CredentialVault(f); await reopened.init();
  assert.equal((await reopened.handle({ operation: 'snapshot' })).refs.DEEPSEEK_API_KEY, secret);
});
test('unavailable encryption and failed persistence keep legacy credentials untouched', async (t) => {
  const f = await fixture(t); const document = '{"refs":{"DEEPSEEK_API_KEY":"fixture"}}';
  await fsp.writeFile(f.vault.legacyPath, document);
  f.crypto.isEncryptionAvailable = () => false;
  await assert.rejects(f.vault.init(), /Windows/);
  assert.equal(await fsp.readFile(f.vault.legacyPath, 'utf8'), document);
  f.crypto.isEncryptionAvailable = () => true;
  f.vault.storage.write = async () => { throw new Error('disk failure'); };
  await assert.rejects(f.vault.init(), /disk failure/);
  assert.equal(await fsp.readFile(f.vault.legacyPath, 'utf8'), document);
});
test('credential writes serialize with stale-write rejection and encrypted backups', async (t) => {
  const f = await fixture(t); await f.vault.init();
  await f.vault.handle({ operation: 'put-ref', key: 'DEEPSEEK_API_KEY', value: 'fixture-new-secret', revision: 0 });
  await assert.rejects(f.vault.handle({ operation: 'put-ref', key: 'DEEPSEEK_API_KEY', value: 'stale', revision: 0 }), /已变化/);
  await f.vault.handle({ operation: 'put-ref', key: 'OTHER_KEY', value: 'second', revision: 1 });
  for (const file of [f.vault.filePath, `${f.vault.filePath}.bak`]) assert.equal((await fsp.readFile(file, 'utf8')).includes('fixture-new-secret'), false);
  await assert.rejects(f.vault.handle({ operation: 'put-ref', key: '__proto__', value: 'pollute', revision: 2 }), /无效/);
  await f.vault.handle({ operation: 'delete-ref', key: 'DEEPSEEK_API_KEY', revision: 2 });
  assert.equal(f.vault.status().configured, false);
});
test('invalid encrypted data and another Windows identity fail closed without overwriting', async (t) => {
  const f = await fixture(t); await f.vault.init();
  const bytes = await fsp.readFile(f.vault.filePath);
  f.crypto.decryptString = () => { throw new Error('different identity'); };
  await assert.rejects(new CredentialVault(f).init(), /Windows/);
  assert.deepEqual(await fsp.readFile(f.vault.filePath), bytes);
});
test('record credentials survive migration and immutable snapshot isolation', async (t) => {
  const f = await fixture(t); await f.vault.init();
  await f.vault.handle({ operation: 'put-record', key: 'llm-pi-ai/test', value: { kind: 'api-key', key: 'fixture-record' }, revision: 0 });
  const snapshot = await f.vault.handle({ operation: 'snapshot' }); snapshot.records['llm-pi-ai/test'].key = 'changed';
  assert.equal((await f.vault.handle({ operation: 'snapshot' })).records['llm-pi-ai/test'].key, 'fixture-record');
  await assert.rejects(f.vault.handle({ operation: 'put-record', key: 'llm-pi-ai/test', value: { kind: 'unknown' }, revision: 1 }), /无效/);
});

test('deferred migration preserves the legacy file until runtime readiness and serializes cleanup with credential updates', async (t) => {
  const f = await fixture(t);
  const document = JSON.stringify({ refs: { DEEPSEEK_API_KEY: 'fixture-kept' }, records: {} });
  await fsp.writeFile(f.vault.legacyPath, document);
  await f.vault.init({ deferMigration: true });
  assert.equal(await fsp.readFile(f.vault.legacyPath, 'utf8'), document);
  const update = f.vault.handle({ operation: 'put-record', key: 'client-connection/browser-session', value: { kind: 'grant', payload: { fixture: true } }, revision: 0 });
  await Promise.all([update, f.vault.finalizeMigration()]);
  await assert.rejects(fsp.stat(f.vault.legacyPath), { code: 'ENOENT' });
  assert.equal((await f.vault.handle({ operation: 'snapshot' })).records['client-connection/browser-session'].payload.fixture, true);
});

test('legacy edits during deferred migration are never deleted', async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(f.vault.legacyPath, '{"refs":{"DEEPSEEK_API_KEY":"before"}}');
  await f.vault.init({ deferMigration: true });
  const modified = '{"refs":{"DEEPSEEK_API_KEY":"after"}}';
  await fsp.writeFile(f.vault.legacyPath, modified);
  await assert.rejects(f.vault.finalizeMigration(), /被修改/);
  assert.equal(await fsp.readFile(f.vault.legacyPath, 'utf8'), modified);
});

const rejectedIpc = async error => {
  const child = new EventEmitter(); child.connected = true;
  const result = new Promise(resolve => { child.send = (response, callback) => { callback(); resolve(response); }; });
  const detach = attachCredentialChannel(child, { handle: async () => { throw error; } });
  child.emit('message', { channel: 'dsh-credential-v1', requestId: '12345678-1234-1234-1234-123456789abc', operation: 'snapshot' });
  try { return await result; } finally { detach(); }
};
test('credential IPC keeps its protective message and exposes only trusted atomic phase and allowed filesystem code', async t => {
  const f = await fixture(t), filePath = path.join(f.homeDir, 'synthetic.json'); let failure;
  const injected = { ...fsp, mkdir: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE key path stack'), { code: 'EACCES', path: 'SYNTHETIC_PRIVATE' }); } };
  try { await new AtomicJsonFile({ filePath, fsPromises: injected }).write({ fixture: true }); } catch (error) { failure = error; }
  const response = await rejectedIpc(failure);
  assert.equal(response.error, '凭据读取或保存失败，原凭据未被空值覆盖。请检查 Windows 账户、文件权限后重试。 [phase=mkdir, code=EACCES]');
  assert.equal(response.code, 'EACCES'); assert.equal(response.phase, 'mkdir');
  assert.ok(!JSON.stringify(response).includes('SYNTHETIC_PRIVATE')); assert.ok(!Object.hasOwn(response, 'stack'));
});
test('non-storage exceptions cannot forge credential IPC diagnostic fields or disclose their payload', async () => {
  const response = await rejectedIpc(Object.assign(new Error('SYNTHETIC_PRIVATE'), {
    code: 'EACCES', fsCode: 'EACCES', phase: 'mkdir', path: 'SYNTHETIC_PRIVATE', stack: 'SYNTHETIC_PRIVATE'
  }));
  assert.ok(!Object.hasOwn(response, 'code')); assert.ok(!Object.hasOwn(response, 'phase'));
  assert.ok(!JSON.stringify(response).includes('SYNTHETIC_PRIVATE'));
});
test('unknown storage codes expose only UNKNOWN and invalid phases cannot reach the startup error text', async t => {
  const f = await fixture(t); let failure;
  try { await new AtomicJsonFile({ filePath: path.join(f.homeDir, 'synthetic.json'), fsPromises: {
    mkdir: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: 'SYNTHETIC_PRIVATE' }); }
  } }).write({ fixture: true }); } catch (error) { failure = error; }
  const safe = await rejectedIpc(failure);
  assert.match(safe.error, /\[phase=mkdir, code=UNKNOWN\]$/); assert.equal(safe.code, 'UNKNOWN');
  assert.ok(!JSON.stringify(safe).includes('SYNTHETIC_PRIVATE'));
  failure.phase = 'SYNTHETIC_PRIVATE';
  const rejected = await rejectedIpc(failure);
  assert.equal(rejected.error, '凭据读取或保存失败，原凭据未被空值覆盖。请检查 Windows 账户、文件权限后重试。');
  assert.ok(!Object.hasOwn(rejected, 'phase')); assert.ok(!Object.hasOwn(rejected, 'code'));
});
