'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { NATIVE_CHECKS, hashFile, readInputs, validateEvidence, scanTree, deployReviewedHarnessRuntime } = require('../scripts/deploy-reviewed-harness-runtime.cjs');

const sha = value => createHash('sha256').update(value).digest('hex');
function write(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}
function inventory(root) {
  return scanTree(root).filter(item => !item.identity.directory && item.relative !== 'desktop-runtime.json')
    .map(item => ({ path: item.relative, bytes: item.identity.size, sha256: hashFile(path.join(root, item.relative)) }));
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-reviewed-deploy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = '0.2.1-alpha.1', sourceRuntime = 'artifacts/source/dsh', source = path.join(root, sourceRuntime);
  const officeDirectory = 'node_modules/office';
  write(source, 'package.json', { name: 'fixture', version });
  write(source, 'node_modules/payload.js', 'fixture runtime code');
  write(source, `${officeDirectory}/office.dll`, 'fixture native office');
  const officeFile = write(source, `${officeDirectory}/prebuilds.json`, { files: { 'office.dll': sha('fixture native office') } });
  const descriptor = { files: inventory(source) };
  const descriptorPath = write(source, 'desktop-runtime.json', descriptor);
  const binding = { repository: 'https://example.test/repo', tag: `dsh-v${version}`, commit: 'f'.repeat(40), packageVersion: version,
    distribution: 'official-desktop-runtime', runtimeDirectory: `harness-desktop-${version}`,
    descriptor: { file: 'desktop-runtime.json', sha256: hashFile(descriptorPath) },
    node: { version: '24.19.0', sha256: sha('fixture node') }, powerShell: { version: '7.6.6' } };
  const profile = { schemaVersion: 1, channel: 'local-candidate', promotionAllowed: false, version, sourceRuntime,
    runtimeDirectory: binding.runtimeDirectory, descriptor: binding.descriptor, runtimeFiles: descriptor.files.length,
    runtimeBytes: descriptor.files.reduce((sum, item) => sum + item.bytes, 0), sharedPackages: 1,
    office: { engine: 'win32-x64', directory: officeDirectory, manifest: 'prebuilds.json', manifestSha256: hashFile(officeFile), files: 1 },
    powerShell: { version: '7.6.6', directory: 'vendor/powershell/7.6.6/win32-x64' }, inputs: {} };
  const input = (name, value, relative = `evidence/${name}.json`) => {
    profile.inputs[name] = { path: relative, sha256: hashFile(write(root, relative, value)) };
  };
  input('sourcePatch', 'fixture patch', 'evidence/source.patch');
  input('sourceLock', 'fixture source lock', 'evidence/source-lock.yaml');
  input('sourceWorkspace', 'fixture workspace', 'evidence/source-workspace.yaml');
  input('productionLock', 'fixture production lock', 'evidence/production-lock.yaml');
  input('node', 'fixture node', 'vendor/runtime/win32-x64/node.exe');
  input('powerShellManifest', [], `${profile.powerShell.directory}/runtime-manifest.json`);
  input('powerShellExecutable', 'fixture pwsh', `${profile.powerShell.directory}/pwsh.exe`);
  input('powerShellProfile', { version: '7.6.6', sourceDirectory: profile.powerShell.directory,
    manifestSha256: profile.inputs.powerShellManifest.sha256, executableSha256: profile.inputs.powerShellExecutable.sha256 });
  input('sourceProfile', { version, promotionAllowed: false, repository: binding.repository, tag: binding.tag, commit: binding.commit,
    patchSha256: profile.inputs.sourcePatch.sha256, lockSha256: profile.inputs.sourceLock.sha256,
    workspaceSha256: profile.inputs.sourceWorkspace.sha256, packageManager: 'pnpm@11.7.0' });
  input('lockReport', { ok: true, sourceUnchanged: true, lockSha256: profile.inputs.productionLock.sha256 });
  input('installation', { stage: 'install', code: 0, ok: true, childClosed: true, inputsUnchanged: true, scriptsDisabled: true,
    node: 'v24.19.0', pnpm: '11.7.0', lockBefore: profile.inputs.productionLock.sha256, lockAfter: profile.inputs.productionLock.sha256 });
  input('materialization', { ok: true, runtime: source, sourceAndBuildInputsUnchanged: true, formalPromotionAllowed: false,
    descriptorSha256: profile.descriptor.sha256, runtimeFiles: profile.runtimeFiles, runtimeBytes: profile.runtimeBytes,
    sharedPackages: 1, officeManifestFilesVerified: 1, officeEngine: 'win32-x64' });
  input('nativeVerification', { runtime: source, nativeRuntimeVerified: true, inputsUnchanged: true, descriptorUnchanged: true,
    materializedSha: profile.inputs.materialization.sha256, verificationScope: 'fixture-native-components',
    worker: { ok: true, plainNode: 'v24.19.0', checks: NATIVE_CHECKS.map(name => ({ name, ok: true })) },
    job: { rootExit: { code: 0, activeProcesses: 0 }, empty: { activeProcesses: 0 }, guardianExit: { code: 0 } },
    powershell: { version: '7.6.6', runtimeDir: path.join(root, profile.powerShell.directory) } });
  input('hostAcceptance', { ok: true, runtimeRoot: source, installedDependenciesVerified: true, nativeRuntimeVerified: true,
    electronVerified: false, completeHostVerified: false, installedApplicationVerified: false, published: false,
    descriptorSha256: profile.descriptor.sha256, sourceProfileSha256: profile.inputs.sourceProfile.sha256,
    sourcePatchSha256: profile.inputs.sourcePatch.sha256, productionLockSha256: profile.inputs.productionLock.sha256,
    productionLockReportSha256: profile.inputs.lockReport.sha256, nodeSha256: profile.inputs.node.sha256,
    nativeVerificationScope: 'fixture-native-components', evidence: ['materialization', 'nativeVerification', 'installation', 'lockReport']
      .map(key => ({ file: path.join(root, profile.inputs[key].path), sha256: profile.inputs[key].sha256 })) });
  const oldFile = write(root, 'vendor/old-runtime/user-preserved.txt', 'old bytes');
  const calls = [];
  const verifyRuntime = async directory => {
    calls.push(directory);
    assert.equal(hashFile(path.join(directory, 'desktop-runtime.json')), profile.descriptor.sha256);
    assert.deepEqual(inventory(directory), descriptor.files, 'Fixture whole-tree integrity mismatch');
    return { verified: true };
  };
  let shellChecks = 0;
  const verifyPowerShell = async directory => {
    assert.equal(directory, path.join(root, profile.powerShell.directory)); shellChecks++;
  };
  return { root, source, binding, profile, verifyRuntime, verifyPowerShell, oldFile, calls,
    output: path.join(root, 'vendor', binding.runtimeDirectory), shellChecks: () => shellChecks };
}

