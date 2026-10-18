'use strict';

// Admit the original schema1 receipts, without normalizing them into historical schema2 evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readEvidence, checkMap, input, reference, relativePath, packageBytes, digest } = require('./reviewed-source-chain-v2.cjs');
const SHA = /^[a-f0-9]{64}$/;
const POST_VERIFY = 'independent-post-verification-of-applied-replay';
const PACK_STAGES = ['pack-dsh', 'pack-host', 'pack-vendor', 'native-ts', 'pack-native-entry', 'select-packages'];
const nativeOutput = name => name === 'native/system/tsconfig.tsbuildinfo'
  || /^native\/system\/packages\/entry\/lib\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(name);
const plainMap = value => assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected evidence map');
const timestamp = (start, finish) => assert.ok(Number.isFinite(Date.parse(start)) && Date.parse(finish) >= Date.parse(start), 'Invalid receipt timestamps');
const full = (c, file) => c.inside(c.root, relativePath(c.root, file, c.inside));

function boundJson(c, ref) {
  assert.match(ref.sha256, SHA);
  const bytes = readEvidence(c.root, ref.path, c.inside);
  assert.equal(digest(bytes), ref.sha256, 'Bound receipt changed');
  return JSON.parse(bytes);
}
function sameReference(c, actual, expected) {
  assert.equal(relativePath(c.root, actual.path, c.inside), relativePath(c.root, expected.path, c.inside));
  assert.equal(actual.sha256, expected.sha256);
}
function sibling(c, name, file, sha256) {
  return { path: path.join(path.dirname(full(c, input(c, name).path)), file), sha256 };
}
function sourceManifest(c, receiptName, file, stat) {
  const map = boundJson(c, sibling(c, receiptName, file, stat.manifestSha256)); plainMap(map);
  assert.ok(Object.keys(map).length > 0 && Object.keys(map).length <= 50000);
  assert.equal(Object.keys(map).length, stat.count); assert.equal(digest(JSON.stringify(map)), stat.contentSha256);
  return map;
}
function outputManifest(c, receiptName, file, stat, compareToBuild = undefined) {
  const map = boundJson(c, sibling(c, receiptName, file, stat.manifestSha256)); plainMap(map);
  assert.ok(Object.keys(map).length > 0 && Object.keys(map).length <= 50000);
  assert.equal(Object.keys(map).length, stat.count);
  let bytes = 0;
  for (const [name, item] of Object.entries(map)) {
    c.inside(c.root, name); assert.match(item.sha256, SHA);
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0); bytes += item.bytes;
  }
  if (compareToBuild !== undefined) {
    // Raw pack receipts do not record a byte total here; their full before-map must equal the build's map.
    assert.deepEqual(map, compareToBuild, 'Pack input outputs differ from build');
    if (Object.hasOwn(stat, 'bytes')) assert.equal(bytes, stat.bytes);
  } else assert.equal(bytes, stat.bytes);
  return map;
}

