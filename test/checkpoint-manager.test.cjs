const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GitCheckpointManager, LATEST_REF, isCheckpointId, isRestrictedGitPath, statusPaths } = require('../electron/checkpoint-manager.cjs');

const git = (root, args) => execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  windowsHide: true,
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'DSH Test',
    GIT_AUTHOR_EMAIL: 'test@dsh.local',
    GIT_COMMITTER_NAME: 'DSH Test',
    GIT_COMMITTER_EMAIL: 'test@dsh.local'
  }
});

const createRepository = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-checkpoint-repo-'));
  git(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'base\n');
  fs.writeFileSync(path.join(root, '.npmrc'), 'registry=https://registry.example.invalid/base\n');
  git(root, ['add', 'tracked.txt', '.npmrc']);
  git(root, ['commit', '--quiet', '-m', 'initial']);
  return root;
};

test('read-only index snapshots do not contend with a real-index lock or lose staged changes', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'staged\n');
  git(root, ['add', 'tracked.txt']);
  const expectedIndexTree = git(root, ['write-tree']).trim();
  fs.appendFileSync(path.join(root, 'tracked.txt'), 'unstaged\n');
  const manager = new GitCheckpointManager();
  await manager.activate(root);
  const lock = path.join(root, '.git', 'index.lock');
  fs.writeFileSync(lock, 'external writer owns this lock', { flag: 'wx' });
  const state = await manager.captureCurrentState();
  assert.equal(state.indexTree, expectedIndexTree);
  const checkpoint = await manager.create({ source: 'safety' });
  assert.equal(checkpoint.created, true);
  assert.equal(checkpoint.last.indexTree, expectedIndexTree);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'external writer owns this lock');
  await assert.rejects(manager.executeGit(['read-tree', expectedIndexTree]), /index.lock/);
});

test('private index reads support split indexes and never fall back from a corrupt index to HEAD', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'split staged\n');
  git(root, ['add', 'tracked.txt']);
  git(root, ['update-index', '--split-index']);
  const expected = git(root, ['write-tree']).trim();
  const manager = new GitCheckpointManager(); await manager.activate(root);
  assert.equal((await manager.captureCurrentState()).indexTree, expected);
  fs.writeFileSync(path.join(root, '.git', 'index'), 'invalid index');
  assert.equal((await manager.create({ source: 'safety' })).created, false);
});

