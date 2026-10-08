'use strict';

// Additional reviewed patches must stay bound to the build, package set and materialized tree.
const assert = require('node:assert/strict');
const path = require('node:path');

function validateReviewedSourceChain({ root, profile, binding, records, inside, hashFile }) {
  const pin = binding.reviewedSourceChain;
  const names = ['sourceIntegration', 'sourceBuild', 'sourcePack', 'assemblyInputs'];
  if (!pin) {
    assert.ok(names.every(name => !profile.inputs[name]), 'Unpinned supplemental source evidence');
    const materializedPaths = [...Object.keys(records?.materialization?.before || {}), ...Object.keys(records?.materialization?.after || {})]
      .map(name => name.replaceAll('\\', '/'));
    assert.ok(!materializedPaths.some(name => /\/(integration-final|assembly-inputs)\.json$/.test(name)), 'Supplemental materialization cannot downgrade to legacy validation');
    return;
  }
  for (const name of names) assert.ok(records[name] && profile.inputs[name], `Missing supplemental evidence: ${name}`);
  assert.equal(pin.integrationSha256, profile.inputs.sourceIntegration.sha256);
  assert.equal(pin.assemblyInputsSha256, profile.inputs.assemblyInputs.sha256);
  const { sourceIntegration: integration, sourceBuild: build, sourcePack: pack, assemblyInputs: assembly, materialization } = records;
  assert.equal(integration.schemaVersion, 1);
  assert.equal(assembly.sourceVersion, binding.packageVersion);
  assert.equal(assembly.sourceCommit, binding.commit);
  assert.deepEqual(assembly.sourcePatchChain, integration.sourcePatchChain);
  assert.ok(integration.sourcePatchChain.length >= 2 && integration.sourcePatchChain.length <= 16);
  assert.equal(integration.sourcePatchChain[0], profile.inputs.sourcePatch.path);
  assert.equal(new Set(integration.sourcePatchChain).size, integration.sourcePatchChain.length);
  for (const [record, stage] of [[build, 'build'], [pack, 'pack']]) {
    assert.equal(record.stage, stage);
    for (const key of ['ok', 'inputsUnchanged', 'childClosed']) assert.equal(record[key], true);
    assert.deepEqual(record.after, record.before, 'Source changed during build or pack');
    assert.ok(record.stages.length > 0);
    assert.ok(record.stages.every(item => item.code === 0 && item.childClosed === true && !item.timedOut && !item.spawnError));
  }
  assert.ok(build.stages.some(item => item.name === 'build:official'));
  assert.ok(pack.stages.some(item => item.name === 'select-packages'));
  assert.deepEqual(build.after, pack.before, 'Pack does not use the reviewed build');
  assert.equal(build.clientBuildRecordSha256, pack.clientBuildRecordSha256);
  assert.deepEqual(assembly.packageSet, pack.packageSet);
  const normalize = map => {
    const result = {};
    for (const [name, digest] of Object.entries(map)) {
      const normalized = name.replaceAll('\\', '/');
      assert.ok(!Object.hasOwn(result, normalized), 'Duplicate source evidence path');
      result[normalized] = digest;
    }
    return result;
  };
  const inputs = normalize(assembly.sourceInputs);
  assert.ok(Object.keys(inputs).length > 0 && Object.keys(inputs).length <= 5000);
  for (const [file, digest] of Object.entries(normalize(build.after.fixed))) {
    assert.equal(inputs[file], digest, 'Assembly omits frozen build input: ' + file);
  }
  assert.equal(path.resolve(build.source), path.resolve(pack.source), 'Pack source directory differs');
  const sourceRelative = path.relative(root, build.source).replaceAll('\\', '/');
  inside(root, sourceRelative);
  for (const [file, digest] of Object.entries(normalize(build.after.files))) {
    const relative = `${sourceRelative}/${file}`;
    inside(root, relative);
    assert.equal(inputs[relative], digest, 'Assembly omits final source: ' + file);
  }
  assert.equal(inputs[`${sourceRelative}/.dsh-build/client-build-environment.json`], build.clientBuildRecordSha256);
  assert.equal(path.resolve(assembly.buildFile), path.resolve(inside(root, profile.inputs.sourceBuild.path)));
  assert.equal(path.resolve(assembly.packFile), path.resolve(inside(root, profile.inputs.sourcePack.path)));
  for (const name of ['sourceIntegration', 'sourceBuild', 'sourcePack', 'sourcePatch']) {
    assert.equal(inputs[profile.inputs[name].path], profile.inputs[name].sha256, `Assembly omits ${name}`);
  }
  for (const file of integration.sourcePatchChain) assert.ok(inputs[file], 'Assembly omits a source patch');
  for (const [file, digest] of Object.entries(integration.inputFiles)) assert.equal(inputs[file], digest, 'Integration input omitted');
  for (const entry of integration.files) {
    assert.equal(inputs[entry.postimage], entry.afterSha256, 'Reviewed postimage omitted');
    assert.ok(Object.entries(build.after.files).some(([file, digest]) => file === entry.path && digest === entry.afterSha256), 'Build source differs from reviewed postimage');
  }
  const materializedBefore = normalize(materialization.before);
  const materializedAfter = normalize(materialization.after);
  assert.deepEqual(materializedBefore, materializedAfter, 'Materialization inputs changed');
  assert.equal(materializedBefore[profile.inputs.assemblyInputs.path], profile.inputs.assemblyInputs.sha256, 'Materialization omits supplemental provenance');
  for (const [file, digest] of Object.entries(inputs)) {
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(hashFile(inside(root, file)), digest, 'Supplemental input changed: ' + file);
    assert.equal(materializedBefore[file], digest, 'Materialization omits build input: ' + file);
  }
}

module.exports = { validateReviewedSourceChain };
