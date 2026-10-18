const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepare, checkedBytes, digest, profile } = require('../scripts/prepare-harness021-candidate.cjs');

const scriptPath = path.resolve(__dirname, '../scripts/prepare-harness021-candidate.cjs');
const temporary = (t) => {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'dsh-harness021-input-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('dsh-harness021-input-test-'));
    assert.equal(fs.lstatSync(root).isSymbolicLink(), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
};
const beforeWorkspace = 'packages:\n  - packages/*\n';
const afterWorkspace = `${beforeWorkspace}ignoredBuiltDependencies: []\n`;
const workspacePatch = 'diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml\n'
  + '--- a/pnpm-workspace.yaml\n+++ b/pnpm-workspace.yaml\n@@ -1,2 +1,3 @@\n'
  + ' packages:\n   - packages/*\n+ignoredBuiltDependencies: []\n';
const newFilePath = 'patches/http-cache-semantics@4.3.0.patch';
const newFileBytes = 'synthetic reviewed dependency patch\n';
const newFilePatch = `diff --git a/${newFilePath} b/${newFilePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${newFilePath}\n@@ -0,0 +1 @@\n+${newFileBytes}`;

const fixture = (t, { patch = workspacePatch, expectedWorkspace = afterWorkspace, addedFiles = [] } = {}) => {
  const root = temporary(t);
  const source = path.join(root, 'source');
  const host = path.join(root, 'host');
  const inputs = path.join(host, 'runtime', 'harness-021-candidate');
  fs.mkdirSync(source);
  fs.mkdirSync(inputs, { recursive: true });
  fs.mkdirSync(path.join(host, 'scripts'));
  const production = path.join(host, 'runtime/harness/package.json');
  const previousCandidate = path.join(host, 'runtime/harness-020-candidate/profile.json');
  fs.mkdirSync(path.dirname(production));
  fs.mkdirSync(path.dirname(previousCandidate));
  fs.copyFileSync(path.resolve(__dirname, '../runtime/harness/package.json'), production);
  fs.copyFileSync(path.resolve(__dirname, '../runtime/harness-020-candidate/profile.json'), previousCandidate);
  const bindingSnapshot = () => [production, previousCandidate].map(file => fs.readFileSync(file));
  const bindingsBefore = bindingSnapshot();
  fs.copyFileSync(scriptPath, path.join(host, 'scripts', 'prepare-harness021-candidate.cjs'));
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${path.join(root, 'no-hooks')}`, '-C', source, ...args], { encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: profile.version, packageManager: profile.packageManager }));
  fs.writeFileSync(path.join(source, 'pnpm-lock.yaml'), 'upstream lock\n');
  fs.writeFileSync(path.join(source, 'pnpm-workspace.yaml'), beforeWorkspace);
  git('init', '--quiet');
  git('add', '--all');
  git('-c', 'user.name=DSH Candidate Test', '-c', 'user.email=dsh-candidate-test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  const commit = git('rev-parse', 'HEAD').trim();
  const candidate = {
    ...profile, commit, patchSha256: digest(patch), lockSha256: digest('reviewed lock\n'),
    upstreamLockSha256: digest('upstream lock\n'), upstreamWorkspaceSha256: digest(beforeWorkspace),
    workspaceSha256: digest(expectedWorkspace), addedFiles
  };
  fs.writeFileSync(path.join(inputs, 'profile.json'), JSON.stringify(candidate));
  fs.writeFileSync(path.join(inputs, 'source.patch'), patch);
  fs.writeFileSync(path.join(inputs, 'pnpm-lock.yaml'), 'reviewed lock\n');
  for (const entry of addedFiles) {
    const file = path.join(inputs, entry.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, newFileBytes);
  }
  const candidateModule = require(path.join(host, 'scripts', 'prepare-harness021-candidate.cjs'));
  t.after(() => { delete require.cache[path.join(host, 'scripts', 'prepare-harness021-candidate.cjs')]; });
  const snapshot = () => ({
    manifest: fs.readFileSync(path.join(source, 'package.json'), 'utf8'),
    workspace: fs.readFileSync(path.join(source, 'pnpm-workspace.yaml'), 'utf8'),
    lock: fs.readFileSync(path.join(source, 'pnpm-lock.yaml'), 'utf8'),
    status: git('status', '--porcelain', '--untracked-files=all')
  });
  const prepareIsolated = (...args) => {
    try { return candidateModule.prepare(...args); }
    finally { assert.deepEqual(bindingSnapshot(), bindingsBefore, 'preparation must preserve product pin and previous candidate bytes'); }
  };
  return { root, source, inputs, git, candidate, prepare: prepareIsolated, snapshot };
};

test('021 candidate binds reviewed inputs without changing production or the 020 candidate', () => {
  const bindingFiles = ['runtime/harness/package.json', 'runtime/harness-020-candidate/profile.json']
    .map(file => path.resolve(__dirname, '..', file));
  const before = bindingFiles.map(file => fs.readFileSync(file));
  const root = path.resolve(__dirname, '../runtime/harness-021-candidate');
  checkedBytes(path.join(root, 'source.patch'), profile.patchSha256);
  checkedBytes(path.join(root, 'pnpm-lock.yaml'), profile.lockSha256);
  assert.equal(profile.version, '0.2.1-alpha.1');
  assert.equal(profile.commit, '5badb15009ae1756c3afe0ae0cef1faafc290ccc');
  assert.equal(profile.promotionAllowed, false);
  assert.equal(require('../runtime/harness-020-candidate/profile.json').version, '0.2.0-rc.2');
  assert.deepEqual(bindingFiles.map(file => fs.readFileSync(file)), before);
});

test('021 preparation refuses relative paths and the desktop checkout', () => {
  assert.throws(() => prepare('.'), /absolute/);
  assert.throws(() => prepare(path.resolve(__dirname, '..')), /commit mismatch/);
});

test('021 input digest verification rejects changed bytes', (t) => {
  const file = path.join(temporary(t), 'input');
  fs.writeFileSync(file, 'reviewed');
  assert.equal(checkedBytes(file, digest('reviewed')).toString(), 'reviewed');
  fs.writeFileSync(file, 'changed');
  assert.throws(() => checkedBytes(file, digest('reviewed')), /digest mismatch/);
});

test('021 input validation refuses a parent junction even when bytes match', (t) => {
  const root = temporary(t);
  const target = path.join(root, 'target');
  const linked = path.join(root, 'linked');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'input'), 'reviewed');
  fs.symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => checkedBytes(path.join(linked, 'input'), digest('reviewed')), /Linked/);
  assert.equal(fs.readFileSync(path.join(target, 'input'), 'utf8'), 'reviewed');
});

test('021 input validation rejects a hard link even when its bytes match', (t) => {
  const root = temporary(t);
  const outside = path.join(root, 'outside');
  const linked = path.join(root, 'linked');
  fs.writeFileSync(outside, 'reviewed');
  fs.linkSync(outside, linked);
  assert.throws(() => checkedBytes(linked, digest('reviewed')), /Hard-linked/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'reviewed');
});

test('021 preparation refuses a hard-linked source lock without changing its external inode', (t) => {
  const candidate = fixture(t);
  const outside = path.join(candidate.root, 'outside-lock');
  const lock = path.join(candidate.source, 'pnpm-lock.yaml');
  fs.linkSync(lock, outside);
  const before = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source), /Hard-linked/);
  assert.deepEqual(candidate.snapshot(), before);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'upstream lock\n');
});

test('021 preparation preserves dirty tracked files and untracked user files', (t) => {
  const candidate = fixture(t);
  fs.writeFileSync(path.join(candidate.source, 'user-notes.txt'), 'user content');
  const before = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source), /clean; existing changes preserved/);
  assert.deepEqual(candidate.snapshot(), before);
  fs.appendFileSync(path.join(candidate.source, 'package.json'), '\n');
  const changed = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source), /clean; existing changes preserved/);
  assert.deepEqual(candidate.snapshot(), changed);
  assert.equal(fs.readFileSync(path.join(candidate.source, 'user-notes.txt'), 'utf8'), 'user content');
});

test('021 preparation refuses checkout subdirectories and linked source lock before writes', (t) => {
  const candidate = fixture(t);
  const child = path.join(candidate.source, 'child');
  fs.mkdirSync(child);
  assert.throws(() => candidate.prepare(child), /checkout root/);
  const lock = path.join(candidate.source, 'pnpm-lock.yaml');
  const target = path.join(candidate.root, 'lock-target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'sentinel'), 'preserve');
  fs.unlinkSync(lock);
  fs.symlinkSync(target, lock, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => candidate.prepare(candidate.source), /Linked/);
  assert.equal(fs.readFileSync(path.join(candidate.source, 'pnpm-workspace.yaml'), 'utf8'), beforeWorkspace);
  assert.equal(fs.readFileSync(path.join(target, 'sentinel'), 'utf8'), 'preserve');
});

test('021 preparation rejects corrupted candidate input without changing source', (t) => {
  const candidate = fixture(t);
  const before = candidate.snapshot();
  fs.appendFileSync(path.join(candidate.inputs, 'source.patch'), 'corrupt');
  assert.throws(() => candidate.prepare(candidate.source), /digest mismatch/);
  assert.deepEqual(candidate.snapshot(), before);
});

test('021 preparation validates the workspace postimage before touching source', (t) => {
  const candidate = fixture(t, { expectedWorkspace: 'incorrect expected workspace' });
  const before = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source), /digest mismatch: pnpm-workspace.yaml/);
  assert.deepEqual(candidate.snapshot(), before);
});

test('021 preparation rejects an inapplicable patch without changing source', (t) => {
  const candidate = fixture(t, { patch: workspacePatch.replace(' packages:\n', ' nonexistent:\n') });
  const before = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source), /Command failed/);
  assert.deepEqual(candidate.snapshot(), before);
});

test('021 preparation applies reviewed inputs and reports preparation only', (t) => {
  const candidate = fixture(t);
  assert.deepEqual(candidate.prepare(candidate.source), {
    version: profile.version, commit: candidate.candidate.commit, installed: false, published: false, promotionAllowed: false
  });
  const after = candidate.snapshot();
  assert.equal(after.workspace, afterWorkspace);
  assert.equal(after.lock, 'reviewed lock\n');
  assert.notEqual(after.status, '');
  assert.equal(fs.readdirSync(candidate.source).some((file) => file.startsWith('.pnpm-lock.yaml.dsh021-')), false);
});

test('021 preparation rolls back its exact patch when final lock rename fails', (t) => {
  const candidate = fixture(t);
  const before = candidate.snapshot();
  const lock = path.join(candidate.source, 'pnpm-lock.yaml');
  const rename = fs.renameSync;
  const calls = [];
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to !== lock) return rename(from, to);
    calls.push({ bytes: fs.readFileSync(from, 'utf8'), directory: path.dirname(from) });
    throw Object.assign(new Error('injected final rename failure'), { code: 'EPERM' });
  });
  assert.throws(() => candidate.prepare(candidate.source), (error) => error.code === 'CANDIDATE_PREPARATION_ROLLED_BACK' && error.partial === false);
  assert.deepEqual(calls, [{ bytes: 'reviewed lock\n', directory: candidate.source }]);
  assert.deepEqual(candidate.snapshot(), before);
  assert.equal(fs.readdirSync(candidate.source).some((file) => file.startsWith('.pnpm-lock.yaml.dsh021-')), false);
});

test('021 preparation reports partial and preserves concurrent user content after rename failure', (t) => {
  const candidate = fixture(t);
  const lock = path.join(candidate.source, 'pnpm-lock.yaml');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to !== lock) return rename(from, to);
    fs.appendFileSync(path.join(candidate.source, 'pnpm-workspace.yaml'), '# concurrent user edit\n');
    fs.writeFileSync(path.join(candidate.source, 'user-notes.txt'), 'concurrent user notes');
    throw Object.assign(new Error('injected final rename failure'), { code: 'EPERM' });
  });
  assert.throws(() => candidate.prepare(candidate.source), (error) => error.code === 'CANDIDATE_PREPARATION_PARTIAL'
    && error.partial === true && error.promotionAllowed === false);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'upstream lock\n');
  assert.equal(fs.readFileSync(path.join(candidate.source, 'pnpm-workspace.yaml'), 'utf8'), `${afterWorkspace}# concurrent user edit\n`);
  assert.equal(fs.readFileSync(path.join(candidate.source, 'user-notes.txt'), 'utf8'), 'concurrent user notes');
  assert.equal(fs.readdirSync(candidate.source).some((file) => file.startsWith('.pnpm-lock.yaml.dsh021-')), false);
});

