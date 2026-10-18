'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inside, validateEvidence, NATIVE_CHECKS } = require('../scripts/deploy-reviewed-harness-runtime.cjs');
const { validateReviewedSourceChain: validate } = require('../scripts/reviewed-source-chain.cjs');
const { validateHostTransition } = require('../scripts/reviewed-runtime-evidence-v2.cjs');
const { digest, readEvidence } = require('../scripts/reviewed-source-chain-v2.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-source-v2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const full = path.join(root, name); fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value));
    return { path: name, sha256: digest(fs.readFileSync(full)) };
  };
  const binding = { tag: 'dsh-v0.2.1-alpha.2', commit: 'a'.repeat(40), repository: 'https://example.test/source',
    packageVersion: '0.2.1-alpha.2', node: { version: '24.19.0' }, reviewedSourceChain: { schemaVersion: 2 } };
  const profile = { schemaVersion: 2, inputs: {} }, records = {};
  const input = (name, value) => { records[name] = value; profile.inputs[name] = write(`${name}.json`, value); return profile.inputs[name]; };
  const source = path.join(root, 'source'), postimage = write('source/src/host.ts', 'fixture host and native routing');
  const protectedFile = write('source/package.json', { version: binding.packageVersion });
  const patch = write('reviewed.patch', 'fixture patch');
  const integration = { ok: true, identity: { ...binding, version: binding.packageVersion },
    files: [{ path: 'src/host.ts', sha256: postimage.sha256, expectedSha256: postimage.sha256, matches: true }],
    protected: [{ path: 'package.json', sha256: protectedFile.sha256, unchanged: true }] };
  input('sourceIntegration', integration);
  input('sourceProfile', { schemaVersion: 2, packageManager: 'pnpm@11.28.5', postimageSha256: profile.inputs.sourceIntegration.sha256, patchChain: [patch] });
  const identity = { tag: binding.tag, version: binding.packageVersion, commit: binding.commit, pnpm: '11.28.5', node: 'v24.19.0' };
  const files = { 'src/host.ts': postimage.sha256, 'package.json': protectedFile.sha256 };
  const projection = { schemaVersion: 2, identity, source: 'source', nodeVersion: identity.node, pnpmVersion: identity.pnpm,
    fixed: { 'reviewed.patch': patch.sha256 }, files, tracked: Object.keys(files), untracked: [], changed: ['src/host.ts'],
    reviewedPostimagesAndProtected: files, trackedDiffSha256: digest('fixture diff') };
  const client = { artifacts: { fileCount: 1, sha256: digest('client only') } };
  const clientFile = write('source/.dsh-build/client-build-environment.json', client);
  const log = write('stage.log', 'fixture log');
  const stage = name => ({ name, code: 0, signal: null, childClosed: true,
    startedAt: '2026-10-10T00:00:00Z', finishedAt: '2026-10-10T00:00:01Z',
    logs: { stdout: { path: path.join(root, log.path), sha256: log.sha256 }, stderr: { path: path.join(root, log.path), sha256: log.sha256 } } });
  const common = { schemaVersion: 2, source, identity, before: projection, after: projection, ok: true, code: 0,
    signal: null, childClosed: true, inputsUnchanged: true, clientBuild: client, clientBuildRecordSha256: clientFile.sha256 };
  input('sourceBuild', { ...common, stage: 'build', type: 'controlled-harness-build', completeSourceProjection: true,
    generatedClientRecordExcludedFromSourceProjection: true, stages: [stage('build:official')] });
  const body = Buffer.from('whole TGZ fixture including host and native bytes');
  const entry = { name: '@deepseek-ai/dsh', version: binding.packageVersion, file: 'dsh.tgz', bytes: body.length,
    integrity: `sha512-${digest(body, 'sha512', 'base64')}` };
  const packageSet = prefix => {
    write(`${prefix}/desktop-packages/${entry.file}`, body);
    const descriptor = write(`${prefix}/desktop-packages.json`, { schemaVersion: 1, packages: [entry] });
    return { path: path.join(root, descriptor.path), sha256: descriptor.sha256, count: 1, packages: [{ ...entry, sha256: digest(body) }] };
  };
  const newSet = packageSet('new'), oldSet = packageSet('old');
  input('sourcePack', { ...common, stage: 'pack', type: 'controlled-harness-pack',
    buildReceipt: { path: path.join(root, profile.inputs.sourceBuild.path), sha256: profile.inputs.sourceBuild.sha256 },
    stages: ['pack-dsh', 'pack-host', 'pack-vendor', 'native-ts', 'pack-native-entry', 'select-packages'].map(stage), packageSet: newSet });
  input('priorPack', { ok: true, packInputsUnchanged: true, before: { buildRecordSha256: clientFile.sha256 }, packageSet: oldSet });
  input('sourceEquivalence', { schemaVersion: 2, type: 'harness-package-set-byte-equivalence', identity,
    oldPack: profile.inputs.priorPack, newBuild: profile.inputs.sourceBuild, newPack: profile.inputs.sourcePack,
    oldPackageSet: oldSet, newPackageSet: newSet, equivalent: true, descriptorBytesEqual: true, descriptorEqual: true,
    packagesEqual: true, oldReceiptAndPackageSetUnchanged: true, sourceBuildThenPackVerified: true, comparedPackages: 1,
    comparisons: [{ name: entry.name, old: oldSet.packages[0], current: newSet.packages[0], bytesEqual: true, metadataEqual: true }] });
  input('preparationEvidence', { packReceipt: profile.inputs.priorPack });
  records.packageSet = JSON.parse(fs.readFileSync(oldSet.path)); profile.inputs.packageSet = { path: 'old/desktop-packages.json', sha256: oldSet.sha256 };
  for (const name of ['sourceBuild', 'sourcePack', 'sourceIntegration', 'sourceEquivalence']) binding.reviewedSourceChain[`${name}Sha256`] = profile.inputs[name].sha256;
  return { root, source, profile, binding, records, inside, write, input };
}

