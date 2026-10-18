'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const { verifyHarnessDesktopRuntime } = require('../electron/harness-desktop-runtime.cjs');
const { verifyHarnessNode } = require('../electron/harness-launch-runtime.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function processHostDigest(file) {
  let fd;
  try {
    for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
      const parent = fs.lstatSync(directory);
      if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('linked parent');
      if (directory === path.dirname(directory)) break;
    }
    const before = fs.lstatSync(file);
    const same = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
      && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size
      && stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs;
    if (!same(before) || before.size < 1 || before.size > 1024 * 1024) throw new Error('invalid file');
    fd = fs.openSync(file, 'r');
    if (!same(fs.fstatSync(fd))) throw new Error('replaced file');
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    if (length !== before.size || !same(fs.fstatSync(fd)) || !same(fs.lstatSync(file))) throw new Error('changed file');
    return sha(bytes.subarray(0, length));
  } catch { throw new Error('Harness process host is missing or failed integrity verification.'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

async function verifyPackagedHarness({ appOutDir, electronPlatformName } = {}) {
  if (electronPlatformName !== 'win32') return Object.freeze({ verified: false, reason: 'non-windows' });
  if (typeof appOutDir !== 'string' || !path.isAbsolute(appOutDir)
    || path.resolve(appOutDir) === path.parse(appOutDir).root) throw new Error('Harness verification requires an absolute app output directory.');
  const root = path.resolve(__dirname, '..'), resourcesPath = path.join(appOutDir, 'resources');
  const archive = path.join(resourcesPath, 'app.asar'), info = fs.lstatSync(archive);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Untrusted application archive.');
  // Node executes this external bootstrap before it reaches the verified CLI.
  const processHostSha256 = processHostDigest(path.join(resourcesPath, 'harness-host/harness-process-host.cjs'));
  if (processHostSha256 !== processHostDigest(path.join(root, 'electron/harness-process-host.cjs'))) {
    throw new Error('Harness process host binding mismatch.');
  }
  const bindings = ['runtime/harness/package.json', 'electron/harness-desktop-runtime.cjs',
    'electron/harness-launch-runtime.cjs', 'electron/harness-supervisor.cjs'];
  const officialRoot = path.join(root, 'runtime/harness-official');
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile()) bindings.push(path.relative(root, file));
      else throw new Error('Linked official verifier source.');
    }
  }
  collect(officialRoot);
  for (const relative of bindings) {
    const packaged = asar.extractFile(archive, relative.split('/').join(path.sep));
    if (sha(packaged) !== sha(fs.readFileSync(path.join(root, relative)))) throw new Error(`Harness application binding mismatch: ${relative}`);
  }
  const result = await verifyHarnessDesktopRuntime(path.join(resourcesPath, 'harness'));
  await verifyHarnessNode(path.join(resourcesPath, 'runtime/node.exe'));
  return Object.freeze({ verified: true, version: result.version, descriptorSha256: result.descriptorSha256,
    fileCount: result.descriptor.files.length, sharedPackages: result.descriptor.sharedPackages.length,
    processHostVerified: true, processHostSha256 });
}

module.exports = { verifyPackagedHarness };
