'use strict';
// Synthetic receipts with real local bytes; these tests do not claim a live build or install.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inside } = require('../scripts/deploy-reviewed-harness-runtime.cjs');
const { validateReviewedSourceChain: validate } = require('../scripts/reviewed-source-chain.cjs');
const { digest } = require('../scripts/reviewed-source-chain-v2.cjs');

function fixture(t, postVerification = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-frozen-v1-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const full = path.join(root, name); fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
    return { path: name, sha256: digest(fs.readFileSync(full)) };
  };
  const identity = { version: '0.2.1-rc.2', tag: 'dsh-v0.2.1-rc.2', commit: 'a'.repeat(40), repository: 'https://example.test/official.git' };
  const binding = { packageVersion: identity.version, tag: identity.tag, commit: identity.commit, repository: identity.repository,
    node: { version: '24.19.0' }, reviewedSourceChain: { schemaVersion: 2, receiptFormat: 'source-frozen-v1' } };
  const profile = { schemaVersion: 2, inputs: {} }, records = {};
  const input = (name, value, filename = `${name}.json`) => {
    records[name] = value; profile.inputs[name] = write(filename, value); return profile.inputs[name];
  };
  const node = input('node', 'fixture node', 'toolchain/node.exe'); binding.node.sha256 = node.sha256;
  const pnpm = write('toolchain/pnpm/bin/pnpm.cjs', 'fixture pnpm');
  const pnpmManifest = write('toolchain/pnpm/package.json', { version: '11.28.5' });
  const patch = write('patches/reviewed.patch', 'fixture patch');
  const applyScript = write('scripts/apply-source.cjs', 'fixture apply script');
  const verifyScript = write('scripts/verify-source.cjs', 'fixture verification script');
  const lock = write('source/pnpm-lock.yaml', 'fixture reviewed lock');
  const workspace = write('source/pnpm-workspace.yaml', 'fixture workspace');
  const manifest = write('source/package.json', { version: identity.version, packageManager: 'pnpm@11.28.5' });
  const host = write('source/src/host.ts', 'fixture host source');
  const sourceMap = { 'package.json': manifest.sha256, 'pnpm-lock.yaml': lock.sha256,
    'pnpm-workspace.yaml': workspace.sha256, 'src/host.ts': host.sha256 };
  const files = [{ path: 'src/host.ts', preimageSha256: null, sha256: host.sha256, matches: true }];
  const protectedMap = { 'scripts/apply-source.cjs': applyScript.sha256 };
  const replay = { schemaVersion: 1, identity, source: 'source', scriptSha256: applyScript.sha256, ok: true,
    files, patches: [{ ...patch, check: true, applied: true }], buildVerified: false, runtimeDeployed: false, promotionAllowed: false,
    upstreamLockSha256: digest('official lock'), lockSha256: lock.sha256, workspaceSha256: workspace.sha256,
    protectedBefore: protectedMap, protectedAfter: protectedMap, upstreamChangedFiles: 1, patchIntersections: ['pnpm-lock.yaml'] };
  const replayPin = { type: 'localized-patch-replay-on-new-official-lock', upstreamLockSha256: replay.upstreamLockSha256,
    replayedLockSha256: lock.sha256, sourceReplayScriptPath: applyScript.path, sourceReplayScriptSha256: applyScript.sha256 };
  let failure, review;
  if (postVerification) {
    failure = { ...replay, ok: false, error: 'AssertionError: post-apply source metadata check failed',
      preimageTree: 'b'.repeat(40), postimageTree: 'c'.repeat(40) };
    const failureRef = write('replay/original-failure.json', failure);
    const before = write('replay/sourceBefore.json', sourceMap), after = write('replay/sourceAfter.json', sourceMap);
    Object.assign(replay, { type: 'independent-post-verification-of-applied-replay', scriptSha256: verifyScript.sha256,
      originalFailedReplay: failureRef, originalFailurePreserved: true, patchApplicationExecuted: false, sourceWriteExecuted: false,
      frozenInstallVerified: false, sourceInputsUnchanged: true, patches: [patch],
      sourceBefore: { ...before, count: 4 }, sourceAfter: { ...after, count: 4 }, preimageTree: failure.preimageTree, postimageTree: failure.postimageTree,
      lockComparison: { equalToReviewedAlpha5ExceptFourOfficialImporters: true, existingChangesInDependencies: true, frozenInstallVerified: false } });
    Object.assign(replayPin, { verificationType: replay.type, sourceReplayScriptPath: verifyScript.path, sourceReplayScriptSha256: verifyScript.sha256,
      originalFailureScope: { type: 'post-apply-source-metadata-assertion', errorSha256: digest(failure.error),
        scriptPath: applyScript.path, scriptSha256: applyScript.sha256, patchCount: 1, fileCount: 1 } });
  }
  Object.assign(replayPin, write('replay/result.json', replay));
  review = { schemaVersion: 1, identity, receipt: { path: replayPin.path, sha256: replayPin.sha256 },
    findings: { Blocking: [] }, status: { patchReplayAndLockReviewPassed: true, buildVerified: false, runtimeDeployed: false,
      installedOrPublishedByThisReview: false, promotionAllowed: false } };
  if (postVerification) Object.assign(review, { originalFailedReplay: replay.originalFailedReplay, originalFailurePreserved: true });
  const reviewRef = write('replay/review.json', review);
  Object.assign(replayPin, { reviewPath: reviewRef.path, reviewSha256: reviewRef.sha256 });
  input('sourceIntegration', { schemaVersion: 1, identity, source: 'source', ok: true, files, patchChain: [patch], lockReplay: replayPin,
    buildVerified: false, runtimeDeployed: false, promotionAllowed: false });
  input('sourceProfile', { schemaVersion: 2, ...identity, packageManager: 'pnpm@11.28.5', promotionAllowed: false, preflightOnly: true,
    lockSha256: lock.sha256, upstreamLockSha256: replay.upstreamLockSha256, workspaceSha256: workspace.sha256,
    postimagePath: profile.inputs.sourceIntegration.path, postimageSha256: profile.inputs.sourceIntegration.sha256,
    patchChain: [patch], lockReplay: replayPin });
  const fixed = Object.fromEntries([node, pnpm, pnpmManifest, patch, applyScript, verifyScript,
    profile.inputs.sourceIntegration, profile.inputs.sourceProfile, { path: replayPin.path, sha256: replayPin.sha256 }, reviewRef].map(x => [x.path, x.sha256]));
  const clientBuild = { formatVersion: 1, environment: { DSH_CLIENT_BUILD_PROFILE: 'official', DSH_CLIENT_COMMIT_HASH: identity.commit.slice(0, 7),
    DSH_CLIENT_TITLE: 'DeepSeek Harness', DSH_CLIENT_VERSION: identity.version }, artifacts: { fileCount: 1, sha256: digest('client files') } };
  const client = write('source/.dsh-build/client-build-environment.json', clientBuild);
  const generated = write('source/lib/host.js', 'fixture generated host');
  const outputMap = Object.fromEntries([client, generated].map(item => [item.path.replace(/^source\//, ''),
    { sha256: item.sha256, bytes: fs.statSync(path.join(root, item.path)).size }]));
  const outputStats = (where, map) => ({ count: Object.keys(map).length, bytes: Object.values(map).reduce((sum, item) => sum + item.bytes, 0), manifestSha256: write(where, map).sha256 });
  const sourceStats = where => ({ count: 4, contentSha256: digest(JSON.stringify(sourceMap)), manifestSha256: write(where, sourceMap).sha256 });
  const log = write('stages.log', 'fixture command logs'); const absolute = file => path.join(root, file);
  const stage = (name, args, build = false) => ({ name, executable: absolute(node.path), args: [absolute(pnpm.path), ...args], cwd: 'source',
    code: 0, signal: null, childClosed: true, exit: { at: '2026-10-17T00:00:01Z', code: 0, signal: null },
    startedAt: '2026-10-17T00:00:00Z', [build ? 'closedAt' : 'finishedAt']: '2026-10-17T00:00:01Z',
    logs: { stdout: { ...log, bytes: 20 }, stderr: { ...log, bytes: 20 } }, ok: true,
    ...(build ? { gates: [{ label: 'fixture gate', started: true, status: 'passed' }], summary: { passed: 1, failed: 0, skipped: 0 } }
      : { inputsUnchanged: true, generatedChanges: [] }) });
  const environment = { isolatedHome: 'isolated-home', offlinePackageManager: true, ignoreLifecycleScripts: true, inheritedCredentials: false };
  const common = { schemaVersion: 1, identity, source: 'source', ok: true, startedAt: '2026-10-17T00:00:00Z', finishedAt: '2026-10-17T00:00:02Z',
    installExecuted: false, runtimeDeployed: false, promotionAllowed: false, fullRuntimeAcceptance: false,
    environment, inputsUnchanged: true, fixedInputsUnchanged: true, verificationErrors: [] };
  const build = { ...common, type: 'source-frozen-build-only', packExecuted: false, fixedBefore: fixed, fixedAfter: fixed,
    sourceBefore: sourceStats('build/source-before.json'), sourceAfter: sourceStats('build/source-after.json'), changedInputs: [], extraInputs: [],
    outputs: { ...outputStats('build/outputs-after.json', outputMap), added: Object.keys(outputMap), changed: [], removed: [] },
    clientBuild, clientBuildRecordSha256: client.sha256, stages: [stage('build:official', ['run', 'build:official'], true)] };
  input('sourceBuild', build, 'build/result.json');
  const body = Buffer.from('full synthetic TGZ bytes'), entry = { name: '@deepseek-ai/node-addon-system', version: '0.1.2', file: 'native.tgz',
    bytes: body.length, integrity: `sha512-${digest(body, 'sha512', 'base64')}` };
  const tarball = write('pack/packed/landlock/native.tgz', body);
  write('pack/package-set/desktop-packages/native.tgz', body);
  const packageSet = write('pack/package-set/desktop-packages.json', { schemaVersion: 1, packages: [entry] });
  const out = family => absolute(`pack/packed/${family}`);
  const commandStages = [
    ['pack-dsh', ['run', 'release:pack', '--family', 'dsh', '--out', out('dsh'), '--concurrency', '2']],
    ['pack-host', ['--dir', 'apps/desktop-host', 'pack', '--pack-destination', out('dsh')]],
    ['pack-vendor', ['run', 'release:pack', '--family', 'vendor', '--out', out('vendor'), '--concurrency', '2']],
    ['native-ts', ['--dir', 'native/system', 'run', 'build:ts']],
    ['pack-native-entry', ['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', out('landlock')]],
    ['select-packages', ['--dir', 'apps/desktop', 'exec', 'tsx', 'scripts/prepare-package-set.ts', '--from', out('dsh'), '--from', out('vendor'), '--from', out('landlock'), '--out', absolute('pack/package-set')]],
  ];
  const pack = { ...common, type: 'source-frozen-pack-only', buildOfficialExecuted: false, sourceEquivalenceClaimed: false,
    scriptSha256: write('scripts/pack.cjs', 'fixture pack controller').sha256, sourceBuild: profile.inputs.sourceBuild,
    buildManifests: Object.fromEntries([['sourceBefore', 'source-before.json'], ['sourceAfter', 'source-after.json'], ['outputsAfter', 'outputs-after.json']]
      .map(([key, name]) => [key, { path: `build/${name}`, sha256: digest(fs.readFileSync(absolute(`build/${name}`))) }])),
    sourceBefore: sourceStats('pack/source-before.json'), sourceAfter: sourceStats('pack/source-after.json'),
    outputsBefore: outputStats('pack/outputs-before.json', outputMap), outputs: { ...outputStats('pack/outputs-after.json', outputMap), changed: [] },
    clientBuildBefore: clientBuild, clientBuildAfter: clientBuild, clientBuildRecordSha256: client.sha256,
    nativeEntryTarball: { name: entry.name, version: entry.version, sourceTarball: tarball.path, sha256: tarball.sha256,
      memberListSha256: digest('native members'), exportedFiles: ['package/lib/index.js'], actualPackedExportsVerified: true },
    packageProvenance: { [entry.name]: { sourceTarball: tarball.path, sha256: tarball.sha256, bytes: body.length } },
    packageSet: { ...packageSet, count: 1, packages: [{ ...entry, sha256: digest(body) }] },
    stages: commandStages.map(([name, args]) => stage(name, args)) };
  input('sourcePack', pack, 'pack/result.json');
  input('preparationEvidence', { packReceipt: profile.inputs.sourcePack });
  profile.inputs.packageSet = packageSet; records.packageSet = JSON.parse(fs.readFileSync(absolute(packageSet.path)));
  for (const name of ['sourceBuild', 'sourcePack', 'sourceIntegration']) binding.reviewedSourceChain[`${name}Sha256`] = profile.inputs[name].sha256;
  const refresh = () => {
    Object.assign(replayPin, write(replayPin.path, replay));
    review.receipt = { path: replayPin.path, sha256: replayPin.sha256 };
    const updatedReview = write(replayPin.reviewPath, review); replayPin.reviewSha256 = updatedReview.sha256;
    input('sourceIntegration', records.sourceIntegration);
    records.sourceProfile.postimageSha256 = profile.inputs.sourceIntegration.sha256;
    input('sourceProfile', records.sourceProfile);
    for (const entry of [profile.inputs.sourceProfile, profile.inputs.sourceIntegration,
      { path: replayPin.path, sha256: replayPin.sha256 }, updatedReview]) fixed[entry.path] = entry.sha256;
    input('sourceBuild', build, 'build/result.json'); pack.sourceBuild = profile.inputs.sourceBuild;
    input('sourcePack', pack, 'pack/result.json'); input('preparationEvidence', { packReceipt: profile.inputs.sourcePack });
    for (const name of ['sourceBuild', 'sourcePack', 'sourceIntegration']) binding.reviewedSourceChain[`${name}Sha256`] = profile.inputs[name].sha256;
  };
  return { root, profile, binding, records, inside, write, input, replay, replayPin, review, failure, sourceMap, outputMap, refresh, outputStats };
}

