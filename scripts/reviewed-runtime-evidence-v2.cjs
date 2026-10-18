'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { readEvidence, checkMap, input, relativePath, digest, samePath } = require('./reviewed-source-chain-v2.cjs');

const INSTALL_ARGS = ['install', '--prod', '--frozen-lockfile', '--offline', '--ignore-scripts', '--package-import-method=copy', '--reporter=append-only'];
const HOST_CHECKS = ['preflight', 'candidateFullIntegrity', 'authenticatedHttpAndReadPlugin', 'sessionCreatedWithoutPrompt', 'sessionRestartAndReadOnlyHistory'];
const SOURCE_FROZEN_TOOLS = Object.freeze({
  lockValidator: 'ce0b93ee7d337c4237efcf796d889549058ad62eaad1f93780fae1be87ba4259',
  dependencyController: '170d9b7fd59444796ac56b80f6f5cdf5a31018dd97095e16f650135fb4ef1439',
  dependencyStageController: 'df4f36dddf62e81d304f4a8d883e0df6739f88ad328cd7437c730a2af371ccd3',
});

function boundReference(c, ref, name) {
  const expected = input(c, name);
  assert.deepEqual(ref, { path: expected.path, sha256: expected.sha256 }, `Wrong ${name} reference`);
}
function validateBoundedDependencyStage(c, receipt, stage, { fixed, args, limits, pnpmEntrySha256 }) {
  const { root, inside, profile } = c;
  assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.type, 'bounded-source-frozen-runtime-stage'); assert.equal(receipt.stage, stage);
  assert.deepEqual(receipt.fixed, fixed); assert.equal(receipt.scriptSha256, input(c, 'dependencyStageController').sha256);
  boundReference(c, receipt.controller, 'dependencyController'); boundReference(c, receipt.preparation, 'preparationEvidence');
  boundReference(c, receipt.lockVerification, 'lockReport');
  for (const name of ['ok', 'packageManagerExecuted', 'childClosed', 'processSucceeded', 'sourceInputsUnchanged', 'preparedInputsUnchanged', 'lifecycleScriptsDisabled', 'pnpmHooksDisabled']) assert.equal(receipt[name], true, name);
  for (const name of ['sourceBuildExecuted', 'nativeRebuildExecuted', 'runtimeDeployed', 'fullRuntimeAcceptance', 'promotionAllowed']) assert.equal(receipt[name], false, name);
  for (const name of ['error', 'timedOut', 'spawnError', 'stopReason', 'lowDisk', 'logLimitExceeded', 'logError', 'terminationError', 'diskInspectionError', 'closeNotObserved', 'verificationError']) assert.ok(!receipt[name], name);
  assert.equal(receipt.code, 0); assert.equal(receipt.signal, null); assert.equal(receipt.exit.code, 0); assert.equal(receipt.exit.signal, null);
  const times = ['startedAt', 'exit.at', 'closedAt', 'processFinishedAt', 'finishedAt'].map(field => Date.parse(field === 'exit.at' ? receipt.exit.at : receipt[field]));
  assert.ok(times.every(Number.isFinite) && times.every((time, index) => index === 0 || time >= times[index - 1]), 'Invalid actual exit/close timestamps');
  assert.equal(receipt.dependencyMaterializationRequested, stage === 'install'); assert.equal(receipt.offlineRequested, stage === 'install');
  assert.deepEqual(receipt.limits, limits);
  for (const field of ['lockBeforeSha256', 'lockAfterSha256']) assert.equal(receipt[field], input(c, 'productionLock').sha256);
  assert.equal(relativePath(root, receipt.command.executable, inside), input(c, 'node').path);
  const pnpmEntry = relativePath(root, receipt.command.args[0], inside), version = fixed.packageManager.replace(/^pnpm@/, '');
  assert.ok(pnpmEntry.endsWith(`/node_modules/.pnpm/pnpm@${version}/node_modules/pnpm/bin/pnpm.cjs`), 'Unfixed package manager entry');
  assert.equal(digest(readEvidence(root, pnpmEntry, inside)), pnpmEntrySha256);
  assert.deepEqual(receipt.command.args.slice(1), args);
  assert.equal(relativePath(root, receipt.command.cwd, inside), path.posix.dirname(profile.inputs.productionLock.path));
  const directory = path.posix.dirname(profile.inputs[stage === 'install' ? 'installation' : 'audit'].path);
  assert.equal(receipt.environment.inheritedCredentials, false); assert.equal(receipt.environment.inheritedProxy, false);
  assert.equal(receipt.environment.registry, 'https://registry.npmjs.org/');
  assert.equal(receipt.environment.isolatedHome, directory + '/home');
  assert.equal(receipt.environment.npmrc, directory + '/empty.npmrc');
  assert.equal(readEvidence(root, receipt.environment.npmrc, inside).length, 0);
  assert.deepEqual(Object.keys(receipt.logs).sort(), ['stderr', 'stdout']);
  const logTexts = {};
  for (const [name, log] of Object.entries(receipt.logs)) {
    assert.equal(log.path, directory + '/' + name + '.log'); assert.equal(log.truncated, false);
    assert.ok(Number.isSafeInteger(log.bytes) && log.bytes >= 0 && log.bytes <= limits.streamBytes);
    assert.equal(log.observedBytes, log.bytes);
    const bytes = readEvidence(root, log.path, inside); assert.equal(bytes.length, log.bytes); assert.equal(digest(bytes), log.sha256);
    logTexts[name] = bytes.toString('utf8');
  }
  if (stage === 'audit') {
    const report = JSON.parse(logTexts.stdout); assert.ok(!report.error);
    assert.deepEqual(report.advisories, {});
    const counts = report.metadata?.vulnerabilities;
    assert.deepEqual(Object.keys(counts || {}).sort(), ['critical', 'high', 'info', 'low', 'moderate']);
    assert.ok(Object.values(counts).every(value => Number.isSafeInteger(value) && value >= 0));
    assert.equal(counts.moderate + counts.high + counts.critical, 0);
    assert.ok(Number.isSafeInteger(report.metadata.dependencies) && report.metadata.dependencies > 0);
    assert.deepEqual(receipt.audit, { vulnerabilities: counts, knownModerateOrHigher: 0, dependencies: report.metadata.dependencies });
  }
}

