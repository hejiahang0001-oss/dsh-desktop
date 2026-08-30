const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ReviewScopes, linesWithAnchors, parseNames } = require('../electron/review-scopes.cjs');
const { GitChangeReviewer } = require('../electron/change-review.cjs');
const execute = promisify(execFile);
const fixture = async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-scopes-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const git = async (...args) => (await execute('git', ['-C', root, ...args], { windowsHide: true, encoding: 'utf8' })).stdout.trim();
  await git('init', '-q', '-b', 'main'); await git('config', 'user.name', 'DSH Test'); await git('config', 'user.email', 'test@example.invalid');
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'original\n'); await git('add', '.'); await git('commit', '-qm', 'base');
  const reviewer = new GitChangeReviewer(); await reviewer.activate(root);
  let context = 'session-one';
  const scopes = new ReviewScopes({ reviewer, getContext: async () => context });
  return { root, git, reviewer, scopes, switchSession: () => { context = 'session-two'; } };
};
test('review line anchors distinguish real new and deleted line numbers', () => {
  const lines = linesWithAnchors('diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -10,2 +20,2 @@\n-old\n+new\n same');
  assert.equal(lines[4].line, 10); assert.equal(lines[4].side, 'old');
  assert.equal(lines[5].line, 20); assert.equal(lines[6].line, 21);
  assert.deepEqual(parseNames('R100\0old.txt\0new.txt\0M\0file.txt\0'), [{ path: 'new.txt', originalPath: 'old.txt', code: 'R100' }, { path: 'file.txt', originalPath: '', code: 'M' }]);
});
test('staged and unstaged scopes show different contents for a mixed file and include untracked only in unstaged', async (t) => {
  const f = await fixture(t);
  await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'staged-version\n'); await f.git('add', 'tracked.txt');
  await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'unstaged-version\n'); await fsp.writeFile(path.join(f.root, 'new.txt'), 'new-file\n');
  await fsp.writeFile(path.join(f.root, '.env'), 'fixture=private');
  const staged = await f.scopes.list({ scope: 'staged' }); const unstaged = await f.scopes.list({ scope: 'unstaged' });
  assert.equal(staged.items.length, 1); assert.equal(unstaged.items.length, 2);
  assert.match((await f.scopes.diff({ token: staged.token, file: 'tracked.txt' })).content, /\+staged-version/);
  assert.match((await f.scopes.diff({ token: unstaged.token, file: 'tracked.txt' })).content, /\+unstaged-version/);
  await assert.rejects(f.scopes.diff({ token: unstaged.token, file: '.env' }), /范围/);
});
test('branch scope reads merge-base to HEAD and excludes uncommitted work', async (t) => {
  const f = await fixture(t); await f.git('switch', '-qc', 'feature');
  await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'branch-change\n'); await f.git('commit', '-qam', 'change');
  await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'local-not-committed\n');
  const view = await f.scopes.list({ scope: 'branch', base: 'main' });
  const diff = await f.scopes.diff({ token: view.token, file: 'tracked.txt' });
  assert.match(diff.content, /branch-change/); assert.doesNotMatch(diff.content, /local-not-committed/);
  assert.equal(view.items[0].canReject, false);
});
test('comments retain exact line anchors, support edit/delete, and refuse stale code or another session', async (t) => {
  const f = await fixture(t); await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'changed\n');
  const view = await f.scopes.list(); const diff = await f.scopes.diff({ token: view.token, file: 'tracked.txt' });
  const index = diff.lines.find((line) => line.text === '+changed').index;
  const comment = await f.scopes.addComment({ token: view.token, file: 'tracked.txt', fingerprint: diff.fingerprint, index, body: '请处理空值' });
  assert.equal(comment.line, 1); assert.match((await f.scopes.prompt()).text, /请处理空值/);
  await f.scopes.addComment({ token: view.token, file: 'tracked.txt', fingerprint: diff.fingerprint, index, body: '请补充边界测试', id: comment.id });
  assert.equal((await f.scopes.listComments()).length, 1);
  await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'changed-again\n');
  await assert.rejects(f.scopes.prompt(), /已变化/);
  f.switchSession(); await assert.rejects(f.scopes.diff({ token: view.token, file: 'tracked.txt' }), /过期/);
  assert.equal((await f.scopes.listComments()).length, 0);
  await assert.rejects(f.scopes.removeComment(comment.id), /过期/);
});
test('last turn scope is unavailable without verified context-bound checkpoint trees', async (t) => {
  const f = await fixture(t); const state = await f.scopes.list({ scope: 'last-turn' });
  assert.equal(state.available, false); assert.equal(state.reason, 'no-turn-baseline');
});

