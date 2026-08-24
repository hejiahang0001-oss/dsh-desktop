const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AtomicJsonFile } = require('../electron/atomic-json-store.cjs');

const tempRoot = (context, prefix) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('atomic JSON writes retain one verified last-known-good backup and no temp files', async (context) => {
  const root = tempRoot(context, 'dsh-atomic-json-');
  const filePath = path.join(root, 'state.json');
  const store = new AtomicJsonFile({ filePath });
  await store.write({ version: 1, value: 'first' });
  await store.write({ version: 1, value: 'second' });
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { version: 1, value: 'second' });
  assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`, 'utf8')), { version: 1, value: 'first' });
  assert.equal((await fsp.readdir(root)).some((name) => name.endsWith('.tmp')), false);
});

test('atomic JSON reads recover from a valid backup without trusting a corrupt primary', async (context) => {
  const root = tempRoot(context, 'dsh-json-recovery-');
  const filePath = path.join(root, 'state.json');
  const store = new AtomicJsonFile({ filePath });
  await store.write({ value: 'last-good' });
  await store.write({ value: 'newer' });
  await fsp.writeFile(filePath, '{ interrupted');
  const recovered = await store.read({ fallback: { value: 'fallback' } });
  assert.equal(recovered.source, 'backup');
  assert.deepEqual(recovered.value, { value: 'last-good' });
  await store.write(recovered.value);
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { value: 'last-good' });
  assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`, 'utf8')), { value: 'last-good' });
});

test('failed replacement preserves the primary and cleans the pending temp file', async (context) => {
  const root = tempRoot(context, 'dsh-json-failure-');
  const filePath = path.join(root, 'state.json');
  const stable = new AtomicJsonFile({ filePath });
  await stable.write({ value: 'stable' });
  const failingFs = {
    ...fsp,
    rename: async (from, to) => {
      if (to === filePath) throw Object.assign(new Error('simulated replace failure'), { code: 'EACCES' });
      return fsp.rename(from, to);
    }
  };
  const failing = new AtomicJsonFile({ filePath, fsPromises: failingFs });
  await assert.rejects(failing.write({ value: 'partial' }), /simulated replace failure/);
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { value: 'stable' });
  assert.equal((await fsp.readdir(root)).some((name) => name.endsWith('.tmp')), false);
});

test('concurrent writes serialize in call order and leave the latest complete state', async (context) => {
  const root = tempRoot(context, 'dsh-json-queue-');
  const filePath = path.join(root, 'state.json');
  const store = new AtomicJsonFile({ filePath });
  await Promise.all([store.write({ value: 1 }), store.write({ value: 2 }), store.write({ value: 3 })]);
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { value: 3 });
  assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`, 'utf8')), { value: 2 });
});