function validateReplay(c, sourceMap, sourceRoot, identity) {
  const { sourceProfile: source, sourceIntegration: integration } = c.records, pin = source.lockReplay;
  assert.equal(Object.hasOwn(source, 'lockDerivation'), false, 'Raw replay provenance must not mix formats');
  assert.equal(pin.type, 'localized-patch-replay-on-new-official-lock');
  assert.ok(pin.verificationType === undefined || pin.verificationType === POST_VERIFY, 'Unknown replay verification type');
  assert.deepEqual(integration.lockReplay, pin); assert.deepEqual(integration.patchChain, source.patchChain);
  assert.ok(Array.isArray(source.patchChain) && source.patchChain.length > 0 && source.patchChain.length <= 32);
  assert.equal(new Set(source.patchChain.map(item => item.path.toLowerCase())).size, source.patchChain.length);
  for (const patch of source.patchChain) checkMap(c, { [patch.path]: patch.sha256 });
  const receipt = boundJson(c, pin), review = boundJson(c, { path: pin.reviewPath, sha256: pin.reviewSha256 });
  checkMap(c, { [pin.sourceReplayScriptPath]: pin.sourceReplayScriptSha256 });
  assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.ok, true); assert.deepEqual(receipt.identity, identity);
  assert.equal(full(c, receipt.source), sourceRoot); assert.equal(receipt.scriptSha256, pin.sourceReplayScriptSha256);
  assert.equal(receipt.lockSha256, source.lockSha256); assert.equal(receipt.lockSha256, pin.replayedLockSha256);
  assert.equal(receipt.workspaceSha256, source.workspaceSha256);
  assert.equal(receipt.upstreamLockSha256, source.upstreamLockSha256); assert.equal(receipt.upstreamLockSha256, pin.upstreamLockSha256);
  assert.equal(sourceMap['pnpm-lock.yaml'], source.lockSha256); assert.equal(sourceMap['pnpm-workspace.yaml'], source.workspaceSha256);
  assert.equal(review.schemaVersion, 1); sameReference(c, review.receipt, pin);
  for (const key of ['version', 'tag', 'commit']) assert.equal(review.identity[key], identity[key]);
  assert.deepEqual(review.findings.Blocking, []); assert.equal(review.status.patchReplayAndLockReviewPassed, true);
  for (const item of [receipt, review.status]) for (const key of ['buildVerified', 'runtimeDeployed', 'promotionAllowed']) assert.equal(item[key], false);
  assert.equal(review.status.installedOrPublishedByThisReview, false);
  assert.deepEqual(receipt.files, integration.files); assert.ok(integration.files.length > 0 && integration.files.length <= 50000);
  assert.equal(new Set(integration.files.map(item => item.path.toLowerCase())).size, integration.files.length);
  for (const item of integration.files) {
    c.inside(sourceRoot, item.path); assert.equal(item.matches, true); assert.match(item.sha256, SHA);
    assert.ok(item.preimageSha256 === null || SHA.test(item.preimageSha256));
    assert.equal(sourceMap[item.path], item.sha256, 'Reviewed source postimage differs');
  }
  assert.deepEqual(receipt.protectedBefore, receipt.protectedAfter);
  // These are historical formal inputs: do not demand equality after an explicitly validated Host transition.
  plainMap(receipt.protectedBefore);
  for (const [name, sha] of Object.entries(receipt.protectedBefore)) { c.inside(c.root, name); assert.match(sha, SHA); }
  if (pin.verificationType === undefined) {
    assert.equal(receipt.type, undefined); assert.equal(pin.originalFailureScope, undefined);
    assert.deepEqual(receipt.patches, source.patchChain.map(item => ({ ...item, check: true, applied: true })));
    return;
  }
  assert.equal(receipt.type, POST_VERIFY);
  for (const key of ['originalFailurePreserved', 'sourceInputsUnchanged']) assert.equal(receipt[key], true);
  for (const key of ['patchApplicationExecuted', 'sourceWriteExecuted', 'frozenInstallVerified']) assert.equal(receipt[key], false);
  assert.deepEqual(receipt.patches, source.patchChain);
  assert.equal(review.originalFailurePreserved, true); sameReference(c, review.originalFailedReplay, receipt.originalFailedReplay);
  const failure = boundJson(c, receipt.originalFailedReplay), scope = pin.originalFailureScope;
  assert.equal(scope.type, 'post-apply-source-metadata-assertion'); assert.match(scope.errorSha256, SHA);
  assert.equal(failure.schemaVersion, 1); assert.equal(failure.ok, false); assert.equal(typeof failure.error, 'string');
  assert.ok(failure.error.length > 0); assert.equal(digest(failure.error), scope.errorSha256, 'Failure scope changed');
  checkMap(c, { [scope.scriptPath]: scope.scriptSha256 }); assert.equal(failure.scriptSha256, scope.scriptSha256);
  assert.deepEqual(failure.identity, identity); assert.equal(full(c, failure.source), sourceRoot);
  assert.equal(scope.patchCount, source.patchChain.length); assert.equal(scope.fileCount, integration.files.length);
  assert.deepEqual(failure.patches, source.patchChain.map(item => ({ ...item, check: true, applied: true })));
  assert.deepEqual(failure.files, integration.files);
  for (const key of ['buildVerified', 'runtimeDeployed', 'promotionAllowed']) assert.equal(failure[key], false);
  for (const key of ['preimageTree', 'postimageTree']) { assert.match(receipt[key], /^[a-f0-9]{40}$/); assert.equal(failure[key], receipt[key]); }
  for (const key of ['upstreamChangedFiles', 'patchIntersections', 'protectedBefore']) assert.deepEqual(failure[key], receipt[key]);
  const before = boundJson(c, receipt.sourceBefore), after = boundJson(c, receipt.sourceAfter);
  assert.deepEqual(before, after); assert.deepEqual(after, sourceMap);
  assert.equal(Object.keys(before).length, receipt.sourceBefore.count); assert.equal(Object.keys(after).length, receipt.sourceAfter.count);
  assert.equal(receipt.lockComparison.equalToReviewedAlpha5ExceptFourOfficialImporters, true);
  assert.equal(receipt.lockComparison.existingChangesInDependencies, true); assert.equal(receipt.lockComparison.frozenInstallVerified, false);
}

