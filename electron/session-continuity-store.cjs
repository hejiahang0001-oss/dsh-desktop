const { AtomicJsonFile } = require('./atomic-json-store.cjs');
const MAX_CONTEXTS = 100, MAX_DRAFT_CHARS = 65536;
const validKey = (key) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
const cleanAttachments = (items) => {
  if (!Array.isArray(items) || items.length > 50) throw new Error('附件记录超出上限。');
  return items.map((item) => {
    if (!item || !/^[a-f0-9-]{36}$/i.test(item.id || '') || typeof item.name !== 'string' || item.name.length > 255
      || typeof item.relativePath !== 'string' || item.relativePath.length > 2048 || /^(?:[A-Za-z]:|[\\/])/.test(item.relativePath)
      || item.relativePath.split(/[\\/]/).some((part) => part === '..' || part === '.') || /[\0-\x1f]/.test(item.relativePath)
      || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 32 * 1024 * 1024) throw new Error('附件记录无效。');
    return { id: item.id, name: item.name, relativePath: item.relativePath, bytes: item.bytes, sha256: item.sha256,
      source: item.source === 'workspace' ? 'workspace' : 'imported', duplicate: Boolean(item.duplicate) };
  });
};
const validState = (value) => {
  if (value?.version !== 1 || !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries) || Object.keys(value.entries).length > MAX_CONTEXTS) return false;
  try { return Object.entries(value.entries).every(([key, row]) => validKey(key) && typeof row.text === 'string' && row.text.length <= MAX_DRAFT_CHARS
    && Number.isSafeInteger(row.revision) && row.revision >= 0 && Number.isFinite(row.updatedAt) && Boolean(cleanAttachments(row.items))); } catch { return false; }
};
class SessionContinuityStore {
  constructor(filePath) { this.storage = new AtomicJsonFile({ filePath, validator: validState }); this.state = { version: 1, entries: {} }; this.queue = Promise.resolve(); }
  async init() { this.state = (await this.storage.read({ fallback: this.state })).value; }
  read(key) {
    if (!validKey(key)) throw new Error('会话草稿标识无效。');
    return structuredClone(this.state.entries[key] || { text: '', items: [], revision: 0, updatedAt: 0 });
  }
  update(key, operation) {
    if (!validKey(key)) return Promise.reject(new Error('会话草稿标识无效。'));
    const task = this.queue.then(async () => {
      const previous = this.read(key), next = operation(previous);
      const entries = { ...this.state.entries, [key]: { ...next, updatedAt: Date.now() } };
      for (const [oldKey] of Object.entries(entries).sort((a, b) => a[1].updatedAt - b[1].updatedAt).slice(0, Math.max(0, Object.keys(entries).length - MAX_CONTEXTS))) delete entries[oldKey];
      const state = { version: 1, entries }; await this.storage.write(state); this.state = state; return this.read(key);
    });
    this.queue = task.catch(() => {}); return task;
  }
  saveDraft(key, text, revision) {
    if (typeof text !== 'string' || text.length > MAX_DRAFT_CHARS || !Number.isSafeInteger(revision) || revision < 0) return Promise.reject(new Error('草稿过大或版本无效（最多 65,536 字符）。'));
    return this.update(key, (row) => { if (row.revision !== revision) throw new Error('草稿已更新，请刷新后重试，未覆盖新内容。'); return { ...row, text, revision: row.revision + 1 }; });
  }
  saveAttachments(key, items) { const clean = cleanAttachments(items); return this.update(key, (row) => ({ ...row, items: clean })); }
}
module.exports = { SessionContinuityStore, cleanAttachments, MAX_CONTEXTS, MAX_DRAFT_CHARS };
