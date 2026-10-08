// Opt-in input preparation only. Never promotes a runtime or edits user profiles.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const inputRoot = path.resolve(__dirname, '../runtime/harness-021-candidate');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refuseLinks = (target, allowMissing = false) => {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info;
    try { info = fs.lstatSync(current); } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error('Linked candidate input or source refused.');
  }
};
const regularBytes = (file) => {
  refuseLinks(file);
  const info = fs.lstatSync(file);
  if (!info.isFile()) throw new Error('Candidate input must be a regular file.');
  if (info.nlink !== 1) throw new Error('Hard-linked candidate input or source refused.');
  return fs.readFileSync(file);
};
const checkedBytes = (file, expected) => {
  const bytes = regularBytes(file);
  if (digest(bytes) !== expected) throw new Error(`Candidate digest mismatch: ${path.basename(file)}`);
  return bytes;
};
const absentPath = (file) => {
  refuseLinks(file, true);
  try { fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Pre-existing added candidate path refused.');
};
const profile = Object.freeze(JSON.parse(regularBytes(path.join(inputRoot, 'profile.json'))));
const gitAt = (root, args, input) => execFileSync('git', ['-c', 'core.autocrlf=false', '-C', root, ...args], {
  encoding: 'utf8', windowsHide: true, stdio: 'pipe', ...(input === undefined ? {} : { input })
});

const preflightPatch = (root, patch) => {
  const additions = profile.addedFiles || [];
  const permittedAdditions = new Set([
    'patches/http-cache-semantics@4.3.0.patch',
    'packages/subprocess/win32-process/src/extension-points.ts',
    'packages/sandbox/sandbox-windows-acl/src/private-console.ts',
    'packages/sandbox/sandbox-local/src/private-powershell.ts',
    'packages/sandbox/sandbox-windows-acl/src/pty-console.ts'
  ]);
  if (!Array.isArray(additions) || additions.length > permittedAdditions.size || additions.some((entry) =>
    !entry || !permittedAdditions.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256))
    || new Set(additions.map((entry) => entry.path)).size !== additions.length) {
    throw new Error('Unsupported candidate added file.');
  }
  const added = new Map(additions.map((entry) => [entry.path, entry.sha256]));
  for (const [relative, hash] of added) checkedBytes(path.join(inputRoot, relative), hash);
  const entries = gitAt(root, ['apply', '--numstat', '-z', '-'], patch).split('\0').filter(Boolean);
  const paths = entries.map((entry) => {
    const match = /^\d+\t\d+\t(.+)$/.exec(entry);
    const relative = match?.[1];
    if (!relative || relative.includes('\\') || relative.includes(':') || path.isAbsolute(relative)
      || relative.split('/').some((part) => !part || part === '..' || part === '.')
      || relative === 'pnpm-lock.yaml') throw new Error('Unsupported candidate patch target.');
    return relative;
  });
  if (!paths.length || new Set(paths).size !== paths.length) throw new Error('Invalid candidate patch targets.');
  if ([...added.keys()].some((relative) => !paths.includes(relative))) throw new Error('Pinned added file missing from candidate patch.');
  const parent = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(parent, 'dsh-harness021-preflight-'));
  try {
    const before = new Map();
    for (const relative of paths) {
      if (added.has(relative)) {
        absentPath(path.join(root, relative));
        before.set(relative, null);
        continue;
      }
      const bytes = regularBytes(path.join(root, relative));
      before.set(relative, digest(bytes));
      const file = path.join(temporary, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes, { flag: 'wx' });
    }
    gitAt(temporary, ['apply', '--check', '-'], patch);
    gitAt(temporary, ['apply', '-'], patch);
    checkedBytes(path.join(temporary, 'pnpm-workspace.yaml'), profile.workspaceSha256);
    const after = new Map(paths.map((relative) => [relative, digest(regularBytes(path.join(temporary, relative)))]));
    for (const [relative, hash] of added) {
      if (after.get(relative) !== hash) throw new Error('Added file postimage does not match pinned input.');
    }
    return { before, after };
  } finally {
    if (path.dirname(temporary) !== parent || !path.basename(temporary).startsWith('dsh-harness021-preflight-')
      || fs.lstatSync(temporary).isSymbolicLink()) throw new Error('Unsafe preflight cleanup refused.');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
};

