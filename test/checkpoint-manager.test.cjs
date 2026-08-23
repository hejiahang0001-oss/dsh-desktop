const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GitCheckpointManager, LATEST_REF, isRestrictedGitPath, statusPaths } = require('../electron/checkpoint-manager.cjs');

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
  git(root, ['add', 'tracked.txt']);
  git(root, ['commit', '--quiet', '-m', 'initial']);
  return root;
};

test('automatic checkpoint captures code without changing the worktree or real index', async (context) => {
  const root = createRepository();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'before agent\n');
  fs.writeFileSync(path.join(root, 'new-file.txt'), 'new code\n');
  fs.writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=not-captured\n');
  const statusBefore = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const indexBefore = fs.readFileSync(path.join(root, '.git', 'index'));

  const manager = new GitCheckpointManager({
    now: () => new Date('2026-08-24T04:00:00.000Z'),
    random: () => Buffer.from('01020304', 'hex')
  });
  assert.equal((await manager.activate(root)).available, true);
  const result = await manager.create({ source: 'automatic' });
  assert.equal(result.created, true);
  assert.equal(result.last.source, 'automatic');
  assert.equal(result.last.sensitiveExcludedCount, 1);
  assert.equal(git(root, ['show', `${result.last.commit}:tracked.txt`]), 'before agent\n');
  assert.equal(git(root, ['show', `${result.last.commit}:new-file.txt`]), 'new code\n');
  assert.doesNotMatch(git(root, ['ls-tree', '-r', '--name-only', result.last.commit]), /^\.env$/m);
  assert.equal(git(root, ['rev-parse', '--verify', LATEST_REF]).trim(), result.last.commit);
  assert.equal(git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), statusBefore);
  assert.deepEqual(fs.readFileSync(path.join(root, '.git', 'index')), indexBefore);

  const unchanged = await manager.create({ source: 'automatic' });
  assert.equal(unchanged.created, false);
  assert.equal(unchanged.unchanged, true);
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
  assert.equal(isRestrictedGitPath('src/client.ts'), false);
  assert.deepEqual(statusPaths(' M src/a.js\0?? secrets.local\0'), ['src/a.js', 'secrets.local']);
});
