const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { SessionContinuityStore } = require('../electron/session-continuity-store.cjs');
const a = 'a'.repeat(64), b = 'b'.repeat(64);
async function fixture(t) { const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-continuity-')); t.after(() => fsp.rm(root, { recursive: true, force: true })); const store = new SessionContinuityStore(path.join(root, 'state.json')); await store.init(); return store; }
test('drafts survive restart, remain session isolated and reject stale writes', async (t) => {
  const store = await fixture(t); await store.saveDraft(a, '甲草稿', 0); await store.saveDraft(b, '乙草稿', 0);
  await assert.rejects(store.saveDraft(a, '旧覆盖', 0), /已更新/);
  const next = new SessionContinuityStore(store.storage.filePath); await next.init();
  assert.equal(next.read(a).text, '甲草稿'); assert.equal(next.read(b).text, '乙草稿');
  await next.saveDraft(a, '', 1); assert.equal(next.read(a).text, '');
});
test('attachment persistence has a bounded relative-path contract and preserves drafts', async (t) => {
  const store = await fixture(t); await store.saveDraft(a, '保留', 0);
  const item = { id: '12345678-1234-1234-1234-123456789012', name: '资料.xlsx', relativePath: 'dsh-attachments/item-1/资料.xlsx', sha256: 'c'.repeat(64), bytes: 100 };
  await store.saveAttachments(a, [item]); assert.equal(store.read(a).text, '保留');
  assert.equal(store.read(a).items.length, 1); assert.equal(store.read(b).items.length, 0);
  assert.throws(() => store.saveAttachments(a, [{ ...item, relativePath: '../secret' }]), /无效/);
  assert.throws(() => store.saveAttachments(a, [{ ...item, relativePath: 'C:/secret' }]), /无效/);
  await assert.rejects(store.saveDraft(a, 'x'.repeat(65537), 1), /过大/);
});
