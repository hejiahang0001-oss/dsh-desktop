const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  GitWorktreeError,
  GitWorktreeManager,
  parseWorktreePorcelain,
  sanitizedGitEnvironment,
  summarizeStatus
} = require('../electron/worktree-manager.cjs');

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8',
  windowsHide: true,
  env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^DEEPSEEK(?:_|$)/i.test(name)))
});

const repositoryFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-worktree-'));
  const repository = path.join(root, 'repository');
  const managedRoot = path.join(root, 'managed');
  fs.mkdirSync(repository, { recursive: true });
  git(repository, ['init', '--initial-branch=main']);
  git(repository, ['config', 'user.name', 'DSH Worktree Test']);
  git(repository, ['config', 'user.email', 'worktree-test@dsh-desktop.local']);
  fs.writeFileSync(path.join(repository, 'README.md'), '# fixture\n');
  git(repository, ['add', 'README.md']);
  git(repository, ['commit', '-m', 'fixture']);
  return { root, repository, managedRoot };
};

test('worktree porcelain and status parsers remain bounded and preserve Git state', () => {
  const entries = parseWorktreePorcelain([
    'worktree C:/repo',
    'HEAD 0123456789012345678901234567890123456789',
    'branch refs/heads/main',
    '',
    'worktree C:/repo-task',
    'HEAD abcdefabcdefabcdefabcdefabcdefabcdefabcd',
    'detached',
    'locked maintenance',
    '',
    ''
  ].join('\0'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].branch, 'main');
  assert.equal(entries[1].detached, true);
  assert.equal(entries[1].locked, true);
  assert.equal(entries[1].lockReason, 'maintenance');
  assert.throws(() => parseWorktreePorcelain('HEAD abc\0\0'), /缺少路径/);

  const status = summarizeStatus('M  staged.txt\0 M unstaged.txt\0?? new.txt\0R  old.txt\0renamed.txt\0');
  assert.deepEqual({ changed: status.changed, staged: status.staged, unstaged: status.unstaged, untracked: status.untracked, clean: status.clean }, {
    changed: 4,
    staged: 2,
    unstaged: 1,
    untracked: 1,
    clean: false
  });
  assert.match(status.digest, /^[0-9a-f]{64}$/);
});

