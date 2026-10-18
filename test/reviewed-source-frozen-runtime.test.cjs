'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { inside } = require('../scripts/deploy-reviewed-harness-runtime.cjs');
const { validateBoundedDependencyStage, validateSourceFrozenDependencies } = require('../scripts/reviewed-runtime-evidence-v2.cjs');
const digest = text => createHash('sha256').update(text).digest('hex');
function fixture(t, stage = 'install') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bounded-dependency-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { const target = inside(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); return { path: file, sha256: digest(text), bytes: Buffer.byteLength(text) }; };
  const refs = { preparationEvidence: write('derived/preparation.json', '{}'), lockReport: write('derived/lock-verification.json', '{}'),
    productionLock: write('derived/pnpm-lock.yaml', 'lock'), node: write('node.exe', 'node'),
    dependencyController: write('control.cjs', 'control'), dependencyStageController: write('stage.cjs', 'stage') };
  refs[stage === 'install' ? 'installation' : 'audit'] = write(stage + '/result.json', '{}');
  const pnpm = write('toolchain/node_modules/.pnpm/pnpm@11.28.5/node_modules/pnpm/bin/pnpm.cjs', 'pnpm');
  write(stage + '/empty.npmrc', ''); fs.mkdirSync(path.join(root, stage, 'home'));
  const audit = { advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, dependencies: 603 } };
  const logs = { stdout: write(stage + '/stdout.log', stage === 'audit' ? JSON.stringify(audit) : 'installed'), stderr: write(stage + '/stderr.log', '') };
  for (const log of Object.values(logs)) Object.assign(log, { observedBytes: log.bytes, truncated: false });
  const fixed = { packageManager: 'pnpm@11.28.5', version: 'fixture' }, args = [stage, '--prod', ...(stage === 'install' ? ['--offline'] : ['--json'])];
  const options = { fixed, args, limits: { streamBytes: 4194304 }, pnpmEntrySha256: pnpm.sha256 };
  const cleanRef = name => ({ path: refs[name].path, sha256: refs[name].sha256 });
  const receipt = { schemaVersion: 1, type: 'bounded-source-frozen-runtime-stage', stage, fixed,
    scriptSha256: refs.dependencyStageController.sha256, controller: cleanRef('dependencyController'),
    preparation: cleanRef('preparationEvidence'), lockVerification: cleanRef('lockReport'),
    lockBeforeSha256: refs.productionLock.sha256, lockAfterSha256: refs.productionLock.sha256,
    ok: true, packageManagerExecuted: true, sourceInputsUnchanged: true, preparedInputsUnchanged: true,
    dependencyMaterializationRequested: stage === 'install', offlineRequested: stage === 'install',
    lifecycleScriptsDisabled: true, pnpmHooksDisabled: true, sourceBuildExecuted: false, nativeRebuildExecuted: false,
    runtimeDeployed: false, fullRuntimeAcceptance: false, promotionAllowed: false, childClosed: true,
    processSucceeded: true, code: 0, signal: null, exit: { code: 0, signal: null, at: '2026-10-17T00:00:01Z' },
    startedAt: '2026-10-17T00:00:00Z', closedAt: '2026-10-17T00:00:02Z', processFinishedAt: '2026-10-17T00:00:02Z', finishedAt: '2026-10-17T00:00:03Z', limits: options.limits,
    command: { executable: inside(root, refs.node.path), args: [inside(root, pnpm.path), ...args], cwd: 'derived' },
    environment: { inheritedCredentials: false, inheritedProxy: false, isolatedHome: stage + '/home', npmrc: stage + '/empty.npmrc', registry: 'https://registry.npmjs.org/' }, logs };
  if (stage === 'audit') receipt.audit = { vulnerabilities: audit.metadata.vulnerabilities, knownModerateOrHigher: 0, dependencies: 603 };
  return { context: { root, inside, profile: { inputs: refs } }, receipt, options, write };
}
test('schema1 bounded install receipt is admitted without inventing legacy fields', t => { const f = fixture(t); validateBoundedDependencyStage(f.context, f.receipt, 'install', f.options); });
test('schema1 audit is checked against actual JSON log and coverage', t => { const f = fixture(t, 'audit'); validateBoundedDependencyStage(f.context, f.receipt, 'audit', f.options); });
for (const [label, mutate] of [
  ['unclosed child', f => { f.receipt.childClosed = false; }],
  ['fake launcher exit success', f => { f.receipt.exit.code = 1; }],
  ['timeout despite code zero', f => { f.receipt.timedOut = true; }],
  ['changed lock', f => { f.receipt.lockAfterSha256 = 'a'.repeat(64); }],
  ['source mutation', f => { f.receipt.sourceInputsUnchanged = false; }],
  ['prepared mutation', f => { f.receipt.preparedInputsUnchanged = false; }],
  ['enabled hooks', f => { f.receipt.pnpmHooksDisabled = false; }],
  ['missing offline arg', f => { f.receipt.command.args = f.receipt.command.args.filter(x => x !== '--offline'); }],
  ['unbound controller', f => { f.receipt.controller.sha256 = 'b'.repeat(64); }],
  ['wrong prepare', f => { f.receipt.preparation.path = 'other.json'; }],
  ['inherited credentials', f => { f.receipt.environment.inheritedCredentials = true; }],
  ['truncated log', f => { f.receipt.logs.stdout.truncated = true; }],
  ['false full acceptance', f => { f.receipt.fullRuntimeAcceptance = true; }],
  ['logs changed', f => { f.write('install/stdout.log', 'changed'); }],
  ['nonempty npmrc', f => { f.write('install/empty.npmrc', 'token=secret-placeholder'); }],
]) test('bounded receipt rejects ' + label, t => { const f = fixture(t); mutate(f); assert.throws(() => validateBoundedDependencyStage(f.context, f.receipt, 'install', f.options), assert.AssertionError); });
test('audit summary cannot hide real vulnerabilities in the bound stdout', t => {
  const f = fixture(t, 'audit'), report = { advisories: { one: {} }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0 }, dependencies: 603 } };
  const ref = f.write('audit/stdout.log', JSON.stringify(report)); f.receipt.logs.stdout = { ...ref, observedBytes: ref.bytes, truncated: false };
  assert.throws(() => validateBoundedDependencyStage(f.context, f.receipt, 'audit', f.options), assert.AssertionError);
});
for (const [label, mutate] of [
  ['old preparation schema', c => { c.records.preparationEvidence.schemaVersion = 1; }],
  ['old preparation revision', c => { c.records.preparationEvidence.preparationRevision = 1; }],
  ['unknown lock type', c => { c.records.lockReport.type = 'candidate-only'; }],
  ['unknown lock schema', c => { c.records.lockReport.schemaVersion = 2; }],
]) test('explicit new admission rejects ' + label + ' before loading helpers', t => {
  const f = fixture(t), c = f.context;
  c.records = { preparationEvidence: { schemaVersion: 2, preparationRevision: 2, type: 'source-frozen-runtime-metadata-preparation' },
    lockReport: { schemaVersion: 1, type: 'source-frozen-runtime-lock-verification' } };
  mutate(c); assert.throws(() => validateSourceFrozenDependencies(c, f.options.fixed), assert.AssertionError);
});
test('a rebound malicious validator is rejected by the exact reviewed code pin before require', t => {
  const f = fixture(t), c = f.context;
  c.records = { preparationEvidence: { schemaVersion: 2, preparationRevision: 2, type: 'source-frozen-runtime-metadata-preparation' },
    lockReport: { schemaVersion: 1, type: 'source-frozen-runtime-lock-verification' } };
  c.profile.inputs.lockValidator = f.write('malicious.cjs', 'globalThis.__unreviewedValidatorExecuted = true;');
  assert.throws(() => validateSourceFrozenDependencies(c, f.options.fixed), /Unreviewed lockValidator/);
  assert.equal(globalThis.__unreviewedValidatorExecuted, undefined);
});