test('raw schema1 source receipts are admitted only through explicit source-frozen-v1', t => validate(fixture(t)));
test('independent replay post-verification preserves and validates the failed application receipt', t => validate(fixture(t, true)));
test('original pack output-before summary may omit bytes only when the complete map equals build outputs', t => {
  const f = fixture(t); delete f.records.sourcePack.outputsBefore.bytes; f.refresh(); validate(f);
});
test('only declared native-ts generated output may differ after pack', t => {
  const f = fixture(t), name = 'native/system/tsconfig.tsbuildinfo', value = f.write(`source/${name}`, 'native incremental build data');
  f.outputMap[name] = { bytes: fs.statSync(path.join(f.root, value.path)).size, sha256: value.sha256 };
  f.records.sourcePack.outputs = { ...f.outputStats('pack/outputs-after.json', f.outputMap), changed: [name] };
  f.records.sourcePack.stages[3].generatedChanges = [name]; f.refresh(); validate(f);
});
test('pnpm fixed-version junction is read without allowing arbitrary evidence redirection', t => {
  const f = fixture(t), prefix = 'artifacts/upstream-checks/2026-10-17/toolchain/node_modules';
  const target = `${prefix}/.pnpm/pnpm@11.28.5/node_modules/pnpm`;
  const cjs = f.write(`${target}/bin/pnpm.cjs`, 'fixture pnpm');
  const manifest = f.write(`${target}/package.json`, { version: '11.28.5' });
  fs.symlinkSync(path.join(f.root, target), path.join(f.root, prefix, 'pnpm'), 'junction');
  const pnpm = `${prefix}/pnpm/bin/pnpm.cjs`;
  f.records.sourceBuild.fixedBefore[pnpm] = cjs.sha256;
  f.records.sourceBuild.fixedBefore[`${prefix}/pnpm/package.json`] = manifest.sha256;
  for (const stage of [...f.records.sourceBuild.stages, ...f.records.sourcePack.stages]) stage.args[0] = path.join(f.root, pnpm);
  f.refresh(); validate(f);
});
for (const [label, mutate] of [
  ['claimed fresh patch application', f => { f.replay.patchApplicationExecuted = true; }],
  ['source written during verification', f => { f.replay.sourceWriteExecuted = true; }],
  ['different failure error scope', f => { f.replayPin.originalFailureScope.errorSha256 = 'f'.repeat(64); }],
  ['wrong patch count', f => { f.replayPin.originalFailureScope.patchCount++; }],
  ['wrong postimage count', f => { f.replayPin.originalFailureScope.fileCount++; }],
  ['post-verification review blocking finding', f => { f.review.findings.Blocking = ['unresolved failure']; }],
  ['post-verification source map differs', f => { f.replay.sourceAfter = { ...f.write('replay/altered-map.json', {}), count: 0 }; }],
  ['original application was not completed', f => {
    f.failure.patches = f.failure.patches.map(item => ({ ...item, applied: false }));
    f.replay.originalFailedReplay = f.write('replay/original-failure.json', f.failure);
    f.review.originalFailedReplay = f.replay.originalFailedReplay;
  }],
  ['original failure falsely rewritten successful', f => {
    f.failure.ok = true; f.replay.originalFailedReplay = f.write('replay/original-failure.json', f.failure);
    f.review.originalFailedReplay = f.replay.originalFailedReplay;
  }],
  ['pack mutates generated host under fresh manifest', f => {
    const value = f.write('source/lib/host.js', 'different generated host');
    f.outputMap['lib/host.js'] = { sha256: value.sha256, bytes: fs.statSync(path.join(f.root, value.path)).size };
    f.records.sourcePack.outputs = { ...f.outputStats('pack/outputs-after.json', f.outputMap), changed: ['lib/host.js'] };
    f.records.sourcePack.stages[3].generatedChanges = ['lib/host.js'];
  }],
  ['before-map without bytes is not the bound build output', f => {
    delete f.records.sourcePack.outputsBefore.bytes;
    f.records.sourcePack.outputsBefore.manifestSha256 = f.write('pack/outputs-before.json', {}).sha256;
    f.records.sourcePack.outputsBefore.count = 0;
  }],
  ['historical tarball bytes outside the current pack run', f => {
    const bytes = fs.readFileSync(path.join(f.root, 'pack/packed/landlock/native.tgz'));
    f.write('old-pack/native.tgz', bytes);
    f.records.sourcePack.packageProvenance['@deepseek-ai/node-addon-system'].sourceTarball = 'old-pack/native.tgz';
  }],
]) test(`rebound source-frozen-v1 still rejects ${label}`, t => {
  const f = fixture(t, true); mutate(f); f.refresh(); assert.throws(() => validate(f));
});
for (const [label, mutate] of [
  ['implicit raw downgrade', f => { delete f.binding.reviewedSourceChain.receiptFormat; }],
  ['unknown raw schema', f => { f.records.sourceBuild.schemaVersion = 2; }],
  ['missing build close event', f => { f.records.sourceBuild.stages[0].childClosed = false; }],
  ['nonzero exit event despite code zero', f => { f.records.sourceBuild.stages[0].exit.code = 1; }],
  ['missing build gate', f => { f.records.sourceBuild.stages[0].gates = []; }],
  ['live credentials in build', f => { f.records.sourceBuild.environment.inheritedCredentials = true; }],
  ['native build execution instead of TypeScript', f => { f.records.sourcePack.stages[3].args[4] = 'build'; }],
  ['changed source manifest bytes', f => f.write('build/source-before.json', {})],
  ['source bytes changed', f => f.write('source/src/host.ts', 'changed source')],
  ['unrecorded source file', f => f.write('source/src/extra.ts', 'injected')],
  ['source directory traversal', f => { f.records.sourceBuild.source = '../source'; }],
  ['changed generated Host', f => f.write('source/lib/host.js', 'changed generated host')],
  ['package set consumed from another receipt', f => { f.records.preparationEvidence.packReceipt = f.profile.inputs.sourceBuild; }],
  ['package provenance changed', f => f.write('pack/packed/landlock/native.tgz', 'changed native bytes')],
  ['client identity changed', f => { f.records.sourcePack.clientBuildAfter = {}; }],
  ['missing native export evidence', f => { f.records.sourcePack.nativeEntryTarball.actualPackedExportsVerified = false; }],
  ['unknown replay verification type', f => { f.records.sourceProfile.lockReplay.verificationType = 'guess'; }],
  ['undeclared failure scope', f => { delete f.records.sourceProfile.lockReplay.originalFailureScope; }],
  ['edited original failure', f => f.write('replay/original-failure.json', { ...f.failure, ok: true })],
  ['changed original apply script', f => f.write('scripts/apply-source.cjs', 'changed apply source')],
  ['claimed fresh patch application', f => { f.replay.patchApplicationExecuted = true; f.write('replay/result.json', f.replay); }],
]) test(`source-frozen-v1 rejects ${label}`, t => { const f = fixture(t, true); mutate(f); assert.throws(() => validate(f)); });
