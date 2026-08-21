const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanSessionCatalog } = require('../electron/session-catalog.cjs');

test('session catalog returns an empty safe summary for a missing root', async () => {
  const result = await scanSessionCatalog(path.join(os.tmpdir(), `dsh-missing-${Date.now()}`));
  assert.deepEqual(result, {
    available: true,
    count: 0,
    latestUpdatedAt: null,
    encodings: { zstd: 0, jsonl: 0 }
  });
});

test('session catalog counts only supported persisted transcripts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-sessions-'));
  try {
    const first = path.join(root, 'project-a', 'session-a');
    const second = path.join(root, 'project-b', 'session-b');
    const ignored = path.join(root, 'project-b', 'session-empty');
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(second, { recursive: true });
    await fs.mkdir(ignored, { recursive: true });
    await fs.writeFile(path.join(first, 'session.jsonl.zstd'), 'a');
    await fs.writeFile(path.join(second, 'session.jsonl'), 'b');
    await fs.writeFile(path.join(ignored, 'notes.txt'), 'ignored');
    const result = await scanSessionCatalog(root);
    assert.equal(result.count, 2);
    assert.deepEqual(result.encodings, { zstd: 1, jsonl: 1 });
    assert.match(result.latestUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
