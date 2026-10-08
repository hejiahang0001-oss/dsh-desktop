'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const official = require('../runtime/harness-official/runtime-tree.cjs');
const manifest = require('../runtime/harness/package.json');

const freeze = value => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
// This is a reviewed product-candidate identity, never an automatic release approval.
const PRODUCT_BINDING = freeze(structuredClone(manifest.dshDesktop));
const HARNESS_VERSION = manifest.version;
const HARNESS_RUNTIME_DIRECTORY = PRODUCT_BINDING.runtimeDirectory;
const DESCRIPTOR_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 60_000;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DSH_MANIFEST = 'node_modules/@deepseek-ai/dsh/package.json';
const DSH_BIN = 'node_modules/@deepseek-ai/dsh/lib/bin.js';
const SHA256 = /^[a-f0-9]{64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const invalid = () => Object.assign(new Error('lulu 固定 Harness 运行库缺失或完整性检查失败，请修复安装。'), { code: 'HARNESS_DESKTOP_RUNTIME_INVALID' });
const requireValid = value => { if (!value) throw invalid(); };

function validRelative(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024
    && !/[\\:\u0000-\u001f\u007f<>"|?*]/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..'
      && !/[. ]$/.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part));
}

function plainParents(directory) {
  requireValid(typeof directory === 'string' && path.isAbsolute(directory));
  const root = path.resolve(directory);
  let current = path.parse(root).root;
  for (const segment of root.slice(current.length).split(path.sep).filter(Boolean)) {
    requireValid(validRelative(segment));
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    requireValid(stat.isDirectory() && !stat.isSymbolicLink());
  }
  return root;
}