const prepare = (sourceRoot) => {
  if (!path.isAbsolute(sourceRoot || '')) throw new Error('An absolute source-root is required.');
  refuseLinks(sourceRoot);
  const root = fs.realpathSync(sourceRoot);
  const git = (...args) => gitAt(root, args);
  if (fs.realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) throw new Error('Source must be the checkout root.');
  let stagedLock;
  let stagedIdentity;
  const lockPath = path.join(root, 'pnpm-lock.yaml');
  const status = () => git('status', '--porcelain', '--untracked-files=all').split(/\r?\n/)
    .filter((line) => line && line !== `?? ${path.basename(stagedLock || '')}`).sort();
  const checkSource = () => {
    refuseLinks(root);
    if (git('rev-parse', 'HEAD').trim() !== profile.commit) throw new Error('Candidate source commit mismatch.');
    const manifest = JSON.parse(regularBytes(path.join(root, 'package.json')));
    if (manifest.version !== profile.version || manifest.packageManager !== profile.packageManager) throw new Error('Candidate source identity mismatch.');
    checkedBytes(lockPath, profile.upstreamLockSha256);
    checkedBytes(path.join(root, 'pnpm-workspace.yaml'), profile.upstreamWorkspaceSha256);
    if (status().length) throw new Error('Candidate source must be clean; existing changes preserved.');
  };
  checkSource();
  const patch = checkedBytes(path.join(inputRoot, 'source.patch'), profile.patchSha256);
  const lock = checkedBytes(path.join(inputRoot, 'pnpm-lock.yaml'), profile.lockSha256);
  // Derive exact before/after hashes from only the reviewed patch targets.
  gitAt(root, ['apply', '--check', '-'], patch);
  const images = preflightPatch(root, patch);
  const addedIdentities = new Map();
  const assertBeforeImage = () => {
    for (const [relative, hash] of images.before) {
      if (hash === null) absentPath(path.join(root, relative));
      else checkedBytes(path.join(root, relative), hash);
    }
  };
  checkSource();
  const assertAppliedState = () => {
    if (git('rev-parse', 'HEAD').trim() !== profile.commit) throw new Error('Source HEAD changed.');
    checkedBytes(lockPath, profile.upstreamLockSha256);
    for (const [relative, hash] of images.after) checkedBytes(path.join(root, relative), hash);
    for (const [relative, identity] of addedIdentities) {
      const current = fs.lstatSync(path.join(root, relative));
      if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Added candidate file identity changed.');
    }
    const expected = [...images.after.keys()].map((relative) => `${images.before.get(relative) === null ? '??' : ' M'} ${relative}`).sort();
    if (JSON.stringify(status()) !== JSON.stringify(expected)) throw new Error('Source changes exceed the reviewed patch.');
  };
  let applied = false;
  try {
    stagedLock = path.join(root, `.pnpm-lock.yaml.dsh021-${randomUUID()}.tmp`);
    const descriptor = fs.openSync(stagedLock, 'wx');
    try {
      stagedIdentity = fs.fstatSync(descriptor);
      fs.writeFileSync(descriptor, lock);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    checkedBytes(stagedLock, profile.lockSha256);
    checkSource();
    assertBeforeImage();
    gitAt(root, ['apply', '--check', '-'], patch);
    // Once application starts, an I/O failure may leave a partial tree.
    applied = true;
    gitAt(root, ['apply', '-'], patch);
    for (const [relative, hash] of images.before) {
      if (hash === null) addedIdentities.set(relative, fs.lstatSync(path.join(root, relative)));
    }
    assertAppliedState();
    checkedBytes(stagedLock, profile.lockSha256);
    fs.renameSync(stagedLock, lockPath);
  } catch (error) {
    if (!applied) throw error;
    try {
      // Never restore stored bytes over a user's concurrent edits. Reverse only
      // an unchanged, precisely known postimage with the original lock intact.
      assertAppliedState();
      gitAt(root, ['apply', '--reverse', '--check', '-'], patch);
      assertAppliedState();
      gitAt(root, ['apply', '--reverse', '-'], patch);
      assertBeforeImage();
      checkSource();
    } catch (rollbackError) {
      const partial = new Error(`Candidate preparation partial: ${error.message}; source preserved for inspection: ${rollbackError.message}`, { cause: error });
      partial.code = 'CANDIDATE_PREPARATION_PARTIAL';
      partial.partial = true;
      partial.promotionAllowed = false;
      throw partial;
    }
    const restored = new Error(`Candidate preparation failed; reviewed patch rolled back and original lock preserved: ${error.message}`, { cause: error });
    restored.code = 'CANDIDATE_PREPARATION_ROLLED_BACK';
    restored.partial = false;
    throw restored;
  } finally {
    if (stagedLock && stagedIdentity) {
      let info;
      try { info = fs.lstatSync(stagedLock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (info && path.dirname(stagedLock) === root && /^\.pnpm-lock\.yaml\.dsh021-[a-f0-9-]+\.tmp$/.test(path.basename(stagedLock))
        && info.isFile() && !info.isSymbolicLink() && info.nlink === 1
        && info.dev === stagedIdentity.dev && info.ino === stagedIdentity.ino) fs.unlinkSync(stagedLock);
    }
  }
  return { version: profile.version, commit: profile.commit, installed: false, published: false, promotionAllowed: false };
};

if (require.main === module) {
  try {
    const root = process.argv.find((arg) => arg.startsWith('--source-root='))?.slice(14);
    console.log(JSON.stringify(prepare(root)));
  } catch (error) {
    console.error(error.partial ? JSON.stringify({ error: error.message, partial: true, installed: false, published: false, promotionAllowed: false }) : error.message);
    process.exitCode = 1;
  }
}
module.exports = { prepare, checkedBytes, digest, profile };