function validateSourceFrozenDependencies(c, fixed) {
  const { root, inside, profile, records } = c;
  const preparation = records.preparationEvidence, lock = records.lockReport;
  assert.equal(preparation.schemaVersion, 2); assert.equal(preparation.preparationRevision, 2);
  assert.equal(preparation.type, 'source-frozen-runtime-metadata-preparation');
  assert.equal(lock.schemaVersion, 1); assert.equal(lock.type, 'source-frozen-runtime-lock-verification');
  // Verify exact reviewed code bytes BEFORE loading executable validator helpers.
  for (const [name, checksum] of Object.entries(SOURCE_FROZEN_TOOLS)) assert.equal(input(c, name).sha256, checksum, `Unreviewed ${name}`);
  const load = name => require(inside(root, profile.inputs[name].path));
  const control = load('dependencyController'), installer = load('dependencyStageController'), validator = load('lockValidator');
  assert.deepEqual(control.fixed, fixed); control.assertPreparation(preparation); control.verifyExclusions(preparation);
  const yaml = control.verifyTools();
  const sourceRoot = path.dirname(inside(root, input(c, 'sourceWorkspace').path));
  const sourceRequire = require('node:module').createRequire(path.join(sourceRoot, 'package.json'));
  assert.ok(samePath(sourceRequire.resolve('js-yaml'), path.join(sourceRoot, 'node_modules/.pnpm/js-yaml@4.3.2/node_modules/js-yaml/index.js')),
    'Source validator YAML alias differs from the verified parser tree');
  const directory = path.posix.dirname(profile.inputs.productionLock.path), reviewDirectory = path.posix.dirname(profile.inputs.lockValidator.path);
  installer.assertLockVerification(lock, { directory, preparationSha256: input(c, 'preparationEvidence').sha256, reviewDirectory });
  const referenceInputs = { preparation: 'preparationEvidence', package: 'productionManifest', workspace: 'productionWorkspace', descriptor: 'packageSet',
    lock: 'productionLock', independentSnapshotReview: 'snapshotReview', sourceGraphAudit: 'sourceGraphAudit', validatorV3: 'lockValidator', zeroRules: 'peerRules' };
  for (const [ref, name] of Object.entries(referenceInputs)) boundReference(c, lock.refs[ref], name);
  assert.equal(lock.peerMetadataExceptions, 0); assert.equal(lock.peerContextExceptions, 0); assert.equal(lock.hashAlgorithmReproduced, false);
  assert.equal(lock.sourceInputCount, Object.keys(preparation.sourceInputs).length); assert.equal(lock.derivedInputCount, Object.keys(preparation.inputFiles).length);
  checkMap(c, preparation.sourceInputs); checkMap(c, preparation.inputFiles, inside(root, directory));
  const readRef = ref => { checkMap(c, { [ref.path]: ref.sha256 }); return readEvidence(root, ref.path, inside); };
  const declarationBindingsBytes = readRef(preparation.peerOnlyPinExclusion.declarationBindings);
  const sourceManifestBytesByPath = Object.fromEntries(Object.values(JSON.parse(declarationBindingsBytes).manifests).map(ref => [ref.path, readRef(ref)]));
  const pnpmEntry = relativePath(root, records.installation.command.args[0], inside);
  const pnpmBundle = path.posix.join(path.posix.dirname(pnpmEntry), '../dist/pnpm.mjs');
  const pnpmBytes = readEvidence(root, pnpmBundle, inside); assert.equal(digest(pnpmBytes), control.pins.pnpmBundle);
  const projection = validator.createRuntimeManifestProjection({ inventoryBytes: readRef(preparation.inventory),
    sourceWorkspaceBytes: readEvidence(root, input(c, 'sourceWorkspace').path, inside),
    peerPinReviewBytes: readRef(preparation.peerOnlyPinExclusion.review), declarationBindingsBytes, sourceManifestBytesByPath, pnpmBytes }, preparation);
  assert.deepEqual(records.productionManifest, preparation.expectedManifest);
  assert.deepEqual(yaml.load(readEvidence(root, input(c, 'productionWorkspace').path, inside).toString('utf8')), preparation.expectedWorkspace);
  assert.deepEqual(records.packageSet, preparation.packageSet);
  const verified = validator.verifyDerivedLock(yaml.load(readEvidence(root, input(c, 'productionLock').path, inside).toString('utf8')), preparation,
    { inventorySha256: preparation.inventory.sha256, preparationObjectSha256: lock.preparationObjectSha256,
      peerRulesSha256: input(c, 'peerRules').sha256, snapshotReviewSha256: lock.snapshotReviewSha256 },
    readEvidence(root, input(c, 'snapshotReview').path, inside), readEvidence(root, input(c, 'peerRules').path, inside), projection);
  assert.equal(verified.ok, true); assert.equal(verified.verified, true);
  assert.equal(lock.localPackages, verified.localPackages); assert.equal(lock.registrySnapshots, verified.registrySnapshots);
  for (const [name, stage] of [['installation', 'install'], ['audit', 'audit']]) validateBoundedDependencyStage(c, records[name], stage,
    { fixed, args: installer.stageArguments(stage), limits: control.limits, pnpmEntrySha256: control.pins.pnpmEntry });
}

