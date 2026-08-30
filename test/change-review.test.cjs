const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');
const {
  ChangeReviewError,
  GitChangeReviewer,
  parsePorcelainEntries,
  resolveReportedPath
} = require('../electron/change-review.cjs');

const execFileAsync = promisify(execFile);

const git = async (root, args) => execFileAsync('git', ['-C', root, ...args], {
  windowsHide: true,
  encoding: 'utf8'
});
const readNormalized = async (target) => (await fsp.readFile(target, 'utf8')).replaceAll('\r\n', '\n');

const createRepository = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-change-review-'));
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', 'DSH Desktop Test']);
  await git(root, ['config', 'user.email', 'dsh-desktop@example.invalid']);
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'baseline\n', 'utf8');
  await git(root, ['add', '--', 'tracked.txt']);
  await git(root, ['commit', '-q', '-m', 'baseline']);
  return root;
};

test('reported paths stay inside the active workspace', () => {
  const workspace = path.resolve('workspace');
  assert.equal(resolveReportedPath(workspace, 'src/file.js'), path.join(workspace, 'src', 'file.js'));
  assert.throws(() => resolveReportedPath(workspace, '../outside.js'), ChangeReviewError);
  assert.throws(() => resolveReportedPath(workspace, path.join(workspace, 'absolute.js')), ChangeReviewError);
});

test('documents added by the user are protected from rejecting all Agent output', async (t) => {
  const root = await createRepository(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer(); await reviewer.activate(root);
  await fsp.writeFile(path.join(root, '资料.csv'), '项目,金额\n甲,12');
  reviewer.protectUserPaths(['资料.csv']);
  assert.equal((await reviewer.inspect('资料.csv')).canReject, false);
  await assert.rejects(reviewer.reject('资料.csv'), /未暂存修改/);
  assert.equal(await fsp.readFile(path.join(root, '资料.csv'), 'utf8'), '项目,金额\n甲,12');
});

test('porcelain parser keeps rename records paired instead of inventing another file', () => {
  assert.deepEqual(parsePorcelainEntries('R  renamed.txt\0original.txt\0?? new.txt\0'), [
    { code: 'R ', path: 'renamed.txt', originalPath: 'original.txt' },
    { code: '??', path: 'new.txt', originalPath: '' }
  ]);
});

test('review state distinguishes clean repositories from repositories with only untracked files', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);

  const clean = await reviewer.listChanges();
  assert.equal(clean.available, true);
  assert.equal(clean.reviewState, 'clean');
  assert.equal(clean.reason, 'no-change');

  await fsp.writeFile(path.join(root, 'untracked.txt'), 'new output\n', 'utf8');
  const changed = await reviewer.listChanges();
  assert.equal(changed.available, true);
  assert.equal(changed.reviewState, 'changes');
  assert.equal(changed.total, 1);
  assert.equal(changed.items[0].untracked, true);
});

test('review state distinguishes missing Git, non-repositories, and Git status failures', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-change-review-state-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));

  const missing = new GitChangeReviewer({
    run: async () => { const error = new Error('spawn git ENOENT'); error.code = 'ENOENT'; throw error; }
  });
  assert.equal((await missing.activate(directory)).reason, 'git-unavailable');
  assert.equal((await missing.listChanges()).reviewState, 'git-unavailable');

  const nonRepository = new GitChangeReviewer();
  assert.equal((await nonRepository.activate(directory)).reason, 'not-a-git-repository');
  assert.equal((await nonRepository.listChanges()).reviewState, 'not-a-git-repository');

  const failed = new GitChangeReviewer({
    run: async (_command, args) => {
      if (args.includes('rev-parse')) return { stdout: directory };
      const error = new Error('Git status access denied');
      error.code = 'EACCES';
      throw error;
    }
  });
  assert.equal((await failed.activate(directory)).reason, 'git-status-failed');
  const failedList = await failed.listChanges();
  assert.equal(failedList.available, false);
  assert.equal(failedList.reviewState, 'status-read-failed');
});