test('automatic checkpoint captures code without changing the worktree or real index', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'before agent\n');
  fs.writeFileSync(path.join(root, 'new-file.txt'), 'new code\n');
  fs.writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=not-captured\n');
  fs.mkdirSync(path.join(root, 'secrets'));
  fs.writeFileSync(path.join(root, 'secrets', 'token.txt'), 'not-captured\n');
  fs.mkdirSync(path.join(root, 'CrEdEnTiAlS'));
  fs.writeFileSync(path.join(root, 'CrEdEnTiAlS', 'api.txt'), 'not-captured\n');
  fs.writeFileSync(path.join(root, 'secretary-notes.md'), 'ordinary project notes\n');
  const statusBefore = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const indexBefore = fs.readFileSync(path.join(root, '.git', 'index'));

  let randomCounter = 1;
  const manager = new GitCheckpointManager({
    now: () => new Date('2026-08-24T04:00:00.000Z'),
    random: () => Buffer.from([0, 0, 0, randomCounter++])
  });
  assert.equal((await manager.activate(root)).available, true);
  const result = await manager.create({ source: 'automatic' });
  assert.equal(result.created, true);
  assert.equal(result.last.source, 'automatic');
  assert.equal(result.last.sensitiveExcludedCount, 3);
  assert.equal(git(root, ['show', `${result.last.commit}:tracked.txt`]), 'before agent\n');
  assert.equal(git(root, ['show', `${result.last.commit}:new-file.txt`]), 'new code\n');
  assert.doesNotMatch(git(root, ['ls-tree', '-r', '--name-only', result.last.commit]), /^\.env$/m);
  assert.doesNotMatch(git(root, ['ls-tree', '-r', '--name-only', result.last.commit]), /^secrets\/token\.txt$/m);
  assert.doesNotMatch(git(root, ['ls-tree', '-r', '--name-only', result.last.commit]), /^CrEdEnTiAlS\/api\.txt$/m);
  assert.match(git(root, ['ls-tree', '-r', '--name-only', result.last.commit]), /^secretary-notes\.md$/m);
  assert.equal(git(root, ['rev-parse', '--verify', LATEST_REF]).trim(), result.last.commit);
  assert.equal(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), statusBefore);
  assert.deepEqual(fs.readFileSync(path.join(root, '.git', 'index')), indexBefore);

  const unchanged = await manager.create({ source: 'automatic' });
  assert.equal(unchanged.created, false);
  assert.equal(unchanged.unchanged, true);
  const unchangedPreview = await manager.previewRestore();
  assert.equal(unchangedPreview.unchanged, true);
  assert.equal(unchangedPreview.affectedCount, 0);
  assert.equal(unchangedPreview.untrackedTrashCount, 0);

  fs.writeFileSync(path.join(root, 'tracked.txt'), 'after agent\n');
  fs.writeFileSync(path.join(root, 'new-file.txt'), 'changed after checkpoint\n');
  fs.writeFileSync(path.join(root, 'later.txt'), 'remove through trash\n');
  fs.writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=preserve-this-value\n');
  fs.writeFileSync(path.join(root, '.npmrc'), 'registry=https://registry.example.invalid/preserve\n');
  git(root, ['add', 'tracked.txt', '.npmrc']);
  const headBeforeRestore = git(root, ['rev-parse', 'HEAD']).trim();
  const preview = await manager.previewRestore();
  assert.equal(preview.available, true);
  assert.equal(preview.indexWillChange, true);
  assert.equal(preview.sensitiveExcludedCount, 4);
  const trashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-checkpoint-trash-'));
  context.after(() => fs.rmSync(trashRoot, { recursive: true, force: true }));
  const trashed = [];
  const restored = await manager.restoreLatest({
    trashItem: async (target) => {
      const destination = path.join(trashRoot, `${trashed.length}-${path.basename(target)}`);
      await fs.promises.rename(target, destination);
      trashed.push(destination);
    }
  });
  assert.equal(restored.restored, true);
  assert.equal(restored.last.source, 'safety');
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), headBeforeRestore);
  assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8').replaceAll('\r\n', '\n'), 'before agent\n');
  assert.equal(fs.readFileSync(path.join(root, 'new-file.txt'), 'utf8').replaceAll('\r\n', '\n'), 'new code\n');
  assert.equal(fs.existsSync(path.join(root, 'later.txt')), false);
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'DEEPSEEK_API_KEY=preserve-this-value\n');
  assert.equal(fs.readFileSync(path.join(root, '.npmrc'), 'utf8'), 'registry=https://registry.example.invalid/preserve\n');
  assert.equal(git(root, ['show', ':tracked.txt']).replaceAll('\r\n', '\n'), 'base\n');
  assert.equal(git(root, ['show', ':.npmrc']).replaceAll('\r\n', '\n'), 'registry=https://registry.example.invalid/preserve\n');
  assert.match(git(root, ['show', `${restored.safety.commit}:tracked.txt`]), /after agent/);
  assert.ok(trashed.some((entry) => entry.endsWith('later.txt')));
});

test('restore failure rolls back to the safety point and oversized recovery fails closed', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'checkpoint state\n');
  const manager = new GitCheckpointManager({
    now: () => new Date('2026-08-24T04:30:00.000Z'),
    random: () => Buffer.from([0, 0, 0, 7])
  });
  await manager.activate(root);
  await manager.create({ source: 'automatic' });

  fs.writeFileSync(path.join(root, 'tracked.txt'), 'restore me after failure\n');
  fs.writeFileSync(path.join(root, 'later.txt'), 'safety content\n');
  const rolledBack = await manager.restoreLatest({
    trashItem: async () => { throw new Error('simulated recycle failure'); }
  });
  assert.equal(rolledBack.restored, false);
  assert.equal(rolledBack.rolledBack, true);
  assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8').replaceAll('\r\n', '\n'), 'restore me after failure\n');
  assert.equal(fs.readFileSync(path.join(root, 'later.txt'), 'utf8').replaceAll('\r\n', '\n'), 'safety content\n');

  for (let index = 0; index < 501; index += 1) {
    fs.writeFileSync(path.join(root, `overflow-${String(index).padStart(3, '0')}.txt`), 'bounded\n');
  }
  const oversized = await manager.previewRestore();
  assert.equal(oversized.available, false);
  assert.equal(oversized.reason, 'too-many-paths');
  assert.equal(oversized.affectedCount, 501);
});