test('deploys identical bytes through both verifications and preserves existing runtime', async t => {
  const f = fixture(t), result = await deployReviewedHarnessRuntime(f);
  assert.equal(result.ok, true); assert.equal(result.promotionAllowed, false); assert.equal(result.published, false);
  assert.deepEqual(inventory(f.output), inventory(f.source));
  assert.equal(fs.readFileSync(f.oldFile, 'utf8'), 'old bytes');
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0], f.source); assert.equal(f.shellChecks(), 2);
  assert.equal(fs.existsSync(path.join(f.output, 'harness-runtime.json')), false);
  assert.equal(hashFile(path.join(f.output, 'desktop-runtime.json')), f.profile.descriptor.sha256);
  assert.equal(readInputs(f.root, f.profile).sourceProfile.promotionAllowed, false);
});

test('refuses an existing output before copying or invoking the runtime verifier', async t => {
  const f = fixture(t); write(f.output, 'sentinel.txt', 'preserved');
  await assert.rejects(deployReviewedHarnessRuntime(f), /overwrite/);
  assert.equal(fs.readFileSync(path.join(f.output, 'sentinel.txt'), 'utf8'), 'preserved');
  assert.equal(f.calls.length, 0);
});

for (const mutation of ['extra', 'missing', 'modified', 'descriptor']) test(`rejects ${mutation} reviewed runtime bytes before staging`, async t => {
  const f = fixture(t), payload = path.join(f.source, 'node_modules/payload.js');
  if (mutation === 'extra') write(f.source, 'unexpected.txt', 'extra');
  else if (mutation === 'missing') fs.unlinkSync(payload);
  else if (mutation === 'modified') fs.appendFileSync(payload, 'altered');
  else fs.appendFileSync(path.join(f.source, 'desktop-runtime.json'), ' ');
  await assert.rejects(deployReviewedHarnessRuntime(f));
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(fs.readdirSync(path.join(f.root, 'vendor')).some(name => name.includes('.staging-')), false);
});