test('reject restores a tracked Harness change to the current index', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);

  await fsp.writeFile(path.join(root, 'tracked.txt'), 'agent version\n', 'utf8');
  assert.equal((await reviewer.inspect('tracked.txt')).status, 'pending');
  const restored = await reviewer.reject('tracked.txt');
  assert.equal(restored.status, 'clean');
  assert.equal(await readNormalized(path.join(root, 'tracked.txt')), 'baseline\n');
});

test('accept creates a staged recovery baseline for a later reject', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);

  await fsp.writeFile(path.join(root, 'tracked.txt'), 'accepted version\n', 'utf8');
  assert.equal((await reviewer.accept('tracked.txt')).status, 'accepted');
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'later version\n', 'utf8');
  assert.equal((await reviewer.reject('tracked.txt')).status, 'accepted');
  assert.equal(await readNormalized(path.join(root, 'tracked.txt')), 'accepted version\n');
});

test('preexisting unstaged content cannot be rejected with one click', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'user version\n', 'utf8');
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);

  const protectedState = await reviewer.inspect('tracked.txt');
  assert.equal(protectedState.status, 'protected');
  assert.equal(protectedState.canReject, false);
  await assert.rejects(() => reviewer.reject('tracked.txt'), { code: 'preexisting-unstaged-change' });
  assert.equal(await readNormalized(path.join(root, 'tracked.txt')), 'user version\n');
  assert.equal((await reviewer.accept('tracked.txt')).status, 'accepted');
});

test('a new Agent turn can refresh protection for edits made after workspace activation', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'user edit before turn\n', 'utf8');
  await reviewer.captureBaseline();

  const state = await reviewer.inspect('tracked.txt');
  assert.equal(state.protected, true);
  assert.equal(state.canReject, false);
});

test('reject sends a newly produced untracked file through the injected trash handler', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  let trashedPath = '';
  const reviewer = new GitChangeReviewer({
    trashItem: async (target) => {
      trashedPath = target;
      await fsp.rename(target, `${target}.trashed`);
    }
  });
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'new-file.txt'), 'new output\n', 'utf8');

  const pending = await reviewer.inspect('new-file.txt');
  assert.equal(pending.untracked, true);
  assert.equal(pending.canReject, true);
  assert.equal((await reviewer.reject('new-file.txt')).status, 'clean');
  assert.equal(trashedPath, path.join(root, 'new-file.txt'));
});

test('accept stages a newly produced untracked file', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'new-file.txt'), 'new output\n', 'utf8');

  const accepted = await reviewer.accept('new-file.txt');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.canReject, false);
});

test('diff preview shows pending worktree changes and accepted staged changes', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'agent version\n', 'utf8');

  const pending = await reviewer.getDiff('tracked.txt');
  assert.equal(pending.available, true);
  assert.equal(pending.status, 'pending');
  assert.match(pending.content, /-baseline/);
  assert.match(pending.content, /\+agent version/);

  await reviewer.accept('tracked.txt');
  const accepted = await reviewer.getDiff('tracked.txt');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.staged, true);
  assert.match(accepted.content, /\+agent version/);
});

test('diff preview bounds new text files and identifies binary files', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'new.txt'), 'first\nsecond\nthird\n', 'utf8');
  await fsp.writeFile(path.join(root, 'new.bin'), Buffer.from([1, 0, 2, 3]));

  const textPreview = await reviewer.getDiff('new.txt', { maxChars: 80, maxFileBytes: 12 });
  assert.equal(textPreview.available, true);
  assert.equal(textPreview.truncated, true);
  assert.match(textPreview.content, /Diff 已截断/);

  const binaryPreview = await reviewer.getDiff('new.bin');
  assert.equal(binaryPreview.binary, true);
  assert.equal(binaryPreview.available, true);
  assert.match(binaryPreview.content, /Binary file/);
});