test('history lists bounded verified refs and restores only a selected checkpoint id', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let randomCounter = 1;
  const manager = new GitCheckpointManager({
    now: () => new Date('2026-08-24T05:00:00.000Z'),
    random: () => Buffer.from([0, 0, 0, randomCounter++])
  });
  await manager.activate(root);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'first checkpoint\n');
  const first = await manager.create({ source: 'automatic' });
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'second checkpoint\n');
  const second = await manager.create({ source: 'manual' });
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'current work\n');
  git(root, ['update-ref', 'refs/dsh/checkpoints/items/20260824T060000000Z-deadbeef', 'HEAD']);

  const history = await manager.listHistory();
  assert.equal(history.available, true);
  assert.equal(history.items.length, 2);
  assert.equal(history.invalidCount, 1);
  assert.equal(history.items[0].id, second.last.id);
  assert.equal(history.items[0].source, 'manual');
  assert.equal(history.items[0].isLatest, true);
  assert.equal(history.items[1].id, first.last.id);
  assert.equal(history.items.every((item) => !Object.hasOwn(item, 'commit')), true);

  const restored = await manager.restoreCheckpoint({
    id: first.last.id,
    expectedCommit: first.last.commit,
    trashItem: async () => {}
  });
  assert.equal(restored.restored, true);
  assert.equal(restored.restoredTo.id, first.last.id);
  assert.equal(fs.readFileSync(path.join(root, 'tracked.txt'), 'utf8').replaceAll('\r\n', '\n'), 'first checkpoint\n');
  const rejected = await manager.restoreCheckpoint({ id: 'not-a-checkpoint', trashItem: async () => {} });
  assert.equal(rejected.restoreReason, 'checkpoint-changed');
});

test('checkpoint scope refuses a nested workspace and credential-like components are detected', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(nested, { recursive: true });
  const manager = new GitCheckpointManager();
  const state = await manager.activate(nested);
  assert.equal(state.available, false);
  assert.equal(state.reason, 'workspace-is-subdirectory');
  assert.equal(isRestrictedGitPath('config/.credentials.yaml'), true);
  assert.equal(isRestrictedGitPath('secrets/token.txt'), true);
  assert.equal(isRestrictedGitPath('src/CrEdEnTiAlS/api.txt'), true);
  assert.equal(isRestrictedGitPath('src/client.ts'), false);
  assert.equal(isCheckpointId('20260824T060000000Z-deadbeef'), true);
  assert.equal(isCheckpointId('../refs/heads/main'), false);
  assert.deepEqual(statusPaths(' M src/a.js\0?? secrets.local\0'), ['src/a.js', 'secrets.local']);
});

test('checkpoint history exposes bounded conversation capability while keeping session anchors internal', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'linked checkpoint\n');
  let randomCounter = 20;
  const manager = new GitCheckpointManager({
    now: () => new Date('2026-08-24T08:00:00.000Z'),
    random: () => Buffer.from([0, 0, 0, randomCounter++])
  });
  await manager.activate(root);
  const sourceSessionId = 'session-11111111-1111-4111-8111-111111111111';
  const linked = await manager.create({
    source: 'automatic',
    sessionLink: { sessionId: sourceSessionId, atSeq: 14 }
  });
  assert.equal(linked.created, true);
  const body = git(root, ['show', '-s', '--format=%B', linked.last.commit]);
  assert.match(body, new RegExp(`DSH-Session-ID: ${sourceSessionId}`));
  assert.match(body, /DSH-Session-At-Seq: 14/);

  const history = await manager.listHistory();
  assert.equal(history.items[0].conversationLinked, true);
  assert.equal(history.items[0].conversationForkAvailable, true);
  assert.equal(Object.hasOwn(history.items[0], 'sessionId'), false);
  assert.equal(Object.hasOwn(history.items[0], 'sessionAtSeq'), false);
  const anchor = await manager.resolveConversationAnchor(history.items[0].id);
  assert.equal(anchor.id, linked.last.id);
  assert.equal(anchor.commit, linked.last.commit);
  assert.equal(new Date(anchor.createdAt).getTime(), new Date(linked.last.createdAt).getTime());
  assert.equal(anchor.sessionId, sourceSessionId);
  assert.equal(anchor.atSeq, 14);

  const unchanged = await manager.create({
    source: 'automatic',
    sessionLink: { sessionId: sourceSessionId, atSeq: 14 }
  });
  assert.equal(unchanged.unchanged, true);
  const nextTurn = await manager.create({
    source: 'automatic',
    sessionLink: { sessionId: sourceSessionId, atSeq: 19 }
  });
  assert.equal(nextTurn.created, true);
  assert.notEqual(nextTurn.last.commit, linked.last.commit);
});
