const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { CredentialVault } = require('../electron/credential-vault.cjs');

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