test('Git environment removes software keys and Git execution overrides', () => {
  const environment = sanitizedGitEnvironment({
    PATH: 'C:\\Git\\cmd',
    DEEPSEEK_API_KEY: 'secret',
    deepseek_token: 'secret-2',
    GIT_DIR: 'C:\\outside',
    GIT_WORK_TREE: 'C:\\outside-tree',
    GIT_COMMON_DIR: 'C:\\outside-common',
    GIT_EXEC_PATH: 'C:\\outside-exec',
    GIT_CONFIG_GLOBAL: 'C:\\outside-config',
    git_terminal_prompt: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: 'C:\\hook'
  });
  assert.equal(environment.PATH, 'C:\\Git\\cmd');
  assert.equal(environment.DEEPSEEK_API_KEY, undefined);
  assert.equal(environment.deepseek_token, undefined);
  assert.equal(environment.GIT_DIR, undefined);
  assert.equal(environment.GIT_WORK_TREE, undefined);
  assert.equal(environment.GIT_COMMON_DIR, undefined);
  assert.equal(environment.GIT_EXEC_PATH, undefined);
  assert.equal(environment.GIT_CONFIG_GLOBAL, undefined);
  assert.equal(environment.GIT_CONFIG_COUNT, undefined);
  assert.equal(environment.GIT_CONFIG_KEY_0, undefined);
  assert.equal(environment.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
  assert.equal(environment.GIT_OPTIONAL_LOCKS, '0');
});

test('workspace links and the total worktree limit fail closed before mutation', async (context) => {
  const fixture = repositoryFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const linkPath = path.join(fixture.root, 'repository-link');
  fs.symlinkSync(fixture.repository, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  const manager = new GitWorktreeManager({ managedRoot: fixture.managedRoot });
  const linkedState = await manager.inspect(linkPath);
  assert.equal(linkedState.available, false);
  assert.equal(linkedState.reason, 'workspace-invalid');

  manager._state = async () => ({ counts: { total: 32, managed: 0 } });
  await assert.rejects(
    manager.create({ workspacePath: fixture.repository }),
    (error) => error?.code === 'worktree-limit'
  );
});

test('managed worktree creation is generated, isolated, and leaves unmanaged worktrees read-only', async (context) => {
  const fixture = repositoryFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const manager = new GitWorktreeManager({
    managedRoot: fixture.managedRoot,
    baseEnv: { ...process.env, DEEPSEEK_API_KEY: 'must-not-forward' },
    now: () => new Date('2026-08-25T06:07:08.000Z'),
    random: () => Buffer.from('a1b2c3', 'hex')
  });

  const initial = await manager.inspect(fixture.repository);
  assert.equal(initial.available, true);
  assert.equal(initial.counts.total, 1);
  assert.equal(initial.worktrees[0].main, true);
  assert.equal(initial.worktrees[0].managed, false);
  assert.equal(initial.worktrees[0].canRemove, false);
  await assert.rejects(
    manager.previewRemove({ workspacePath: fixture.repository, id: initial.worktrees[0].id }),
    (error) => error?.code === 'remove-not-allowed'
  );

  const created = await manager.create({ workspacePath: fixture.repository });
  assert.equal(created.ok, true);
  assert.equal(created.branch, 'dsh/worktree-20260825-060708-a1b2c3');
  assert.equal(created.path.startsWith(path.resolve(fixture.managedRoot)), true);
  assert.equal(fs.existsSync(path.join(created.path, 'README.md')), true);
  const item = created.state.worktrees.find((candidate) => candidate.id === created.createdId);
  assert.equal(item.managed, true);
  assert.equal(item.owner, 'DSH Desktop');
  assert.equal(item.pathSafe, true);
  assert.equal(item.status.available, true);
  assert.equal(item.canActivate, true);
  assert.equal(item.canRemove, true);
  assert.equal(item.status.clean, true);

  const reloaded = new GitWorktreeManager({ managedRoot: fixture.managedRoot });
  const persisted = await reloaded.inspect(fixture.repository);
  assert.equal(persisted.worktrees.find((candidate) => candidate.id === created.createdId)?.managed, true);

  const externalPath = path.join(path.dirname(created.path), 'worktree-20260825-060709-deadbe');
  const externalBranch = 'dsh/worktree-20260825-060709-deadbe';
  git(fixture.repository, ['worktree', 'add', '--no-track', '-b', externalBranch, externalPath, 'HEAD']);
  const withMimic = await reloaded.inspect(fixture.repository);
  const mimic = withMimic.worktrees.find((candidate) => candidate.branch === externalBranch);
  assert.equal(mimic.managed, false);
  assert.equal(mimic.owner, '外部 Git');
  assert.equal(mimic.canRemove, false);
});

test('dirty managed worktree gets a private recovery checkpoint before safe removal', async (context) => {
  const fixture = repositoryFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const manager = new GitWorktreeManager({
    managedRoot: fixture.managedRoot,
    now: () => new Date('2026-08-25T07:00:00.000Z'),
    random: () => Buffer.from('010203', 'hex')
  });
  const created = await manager.create({ workspacePath: fixture.repository });
  fs.writeFileSync(path.join(created.path, 'uncommitted.txt'), 'recover me\n');
  const preview = await manager.previewRemove({ workspacePath: fixture.repository, id: created.createdId });
  assert.equal(preview.status.clean, false);
  assert.equal(preview.status.untracked, 1);
  assert.equal(preview.recovery, 'private-checkpoint');

  const removed = await manager.remove({
    workspacePath: fixture.repository,
    id: created.createdId,
    expectedFingerprint: preview.fingerprint
  });
  assert.equal(removed.ok, true);
  assert.match(removed.checkpoint.id, /^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{8}$/i);
  assert.match(removed.checkpoint.commit, /^[0-9a-f]{40,64}$/i);
  assert.equal(fs.existsSync(created.path), false);
  assert.match(git(fixture.repository, ['show-ref', '--verify', `refs/heads/${created.branch}`]), new RegExp(`refs/heads/${created.branch}$`, 'm'));
  assert.equal(git(fixture.repository, ['rev-parse', '--verify', `refs/dsh/checkpoints/items/${removed.checkpoint.id}`]).trim(), removed.checkpoint.commit);
  assert.equal(removed.ownershipReleased, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixture.managedRoot, 'ownership.json'), 'utf8')).worktrees, []);
});

