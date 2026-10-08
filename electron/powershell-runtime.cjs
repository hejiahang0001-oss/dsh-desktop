const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = '7.6.6';
const MANIFEST = 'runtime-manifest.json';
const MAX_FILES = 10_000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const invalid = () => Object.assign(new Error('lulu 私有 PowerShell 运行时缺失或完整性检查失败，请修复安装。'), { code: 'POWERSHELL_RUNTIME_INVALID' });
const requireValid = (value) => { if (!value) throw invalid(); };

function refuseLinkedParents(directory) {
  requireValid(typeof directory === 'string' && path.isAbsolute(directory));
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    requireValid(stat.isDirectory() && !stat.isSymbolicLink());
  }
  return absolute;
}

function regularBytes(file, maxBytes) {
  const before = fs.lstatSync(file);
  requireValid(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= maxBytes);
  const sameFile = (stat) => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
    && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size
    && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs;
  const descriptor = fs.openSync(file, 'r');
  try {
    requireValid(sameFile(fs.fstatSync(descriptor)));
    // A concurrently growing file must not cause an unbounded path read.
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (!read) break;
      length += read;
    }
    requireValid(length === before.size && sameFile(fs.fstatSync(descriptor)) && sameFile(fs.lstatSync(file)));
    return buffer.subarray(0, length);
  } finally { fs.closeSync(descriptor); }
}

function validRelative(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 512
    && !/[\\:\u0000-\u001f\u007f]/.test(name)
    && name.split('/').every((part) => part && part !== '.' && part !== '..'
      && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

// The profile comes from packaged application code, never a renderer or cwd.
// Validate the entire DLL/config/notice payload before exposing its fixed exe.
function inspectPowerShellRuntime(directory, profile) {
  try {
    requireValid(profile?.version === VERSION && SHA256.test(profile.manifestSha256)
      && SHA256.test(profile.executableSha256));
    const root = refuseLinkedParents(directory);
    const manifestBytes = regularBytes(path.join(root, MANIFEST), 4 * 1024 * 1024);
    requireValid(digest(manifestBytes) === profile.manifestSha256);
    const entries = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
    requireValid(Array.isArray(entries) && entries.length > 0 && entries.length <= MAX_FILES);
    const expected = new Map();
    let bytes = 0;
    for (const entry of entries) {
      requireValid(validRelative(entry.path) && entry.path.toLowerCase() !== MANIFEST
        && SHA256.test(entry.sha256) && Number.isSafeInteger(entry.size) && entry.size >= 0);
      const key = entry.path.toLowerCase();
      requireValid(!expected.has(key));
      expected.set(key, entry);
      bytes += entry.size;
      requireValid(bytes <= MAX_BYTES);
    }
    for (const required of ['pwsh.exe', 'license.txt', 'thirdpartynotices.txt', 'pwsh.runtimeconfig.json']) requireValid(expected.has(required));
    requireValid(expected.get('pwsh.exe').sha256 === profile.executableSha256);
    const queue = [root], seen = new Set();
    let count = 0;
    while (queue.length) {
      const current = queue.pop();
      for (const name of fs.readdirSync(current)) {
        requireValid(++count <= MAX_FILES * 2);
        const file = path.join(current, name), stat = fs.lstatSync(file);
        requireValid(!stat.isSymbolicLink());
        if (stat.isDirectory()) { queue.push(file); continue; }
        const relative = path.relative(root, file).split(path.sep).join('/');
        if (relative === MANIFEST) continue;
        const key = relative.toLowerCase(), entry = expected.get(key);
        requireValid(entry && entry.path === relative && !seen.has(key));
        const content = regularBytes(file, entry.size);
        requireValid(content.length === entry.size && digest(content) === entry.sha256);
        seen.add(key);
      }
    }
    requireValid(seen.size === expected.size);
    return Object.freeze({ runtimeDir: root, executable: path.join(root, 'pwsh.exe'), version: VERSION, fileCount: seen.size, bytes });
  } catch {
    // Do not expose user/system paths or arbitrary manifest content in UI logs.
    throw invalid();
  }
}

function resolvePowerShellRuntime({ rootDir, resourcesPath, isPackaged }) {
  try {
    requireValid(typeof isPackaged === 'boolean');
    const parent = isPackaged ? resourcesPath : rootDir;
    requireValid(typeof parent === 'string' && path.isAbsolute(parent));
    const directory = isPackaged
      ? path.join(parent, 'powershell', VERSION, 'win32-x64')
      : path.join(parent, 'vendor', 'powershell', VERSION, 'win32-x64');
    return inspectPowerShellRuntime(directory, require('../runtime/powershell/profile.json'));
  } catch { throw invalid(); }
}

module.exports = { inspectPowerShellRuntime, resolvePowerShellRuntime };
