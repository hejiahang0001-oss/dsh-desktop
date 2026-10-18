'use strict';

// Versioned admission of real controlled-build receipts. Never rewrites historical evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const SHA256 = /^[a-f0-9]{64}$/;
const PACK_STAGES = ['pack-dsh', 'pack-host', 'pack-vendor', 'native-ts', 'pack-native-entry', 'select-packages'];
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function relativePath(root, file, inside) {
  assert.equal(typeof file, 'string');
  const relative = path.isAbsolute(file) ? path.relative(root, file).split(path.sep).join('/') : file;
  const full = inside(root, relative);
  assert.ok(samePath(full, path.isAbsolute(file) ? file : path.join(root, file)), 'Evidence path redirected');
  return relative;
}

// pnpm build inputs may be hardlinked. This does NOT relax the deployed tree's single-link guard.
function readEvidence(root, file, inside, limit = 128 * 1024 * 1024) {
  const full = inside(root, relativePath(root, file, inside));
  for (let parent = path.dirname(full); ; parent = path.dirname(parent)) {
    const stat = fs.lstatSync(parent);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Linked evidence ancestor');
    if (parent === path.dirname(parent)) break;
  }
  const before = fs.lstatSync(full);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= limit, 'Invalid evidence file');
  const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.nlink];
  const fd = fs.openSync(full, 'r');
  try {
    assert.deepEqual(identity(fs.fstatSync(fd)), identity(before), 'Evidence replaced');
    const bytes = fs.readFileSync(fd);
    assert.equal(bytes.length, before.size);
    assert.deepEqual(identity(fs.fstatSync(fd)), identity(before), 'Evidence changed');
    assert.deepEqual(identity(fs.lstatSync(full)), identity(before), 'Evidence replaced');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function checkMap(context, values, base = context.root) {
  assert.ok(values && typeof values === 'object' && !Array.isArray(values));
  const entries = Object.entries(values);
  assert.ok(entries.length > 0 && entries.length <= 50000, 'Empty or excessive evidence map');
  const names = new Set();
  for (const [file, expected] of entries) {
    assert.match(expected, SHA256);
    let full = path.isAbsolute(file) ? file : context.inside(base, file.replaceAll('\\', '/'));
    const relative = relativePath(context.root, full, context.inside);
    assert.ok(!names.has(relative.toLowerCase()), 'Case-colliding evidence inputs'); names.add(relative.toLowerCase());
    const tool = /^(artifacts\/upstream-checks\/\d{4}-\d{2}-\d{2}\/toolchain\/node_modules)\/pnpm\/(.+)$/.exec(relative);
    if (tool) {
      const version = context.records.sourceProfile.packageManager.replace(/^pnpm@/, '');
      const expectedPath = context.inside(context.root, `${tool[1]}/.pnpm/pnpm@${version}/node_modules/pnpm/${tool[2]}`);
      full = fs.realpathSync(full);
      assert.ok(samePath(full, expectedPath), 'Build pnpm resolves outside its fixed package');
    }
    assert.equal(digest(readEvidence(context.root, full, context.inside)), expected, `Bound evidence changed: ${relative}`);
  }
}

function input(context, name) {
  const value = context.profile.inputs[name];
  assert.ok(value, `Missing v2 evidence: ${name}`); assert.match(value.sha256, SHA256);
  assert.equal(digest(readEvidence(context.root, value.path, context.inside)), value.sha256, `Reviewed v2 input changed: ${name}`);
  return value;
}

function reference(context, ref, name) {
  const expected = input(context, name);
  assert.equal(relativePath(context.root, ref.path, context.inside), expected.path);
  assert.equal(ref.sha256, expected.sha256);
}

function successfulStage(context, stage) {
  assert.equal(stage.code, 0); assert.equal(stage.signal, null); assert.equal(stage.childClosed, true);
  for (const key of ['timedOut', 'spawnError', 'terminationError', 'terminatedOwnedPid', 'terminationRequestedForOwnedPid']) assert.ok(!stage[key], `Unsuccessful stage: ${key}`);
  assert.ok(Date.parse(stage.finishedAt) >= Date.parse(stage.startedAt), 'Invalid stage timestamps');
  assert.deepEqual(Object.keys(stage.logs).sort(), ['stderr', 'stdout']);
  for (const log of Object.values(stage.logs)) {
    assert.match(log.sha256, SHA256);
    assert.equal(digest(readEvidence(context.root, log.path, context.inside)), log.sha256, 'Stage log changed');
  }
}

function packageBytes(context, set) {
  const bytes = readEvidence(context.root, set.path, context.inside);
  assert.equal(digest(bytes), set.sha256, 'Package-set descriptor changed');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(set.count, set.packages.length); assert.ok(set.count > 0 && set.count <= 5000);
  const stripped = set.packages.map(({ sha256, ...entry }) => entry);
  assert.deepEqual(manifest.packages, stripped, 'Package descriptor and receipt differ');
  const names = new Set(), files = new Set();
  const result = [];
  for (const item of set.packages) {
    assert.equal(typeof item.name, 'string'); assert.equal(typeof item.version, 'string');
    assert.match(item.file, /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/);
    assert.ok(!names.has(item.name) && !files.has(item.file.toLowerCase()), 'Duplicate package');
    names.add(item.name); files.add(item.file.toLowerCase());
    const file = path.join(path.dirname(context.inside(context.root, relativePath(context.root, set.path, context.inside))), 'desktop-packages', item.file);
    const body = readEvidence(context.root, file, context.inside);
    assert.equal(body.length, item.bytes); assert.match(item.sha256, SHA256);
    assert.equal(digest(body), item.sha256); assert.equal(`sha512-${digest(body, 'sha512', 'base64')}`, item.integrity);
    result.push({ item, body });
  }
  return { bytes, packages: result };
}

function validateControlledSourceChain(context) {
  const { root, profile, binding, records, inside } = context;
  const pin = binding.reviewedSourceChain;
  assert.equal(profile.schemaVersion, 2); assert.equal(pin.schemaVersion, 2);
  if (pin.receiptFormat === 'source-frozen-v1') {
    return require('./reviewed-source-frozen-v1.cjs').validateSourceFrozenChain(context);
  }
  assert.equal(pin.receiptFormat, undefined, 'Unknown controlled source receipt format');
  const { sourceBuild: build, sourcePack: pack, sourceIntegration: integration, sourceProfile: source } = records;
  for (const [name, field] of [['sourceBuild', 'sourceBuildSha256'], ['sourcePack', 'sourcePackSha256'], ['sourceIntegration', 'sourceIntegrationSha256']]) {
    assert.equal(pin[field], input(context, name).sha256, `Missing fixed ${name} pin`);
  }
  assert.equal(source.schemaVersion, 2); assert.equal(source.postimageSha256, profile.inputs.sourceIntegration.sha256);
  assert.equal(integration.ok, true);
  for (const key of ['tag', 'commit', 'repository']) assert.equal(integration.identity[key], binding[key]);
  const expectedIdentity = { tag: binding.tag, version: binding.packageVersion, commit: binding.commit,
    pnpm: source.packageManager.replace(/^pnpm@/, ''), node: `v${binding.node.version}` };
  for (const [record, kind] of [[build, 'build'], [pack, 'pack']]) {
    assert.equal(record.schemaVersion, 2); assert.equal(record.type, `controlled-harness-${kind}`); assert.equal(record.stage, kind);
    assert.deepEqual(record.identity, expectedIdentity);
    for (const key of ['ok', 'inputsUnchanged', 'childClosed']) assert.equal(record[key], true);
    assert.equal(record.code, 0); assert.equal(record.signal, null);
    assert.deepEqual(record.before, record.after, 'Source changed during controlled build/pack');
    for (const stage of record.stages) successfulStage(context, stage);
  }
  assert.equal(build.completeSourceProjection, true); assert.equal(build.generatedClientRecordExcludedFromSourceProjection, true);
  assert.deepEqual(build.stages.map(item => item.name), ['build:official']);
  assert.deepEqual(pack.stages.map(item => item.name), PACK_STAGES);
  assert.deepEqual(build.after, pack.before, 'Pack does not consume the controlled build');
  assert.ok(samePath(build.source, pack.source));
  reference(context, pack.buildReceipt, 'sourceBuild');
  assert.equal(build.clientBuildRecordSha256, pack.clientBuildRecordSha256);
  assert.deepEqual(build.clientBuild, pack.clientBuild);
  assert.equal(digest(readEvidence(root, path.join(build.source, '.dsh-build/client-build-environment.json'), inside)), build.clientBuildRecordSha256);
  const projection = build.after;
  assert.equal(projection.schemaVersion, 2); assert.deepEqual(projection.identity, expectedIdentity);
  assert.equal(projection.source, relativePath(root, build.source, inside));
  assert.equal(projection.nodeVersion, expectedIdentity.node); assert.equal(projection.pnpmVersion, expectedIdentity.pnpm);
  assert.deepEqual(Object.keys(projection.files).sort(), [...projection.tracked, ...projection.untracked].sort());
  assert.equal(new Set([...projection.tracked, ...projection.untracked]).size, Object.keys(projection.files).length);
  assert.ok(!Object.hasOwn(projection.files, '.dsh-build/client-build-environment.json'), 'Generated output cannot be frozen source');
  const postimages = [...integration.files, ...integration.protected];
  assert.equal(new Set(postimages.map(item => item.path)).size, postimages.length);
  assert.deepEqual(Object.keys(projection.reviewedPostimagesAndProtected).sort(), postimages.map(item => item.path).sort());
  for (const item of postimages) {
    assert.equal(item.matches ?? item.unchanged, true); assert.equal(item.expectedSha256 ?? item.sha256, item.sha256);
    assert.equal(projection.files[item.path], item.sha256); assert.equal(projection.reviewedPostimagesAndProtected[item.path], item.sha256);
  }
  checkMap(context, projection.files, inside(root, projection.source)); checkMap(context, projection.fixed);
  assert.ok(Array.isArray(source.patchChain) && source.patchChain.length > 0 && source.patchChain.length <= 32);
  assert.equal(new Set(source.patchChain.map(patch => patch.path.toLowerCase())).size, source.patchChain.length, 'Duplicate source patch');
  for (const patch of source.patchChain) { assert.match(patch.sha256, SHA256); assert.equal(digest(readEvidence(root, patch.path, inside)), patch.sha256); }
  const newBytes = packageBytes(context, pack.packageSet);
  const preparation = records.preparationEvidence; input(context, 'preparationEvidence');
  const deployedSet = input(context, 'packageSet');
  if (profile.inputs.sourceEquivalence) {
    assert.equal(pin.sourceEquivalenceSha256, input(context, 'sourceEquivalence').sha256);
    const eq = records.sourceEquivalence, old = records.priorPack;
    assert.equal(eq.schemaVersion, 2); assert.equal(eq.type, 'harness-package-set-byte-equivalence');
    assert.deepEqual(eq.identity, expectedIdentity);
    for (const key of ['equivalent', 'descriptorBytesEqual', 'descriptorEqual', 'packagesEqual', 'oldReceiptAndPackageSetUnchanged', 'sourceBuildThenPackVerified']) assert.equal(eq[key], true);
    reference(context, eq.oldPack, 'priorPack'); reference(context, eq.newBuild, 'sourceBuild'); reference(context, eq.newPack, 'sourcePack');
    assert.equal(old.ok, true); assert.equal(old.packInputsUnchanged, true);
    assert.equal(old.before.buildRecordSha256, build.clientBuildRecordSha256, 'Historical preparation still requires its original build record');
    assert.deepEqual(eq.oldPackageSet, old.packageSet); assert.deepEqual(eq.newPackageSet, pack.packageSet);
    const oldBytes = packageBytes(context, old.packageSet);
    assert.equal(oldBytes.bytes.equals(newBytes.bytes), true, 'Descriptor not byte-equivalent');
    assert.deepEqual(old.packageSet.packages, pack.packageSet.packages, 'Package metadata not equivalent');
    assert.equal(eq.comparedPackages, newBytes.packages.length); assert.equal(eq.comparisons.length, newBytes.packages.length);
    for (let i = 0; i < newBytes.packages.length; i++) {
      assert.equal(oldBytes.packages[i].body.equals(newBytes.packages[i].body), true, 'TGZ not byte-equivalent');
      const entry = eq.comparisons[i]; assert.equal(entry.name, newBytes.packages[i].item.name);
      assert.deepEqual(entry.old, oldBytes.packages[i].item); assert.deepEqual(entry.current, newBytes.packages[i].item);
      assert.equal(entry.bytesEqual, true); assert.equal(entry.metadataEqual, true);
    }
    reference(context, preparation.packReceipt, 'priorPack');
    assert.equal(deployedSet.sha256, old.packageSet.sha256);
  } else {
    assert.equal(pin.sourceEquivalenceSha256, undefined); assert.equal(profile.inputs.priorPack, undefined);
    reference(context, preparation.packReceipt, 'sourcePack');
    assert.equal(deployedSet.sha256, pack.packageSet.sha256);
  }
  assert.equal(deployedSet.sha256, pack.packageSet.sha256, 'Installed package set differs from reviewed build');
  assert.deepEqual(records.packageSet.packages, pack.packageSet.packages.map(({ sha256, ...entry }) => entry));
}

module.exports = { validateControlledSourceChain, readEvidence, checkMap, input, reference, relativePath, packageBytes, digest, samePath };
