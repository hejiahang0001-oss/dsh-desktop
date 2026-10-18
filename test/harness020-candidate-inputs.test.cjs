const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { prepare, checkedBytes, digest, profile } = require('../scripts/prepare-harness020-candidate.cjs');

test('candidate inputs bind reviewed patch and security lock without changing production binding', () => {
  const bindingFile = path.resolve(__dirname, '../runtime/harness/package.json');
  const bindingBefore = fs.readFileSync(bindingFile);
  const root = path.resolve(__dirname, '../runtime/harness-020-candidate');
  checkedBytes(path.join(root, 'source.patch'), profile.patchSha256);
  checkedBytes(path.join(root, 'pnpm-lock.yaml'), profile.lockSha256);
  assert.equal(profile.version, '0.2.0-rc.2');
  assert.deepEqual(fs.readFileSync(bindingFile), bindingBefore);
});

test('020 preparation applies only isolated source inputs and preserves the current product binding bytes', t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dsh-020-preparation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), host = path.join(root, 'host');
  const inputs = path.join(host, 'runtime/harness-020-candidate');
  const production = path.join(host, 'runtime/harness/package.json');
  fs.mkdirSync(source); fs.mkdirSync(inputs, { recursive: true });
  fs.mkdirSync(path.dirname(production)); fs.mkdirSync(path.join(host, 'scripts'));
  const productBytes = fs.readFileSync(path.resolve(__dirname, '../runtime/harness/package.json'));
  fs.writeFileSync(production, productBytes);
  const beforeWorkspace = 'packages:\n  - packages/*\n';
  const afterWorkspace = `${beforeWorkspace}ignoredBuiltDependencies: []\n`;
  const patch = 'diff --git a/pnpm-workspace.yaml b/pnpm-workspace.yaml\n--- a/pnpm-workspace.yaml\n+++ b/pnpm-workspace.yaml\n@@ -1,2 +1,3 @@\n packages:\n   - packages/*\n+ignoredBuiltDependencies: []\n';
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: profile.version, packageManager: profile.packageManager }));
  fs.writeFileSync(path.join(source, 'pnpm-lock.yaml'), 'upstream lock\n');
  fs.writeFileSync(path.join(source, 'pnpm-workspace.yaml'), beforeWorkspace);
  const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${path.join(root, 'no-hooks')}`, '-C', source, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '--quiet');
  // The legacy preparer invokes Git itself, so pin the fixture's local setting
  // rather than relying on -c options used only while creating this checkout.
  git('config', 'core.autocrlf', 'false');
  git('add', '--all');
  git('-c', 'user.name=DSH Candidate Test', '-c', 'user.email=dsh-candidate-test@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  const pinned = { ...profile, commit: git('rev-parse', 'HEAD').trim(), patchSha256: digest(patch),
    upstreamLockSha256: digest('upstream lock\n'), upstreamWorkspaceSha256: digest(beforeWorkspace),
    workspaceSha256: digest(afterWorkspace), lockSha256: digest('reviewed lock\n') };
  fs.writeFileSync(path.join(inputs, 'profile.json'), JSON.stringify(pinned));
  fs.writeFileSync(path.join(inputs, 'source.patch'), patch);
  fs.writeFileSync(path.join(inputs, 'pnpm-lock.yaml'), 'reviewed lock\n');
  const copy = path.join(host, 'scripts/prepare-harness020-candidate.cjs');
  fs.copyFileSync(path.resolve(__dirname, '../scripts/prepare-harness020-candidate.cjs'), copy);
  t.after(() => { delete require.cache[copy]; });
  assert.deepEqual(require(copy).prepare(source), { version: profile.version, commit: pinned.commit, installed: false, published: false });
  assert.equal(fs.readFileSync(path.join(source, 'pnpm-workspace.yaml'), 'utf8'), afterWorkspace);
  assert.equal(fs.readFileSync(path.join(source, 'pnpm-lock.yaml'), 'utf8'), 'reviewed lock\n');
  assert.deepEqual(fs.readFileSync(production), productBytes);
});
test('candidate preparation refuses relative paths and the desktop checkout', () => {
  assert.throws(() => prepare('.'), /absolute/);
  assert.throws(() => prepare(path.resolve(__dirname, '..')), /commit mismatch/);
});
test('candidate digest verification rejects tampered bytes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-candidate-input-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'input');
  fs.writeFileSync(file, 'reviewed');
  assert.equal(checkedBytes(file, digest(Buffer.from('reviewed'))).toString(), 'reviewed');
  fs.writeFileSync(file, 'changed');
  assert.throws(() => checkedBytes(file, digest(Buffer.from('reviewed'))), /digest mismatch/);
});
