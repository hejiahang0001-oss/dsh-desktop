'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateReviewedSourceChain: validate } = require('../scripts/reviewed-source-chain.cjs');

function fixture() {
  const digest = 'a'.repeat(64), inputs = {};
  for (const name of ['sourceIntegration', 'sourceBuild', 'sourcePack', 'assemblyInputs', 'sourcePatch']) inputs[name] = { path: `${name}.json`, sha256: digest };
  const root = path.resolve('fixture'), source = path.join(root, 'checkout');
  const state = { files: { 'src/fix.ts': digest, 'src/hub.ts': digest, 'src/facade.ts': digest }, fixed: { 'sourcePatch.json': digest } };
  const sourceIntegration = { schemaVersion: 1, sourcePatchChain: ['sourcePatch.json', 'supplement.patch'],
    inputFiles: { 'supplement.patch': digest, 'postimage.ts': digest }, files: [{ path: 'src/fix.ts', postimage: 'postimage.ts', afterSha256: digest }] };
  const sourceInputs = Object.fromEntries(['sourceIntegration.json', 'sourceBuild.json', 'sourcePack.json', 'sourcePatch.json', 'supplement.patch', 'postimage.ts',
    'checkout/src/fix.ts', 'checkout/src/hub.ts', 'checkout/src/facade.ts', 'checkout/.dsh-build/client-build-environment.json'].map(file => [file, digest]));
  const common = { source, ok: true, childClosed: true, inputsUnchanged: true, before: state, after: state, clientBuildRecordSha256: digest };
  const packageSet = { path: 'fixture-package-set', sha256: digest };
  const records = { sourceIntegration,
    sourceBuild: { ...common, stage: 'build', stages: [{ name: 'build:official', code: 0, childClosed: true }] },
    sourcePack: { ...common, stage: 'pack', packageSet, stages: [{ name: 'select-packages', code: 0, childClosed: true }] },
    assemblyInputs: { sourceVersion: '1', sourceCommit: 'commit', sourcePatchChain: sourceIntegration.sourcePatchChain, sourceInputs, packageSet,
      buildFile: path.join(root, 'sourceBuild.json'), packFile: path.join(root, 'sourcePack.json') },
    materialization: { before: { ...sourceInputs, 'assemblyInputs.json': digest }, after: { ...sourceInputs, 'assemblyInputs.json': digest } } };
  return { root, profile: { inputs }, binding: { packageVersion: '1', commit: 'commit', reviewedSourceChain: { integrationSha256: digest, assemblyInputsSha256: digest } }, records,
    inside: (base, file) => path.join(base, file), hashFile: () => digest };
}

test('binds supplemental source to successful unchanged build, pack and materialization', () => validate(fixture()));
test('legacy evidence remains valid but supplemental evidence cannot silently downgrade', () => {
  validate({ binding: {}, profile: { inputs: {} } });
  const f = fixture(); delete f.binding.reviewedSourceChain;
  assert.throws(() => validate(f), /Unpinned/);
});
test('deleting all top-level supplemental fields still cannot downgrade new materialization', () => {
  const f = fixture(); delete f.binding.reviewedSourceChain;
  for (const name of ['sourceIntegration', 'sourceBuild', 'sourcePack', 'assemblyInputs']) delete f.profile.inputs[name];
  f.records.materialization.before['build/assembly-new/assembly-inputs.json'] = 'a'.repeat(64);
  assert.throws(() => validate(f), /cannot downgrade/);
});
for (const [label, change] of [
  ['missing integration pin', f => { f.binding.reviewedSourceChain.integrationSha256 = 'b'.repeat(64); }],
  ['failed build', f => { f.records.sourceBuild.stages[0].code = 1; }],
  ['unclosed pack', f => { f.records.sourcePack.childClosed = false; }],
  ['different pack source', f => { f.records.sourcePack.before = {}; }],
  ['missing supplemental patch', f => { delete f.records.assemblyInputs.sourceInputs['supplement.patch']; }],
  ['wrong postimage', f => { f.records.sourceIntegration.files[0].afterSha256 = 'b'.repeat(64); }],
  ['omitted materialized provenance', f => { delete f.records.materialization.before['assemblyInputs.json']; delete f.records.materialization.after['assemblyInputs.json']; }],
  ['changed materialization', f => { f.records.materialization.after.extra = 'b'.repeat(64); }],
  ['changed current source', f => { f.hashFile = () => 'b'.repeat(64); }],
  ['omitted runtime hub', f => { delete f.records.assemblyInputs.sourceInputs['checkout/src/hub.ts']; }],
  ['omitted runtime facade', f => { delete f.records.assemblyInputs.sourceInputs['checkout/src/facade.ts']; }],
  ['omitted frozen input', f => { f.records.sourceBuild.after.fixed.extra = 'a'.repeat(64); }],
  ['wrong client build record', f => { f.records.assemblyInputs.sourceInputs['checkout/.dsh-build/client-build-environment.json'] = 'b'.repeat(64); }],
  ['wrong pack record path', f => { f.records.assemblyInputs.packFile = 'other-record.json'; }],
]) test(`rejects ${label}`, () => { const f = fixture(); change(f); assert.throws(() => validate(f)); });
