const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WorkspaceStore } = require('../electron/workspace-store.cjs');

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-store-'));
  const fallbackDir = path.join(root, 'fallback');
  const firstRepo = path.join(root, 'first-repo');
  const secondRepo = path.join(root, 'second-repo');
  fs.mkdirSync(firstRepo, { recursive: true });
  fs.mkdirSync(secondRepo, { recursive: true });
  return { root, fallbackDir, firstRepo, secondRepo, filePath: path.join(root, 'desktop-state.json') };
};

test('workspace store starts with an empty fallback and persists recent repositories', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const store = new WorkspaceStore(fixture);

  const initial = await store.init();
  assert.equal(initial.isFallback, true);
  assert.equal(initial.displayName, '未选择仓库');
  assert.deepEqual(initial.recentPaths, []);

  const first = await store.activate(fixture.firstRepo);
  assert.equal(first.isFallback, false);
  assert.equal(first.displayName, 'first-repo');
  assert.deepEqual(first.recentPaths, [fs.realpathSync(fixture.firstRepo)]);

  await store.activate(fixture.secondRepo);
  const repeated = await store.activate(fixture.firstRepo);
  assert.deepEqual(repeated.recentPaths, [
    fs.realpathSync(fixture.firstRepo),
    fs.realpathSync(fixture.secondRepo)
  ]);
});

test('workspace store drops unavailable saved paths on startup', async (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.writeFileSync(fixture.filePath, JSON.stringify({
    version: 1,
    activePath: path.join(fixture.root, 'missing'),
    recentPaths: [fixture.firstRepo, path.join(fixture.root, 'missing')]
  }));

  const store = new WorkspaceStore(fixture);
  const state = await store.init();
  assert.equal(state.isFallback, true);
  assert.deepEqual(state.recentPaths, [fs.realpathSync(fixture.firstRepo)]);
});
