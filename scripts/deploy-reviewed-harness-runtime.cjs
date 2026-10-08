'use strict';

// Copies an already reviewed official tree. No install, rebuild, network or in-tree provenance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const MAX_ENTRIES = 50_000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const NATIVE_CHECKS = [
  'natural HCS/MCP production entries', 'sharp native pixel encode/decode', 'Koffi and node-addon entry',
  'Office real DOCX/XLSX/PPTX native conversion', 'actual built restricted PTY cancel/reuse/disposal',
];
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

function inside(root, name) {
  assert.ok(typeof name === 'string' && name.length > 0 && name.length <= 1024
    && !/[\\:\u0000-\u001f\u007f]/.test(name) && !path.isAbsolute(name)
    && name.split('/').every(part => part && part !== '.' && part !== '..'
      && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), 'Invalid deployment path');
  return path.join(root, ...name.split('/'));
}

function unlinkedParents(directory) {
  const absolute = path.resolve(directory);
  for (let current = absolute; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Linked or non-directory deployment parent');
    if (current === path.dirname(current)) break;
  }
  return absolute;
}

function fingerprint(file) {
  const stat = fs.lstatSync(file);
  assert.ok(!stat.isSymbolicLink() && (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)), 'Linked or non-regular deployment entry');
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, directory: stat.isDirectory() };
}

function hashFile(file) {
  unlinkedParents(path.dirname(file));
  const before = fingerprint(file);
  assert.ok(!before.directory && before.size <= MAX_BYTES, 'Invalid deployment file size');
  const hash = createHash('sha256'), fd = fs.openSync(file, 'r');
  let length = 0;
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.ino === before.ino && stat.dev === before.dev && stat.nlink === 1, 'Deployment input replaced');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      length += bytes;
      assert.ok(length <= before.size, 'Deployment input grew');
      hash.update(buffer.subarray(0, bytes));
    }
    assert.equal(length, before.size, 'Deployment input truncated');
    assert.deepEqual(fingerprint(file), before, 'Deployment input changed');
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function readInputs(root, profile) {
  const records = {};
  for (const [name, input] of Object.entries(profile.inputs)) {
    assert.match(input.sha256, /^[a-f0-9]{64}$/);
    const file = inside(root, input.path);
    assert.equal(hashFile(file), input.sha256, `Reviewed input changed: ${name}`);
    if (input.path.endsWith('.json')) {
      assert.ok(fs.statSync(file).size <= 16 * 1024 * 1024, 'Oversized deployment evidence');
      const bytes = fs.readFileSync(file);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256, `Reviewed JSON changed: ${name}`);
      records[name] = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    }
  }
  return records;
}

