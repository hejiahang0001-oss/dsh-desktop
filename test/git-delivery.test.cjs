'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { GitDeliveryManager, normalizeCommitMessage, parseGitHubRemote, parseStatus } = require('../electron/git-delivery.cjs');

const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });

const repository = async (context) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-delivery-'));
  const root = path.join(parent, 'repo  with  spaces');
  await fs.mkdir(root);
  context.after(() => fs.rm(parent, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'DSH Test']);
  git(root, ['config', 'user.email', 'dsh@example.invalid']);
  await fs.writeFile(path.join(root, 'README.md'), '# DSH\n');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'initial']);
  return root;
};

test('Git delivery inspects bounded status and commits only staged content', async (context) => {
  const root = await repository(context);
  await fs.writeFile(path.join(root, 'staged.txt'), 'staged\n');
  await fs.writeFile(path.join(root, 'unstaged.txt'), 'unstaged\n');
  git(root, ['add', 'staged.txt']);
  const manager = new GitDeliveryManager({ fetchFn: undefined });
  manager.activate(root);
  const before = await manager.inspect({ includeRemote: false });
  assert.equal(before.available, true);
  assert.equal(before.repository.root, root);
  assert.equal(before.repository.branch, 'main');
  assert.equal(before.status.staged, 1);
  assert.equal(before.status.untracked, 1);
  const committed = await manager.commit('deliver staged change', before.status.fingerprint);
  assert.equal(committed.ok, true);
  assert.equal(git(root, ['log', '-1', '--format=%s']).trim(), 'deliver staged change');
  assert.match(git(root, ['status', '--porcelain']), /\?\? unstaged\.txt/u);
  await assert.rejects(() => manager.commit('nothing now', committed.state.status.fingerprint), /没有已暂存改动/);
});

test('Git delivery rejects changed confirmation state, conflicts, and unsafe messages', async (context) => {
  const root = await repository(context);
  await fs.writeFile(path.join(root, 'one.txt'), 'one\n');
  git(root, ['add', 'one.txt']);
  const manager = new GitDeliveryManager({ fetchFn: undefined });
  manager.activate(root);
  const before = await manager.inspect({ includeRemote: false });
  await fs.writeFile(path.join(root, 'one.txt'), 'changed staged bytes\n');
  git(root, ['add', 'one.txt']);
  await assert.rejects(() => manager.commit('state changed', before.status.fingerprint), /暂存区在确认期间已变化/);
  assert.throws(() => normalizeCommitMessage('bad\nmessage'), /单行文本/);
  assert.equal(parseStatus('UU conflict.txt\0').conflicted, 1);
});

test('GitHub remote parsing rejects credentials and maps supported origins', () => {
  assert.deepEqual(parseGitHubRemote('git@github.com:owner/repo.git'), { owner: 'owner', repository: 'repo', webUrl: 'https://github.com/owner/repo' });
  assert.deepEqual(parseGitHubRemote('https://github.com/owner/repo.git'), { owner: 'owner', repository: 'repo', webUrl: 'https://github.com/owner/repo' });
  assert.equal(parseGitHubRemote('https://token@github.com/owner/repo.git'), null);
  assert.equal(parseGitHubRemote('https://example.com/owner/repo.git'), null);
});

test('GitHub PR state is bounded and exposes only opaque cached links', async (context) => {
  const root = await repository(context);
  git(root, ['remote', 'add', 'origin', 'https://github.com/owner/repo.git']);
  const sha = git(root, ['rev-parse', 'HEAD']).trim();
  const responses = [
    [{ number: 7, title: 'Delivery PR', state: 'open', draft: false, updated_at: '2026-08-30T00:00:00Z', head: { sha } }],
    { check_runs: [{ name: 'quality', status: 'completed', conclusion: 'success', details_url: 'https://github.com/owner/repo/actions/runs/1' }] },
    { statuses: [{ context: 'external', state: 'failure', target_url: 'https://evil.invalid/phish' }] }
  ];
  const fetchFn = async () => {
    const body = JSON.stringify(responses.shift());
    return { ok: true, status: 200, headers: { get: () => String(body.length) }, text: async () => body };
  };
  const manager = new GitDeliveryManager({ fetchFn });
  manager.activate(root);
  const state = await manager.inspect({ includeRemote: true });
  assert.equal(state.remote.available, true);
  assert.equal(state.remote.pullRequests.length, 1);
  assert.equal(state.remote.pullRequests[0].checks.counts.passed, 1);
  assert.equal(state.remote.pullRequests[0].checks.counts.failed, 1);
  assert.match(manager.openLink(state.remote.pullRequests[0].id), /\/pull\/7$/u);
  assert.match(manager.openLink(state.remote.pullRequests[0].checks.items[0].linkId), /actions\/runs\/1$/u);
  assert.equal(state.remote.pullRequests[0].checks.items[1].linkId, '');
  assert.throws(() => manager.openLink('0'.repeat(24)), /已失效/);
});
