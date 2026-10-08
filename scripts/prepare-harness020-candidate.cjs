// Opt-in build input preparation only. Never promotes a runtime or edits user profiles.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const inputRoot = path.resolve(__dirname, '../runtime/harness-020-candidate');
const profile = require('../runtime/harness-020-candidate/profile.json');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const checkedBytes = (file, expected) => {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Linked candidate input refused.');
  const bytes = fs.readFileSync(file);
  if (digest(bytes) !== expected) throw new Error(`Candidate digest mismatch: ${path.basename(file)}`);
  return bytes;
};
const prepare = (sourceRoot) => {
  if (!path.isAbsolute(sourceRoot || '')) throw new Error('An absolute source-root is required.');
  const root = fs.realpathSync(sourceRoot);
  // Prevent a subdirectory from resolving to the desktop repository itself.
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  if (fs.realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) throw new Error('Source must be the checkout root.');
  if (git('rev-parse', 'HEAD').trim() !== profile.commit) throw new Error('Candidate source commit mismatch.');
  if (git('status', '--porcelain', '--untracked-files=all').trim()) throw new Error('Candidate source must be clean; existing changes preserved.');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.version !== profile.version || manifest.packageManager !== profile.packageManager) throw new Error('Candidate source identity mismatch.');
  const patch = path.join(inputRoot, 'source.patch');
  checkedBytes(patch, profile.patchSha256);
  const lock = checkedBytes(path.join(inputRoot, 'pnpm-lock.yaml'), profile.lockSha256);
  checkedBytes(path.join(root, 'pnpm-lock.yaml'), profile.upstreamLockSha256);
  checkedBytes(path.join(root, 'pnpm-workspace.yaml'), profile.upstreamWorkspaceSha256);
  git('apply', '--check', patch);
  git('apply', patch);
  checkedBytes(path.join(root, 'pnpm-workspace.yaml'), profile.workspaceSha256);
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), lock);
  return { version: profile.version, commit: profile.commit, installed: false, published: false };
};
if (require.main === module) {
  try {
    const root = process.argv.find((arg) => arg.startsWith('--source-root='))?.slice(14);
    console.log(JSON.stringify(prepare(root)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare, checkedBytes, digest, profile };