const additionFixture = (t) => fixture(t, { patch: workspacePatch + newFilePatch,
  addedFiles: [{ path: newFilePath, sha256: digest(newFileBytes) }] });

test('021 preparation adds only the pinned dependency patch', (t) => {
  const candidate = additionFixture(t);
  candidate.prepare(candidate.source);
  assert.equal(fs.readFileSync(path.join(candidate.source, newFilePath), 'utf8'), newFileBytes);
  assert.equal(candidate.snapshot().workspace, afterWorkspace);
});

test('021 preparation permits the reviewed private PowerShell source additions with exact postimages', (t) => {
  const additions = [newFilePath,
    'packages/subprocess/win32-process/src/extension-points.ts',
    'packages/sandbox/sandbox-windows-acl/src/private-console.ts',
    'packages/sandbox/sandbox-local/src/private-powershell.ts',
    'packages/sandbox/sandbox-windows-acl/src/pty-console.ts'];
  const candidate = fixture(t, {
    patch: workspacePatch + additions.map((relative) => newFilePatch.replaceAll(newFilePath, relative)).join(''),
    addedFiles: additions.map((relative) => ({ path: relative, sha256: digest(newFileBytes) }))
  });
  candidate.prepare(candidate.source);
  for (const relative of additions) assert.equal(fs.readFileSync(path.join(candidate.source, relative), 'utf8'), newFileBytes);
});