function validateStages(c, build, pack, sourceRoot) {
  assert.deepEqual(build.stages.map(item => item.name), ['build:official']);
  assert.deepEqual(pack.stages.map(item => item.name), PACK_STAGES);
  const executable = input(c, 'node'); assert.equal(executable.sha256, c.binding.node.sha256);
  const pnpm = relativePath(c.root, build.stages[0].args[0], c.inside);
  assert.match(pnpm, /\/bin\/pnpm\.cjs$/); assert.match(build.fixedBefore[pnpm], SHA);
  const pnpmManifest = `${pnpm.slice(0, -'bin/pnpm.cjs'.length)}package.json`;
  assert.match(build.fixedBefore[pnpmManifest], SHA);
  // checkMap already restricts the one allowed pnpm alias to its exact fixed-version store path.
  const pnpmBytes = readEvidence(c.root, fs.realpathSync(full(c, pnpmManifest)), c.inside);
  assert.equal(digest(pnpmBytes), build.fixedBefore[pnpmManifest]);
  assert.equal(JSON.parse(pnpmBytes).version, c.records.sourceProfile.packageManager.replace(/^pnpm@/, ''));
  const run = path.dirname(full(c, c.profile.inputs.sourcePack.path)), out = family => path.join(run, 'packed', family);
  const expectedArgs = [
    ['run', 'build:official'],
    ['run', 'release:pack', '--family', 'dsh', '--out', out('dsh'), '--concurrency', '2'],
    ['--dir', 'apps/desktop-host', 'pack', '--pack-destination', out('dsh')],
    ['run', 'release:pack', '--family', 'vendor', '--out', out('vendor'), '--concurrency', '2'],
    ['--dir', 'native/system', 'run', 'build:ts'],
    ['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', out('landlock')],
    ['--dir', 'apps/desktop', 'exec', 'tsx', 'scripts/prepare-package-set.ts', '--from', out('dsh'), '--from', out('vendor'), '--from', out('landlock'), '--out', path.join(run, 'package-set')],
  ];
  const all = [...build.stages, ...pack.stages];
  for (const [index, stage] of all.entries()) {
    assert.equal(full(c, stage.executable), full(c, executable.path)); assert.equal(full(c, stage.cwd), sourceRoot);
    assert.equal(relativePath(c.root, stage.args[0], c.inside), pnpm); assert.deepEqual(stage.args.slice(1), expectedArgs[index]);
    assert.equal(stage.ok, true); assert.equal(stage.code, 0); assert.equal(stage.signal, null); assert.equal(stage.childClosed, true);
    assert.equal(stage.exit.code, 0); assert.equal(stage.exit.signal, null);
    const finish = index === 0 ? stage.closedAt : stage.finishedAt;
    timestamp(stage.startedAt, finish); timestamp(stage.startedAt, stage.exit.at);
    assert.ok(Date.parse(stage.exit.at) <= Date.parse(finish));
    for (const key of ['timedOut', 'spawnError', 'terminationError', 'terminatedOwnedPid', 'terminationRequestedForOwnedPid',
      'stopReason', 'lowDisk', 'diskInspectionError']) assert.ok(!stage[key]);
    assert.deepEqual(Object.keys(stage.logs).sort(), ['stderr', 'stdout']);
    for (const log of Object.values(stage.logs)) {
      const bytes = readEvidence(c.root, log.path, c.inside); assert.equal(bytes.length, log.bytes); assert.equal(digest(bytes), log.sha256);
    }
    if (index > 0) {
      assert.equal(stage.inputsUnchanged, true); assert.ok(Array.isArray(stage.generatedChanges));
      for (const name of stage.generatedChanges) assert.ok(stage.name === 'native-ts' && nativeOutput(name), 'Unexpected pack output mutation');
    }
  }
  const gate = build.stages[0]; assert.ok(gate.gates.length > 0);
  assert.equal(new Set(gate.gates.map(item => item.label)).size, gate.gates.length);
  for (const item of gate.gates) { assert.equal(item.started, true); assert.equal(item.status, 'passed'); }
  assert.equal(gate.summary.passed, gate.gates.length); assert.equal(gate.summary.failed, 0); assert.equal(gate.summary.skipped, 0);
}