test('controlled build and byte-identical full package bridge preserve historical receipts', t => {
  const f = fixture(t); validate(f);
  assert.equal(f.records.priorPack.before.buildRecordSha256, f.records.sourceBuild.clientBuildRecordSha256);
});
test('direct controlled package consumer requires no fabricated old receipt', t => {
  const f = fixture(t); delete f.profile.inputs.sourceEquivalence; delete f.profile.inputs.priorPack;
  delete f.binding.reviewedSourceChain.sourceEquivalenceSha256;
  f.input('preparationEvidence', { packReceipt: f.profile.inputs.sourcePack });
  f.profile.inputs.packageSet = { path: 'new/desktop-packages.json', sha256: f.records.sourcePack.packageSet.sha256 };
  validate(f);
});
for (const [label, mutate] of [
  ['unversioned binding downgrade', f => { delete f.binding.reviewedSourceChain; }],
  ['missing build pin', f => { delete f.binding.reviewedSourceChain.sourceBuildSha256; }],
  ['failed controlled build', f => { f.records.sourceBuild.code = 1; }],
  ['unclosed build', f => { f.records.sourceBuild.childClosed = false; }],
  ['pack using a different input snapshot', f => { f.records.sourcePack.before = {}; }],
  ['pack missing native-entry stage', f => { f.records.sourcePack.stages.splice(4, 1); }],
  ['timeout despite zero exit', f => { f.records.sourceBuild.stages[0].timedOut = true; }],
  ['source projection missing host file', f => { delete f.records.sourceBuild.after.files['src/host.ts']; }],
  ['wrong reviewed postimage', f => { f.records.sourceIntegration.files[0].expectedSha256 = 'f'.repeat(64); }],
  ['modified actual source', f => { f.write('source/src/host.ts', 'different host'); }],
  ['modified patch source', f => { f.write('reviewed.patch', 'different patch'); }],
  ['modified stage log', f => { f.write('stage.log', 'different log'); }],
  ['missing equivalence comparison', f => { f.records.sourceEquivalence.comparisons = []; }],
  ['false metadata equivalence', f => { f.records.sourceEquivalence.comparisons[0].metadataEqual = false; }],
  ['client digest cannot hide changed host TGZ', f => { f.write('new/desktop-packages/dsh.tgz', 'changed host/native, same client'); }],
  ['old preparation build record changed', f => { f.records.priorPack.before.buildRecordSha256 = 'f'.repeat(64); }],
  ['current client record changed', f => { f.write('source/.dsh-build/client-build-environment.json', 'changed'); }],
  ['unbound alternative pack receipt', f => { f.records.preparationEvidence.packReceipt = f.profile.inputs.sourcePack; }],
  ['unknown source schema', f => { f.binding.reviewedSourceChain.schemaVersion = 8; }],
  ['unknown explicit receipt format', f => { f.binding.reviewedSourceChain.receiptFormat = 'guessed-future-schema'; }],
]) test(`v2 rejects ${label}`, t => { const f = fixture(t); mutate(f); assert.throws(() => validate(f)); });