function validateEvidence(root, profile, binding, records) {
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.channel, 'local-candidate');
  assert.equal(profile.promotionAllowed, false);
  assert.equal(profile.version, binding.packageVersion);
  assert.equal(profile.runtimeDirectory, binding.runtimeDirectory);
  assert.equal(binding.distribution, 'official-desktop-runtime');
  assert.deepEqual(profile.descriptor, binding.descriptor);
  assert.equal(profile.inputs.node.sha256, binding.node.sha256);
  assert.equal(profile.powerShell.version, binding.powerShell.version);
  const { sourceProfile: source, hostAcceptance: acceptance, materialization: materialized,
    nativeVerification: native, installation: install, lockReport: lock, powerShellProfile: shell } = records;
  assert.equal(source.version, profile.version);
  assert.equal(source.promotionAllowed, false, 'Historical candidate must remain unpromoted');
  for (const key of ['repository', 'tag', 'commit']) assert.equal(source[key], binding[key]);
  assert.equal(source.patchSha256, profile.inputs.sourcePatch.sha256);
  assert.equal(source.lockSha256, profile.inputs.sourceLock.sha256);
  assert.equal(source.workspaceSha256, profile.inputs.sourceWorkspace.sha256);
  assert.equal(shell.version, binding.powerShell.version);
  assert.equal(shell.sourceDirectory, profile.powerShell.directory);
  assert.equal(shell.manifestSha256, profile.inputs.powerShellManifest.sha256);
  assert.equal(shell.executableSha256, profile.inputs.powerShellExecutable.sha256);
  assert.equal(acceptance.ok, true);
  assert.equal(acceptance.installedDependenciesVerified, true);
  assert.equal(acceptance.nativeRuntimeVerified, true);
  for (const key of ['electronVerified', 'completeHostVerified', 'installedApplicationVerified', 'published']) assert.equal(acceptance[key], false);
  for (const [field, input] of Object.entries({ sourceProfileSha256: 'sourceProfile', sourcePatchSha256: 'sourcePatch',
    productionLockSha256: 'productionLock', productionLockReportSha256: 'lockReport', nodeSha256: 'node' })) {
    assert.equal(acceptance[field], profile.inputs[input].sha256);
  }
  const runtime = inside(root, profile.sourceRuntime);
  for (const actual of [acceptance.runtimeRoot, materialized.runtime, native.runtime]) assert.ok(samePath(actual, runtime), 'Evidence runtime mismatch');
  assert.equal(acceptance.descriptorSha256, profile.descriptor.sha256);
  for (const key of ['materialization', 'nativeVerification', 'installation', 'lockReport']) {
    assert.ok(acceptance.evidence.some(item => samePath(item.file, inside(root, profile.inputs[key].path))
      && item.sha256 === profile.inputs[key].sha256), `Acceptance lacks ${key}`);
  }
  assert.equal(materialized.ok, true);
  assert.equal(materialized.sourceAndBuildInputsUnchanged, true);
  assert.equal(materialized.formalPromotionAllowed, false);
  assert.equal(materialized.descriptorSha256, profile.descriptor.sha256);
  for (const key of ['runtimeFiles', 'runtimeBytes', 'sharedPackages']) assert.equal(materialized[key], profile[key]);
  assert.equal(materialized.officeManifestFilesVerified, profile.office.files);
  assert.equal(materialized.officeEngine, profile.office.engine);
  assert.equal(lock.ok, true); assert.equal(lock.sourceUnchanged, true);
  for (const actual of [lock.lockSha256, install.lockBefore, install.lockAfter]) assert.equal(actual, profile.inputs.productionLock.sha256);
  assert.equal(install.stage, 'install'); assert.equal(install.code, 0);
  for (const key of ['ok', 'childClosed', 'inputsUnchanged', 'scriptsDisabled']) assert.equal(install[key], true);
  assert.equal(install.node, `v${binding.node.version}`); assert.equal(install.pnpm, source.packageManager.replace('pnpm@', ''));
  assert.equal(native.nativeRuntimeVerified, true);
  assert.equal(native.inputsUnchanged, true); assert.equal(native.descriptorUnchanged, true);
  assert.equal(native.materializedSha, profile.inputs.materialization.sha256);
  assert.equal(native.verificationScope, acceptance.nativeVerificationScope);
  assert.equal(native.worker.ok, true);
  assert.deepEqual(native.worker.checks.map(check => check.name).sort(), [...NATIVE_CHECKS].sort());
  assert.ok(native.worker.checks.every(check => check.ok === true), 'Native component check failed');
  assert.equal(native.worker.plainNode, `v${binding.node.version}`);
  assert.equal(native.job.rootExit.code, 0); assert.equal(native.job.rootExit.activeProcesses, 0);
  assert.equal(native.job.empty.activeProcesses, 0); assert.equal(native.job.guardianExit.code, 0);
  assert.equal(native.powershell.version, shell.version);
  assert.ok(samePath(native.powershell.runtimeDir, inside(root, profile.powerShell.directory)));
  require('./reviewed-source-chain.cjs').validateReviewedSourceChain({ root, profile, binding, records, inside, hashFile });
}

function scanTree(root) {
  unlinkedParents(root);
  const entries = [], names = new Set(); let bytes = 0;
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = path.relative(root, file).split(path.sep).join('/');
      inside(root, relative);
      assert.ok(!names.has(relative.toLowerCase()), 'Case-colliding deployment paths'); names.add(relative.toLowerCase());
      assert.ok(entries.length < MAX_ENTRIES, 'Too many deployment entries');
      const identity = fingerprint(file);
      entries.push({ relative, identity });
      if (identity.directory) visit(file);
      else { bytes += identity.size; assert.ok(bytes <= MAX_BYTES, 'Deployment tree too large'); }
    }
  };
  visit(root); return entries;
}

function verifyOffice(runtime, office) {
  const directory = inside(runtime, office.directory), manifest = inside(directory, office.manifest);
  assert.equal(hashFile(manifest), office.manifestSha256, 'Full Office manifest changed');
  const entries = Object.entries(JSON.parse(fs.readFileSync(manifest, 'utf8')).files);
  assert.equal(entries.length, office.files, 'Full Office payload missing');
  for (const [name, expected] of entries) assert.equal(hashFile(inside(directory, name)), expected, 'Full Office file changed');
}

