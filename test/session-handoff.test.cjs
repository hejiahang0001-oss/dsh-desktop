const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { SessionHandoff } = require('../electron/session-handoff.cjs');
const { GitWorktreeManager, sanitizedGitEnvironment } = require('../electron/worktree-manager.cjs');
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, env: sanitizedGitEnvironment() }).trim();
async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-handoff-')), source = path.join(root, 'source');
  t.after(() => fsp.rm(root, { recursive: true, force: true })); await fsp.mkdir(source);
  git(source, ['init', '--initial-branch=main']); git(source, ['config', 'user.name', 'test']); git(source, ['config', 'user.email', 'test@example.invalid']);
  git(source, ['config', 'core.autocrlf', 'false']);
  await fsp.writeFile(path.join(source, 'data.txt'), 'baseline\n'); git(source, ['add', '.']); git(source, ['commit', '-m', 'fixture']);
  let context = { workspacePath: source, sessionId: `session-${randomUUID()}` }, failFork = false, running = false, approved = true;
  const manager = new GitWorktreeManager({ managedRoot: path.join(root, 'managed') });
  const options = { filePath: path.join(root, 'journal.json'), manager, getContext: async () => context,
    confirm: async () => approved, activate: async (workspacePath, sessionId) => { context = { workspacePath, sessionId }; return { ok: true }; },
    trashItem: async (file) => { await fsp.rename(file, path.join(root, `trash-${randomUUID()}`)); },
    control: async (op, request) => { if (op === 'fork' && failFork) throw new Error('simulated fork failure'); return { sessionId: op === 'fork' ? request.childId : request.sessionId, historyHash: 'a'.repeat(64), cursor: -1, eventCount: 0, inheritedEvents: 0, running, pending: 0 }; } };
  const service = new SessionHandoff(options); await service.init();
  return { root, source, service, options, context: () => context, fail: () => { failFork = true; }, busy: () => { running = true; }, cancel: () => { approved = false; } };
}
test('handoff round trip preserves staged, unstaged and untracked state and original history', async (t) => {
  const f = await fixture(t), originalSession = f.context().sessionId;
  await fsp.writeFile(path.join(f.source, 'data.txt'), 'staged\n'); git(f.source, ['add', 'data.txt']);
  await fsp.appendFile(path.join(f.source, 'data.txt'), 'unstaged\n'); await fsp.writeFile(path.join(f.source, 'new.txt'), 'untracked\n');
  const staged = git(f.source, ['write-tree']), before = git(f.source, ['status', '--porcelain']);
  const out = await f.service.run(); assert.equal(out.ok, true); assert.notEqual(out.sessionId, originalSession);
  assert.equal(git(out.workspacePath, ['write-tree']), staged); assert.equal(git(out.workspacePath, ['status', '--porcelain']), before);
  assert.equal(git(f.source, ['status', '--porcelain']), before); assert.equal(await fsp.readFile(path.join(out.workspacePath, 'new.txt'), 'utf8'), 'untracked\n');
  await fsp.appendFile(path.join(out.workspacePath, 'data.txt'), 'worktree work\n');
  const back = await f.service.run(); assert.equal(back.ok, true); assert.equal(back.workspacePath, f.source);
  assert.match(await fsp.readFile(path.join(f.source, 'data.txt'), 'utf8'), /worktree work/); assert.equal(git(f.source, ['write-tree']), staged);
  assert.equal(f.service.state.entries[0].phase, 'returned'); assert.equal(f.service.state.entries.length, 2);
  assert.ok(await fsp.stat(out.workspacePath));
});
test('external original edits block return and busy/canceled tasks create no worktree', async (t) => {
  const f = await fixture(t); await f.service.run(); await fsp.appendFile(path.join(f.source, 'data.txt'), 'someone else\n');
  await assert.rejects(f.service.run(), /原目录已产生/); assert.match(await fsp.readFile(path.join(f.source, 'data.txt'), 'utf8'), /someone else/);
  const g = await fixture(t); g.cancel(); assert.equal((await g.service.run()).canceled, true); assert.equal(g.service.state.entries.length, 0);
  g.busy(); await assert.rejects(g.service.run(), /仍在执行/); assert.equal(g.service.state.entries.length, 0);
});
test('failed outward fork retains recoverable target and restart records interruption without replay', async (t) => {
  const f = await fixture(t); f.fail(); await assert.rejects(f.service.run(), /simulated/);
  assert.equal(f.service.state.entries[0].phase, 'failed'); assert.ok(await fsp.stat(f.service.state.entries[0].targetPath));
  await f.service.update(f.service.state.entries[0].id, { phase: 'forking' });
  const reopened = new SessionHandoff(f.options); await reopened.init(); assert.equal(reopened.state.entries[0].phase, 'interrupted');
  assert.equal(reopened.state.entries.length, 1);
});
test('failed return restores original code and leaves the worktree intact', async (t) => {
  const f = await fixture(t); const out = await f.service.run(); await fsp.writeFile(path.join(out.workspacePath, 'data.txt'), 'child change\n');
  f.fail(); await assert.rejects(f.service.run(), /原目录已恢复/);
  assert.equal(await fsp.readFile(path.join(f.source, 'data.txt'), 'utf8'), 'baseline\n');
  assert.equal(await fsp.readFile(path.join(out.workspacePath, 'data.txt'), 'utf8'), 'child change\n');
});
test('text attachment checkout line endings are accepted without overwriting target or accepting different content', async (t) => {
  const f = await fixture(t), target = path.join(f.root, 'target'); await fsp.mkdir(target);
  const { SessionContinuityStore } = require('../electron/session-continuity-store.cjs');
  const { contextKey } = require('../electron/document-intake-controller.cjs');
  const { createHash } = require('node:crypto');
  const store = new SessionContinuityStore(path.join(f.root, 'drafts.json')); await store.init();
  const text = Buffer.from('名称,金额\n甲,12\n'), converted = Buffer.from('名称,金额\r\n甲,12\r\n');
  const item = { id: randomUUID(), relativePath: 'data.csv', name: 'data.csv', bytes: text.length, sha256: createHash('sha256').update(text).digest('hex'), kind: 'spreadsheet' };
  await fsp.writeFile(path.join(f.source, 'data.csv'), text); await fsp.writeFile(path.join(target, 'data.csv'), converted);
  await store.saveAttachments(contextKey(f.context()), [item]); f.service.continuity = async () => store;
  const child = { workspacePath: target, sessionId: `session-${randomUUID()}` };
  await f.service.transferDraft(f.context(), child);
  assert.deepEqual(await fsp.readFile(path.join(target, 'data.csv')), converted);
  assert.equal(store.read(contextKey(child)).items[0].sha256, createHash('sha256').update(converted).digest('hex'));
  await fsp.writeFile(path.join(target, 'data.csv'), 'different');
  await assert.rejects(f.service.transferDraft(f.context(), { ...child, sessionId: `session-${randomUUID()}` }), /不同的同名附件/);
});