function exactReplace(text, from, to) {
  assert.equal(text.split(from).length, 2, 'Candidate delta is missing or ambiguous');
  return text.replace(from, to);
}

function validateHostTransition(context) {
  const { root, profile, binding, records, inside } = context;
  const host = records.hostAcceptance, adapter = host.adapter;
  assert.equal(adapter.version, binding.packageVersion); assert.equal(adapter.commit, binding.commit);
  assert.equal(adapter.runtimeVerifierOverride, false); assert.equal(adapter.actualLaunchWorkerPreserved, true);
  assert.equal(adapter.formalFilesModified, false);
  const candidate = adapter.manifest;
  assert.equal(candidate.version, binding.packageVersion);
  const candidateFile = path.join(host.destination, 'candidate-runtime.json');
  const manifestBytes = readEvidence(root, candidateFile, inside);
  assert.equal(digest(manifestBytes), adapter.manifestSha256); assert.deepEqual(JSON.parse(manifestBytes), candidate);
  assert.deepEqual({ ...candidate.dshDesktop, runtimeDirectory: binding.runtimeDirectory, reviewedSourceChain: binding.reviewedSourceChain }, binding,
    'Formal binding changes more than candidate identity/promotion evidence');
  assert.deepEqual(adapter.manifestChangedFields, ['version', 'dshDesktop.tag', 'dshDesktop.commit', 'dshDesktop.packageVersion',
    'dshDesktop.runtimeDirectory', 'dshDesktop.descriptor', 'dshDesktop.reviewedSourceChain']);
  const absoluteRequire = file => `require(${JSON.stringify(path.join(root, file))})`;
  const sourceRoot = inside(root, relativePath(root, context.records.sourceBuild.source, inside));
  const transforms = {
    'harness-supervisor.cjs': [[absoluteRequire('electron/harness-automation-migration.cjs'), "require('./harness-automation-migration.cjs')"]],
    'harness-launch-runtime.cjs': [[absoluteRequire('electron/powershell-runtime.cjs'), "require('./powershell-runtime.cjs')"]],
    'harness-desktop-runtime.cjs': [
      [`require(${JSON.stringify(path.join(sourceRoot, 'apps/desktop/src/runtime-tree.ts'))})`, "require('../runtime/harness-official/runtime-tree.cjs')"],
      ["require('./candidate-runtime.json')", "require('../runtime/harness/package.json')"],
    ],
  };
  for (const [name, changes] of Object.entries(transforms)) {
    const bytes = readEvidence(root, path.join(host.destination, name), inside), delta = adapter.deltas[name];
    assert.equal(digest(bytes), delta.afterSha256);
    assert.equal(delta.beforeSha256, adapter.pins[`electron/${name}`]);
    let expected = bytes.toString('utf8');
    for (const [from, to] of changes) expected = exactReplace(expected, from, to);
    assert.equal(readEvidence(root, `electron/${name}`, inside).equals(Buffer.from(expected)), true, 'Formal Host differs from tested candidate');
  }
  const historical = new Set(['runtime/harness/package.json', 'electron/harness-desktop-runtime.cjs']);
  const retained = {};
  for (const [file, sha256] of Object.entries(host.inputHashes)) {
    const relative = relativePath(root, file, inside);
    if (historical.has(relative)) assert.equal(sha256, adapter.pins[relative], 'Unproven historical Host input');
    else retained[file] = sha256;
  }
  for (const file of historical) {
    assert.equal(host.inputHashes[inside(root, file)], adapter.pins[file], 'Historical Host input omitted');
  }
  checkMap(context, retained);
  for (const name of ['runtime-tree', 'core-package-set', 'release', 'host-protocol']) {
    const original = readEvidence(root, path.join(sourceRoot, `apps/desktop/src/${name}.ts`), inside);
    assert.equal(readEvidence(root, `runtime/harness-official/sources/${name}.ts`, inside).equals(original), true, 'Formal official verifier source differs');
  }
}