test('safe removal refuses a worktree whose status changed after confirmation', async (context) => {
  const fixture = repositoryFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const manager = new GitWorktreeManager({
    managedRoot: fixture.managedRoot,
    now: () => new Date('2026-08-25T08:00:00.000Z'),
    random: () => Buffer.from('040506', 'hex')
  });
  const created = await manager.create({ workspacePath: fixture.repository });
  const cleanPreview = await manager.previewRemove({ workspacePath: fixture.repository, id: created.createdId });
  fs.writeFileSync(path.join(created.path, 'changed-after-confirmation.txt'), 'changed\n');
  await assert.rejects(
    manager.remove({ workspacePath: fixture.repository, id: created.createdId, expectedFingerprint: cleanPreview.fingerprint }),
    (error) => error?.code === 'remove-state-changed'
  );
  assert.equal(fs.existsSync(created.path), true);
});

test('failed Git removal restores owned state while the worktree still exists', async (context) => {
  const fixture = repositoryFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const manager = new GitWorktreeManager({
    managedRoot: fixture.managedRoot,
    runGit: async (gitPath, cwd, args, options) => {
      if (args.includes('worktree') && args.includes('remove')) {
        throw new GitWorktreeError('injected-remove-failure', 'injected removal failure');
      }
      const { runGitCommand } = require('../electron/worktree-manager.cjs');
      return runGitCommand(gitPath, cwd, args, options);
    },
    now: () => new Date('2026-08-25T08:30:00.000Z'),
    random: () => Buffer.from('0d0e0f', 'hex')
  });
  const created = await manager.create({ workspacePath: fixture.repository });
  const preview = await manager.previewRemove({ workspacePath: fixture.repository, id: created.createdId });
  await assert.rejects(
    manager.remove({ workspacePath: fixture.repository, id: created.createdId, expectedFingerprint: preview.fingerprint }),
    (error) => error?.code === 'injected-remove-failure'
  );
  assert.equal(fs.existsSync(created.path), true);
  const state = await manager.inspect(fixture.repository);
  assert.equal(state.worktrees.find((item) => item.id === created.createdId)?.managed, true);
  const ownership = JSON.parse(fs.readFileSync(path.join(fixture.managedRoot, 'ownership.json'), 'utf8'));
  assert.equal(ownership.worktrees[0].state, 'owned');
});

test('safe removal reuses an exact verified recovery checkpoint after a retry', async (context) => {
  const fixture = repositoryFixture();
  context.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  let checkpointManager;
  const manager = new GitWorktreeManager({
    managedRoot: fixture.managedRoot,
    checkpointFactory: () => checkpointManager,
    now: () => new Date('2026-08-25T09:00:00.000Z'),
    random: () => Buffer.from('070809', 'hex')
  });
  const created = await manager.create({ workspacePath: fixture.repository });
  fs.writeFileSync(path.join(created.path, 'retry.txt'), 'recover me after retry\n');
  const { GitCheckpointManager } = require('../electron/checkpoint-manager.cjs');
  checkpointManager = new GitCheckpointManager();
  const activated = await checkpointManager.activate(created.path);
  assert.equal(activated.available, true);
  const prior = await checkpointManager.create({ source: 'safety' });
  assert.equal(prior.created, true);
  const preview = await manager.previewRemove({ workspacePath: fixture.repository, id: created.createdId });
  const removed = await manager.remove({
    workspacePath: fixture.repository,
    id: created.createdId,
    expectedFingerprint: preview.fingerprint
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.checkpoint.reused, true);
  assert.equal(removed.checkpoint.id, prior.last.id);
  assert.equal(fs.existsSync(created.path), false);
});