test('evidence read permits a regular build-input hardlink but rejects directory junctions', t => {
  const f = fixture(t); fs.linkSync(path.join(f.root, 'reviewed.patch'), path.join(f.root, 'alias.patch'));
  assert.equal(readEvidence(f.root, 'alias.patch', inside).toString(), 'fixture patch');
  fs.symlinkSync(f.source, path.join(f.root, 'redirected'), 'junction');
  assert.throws(() => readEvidence(f.root, 'redirected/src/host.ts', inside), /Linked/);
});

function hostFixture(t) {
  const f = fixture(t), { root, binding, write, records } = f;
  binding.runtimeDirectory = 'harness-alpha2';
  const candidateBinding = { ...binding, runtimeDirectory: '__artifact-only__', reviewedSourceChain: { materializedSha256: 'b'.repeat(64) } };
  const manifest = { version: binding.packageVersion, dshDesktop: candidateBinding };
  const destination = path.join(root, 'host');
  const manifestFile = write('host/candidate-runtime.json', manifest);
  const absoluteRequire = name => `require(${JSON.stringify(path.join(root, name))})`;
  const modules = {
    'harness-supervisor.cjs': [absoluteRequire('electron/harness-automation-migration.cjs'), "require('./harness-automation-migration.cjs')"],
    'harness-launch-runtime.cjs': [absoluteRequire('electron/powershell-runtime.cjs'), "require('./powershell-runtime.cjs')"],
    'harness-desktop-runtime.cjs': [
      `${absoluteRequire('source/apps/desktop/src/runtime-tree.ts')}; require('./candidate-runtime.json'); const pnpm = '11.28.5';`,
      "require('../runtime/harness-official/runtime-tree.cjs'); require('../runtime/harness/package.json'); const pnpm = '11.28.5';",
    ],
  };
  const inputHashes = {}, pins = {}, deltas = {};
  for (const [name, [candidate, formal]] of Object.entries(modules)) {
    const file = write(`host/${name}`, candidate), current = write(`electron/${name}`, formal);
    pins[`electron/${name}`] = name === 'harness-desktop-runtime.cjs' ? digest('historical alpha1 code') : current.sha256;
    inputHashes[path.join(root, `electron/${name}`)] = pins[`electron/${name}`];
    inputHashes[path.join(root, file.path)] = file.sha256;
    deltas[name] = { beforeSha256: pins[`electron/${name}`], afterSha256: file.sha256 };
  }
  write('runtime/harness/package.json', { version: binding.packageVersion, dshDesktop: binding });
  pins['runtime/harness/package.json'] = digest('historical alpha1 manifest');
  inputHashes[path.join(root, 'runtime/harness/package.json')] = pins['runtime/harness/package.json'];
  for (const name of ['runtime-tree', 'core-package-set', 'release', 'host-protocol']) {
    write(`source/apps/desktop/src/${name}.ts`, `fixture official ${name}`);
    write(`runtime/harness-official/sources/${name}.ts`, `fixture official ${name}`);
  }
  records.hostAcceptance = { destination, inputHashes, adapter: { version: binding.packageVersion, commit: binding.commit,
    runtimeVerifierOverride: false, actualLaunchWorkerPreserved: true, formalFilesModified: false, manifest,
    manifestSha256: manifestFile.sha256, pins, deltas, manifestChangedFields: ['version', 'dshDesktop.tag', 'dshDesktop.commit',
      'dshDesktop.packageVersion', 'dshDesktop.runtimeDirectory', 'dshDesktop.descriptor', 'dshDesktop.reviewedSourceChain'] } };
  return f;
}
test('formal Host accepts only the tested candidate with exact import/identity transition', t => validateHostTransition(hostFixture(t)));
test('formal Host safely resolves a repository-relative source receipt', t => {
  const f = hostFixture(t); f.records.sourceBuild.source = 'source'; validateHostTransition(f);
});
for (const [name, mutate] of [
  ['formal host logic change', f => f.write('electron/harness-desktop-runtime.cjs', 'bypass checks')],
  ['candidate copy changed', f => f.write('host/harness-supervisor.cjs', 'different candidate')],
  ['undeclared binding change', f => { f.binding.additionalPermission = 'all'; }],
  ['deleted historical input', f => { delete f.records.hostAcceptance.inputHashes[path.join(f.root, 'runtime/harness/package.json')]; }],
  ['wrong historical pin', f => { f.records.hostAcceptance.adapter.pins['runtime/harness/package.json'] = 'f'.repeat(64); }],
  ['official verifier source changed', f => f.write('runtime/harness-official/sources/runtime-tree.ts', 'different verifier')],
  ['source path traversal', f => { f.records.sourceBuild.source = '../source'; }],
]) test(`Host transition rejects ${name}`, t => { const f = hostFixture(t); mutate(f); assert.throws(() => validateHostTransition(f)); });