async function deployReviewedHarnessRuntime({ root, profile, binding, verifyRuntime, verifyPowerShell }) {
  root = unlinkedParents(root);
  assert.equal(typeof verifyRuntime, 'function'); assert.equal(typeof verifyPowerShell, 'function');
  const before = readInputs(root, profile);
  validateEvidence(root, profile, binding, before);
  const source = inside(root, profile.sourceRuntime), vendor = unlinkedParents(path.join(root, 'vendor'));
  assert.ok(!profile.runtimeDirectory.includes('/'), 'Runtime output must be a direct vendor child');
  const output = inside(vendor, profile.runtimeDirectory);
  assert.equal(fs.existsSync(output), false, 'Refusing to overwrite an existing runtime');
  await verifyPowerShell(inside(root, profile.powerShell.directory), before.powerShellProfile);
  assert.equal(hashFile(inside(source, profile.descriptor.file)), profile.descriptor.sha256);
  await verifyRuntime(source);
  verifyOffice(source, profile.office);
  const sourceRoot = fingerprint(source), vendorRoot = fingerprint(vendor), plan = scanTree(source);
  const staging = fs.mkdtempSync(`${output}.staging-`);
  const stagingIdentity = fingerprint(staging);
  try {
    for (const item of plan) {
      const file = inside(source, item.relative), target = inside(staging, item.relative);
      assert.deepEqual(fingerprint(file), item.identity, 'Reviewed source changed during deployment');
      unlinkedParents(path.dirname(file)); unlinkedParents(path.dirname(target));
      if (item.identity.directory) fs.mkdirSync(target);
      else fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      assert.deepEqual(fingerprint(file), item.identity, 'Reviewed source changed during deployment');
    }
    assert.deepEqual(scanTree(source), plan, 'Reviewed source tree changed during deployment');
    assert.deepEqual(fingerprint(source), sourceRoot, 'Reviewed source root replaced');
    const stagingPlan = scanTree(staging), stagingRoot = fingerprint(staging);
    assert.equal(stagingRoot.dev, stagingIdentity.dev); assert.equal(stagingRoot.ino, stagingIdentity.ino);
    assert.equal(hashFile(inside(staging, profile.descriptor.file)), profile.descriptor.sha256);
    await verifyRuntime(staging);
    assert.deepEqual(readInputs(root, profile), before, 'Reviewed evidence changed during deployment');
    await verifyPowerShell(inside(root, profile.powerShell.directory), before.powerShellProfile);
    assert.deepEqual(scanTree(source), plan, 'Reviewed source tree changed before promotion');
    assert.deepEqual(fingerprint(source), sourceRoot, 'Reviewed source root replaced');
    assert.deepEqual(scanTree(staging), stagingPlan, 'Verified staging tree changed');
    assert.deepEqual(fingerprint(staging), stagingRoot, 'Verified staging root replaced');
    unlinkedParents(vendor);
    const vendorAfter = fingerprint(vendor);
    assert.equal(vendorAfter.dev, vendorRoot.dev); assert.equal(vendorAfter.ino, vendorRoot.ino);
    assert.equal(fs.existsSync(output), false, 'Runtime target appeared during deployment');
    fs.renameSync(staging, output);
    return { ok: true, channel: profile.channel, promotionAllowed: false, output, source,
      descriptorSha256: profile.descriptor.sha256, runtimeFiles: profile.runtimeFiles,
      runtimeBytes: profile.runtimeBytes, sharedPackages: profile.sharedPackages,
      officialTreeVerified: true, fullOfficeVerified: true, privatePowerShellVerified: true,
      electronVerified: false, installedApplicationVerified: false, published: false };
  } catch (error) { error.stagingDirectory = staging; throw error; }
}

async function main(args) {
  assert.equal(args.length, 0, 'This fixed-input deployment command accepts no arguments');
  const root = path.resolve(__dirname, '..');
  const profile = require('../runtime/harness-desktop-021/deployment.json');
  const binding = require('../runtime/harness/package.json').dshDesktop;
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  assert.equal(process.version, `v${binding.node.version}`);
  assert.ok(samePath(fs.realpathSync(process.execPath), inside(root, profile.inputs.node.path)), 'Use the project-pinned Node executable');
  const { verifyHarnessDesktopRuntime } = require('../electron/harness-desktop-runtime.cjs');
  const { inspectPowerShellRuntime } = require('../electron/powershell-runtime.cjs');
  const result = await deployReviewedHarnessRuntime({ root, profile, binding,
    verifyRuntime: verifyHarnessDesktopRuntime, verifyPowerShell: inspectPowerShellRuntime });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { NATIVE_CHECKS, inside, hashFile, readInputs, validateEvidence, scanTree, verifyOffice, deployReviewedHarnessRuntime };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message, stagingDirectory: error.stagingDirectory })}\n`);
  process.exitCode = 1;
});