test('021 preparation refuses duplicate or unreviewed added source declarations', (t) => {
  for (const paths of [[newFilePath, newFilePath], ['packages/subprocess/win32-process/src/unreviewed.ts']]) {
    const candidate = fixture(t, { patch: workspacePatch,
      addedFiles: paths.map((relative) => ({ path: relative, sha256: digest(newFileBytes) })) });
    const before = candidate.snapshot();
    assert.throws(() => candidate.prepare(candidate.source), /Unsupported candidate added file/);
    assert.deepEqual(candidate.snapshot(), before);
  }
});

test('021 preparation rejects unlisted new files before source modification', (t) => {
  const candidate = fixture(t, { patch: workspacePatch + newFilePatch });
  const before = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source));
  assert.deepEqual(candidate.snapshot(), before);
  assert.equal(fs.existsSync(path.join(candidate.source, newFilePath)), false);
});

test('021 preparation rejects incorrect added-file postimage and preserves source', (t) => {
  const candidate = fixture(t, { patch: workspacePatch + newFilePatch.replace(newFileBytes, 'wrong bytes\n'),
    addedFiles: [{ path: newFilePath, sha256: digest(newFileBytes) }] });
  const before = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source), /postimage/);
  assert.deepEqual(candidate.snapshot(), before);
});