test('last-turn snapshots include tracked and untracked changes without changing the real index', async (t) => {
  const { GitCheckpointManager } = require('../electron/checkpoint-manager.cjs');
  const f = await fixture(t);
  const manager = new GitCheckpointManager(); await manager.activate(f.root);
  const before = await manager.captureCurrentState();
  await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'turn-change\n');
  await fsp.writeFile(path.join(f.root, 'added.txt'), 'new-turn-file\n');
  const after = await manager.captureCurrentState();
  f.scopes.getLastTurn = async () => ({ before: before.tree, after: after.tree });
  const view = await f.scopes.list({ scope: 'last-turn' });
  assert.deepEqual(view.items.map((item) => item.path).sort(), ['added.txt', 'tracked.txt']);
  assert.match((await f.scopes.diff({ token: view.token, file: 'added.txt' })).content, /new-turn-file/);
  assert.equal(await f.git('diff', '--cached', '--name-only'), '');
});

test('headers inside hunks are code lines and untracked comments use actual file line numbers', async (t) => {
  const anchors = linesWithAnchors('@@ -1,2 +1,2 @@\n--- special code\n+++ special code');
  assert.equal(anchors[1].line, 1); assert.equal(anchors[2].line, 1);
  const f = await fixture(t); await fsp.writeFile(path.join(f.root, 'added.txt'), 'first\nsecond\n');
  const view = await f.scopes.list(); const diff = await f.scopes.diff({ token: view.token, file: 'added.txt' });
  const index = diff.lines.find((line) => line.text === '+second').index;
  const comment = await f.scopes.addComment({ token: view.token, file: 'added.txt', fingerprint: diff.fingerprint, index, body: '核对第二行' });
  assert.equal(comment.line, 2); assert.equal(comment.quote, 'second');
  await f.scopes.removeComment(comment.id); assert.equal((await f.scopes.listComments()).length, 0);
});

test('staged rename and binary diffs stay read-only and binary line comments are rejected', async (t) => {
  const f = await fixture(t); await f.git('mv', 'tracked.txt', 'renamed.txt');
  await fsp.writeFile(path.join(f.root, 'binary.bin'), Buffer.from([0, 255, 1, 0])); await f.git('add', 'binary.bin');
  const view = await f.scopes.list({ scope: 'staged' });
  assert.ok(view.items.some((item) => item.path === 'renamed.txt'));
  const binary = await f.scopes.diff({ token: view.token, file: 'binary.bin' }); assert.equal(binary.binary, true);
  await assert.rejects(f.scopes.addComment({ token: view.token, file: 'binary.bin', fingerprint: binary.fingerprint, index: 0, body: 'invalid' }), /变化/);
});

test('unresolved merge conflicts are explicit and cannot be one-click accepted or rejected', async (t) => {
  const f = await fixture(t); await f.git('switch', '-qc', 'other');
  await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'other\n'); await f.git('commit', '-qam', 'other');
  await f.git('switch', 'main'); await fsp.writeFile(path.join(f.root, 'tracked.txt'), 'main\n'); await f.git('commit', '-qam', 'main');
  await assert.rejects(f.git('merge', 'other'));
  const view = await f.scopes.list(); const file = view.items.find((item) => item.path === 'tracked.txt');
  assert.equal(file.status, 'conflict'); assert.equal(file.canAccept, false); assert.equal(file.canReject, false);
  const before = await f.git('ls-files', '-u'); assert.ok(before);
  await f.reviewer.accept('tracked.txt');
  assert.equal(await f.git('ls-files', '-u'), before);
});