function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.nlink}`;
}

function regularBytes(file, maxBytes) {
  plainParents(path.dirname(file));
  const before = fs.lstatSync(file);
  requireValid(before.isFile() && !before.isSymbolicLink() && before.nlink === 1
    && Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= maxBytes);
  const same = stat => stat.isFile() && !stat.isSymbolicLink() && fileIdentity(stat) === fileIdentity(before);
  const fd = fs.openSync(file, 'r');
  try {
    requireValid(same(fs.fstatSync(fd)));
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    requireValid(length === before.size && same(fs.fstatSync(fd)) && same(fs.lstatSync(file)));
    plainParents(path.dirname(file));
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}

function readRuntime(runtimeRoot) {
  requireValid(PRODUCT_BINDING.distribution === 'official-desktop-runtime'
    && PRODUCT_BINDING.package === '@deepseek-ai/dsh'
    && PRODUCT_BINDING.packageVersion === HARNESS_VERSION
    && PRODUCT_BINDING.descriptor.file === 'desktop-runtime.json'
    && SHA256.test(PRODUCT_BINDING.descriptor.sha256));
  const root = plainParents(runtimeRoot);
  const descriptorPath = path.join(root, PRODUCT_BINDING.descriptor.file);
  const descriptorBytes = regularBytes(descriptorPath, DESCRIPTOR_BYTES);
  requireValid(digest(descriptorBytes) === PRODUCT_BINDING.descriptor.sha256);
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  requireValid(descriptor.schemaVersion === 1 && descriptor.platform === 'win32' && descriptor.arch === 'x64'
    && descriptor.release?.schemaVersion === 1 && descriptor.release.version === HARNESS_VERSION
    && descriptor.release.nodeVersion === PRODUCT_BINDING.node.version
    && descriptor.release.pnpmVersion === '11.7.0' && descriptor.release.hostProtocolVersion === 4
    && Array.isArray(descriptor.sharedPackages) && Array.isArray(descriptor.files)
    && descriptor.files.length > 0 && descriptor.files.length <= MAX_FILES);
  const entries = new Map();
  const spellings = new Map();
  let totalBytes = 0;
  for (const entry of descriptor.files) {
    requireValid(entry && validRelative(entry.path) && entry.path.toLowerCase() !== PRODUCT_BINDING.descriptor.file
      && SHA256.test(entry.sha256) && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0
      && typeof entry.executable === 'boolean' && !entries.has(entry.path.toLowerCase()));
    const segments = entry.path.split('/');
    for (let index = 1; index <= segments.length; index += 1) {
      const part = segments.slice(0, index).join('/');
      const key = part.toLowerCase();
      requireValid(!spellings.has(key) || spellings.get(key) === part);
      spellings.set(key, part);
    }
    totalBytes += entry.bytes;
    requireValid(totalBytes <= MAX_PAYLOAD_BYTES);
    entries.set(entry.path.toLowerCase(), entry);
  }
  const boundBytes = (relative, maximum) => {
    const entry = entries.get(relative.toLowerCase());
    requireValid(entry && entry.path === relative && entry.bytes <= maximum);
    const bytes = regularBytes(path.join(root, ...relative.split('/')), entry.bytes);
    requireValid(bytes.length === entry.bytes && digest(bytes) === entry.sha256);
    return bytes;
  };
  const runtimeManifest = JSON.parse(boundBytes('package.json', 1024 * 1024).toString('utf8'));
  requireValid(runtimeManifest.name === '@deepseek-ai/dsh-desktop-runtime' && runtimeManifest.version === HARNESS_VERSION
    && runtimeManifest.dependencies?.['@deepseek-ai/dsh'] === HARNESS_VERSION);
  const dshManifest = JSON.parse(boundBytes(DSH_MANIFEST, 1024 * 1024).toString('utf8'));
  requireValid(dshManifest.name === PRODUCT_BINDING.package && dshManifest.version === HARNESS_VERSION);
  boundBytes(DSH_BIN, 8 * 1024 * 1024);
  requireValid(digest(regularBytes(descriptorPath, DESCRIPTOR_BYTES)) === PRODUCT_BINDING.descriptor.sha256);
  return Object.freeze({
    runtimeRoot: root,
    nodeModulesPath: path.join(root, 'node_modules'),
    dshBinPath: path.join(root, ...DSH_BIN.split('/')),
    version: HARNESS_VERSION,
    descriptorPath,
    descriptorSha256: PRODUCT_BINDING.descriptor.sha256,
    descriptor: freeze(descriptor),
    manifest: freeze(dshManifest),
    runtimeManifest: freeze(runtimeManifest)
  });
}

function readHarnessDesktopRuntime(runtimeRoot) {
  try { return readRuntime(runtimeRoot); }
  catch { throw invalid(); }
}

// Filesystem safety around the official algorithm. Hashing and exact inventory
// comparison remain exclusively owned by verifyDesktopRuntime below.
function snapshotTree(root) {
  plainParents(root);
  const queue = [root], snapshot = new Map(), spellings = new Set();
  while (queue.length) {
    const directory = queue.pop();
    plainParents(directory);
    const directoryStat = fs.lstatSync(directory);
    snapshot.set(directory, fileIdentity(directoryStat));
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      const relative = path.relative(root, file).split(path.sep).join('/');
      requireValid(validRelative(relative) && !spellings.has(relative.toLowerCase()) && spellings.size < MAX_FILES * 2);
      spellings.add(relative.toLowerCase());
      const stat = fs.lstatSync(file);
      requireValid(!stat.isSymbolicLink());
      if (stat.isDirectory()) queue.push(file);
      else {
        requireValid(stat.isFile() && stat.nlink === 1 && stat.size <= MAX_PAYLOAD_BYTES);
        snapshot.set(file, fileIdentity(stat));
      }
    }
  }
  return snapshot;
}

async function verifyHarnessDesktopRuntime(runtimeRoot) {
  try {
    const runtime = readRuntime(runtimeRoot);
    const before = snapshotTree(runtime.runtimeRoot);
    const verified = await official.verifyDesktopRuntime(runtime.runtimeRoot, HARNESS_VERSION, { platform: 'win32', arch: 'x64' });
    requireValid(JSON.stringify(verified) === JSON.stringify(runtime.descriptor));
    const after = snapshotTree(runtime.runtimeRoot);
    requireValid(before.size === after.size && [...before].every(([file, identity]) => after.get(file) === identity));
    readRuntime(runtime.runtimeRoot);
    return Object.freeze({ ...runtime, verified: true });
  } catch { throw invalid(); }
}

module.exports = { HARNESS_VERSION, HARNESS_RUNTIME_DIRECTORY, PRODUCT_BINDING, readHarnessDesktopRuntime, verifyHarnessDesktopRuntime };