test('untracked preview never follows a symbolic link outside the repository', async () => {
  let opened = false;
  const reviewer = new GitChangeReviewer({
    fsPromises: {
      lstat: async () => ({ isFile: () => false, isSymbolicLink: () => true }),
      open: async () => { opened = true; throw new Error('must not open'); }
    }
  });
  reviewer.inspect = async () => ({
    status: 'pending',
    path: 'outside-link.txt',
    repoPath: 'outside-link.txt',
    canAccept: true,
    canReject: true,
    protected: false,
    untracked: true,
    staged: false,
    reason: 'pending'
  });
  reviewer.resolveChangePath = () => ({ absolutePath: 'outside-link.txt', repoPath: 'outside-link.txt' });

  const preview = await reviewer.getDiff('outside-link.txt');
  assert.equal(preview.available, true);
  assert.equal(opened, false);
  assert.match(preview.content, /Symbolic link preview disabled/);
});

test('multi-file list reports pending, protected, and accepted files independently', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.writeFile(path.join(root, 'protected.txt'), 'protected baseline\n', 'utf8');
  await git(root, ['add', '--', 'protected.txt']);
  await git(root, ['commit', '-q', '-m', 'add protected file']);
  await fsp.writeFile(path.join(root, 'protected.txt'), 'user edit\n', 'utf8');

  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'agent edit\n', 'utf8');
  await fsp.writeFile(path.join(root, 'new.txt'), 'new output\n', 'utf8');
  await fsp.writeFile(path.join(root, 'accepted.txt'), 'accepted output\n', 'utf8');
  await git(root, ['add', '--', 'accepted.txt']);

  const list = await reviewer.listChanges();
  assert.equal(list.total, 4);
  assert.equal(list.pendingCount, 2);
  assert.equal(list.protectedCount, 1);
  assert.equal(list.acceptedCount, 1);
  assert.equal(list.canAcceptCount, 2);
  assert.equal(list.canRejectCount, 2);
  assert.deepEqual(list.items.map((item) => [item.path, item.status]), [
    ['accepted.txt', 'accepted'],
    ['new.txt', 'pending'],
    ['protected.txt', 'protected'],
    ['tracked.txt', 'pending']
  ]);
});

test('batch accept stages every selected Agent change', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'agent edit\n', 'utf8');
  await fsp.writeFile(path.join(root, 'new.txt'), 'new output\n', 'utf8');

  const result = await reviewer.acceptMany(['tracked.txt', 'new.txt']);
  assert.equal(result.processed, 2);
  const list = await reviewer.listChanges();
  assert.equal(list.pendingCount, 0);
  assert.equal(list.acceptedCount, 2);
  assert.deepEqual(list.items.map((item) => item.status), ['accepted', 'accepted']);
});

test('batch reject restores tracked files and trashes new files after one preflight', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const trashed = [];
  const reviewer = new GitChangeReviewer({
    trashItem: async (target) => {
      trashed.push(target);
      await fsp.rm(target);
    }
  });
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'agent edit\n', 'utf8');
  await fsp.writeFile(path.join(root, 'new.txt'), 'new output\n', 'utf8');

  const result = await reviewer.rejectMany(['tracked.txt', 'new.txt']);
  assert.equal(result.processed, 2);
  assert.equal(await readNormalized(path.join(root, 'tracked.txt')), 'baseline\n');
  assert.deepEqual(trashed, [path.join(root, 'new.txt')]);
  assert.equal((await reviewer.listChanges()).total, 0);
});

test('batch operations refuse every file when one selected path is protected', async (t) => {
  const root = await createRepository();
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.writeFile(path.join(root, 'tracked.txt'), 'user edit\n', 'utf8');
  const reviewer = new GitChangeReviewer();
  await reviewer.activate(root);
  await fsp.writeFile(path.join(root, 'new.txt'), 'agent output\n', 'utf8');

  await assert.rejects(
    () => reviewer.acceptMany(['tracked.txt', 'new.txt']),
    { code: 'preexisting-unstaged-change' }
  );
  assert.equal((await reviewer.inspect('new.txt')).status, 'pending');
  assert.equal(await readNormalized(path.join(root, 'tracked.txt')), 'user edit\n');
});