test('021 preparation preserves pre-existing ignored added-file target', (t) => {
  const candidate = additionFixture(t);
  fs.mkdirSync(path.join(candidate.source, 'patches'));
  fs.writeFileSync(path.join(candidate.source, newFilePath), 'pre-existing user content');
  fs.appendFileSync(path.join(candidate.source, '.git/info/exclude'), `\n${newFilePath}\n`);
  const before = candidate.snapshot();
  assert.throws(() => candidate.prepare(candidate.source));
  assert.deepEqual(candidate.snapshot(), before);
  assert.equal(fs.readFileSync(path.join(candidate.source, newFilePath), 'utf8'), 'pre-existing user content');
});

test('021 preparation rejects an added-file parent junction without external writes', (t) => {
  const candidate = additionFixture(t);
  const outside = path.join(candidate.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(candidate.source, 'patches'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.appendFileSync(path.join(candidate.source, '.git/info/exclude'), '\npatches\n');
  assert.throws(() => candidate.prepare(candidate.source));
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(candidate.snapshot().workspace, beforeWorkspace);
});

test('021 rollback removes only its unchanged newly created patch', (t) => {
  const candidate = additionFixture(t);
  const before = candidate.snapshot();
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to !== path.join(candidate.source, 'pnpm-lock.yaml')) return rename(from, to);
    throw new Error('injected final rename failure');
  });
  assert.throws(() => candidate.prepare(candidate.source), (error) => error.code === 'CANDIDATE_PREPARATION_ROLLED_BACK');
  assert.deepEqual(candidate.snapshot(), before);
  assert.equal(fs.existsSync(path.join(candidate.source, newFilePath)), false);
});

for (const replace of [false, true]) test(`021 rollback preserves ${replace ? 'replaced identity' : 'changed bytes'} of new patch`, (t) => {
  const candidate = additionFixture(t);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (to !== path.join(candidate.source, 'pnpm-lock.yaml')) return rename(from, to);
    const target = path.join(candidate.source, newFilePath);
    if (replace) {
      rename(target, path.join(candidate.root, 'original-created-patch'));
      fs.writeFileSync(target, newFileBytes);
    } else fs.appendFileSync(target, 'user edit\n');
    throw new Error('injected final rename failure');
  });
  assert.throws(() => candidate.prepare(candidate.source), (error) => error.code === 'CANDIDATE_PREPARATION_PARTIAL');
  assert.equal(fs.readFileSync(path.join(candidate.source, newFilePath), 'utf8'), replace ? newFileBytes : `${newFileBytes}user edit\n`);
  assert.equal(candidate.snapshot().lock, 'upstream lock\n');
});
