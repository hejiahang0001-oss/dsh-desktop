const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const policy = require('../runtime/harness-security/overrides.json');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const renderWorkspace = (bytes) => {
  if (digest(bytes) !== policy.upstreamWorkspaceSha256) throw new Error('Upstream workspace policy differs from the reviewed source.');
  const text = bytes.toString('utf8');
  const entries = Object.entries(policy.overrides).map(([name, version]) => `  '${name}': '${version}'`).join('\n');
  return text.replace('overrides:\n', `overrides:\n  # DSH Desktop exact security fixes; upstream application sources are unchanged.\n${entries}\n`);
};
const applySecurity = ({ sourceRoot, prepare = false }) => {
  const workspace = path.join(sourceRoot, 'pnpm-workspace.yaml');
  const lock = path.join(sourceRoot, 'pnpm-lock.yaml');
  const nextWorkspace = renderWorkspace(fs.readFileSync(workspace));
  if (digest(fs.readFileSync(lock)) !== policy.upstreamLockSha256) throw new Error('Upstream lock differs from the reviewed source.');
  const reviewedLock = path.resolve(__dirname, '../runtime/harness-security/pnpm-lock.yaml');
  const lockBytes = prepare ? null : fs.readFileSync(reviewedLock);
  if (!prepare && digest(lockBytes) !== policy.lockSha256) throw new Error('Desktop security lock digest mismatch.');
  fs.writeFileSync(workspace, nextWorkspace);
  if (lockBytes) fs.writeFileSync(lock, lockBytes);
  return { revision: policy.revision, overrides: policy.overrides, workspaceSha256: digest(Buffer.from(nextWorkspace)), lockSha256: lockBytes ? digest(lockBytes) : null };
};
const verifySecurity = (sourceRoot) => {
  for (const [file, expected] of [['pnpm-workspace.yaml', policy.workspaceSha256], ['pnpm-lock.yaml', policy.lockSha256]]) {
    if (digest(fs.readFileSync(path.join(sourceRoot, file))) !== expected) throw new Error(`Security build input changed: ${file}`);
  }
  return { revision: policy.revision, overrides: policy.overrides, workspaceSha256: policy.workspaceSha256, lockSha256: policy.lockSha256 };
};
if (require.main === module) {
  try {
    const sourceRoot = process.argv.find((arg) => arg.startsWith('--source-root='))?.slice(14);
    if (!sourceRoot || !path.isAbsolute(sourceRoot)) throw new Error('An absolute source-root is required.');
    console.log(JSON.stringify(applySecurity({ sourceRoot, prepare: process.argv.includes('--prepare') })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { applySecurity, verifySecurity, renderWorkspace, digest, policy };