// Compact, real-byte evidence fixture: no external command is executed or represented as a live run.
function runtimeFixture(t) {
  const f = hostFixture(t), { root, input, write, profile, binding, records } = f;
  const node = input('node', 'fixture node'); binding.node.sha256 = node.sha256;
  binding.distribution = 'official-desktop-runtime'; binding.descriptor = { sha256: digest('fixture descriptor') };
  binding.powerShell = { version: '7.6.6' };
  const sourceLock = input('sourceLock', 'fixture source lock'), sourceWorkspace = input('sourceWorkspace', 'fixture source workspace');
  input('sourceProfile', { ...records.sourceProfile, version: binding.packageVersion, repository: binding.repository,
    tag: binding.tag, commit: binding.commit, promotionAllowed: false, lockSha256: sourceLock.sha256, workspaceSha256: sourceWorkspace.sha256 });
  const fixed = { version: binding.packageVersion, commit: binding.commit, packageManager: 'pnpm@11.28.5',
    lock: sourceLock.sha256, workspace: sourceWorkspace.sha256 };
  Object.assign(profile, { channel: 'local-candidate', promotionAllowed: false, version: binding.packageVersion,
    runtimeDirectory: binding.runtimeDirectory, descriptor: binding.descriptor, sourceRuntime: 'candidate/dsh',
    runtimeFiles: 3, runtimeBytes: 42, sharedPackages: 1, office: { files: 1, manifestSha256: digest('fixture office manifest') },
    powerShell: { version: '7.6.6', directory: 'powershell' } });
  const psManifest = input('powerShellManifest', 'fixture powershell manifest'), psExecutable = input('powerShellExecutable', 'fixture powershell exe');
  input('powerShellProfile', { version: '7.6.6', sourceDirectory: profile.powerShell.directory,
    manifestSha256: psManifest.sha256, executableSha256: psExecutable.sha256 });
  input('productionLock', 'fixture full frozen lock'); input('productionManifest', { name: 'fixture production' });
  input('productionWorkspace', 'fixture production workspace'); input('lockValidator', 'fixture semantic validator'); input('peerRules', { reviewed: true });
  const files = Object.fromEntries(['productionManifest', 'productionWorkspace', 'packageSet'].map(name => [profile.inputs[name].path, profile.inputs[name].sha256]));
  input('preparationEvidence', { ...records.preparationEvidence, fixed, expectedManifest: records.productionManifest,
    registryAllowlist: { 'registry@1.0.0': {} }, activePatches: { 'registry@1.0.0': {} }, inputFiles: files });
  const lock = { ok: true, sourceUnchanged: true, installAccepted: false, localPackages: 1, registrySnapshots: 1, activePatches: 1 };
  for (const [field, name] of [['lockSha256', 'productionLock'], ['packageJsonSha256', 'productionManifest'], ['workspaceSha256', 'productionWorkspace'],
    ['descriptorSha256', 'packageSet'], ['preparationEvidenceSha256', 'preparationEvidence'], ['validatorSha256', 'lockValidator'], ['peerRulesSha256', 'peerRules']]) lock[field] = profile.inputs[name].sha256;
  input('lockReport', lock);
  const log = write('dependency.log', 'fixture dependency command logs');
  const receipt = (stage, args) => ({ stage, args, code: 0, signal: null, ok: true, childClosed: true, inputsUnchanged: true,
    isolatedHome: true, scriptsDisabled: true, node: 'v24.19.0', pnpm: '11.28.5', preparationSha256: profile.inputs.preparationEvidence.sha256,
    lockReportSha256: profile.inputs.lockReport.sha256, lockBefore: profile.inputs.productionLock.sha256, lockAfter: profile.inputs.productionLock.sha256,
    before: files, after: files, cwd: root, startedAt: '2026-10-10T00:00:00Z', finishedAt: '2026-10-10T00:00:01Z',
    logs: { 'stdout.log': log, 'stderr.log': log } });
  input('installation', receipt('install', ['install', '--prod', '--frozen-lockfile', '--offline', '--ignore-scripts', '--package-import-method=copy', '--reporter=append-only']));
  input('audit', receipt('audit', ['audit', '--prod', '--audit-level=moderate', '--json']));
  const runtime = path.join(root, profile.sourceRuntime);
  input('materialization', { fixed, runtime, ok: true, sourceAndBuildInputsUnchanged: true, productionPromotionAllowed: false, runtimeAcceptance: false,
    descriptorSha256: profile.descriptor.sha256, runtimeFiles: profile.runtimeFiles, runtimeBytes: profile.runtimeBytes, sharedPackages: 1,
    officeManifestFilesVerified: 1, officeManifestSha256: profile.office.manifestSha256,
    bindings: Object.fromEntries(['lockReport', 'preparationEvidence', 'installation', 'productionLock', 'packageSet'].map(name => [path.join(root, profile.inputs[name].path), profile.inputs[name].sha256])) });
  const nativeMap = { [profile.inputs.materialization.path]: profile.inputs.materialization.sha256 };
  input('nativeVerification', { fixed, runtime, nativeRuntimeVerified: true, inputsUnchanged: true, descriptorUnchanged: true,
    materializedPath: path.join(root, profile.inputs.materialization.path), materializedSha: profile.inputs.materialization.sha256,
    worker: { ok: true, plainNode: 'v24.19.0', checks: NATIVE_CHECKS.map(name => ({ name, ok: true })) },
    consumerBytes: { ok: true, historicalRuntimeBytesAccepted: false }, pdfContent: ['docx', 'xlsx', 'pptx'].map(format => ({ format, ok: true })),
    nativeCacheVerified: { sourceEqualsCache: true }, job: { rootExit: { code: 0, activeProcesses: 0 }, empty: { activeProcesses: 0 }, guardianExit: { code: 0 } },
    powershell: { version: '7.6.6', runtimeDir: path.join(root, 'powershell') }, before: nativeMap, after: nativeMap });
  const host = records.hostAcceptance;
  Object.assign(host, { runtime, mode: 'actual-worker-and-host-smoke', ok: true, inputsUnchanged: true, runtimeUnchanged: true,
    ownedHostProcessesStopped: true, formalPinChanged: false, realUserDataUsed: false, installedProductAccepted: false,
    descendantExitIndependentlyObserved: false, modelPromptsSubmitted: 0, ownedChildren: [{ exited: true, actualLaunchWorkerCompleted: true }],
    checks: Object.fromEntries(['preflight', 'candidateFullIntegrity', 'authenticatedHttpAndReadPlugin', 'sessionCreatedWithoutPrompt', 'sessionRestartAndReadOnlyHistory'].map(name => [name, true])) });
  host.adapter.manifest.dshDesktop = { ...binding, runtimeDirectory: '__artifact-only__', reviewedSourceChain: {
    materializedSha256: profile.inputs.materialization.sha256, nativeSha256: profile.inputs.nativeVerification.sha256 } };
  host.adapter.manifestSha256 = write('host/candidate-runtime.json', host.adapter.manifest).sha256;
  input('hostAcceptance', host);
  return f;
}
const validateRuntime = f => validateEvidence(f.root, f.profile, f.binding, f.records);
test('full v2 runtime admission keeps frozen dependency, native, historical Host and controlled source evidence separate', t => validateRuntime(runtimeFixture(t)));
for (const [name, mutate] of [
  ['missing dependency audit', f => { delete f.records.audit; }],
  ['network-capable install arguments', f => { f.records.installation.args = f.records.installation.args.filter(x => x !== '--offline'); }],
  ['missing dependency logs', f => { f.records.installation.logs = {}; }],
  ['audit failed', f => { f.records.audit.code = 1; }],
  ['changed frozen lock bytes', f => { f.write('productionLock.json', 'changed'); }],
  ['missing peer rules input', f => { delete f.profile.inputs.peerRules; }],
  ['materialization lacks lock report', f => { delete f.records.materialization.bindings[path.join(f.root, f.profile.inputs.lockReport.path)]; }],
  ['materialization prematurely claims runtime acceptance', f => { f.records.materialization.runtimeAcceptance = true; }],
  ['native Office failure', f => { f.records.nativeVerification.worker.checks[3].ok = false; }],
  ['native process remains alive', f => { f.records.nativeVerification.job.empty.activeProcesses = 1; }],
  ['wrong private powershell', f => { f.records.nativeVerification.powershell.version = '5.1'; }],
  ['Host is only preflight', f => { f.records.hostAcceptance.mode = 'preflight'; }],
  ['Host falsely claims installed acceptance', f => { f.records.hostAcceptance.installedProductAccepted = true; }],
  ['Host failed session restart', f => { f.records.hostAcceptance.checks.sessionRestartAndReadOnlyHistory = false; }],
  ['source profile downgrade', f => { f.records.sourceProfile.schemaVersion = 1; }],
]) test(`full v2 runtime rejects ${name}`, t => { const f = runtimeFixture(t); mutate(f); assert.throws(() => validateRuntime(f)); });