function validateRuntimeEvidenceV2(context) {
  const { root, profile, binding, records, inside, nativeChecks } = context;
  assert.equal(profile.schemaVersion, 2); assert.equal(binding.reviewedSourceChain?.schemaVersion, 2);
  assert.equal(profile.channel, 'local-candidate'); assert.equal(profile.promotionAllowed, false);
  assert.equal(profile.version, binding.packageVersion); assert.equal(profile.runtimeDirectory, binding.runtimeDirectory);
  assert.equal(binding.distribution, 'official-desktop-runtime'); assert.deepEqual(profile.descriptor, binding.descriptor);
  const { sourceProfile: source, materialization: materialized, nativeVerification: native, hostAcceptance: host,
    lockReport: lock, installation: install, audit, preparationEvidence: preparation, powerShellProfile: shell } = records;
  assert.equal(source.schemaVersion, 2); assert.equal(source.version, binding.packageVersion); assert.equal(source.promotionAllowed, false);
  for (const key of ['repository', 'tag', 'commit']) assert.equal(source[key], binding[key]);
  assert.equal(source.lockSha256, input(context, 'sourceLock').sha256);
  assert.equal(source.workspaceSha256, input(context, 'sourceWorkspace').sha256);
  const fixed = { version: source.version, commit: source.commit, packageManager: source.packageManager,
    lock: source.lockSha256, workspace: source.workspaceSha256 };
  for (const receipt of [preparation, materialized, native]) assert.deepEqual(receipt.fixed, fixed);
  assert.equal(input(context, 'node').sha256, binding.node.sha256);
  assert.equal(profile.powerShell.version, binding.powerShell.version); assert.equal(shell.version, binding.powerShell.version);
  assert.equal(shell.sourceDirectory, profile.powerShell.directory);
  assert.equal(shell.manifestSha256, input(context, 'powerShellManifest').sha256);
  assert.equal(shell.executableSha256, input(context, 'powerShellExecutable').sha256);
  if (lock.type === 'source-frozen-runtime-lock-verification' || preparation.schemaVersion === 2) {
    validateSourceFrozenDependencies(context, fixed);
  } else {
  assert.equal(lock.type, undefined, 'Unknown dependency lock receipt format');
  assert.equal(install.type, undefined, 'Bounded installation cannot downgrade to legacy admission');
  assert.equal(audit.type, undefined, 'Bounded audit cannot downgrade to legacy admission');
  assert.equal(lock.ok, true); assert.equal(lock.sourceUnchanged, true); assert.equal(lock.installAccepted, false);
  for (const [field, name] of [['lockSha256', 'productionLock'], ['packageJsonSha256', 'productionManifest'],
    ['workspaceSha256', 'productionWorkspace'], ['descriptorSha256', 'packageSet'], ['preparationEvidenceSha256', 'preparationEvidence'],
    ['validatorSha256', 'lockValidator'], ['peerRulesSha256', 'peerRules']]) assert.equal(lock[field], input(context, name).sha256);
  assert.deepEqual(records.productionManifest, preparation.expectedManifest);
  assert.equal(lock.localPackages, records.packageSet.packages.length);
  assert.equal(lock.registrySnapshots, Object.keys(preparation.registryAllowlist).length);
  assert.equal(lock.activePatches, Object.keys(preparation.activePatches).length);
  for (const [receipt, stage, args] of [[install, 'install', INSTALL_ARGS], [audit, 'audit', ['audit', '--prod', '--audit-level=moderate', '--json']]]) {
    assert.equal(receipt.stage, stage); assert.equal(receipt.code, 0); assert.equal(receipt.signal, null);
    for (const key of ['ok', 'childClosed', 'inputsUnchanged', 'isolatedHome']) assert.equal(receipt[key], true);
    for (const key of ['timedOut', 'spawnError', 'terminationError', 'verificationError']) assert.equal(receipt[key], undefined);
    assert.deepEqual(receipt.args, args);
    assert.equal(receipt.node, `v${binding.node.version}`); assert.equal(receipt.pnpm, source.packageManager.replace(/^pnpm@/, ''));
    assert.equal(receipt.preparationSha256, profile.inputs.preparationEvidence.sha256); assert.equal(receipt.lockReportSha256, profile.inputs.lockReport.sha256);
    for (const field of ['lockBefore', 'lockAfter']) assert.equal(receipt[field], profile.inputs.productionLock.sha256);
    assert.deepEqual(receipt.before, preparation.inputFiles); assert.deepEqual(receipt.after, preparation.inputFiles);
    assert.ok(samePath(receipt.cwd, path.dirname(inside(root, profile.inputs.productionLock.path))));
    assert.ok(Date.parse(receipt.finishedAt) >= Date.parse(receipt.startedAt), 'Invalid dependency command timestamps');
    assert.deepEqual(Object.keys(receipt.logs).sort(), ['stderr.log', 'stdout.log']);
    for (const log of Object.values(receipt.logs)) assert.equal(digest(readEvidence(root, log.path, inside)), log.sha256);
  }
  assert.equal(install.scriptsDisabled, true);
  }
  checkMap(context, preparation.inputFiles, path.dirname(inside(root, profile.inputs.productionLock.path)));
  const runtime = inside(root, profile.sourceRuntime);
  for (const receipt of [materialized, native, host]) assert.ok(samePath(receipt.runtime, runtime), 'Evidence runtime mismatch');
  assert.equal(materialized.ok, true); assert.equal(materialized.sourceAndBuildInputsUnchanged, true);
  assert.equal(materialized.productionPromotionAllowed, false); assert.equal(materialized.runtimeAcceptance, false);
  assert.equal(materialized.descriptorSha256, profile.descriptor.sha256);
  for (const key of ['runtimeFiles', 'runtimeBytes', 'sharedPackages']) assert.equal(materialized[key], profile[key]);
  assert.equal(materialized.officeManifestFilesVerified, profile.office.files);
  assert.equal(materialized.officeManifestSha256, profile.office.manifestSha256);
  checkMap(context, materialized.bindings);
  for (const name of ['lockReport', 'preparationEvidence', 'installation', 'productionLock', 'packageSet']) {
    assert.equal(materialized.bindings[inside(root, profile.inputs[name].path)], profile.inputs[name].sha256, `Materialization omits ${name}`);
  }
  assert.equal(native.nativeRuntimeVerified, true); assert.equal(native.inputsUnchanged, true); assert.equal(native.descriptorUnchanged, true);
  for (const key of ['error', 'cleanupError']) assert.equal(native[key], undefined);
  assert.equal(native.materializedSha, input(context, 'materialization').sha256);
  assert.ok(samePath(native.materializedPath, inside(root, profile.inputs.materialization.path)));
  assert.equal(native.worker.ok, true); assert.equal(native.worker.plainNode, `v${binding.node.version}`);
  assert.deepEqual(native.worker.checks.map(item => item.name), nativeChecks); assert.ok(native.worker.checks.every(item => item.ok === true));
  assert.equal(native.consumerBytes.ok, true); assert.equal(native.consumerBytes.historicalRuntimeBytesAccepted, false);
  assert.deepEqual(native.pdfContent.map(item => item.format), ['docx', 'xlsx', 'pptx']); assert.ok(native.pdfContent.every(item => item.ok === true));
  assert.equal(native.nativeCacheVerified.sourceEqualsCache, true);
  assert.equal(native.job.rootExit.code, 0); assert.equal(native.job.rootExit.activeProcesses, 0);
  assert.equal(native.job.empty.activeProcesses, 0); assert.equal(native.job.guardianExit.code, 0);
  assert.equal(native.powershell.version, shell.version); assert.ok(samePath(native.powershell.runtimeDir, inside(root, profile.powerShell.directory)));
  assert.deepEqual(native.before, native.after); checkMap(context, native.before);
  assert.equal(host.mode, 'actual-worker-and-host-smoke');
  for (const key of ['error', 'cleanupError', 'finalVerificationError']) assert.equal(host[key], undefined);
  for (const key of ['ok', 'inputsUnchanged', 'runtimeUnchanged', 'ownedHostProcessesStopped']) assert.equal(host[key], true);
  for (const key of ['formalPinChanged', 'realUserDataUsed', 'installedProductAccepted', 'descendantExitIndependentlyObserved']) assert.equal(host[key], false);
  assert.equal(host.modelPromptsSubmitted, 0);
  assert.deepEqual(Object.keys(host.checks).sort(), [...HOST_CHECKS].sort()); assert.ok(Object.values(host.checks).every(value => value === true));
  assert.ok(host.ownedChildren.length > 0 && host.ownedChildren.every(child => child.exited && child.actualLaunchWorkerCompleted));
  assert.equal(host.adapter.manifest.dshDesktop.reviewedSourceChain.materializedSha256, profile.inputs.materialization.sha256);
  assert.equal(host.adapter.manifest.dshDesktop.reviewedSourceChain.nativeSha256, input(context, 'nativeVerification').sha256);
  validateHostTransition(context);
  require('./reviewed-source-chain.cjs').validateReviewedSourceChain(context);
}

module.exports = { validateRuntimeEvidenceV2, validateHostTransition, validateBoundedDependencyStage, validateSourceFrozenDependencies };