function validateTree(c, sourceRoot, sources, outputs) {
  assert.ok(!Object.hasOwn(sources, '.dsh-build/client-build-environment.json'), 'Generated client record frozen as source');
  const expected = new Set([...Object.keys(sources), ...Object.keys(outputs)]);
  assert.equal(expected.size, Object.keys(sources).length + Object.keys(outputs).length, 'Source/output overlap');
  assert.equal(new Set([...expected].map(name => name.toLowerCase())).size, expected.size, 'Case-colliding source/output paths');
  const actual = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const name = prefix + entry.name, file = c.inside(sourceRoot, name);
      assert.ok(!entry.isSymbolicLink(), 'Linked source/output tree');
      if (entry.isDirectory()) walk(file, `${name}/`);
      else { assert.ok(entry.isFile()); actual.push(name); assert.ok(actual.length <= 100000); }
    }
  }
  walk(sourceRoot); assert.deepEqual(actual.sort(), [...expected].sort(), 'Unrecorded or missing source/output file');
  checkMap(c, sources, sourceRoot);
  for (const [name, item] of Object.entries(outputs)) {
    const bytes = readEvidence(c.root, c.inside(sourceRoot, name), c.inside);
    assert.equal(bytes.length, item.bytes); assert.equal(digest(bytes), item.sha256, 'Generated output changed');
  }
}