test('rejects fixed Node, historical profile, lock and PowerShell input drift', async t => {
  const f = fixture(t);
  for (const name of ['node', 'sourceProfile', 'productionLock', 'powerShellManifest', 'powerShellExecutable']) {
    const file = path.join(f.root, f.profile.inputs[name].path), body = fs.readFileSync(file);
    fs.appendFileSync(file, 'changed');
    await assert.rejects(deployReviewedHarnessRuntime(f), /Reviewed input changed/);
    fs.writeFileSync(file, body);
  }
  assert.equal(fs.existsSync(f.output), false);
});

test('acceptance booleans cannot hide failed or missing native components and unclosed processes', t => {
  const f = fixture(t), original = readInputs(f.root, f.profile);
  const mutations = [
    r => { r.nativeVerification.nativeRuntimeVerified = false; },
    r => { r.nativeVerification.worker.checks[0].ok = false; },
    r => { r.nativeVerification.worker.checks.pop(); },
    r => { r.nativeVerification.job.empty.activeProcesses = 1; },
    r => { r.nativeVerification.job.guardianExit.code = 1; },
    r => { r.nativeVerification.descriptorUnchanged = false; },
    r => { r.sourceProfile.promotionAllowed = true; },
    r => { r.hostAcceptance.nativeRuntimeVerified = false; },
    r => { r.hostAcceptance.evidence.pop(); },
  ];
  for (const mutate of mutations) {
    const records = structuredClone(original); mutate(records);
    assert.throws(() => validateEvidence(f.root, f.profile, f.binding, records));
  }
});

test('refuses source hard links and junctions without copying external payload', async t => {
  const f = fixture(t), payload = path.join(f.source, 'node_modules/payload.js');
  const alias = path.join(f.root, 'alias.js'); fs.linkSync(payload, alias);
  await assert.rejects(deployReviewedHarnessRuntime(f), /Linked/); fs.unlinkSync(alias);
  const external = path.join(f.root, 'external'); write(external, 'private.txt', 'not part of the runtime');
  fs.symlinkSync(external, path.join(f.source, 'external-link'), 'junction');
  await assert.rejects(deployReviewedHarnessRuntime(f), /Linked/);
  assert.equal(fs.existsSync(f.output), false);
});

test('refuses linked destination ancestors', async t => {
  const f = fixture(t), moved = path.join(f.root, 'real-vendor');
  fs.renameSync(path.join(f.root, 'vendor'), moved);
  fs.symlinkSync(moved, path.join(f.root, 'vendor'), 'junction');
  await assert.rejects(deployReviewedHarnessRuntime(f), /Linked/);
  assert.equal(f.calls.length, 0);
});

test('retains failed staging and leaves the formal target absent', async t => {
  const f = fixture(t), verify = f.verifyRuntime;
  f.verifyRuntime = async directory => {
    await verify(directory);
    if (directory !== f.source) throw new Error('fixture destination rejection');
  };
  let failure;
  try { await deployReviewedHarnessRuntime(f); } catch (error) { failure = error; }
  assert.match(failure.message, /destination rejection/);
  assert.ok(fs.statSync(failure.stagingDirectory).isDirectory());
  assert.equal(fs.existsSync(f.output), false);
  assert.equal(fs.readFileSync(f.oldFile, 'utf8'), 'old bytes');
});

test('detects source changes while destination verification is pending', async t => {
  const f = fixture(t), verify = f.verifyRuntime;
  f.verifyRuntime = async directory => {
    await verify(directory);
    if (directory !== f.source) write(f.source, 'late-file.txt', 'concurrent write');
  };
  await assert.rejects(deployReviewedHarnessRuntime(f), /source tree changed/);
  assert.equal(fs.existsSync(f.output), false);
});

test('detects verified staging changes during the final PowerShell check', async t => {
  const f = fixture(t), verify = f.verifyPowerShell;
  f.verifyPowerShell = async (...args) => {
    await verify(...args);
    if (f.calls.length === 2) write(f.calls[1], 'late-file.txt', 'concurrent write');
  };
  await assert.rejects(deployReviewedHarnessRuntime(f), /staging tree changed/);
  assert.equal(fs.existsSync(f.output), false);
});