function validateSourceFrozenChain(c) {
  const { profile, binding, records } = c, pin = binding.reviewedSourceChain;
  assert.equal(profile.schemaVersion, 2); assert.equal(pin.schemaVersion, 2); assert.equal(pin.receiptFormat, 'source-frozen-v1');
  const { sourceBuild: build, sourcePack: pack, sourceProfile: source, sourceIntegration: integration } = records;
  for (const name of ['sourceBuild', 'sourcePack', 'sourceIntegration']) assert.equal(pin[`${name}Sha256`], input(c, name).sha256);
  input(c, 'sourceProfile'); assert.equal(source.schemaVersion, 2);
  const identity = { version: binding.packageVersion, tag: binding.tag, commit: binding.commit, repository: binding.repository };
  for (const [key, value] of Object.entries(identity)) assert.equal(source[key], value);
  assert.equal(source.promotionAllowed, false); assert.equal(source.preflightOnly, true);
  sameReference(c, { path: source.postimagePath, sha256: source.postimageSha256 }, profile.inputs.sourceIntegration);
  assert.equal(integration.schemaVersion, 1); assert.equal(integration.ok, true); assert.deepEqual(integration.identity, identity);
  for (const key of ['buildVerified', 'runtimeDeployed', 'promotionAllowed']) assert.equal(integration[key], false);
  const sourceRoot = full(c, build.source); assert.equal(full(c, pack.source), sourceRoot); assert.equal(full(c, integration.source), sourceRoot);
  for (const [record, kind] of [[build, 'build'], [pack, 'pack']]) {
    assert.equal(record.schemaVersion, 1); assert.equal(record.type, `source-frozen-${kind}-only`); assert.deepEqual(record.identity, identity);
    for (const key of ['ok', 'inputsUnchanged', 'fixedInputsUnchanged']) assert.equal(record[key], true);
    for (const key of ['installExecuted', 'runtimeDeployed', 'promotionAllowed', 'fullRuntimeAcceptance']) assert.equal(record[key], false);
    assert.deepEqual(record.verificationErrors, []); timestamp(record.startedAt, record.finishedAt);
    assert.equal(record.environment.offlinePackageManager, true); assert.equal(record.environment.ignoreLifecycleScripts, true);
    assert.equal(record.environment.inheritedCredentials, false); full(c, record.environment.isolatedHome);
  }
  assert.equal(build.packExecuted, false); assert.equal(pack.buildOfficialExecuted, false); assert.equal(pack.sourceEquivalenceClaimed, false);
  assert.deepEqual(build.changedInputs, []); assert.deepEqual(build.extraInputs, []);
  const sources = sourceManifest(c, 'sourceBuild', 'source-before.json', build.sourceBefore);
  for (const [name, record] of [['sourceBuild', build], ['sourcePack', pack]]) {
    assert.deepEqual(sourceManifest(c, name, 'source-before.json', record.sourceBefore), sources);
    assert.deepEqual(sourceManifest(c, name, 'source-after.json', record.sourceAfter), sources);
  }
  assert.deepEqual(build.fixedBefore, build.fixedAfter); checkMap(c, build.fixedAfter);
  for (const name of ['sourceProfile', 'sourceIntegration', 'node']) assert.equal(build.fixedBefore[profile.inputs[name].path], profile.inputs[name].sha256);
  for (const patch of source.patchChain) assert.equal(build.fixedBefore[patch.path], patch.sha256);
  const replay = source.lockReplay;
  for (const [file, sha] of [[replay.path, replay.sha256], [replay.reviewPath, replay.reviewSha256], [replay.sourceReplayScriptPath, replay.sourceReplayScriptSha256]]) {
    assert.equal(build.fixedBefore[file], sha, 'Build did not bind reviewed replay');
  }
  validateReplay(c, sources, sourceRoot, identity);
  validateStages(c, build, pack, sourceRoot);
  reference(c, pack.sourceBuild, 'sourceBuild');
  for (const [key, file, sha] of [['sourceBefore', 'source-before.json', build.sourceBefore.manifestSha256],
    ['sourceAfter', 'source-after.json', build.sourceAfter.manifestSha256], ['outputsAfter', 'outputs-after.json', build.outputs.manifestSha256]]) {
    sameReference(c, pack.buildManifests[key], sibling(c, 'sourceBuild', file, sha));
  }
  const built = outputManifest(c, 'sourceBuild', 'outputs-after.json', build.outputs);
  outputManifest(c, 'sourcePack', 'outputs-before.json', pack.outputsBefore, built);
  const packed = outputManifest(c, 'sourcePack', 'outputs-after.json', pack.outputs);
  const removed = Object.keys(built).filter(name => !Object.hasOwn(packed, name)); assert.deepEqual(removed, []);
  const changed = Object.keys(packed).filter(name => !Object.hasOwn(built, name) || JSON.stringify(built[name]) !== JSON.stringify(packed[name])).sort();
  assert.deepEqual([...pack.outputs.changed].sort(), changed);
  assert.deepEqual([...new Set(pack.stages.flatMap(item => item.generatedChanges))].sort(), changed);
  for (const name of changed) assert.ok(nativeOutput(name), 'Unreviewed build-to-pack output delta');
  validateTree(c, sourceRoot, sources, packed);
  const manifest = JSON.parse(readEvidence(c.root, path.join(sourceRoot, 'package.json'), c.inside));
  assert.equal(manifest.version, identity.version); assert.equal(manifest.packageManager, source.packageManager);
  assert.deepEqual(pack.clientBuildBefore, build.clientBuild); assert.deepEqual(pack.clientBuildAfter, build.clientBuild);
  assert.equal(pack.clientBuildRecordSha256, build.clientBuildRecordSha256);
  const clientBytes = readEvidence(c.root, path.join(sourceRoot, '.dsh-build/client-build-environment.json'), c.inside);
  assert.equal(digest(clientBytes), build.clientBuildRecordSha256); assert.deepEqual(JSON.parse(clientBytes), build.clientBuild);
  assert.equal(build.clientBuild.formatVersion, 1); assert.equal(build.clientBuild.environment.DSH_CLIENT_BUILD_PROFILE, 'official');
  assert.equal(build.clientBuild.environment.DSH_CLIENT_VERSION, identity.version);
  assert.equal(build.clientBuild.environment.DSH_CLIENT_COMMIT_HASH, identity.commit.slice(0, 7));
  const checked = packageBytes(c, pack.packageSet);
  const packDirectory = path.dirname(full(c, profile.inputs.sourcePack.path));
  assert.equal(full(c, pack.packageSet.path), path.join(packDirectory, 'package-set', 'desktop-packages.json'));
  assert.deepEqual(Object.keys(pack.packageProvenance).sort(), checked.packages.map(x => x.item.name).sort());
  for (const { item, body } of checked.packages) {
    const provenance = pack.packageProvenance[item.name]; assert.equal(provenance.sha256, item.sha256); assert.equal(provenance.bytes, item.bytes);
    const provenancePath = full(c, provenance.sourceTarball);
    assert.ok(['dsh', 'vendor', 'landlock'].some(family => provenancePath === path.join(packDirectory, 'packed', family, item.file)),
      'Package provenance is outside this pack run');
    assert.equal(readEvidence(c.root, provenance.sourceTarball, c.inside).equals(body), true, 'Packed provenance bytes changed');
  }
  const native = pack.nativeEntryTarball, nativePackage = checked.packages.find(x => x.item.name === native.name)?.item;
  assert.equal(native.name, '@deepseek-ai/node-addon-system'); assert.ok(nativePackage);
  assert.equal(native.version, nativePackage.version); assert.equal(native.sha256, nativePackage.sha256);
  assert.equal(full(c, native.sourceTarball), full(c, pack.packageProvenance[native.name].sourceTarball));
  assert.equal(native.actualPackedExportsVerified, true); assert.match(native.memberListSha256, SHA);
  assert.ok(native.exportedFiles.length > 0); for (const name of native.exportedFiles) { assert.match(name, /^package\/lib\//); c.inside(c.root, name); }
  // New raw receipts only support direct consumption; an old equivalence bridge cannot stand in for a new build.
  assert.equal(profile.inputs.sourceEquivalence, undefined); assert.equal(profile.inputs.priorPack, undefined); assert.equal(pin.sourceEquivalenceSha256, undefined);
  input(c, 'preparationEvidence'); reference(c, records.preparationEvidence.packReceipt, 'sourcePack');
  assert.equal(input(c, 'packageSet').sha256, pack.packageSet.sha256);
  assert.deepEqual(records.packageSet.packages, pack.packageSet.packages.map(({ sha256, ...entry }) => entry));
}

module.exports = { validateSourceFrozenChain };
