'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const directory = path.resolve(__dirname, '../runtime/harness-official');
const read = file => fs.readFileSync(path.join(directory, file));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const compatibility = JSON.parse(read('source-compatibility.json'));
const manifest = JSON.parse(read('build-manifest.json'));
const repository = 'https://github.com/deepseek-ai/deepseek-harness.git';
const sourceHashes = {
  'runtime-tree.ts': 'aaef471a94c1bb295c7aecd080f2bf9f4fa037a8fc3f2d76c63db9b367c80778',
  'core-package-set.ts': '578403a76103a378a6abff4257cf45ee65b9e31d0b87b83a475d12da33f85667',
  'release.ts': 'ab4c40200893effa8e3ea0840c43630ba10403242f90ecccba49ae9a11c82140',
  'host-protocol.ts': '3ac3b9c5416144de212ed2e1fae3ae17a12dedd9389df99f07283012df5d77b9'
};

test('compatibility names the exact rc.2 source revision without rewriting the alpha.1 build', () => {
  assert.equal(compatibility.schemaVersion, 1);
  assert.equal(compatibility.kind, 'byte-identical-upstream-source-compatibility');
  assert.deepEqual(compatibility.upstream, {
    repository, tag: 'dsh-v0.2.1-rc.2', commit: '687f282e8625c6b8d11ff58211a90524be2e4317'
  });
  assert.deepEqual(compatibility.historicalBuild.upstream, {
    repository, tag: 'dsh-v0.2.1-alpha.1', commit: '5badb15009ae1756c3afe0ae0cef1faafc290ccc'
  });
  assert.deepEqual(manifest.upstream, compatibility.historicalBuild.upstream);
  assert.equal(compatibility.historicalBuild.file, 'build-manifest.json');
  assert.equal(compatibility.historicalBuild.sha256, '89f886a6bf0e5f8f5a602b1822a8e58fd22752e19db7f0e731d5c634bbbd170f');
  assert.equal(sha256(read('build-manifest.json')), compatibility.historicalBuild.sha256);
});

test('exactly four retained sources match both the compatibility record and historical build', () => {
  assert.deepEqual(manifest.sourceHashes, sourceHashes);
  assert.equal(compatibility.verification.sourceCount, 4);
  assert.deepEqual(compatibility.sources.map(source => source.file).sort(), Object.keys(sourceHashes).sort());
  for (const source of compatibility.sources) {
    assert.equal(source.vendoredPath, `sources/${source.file}`);
    assert.equal(source.upstreamPath, `apps/desktop/src/${source.file}`);
    assert.equal(source.sha256, sourceHashes[source.file]);
    assert.equal(sha256(read(source.vendoredPath)), source.sha256, source.file);
  }
});

test('the unchanged bundle and source map remain exactly bound to their original build', () => {
  assert.deepEqual(compatibility.outputs, [
    { file: 'runtime-tree.cjs', sha256: '1d862fa7d4027163f8761b8e63ff0678daba1c6bda3e1a8af35da6118db23b42' },
    { file: 'runtime-tree.cjs.map', sha256: '9552f07931e02b47877fea4f39f94b180c93c2d27c5ee326982677b54e81079e' }
  ]);
  const byFile = outputs => [...outputs].sort((a, b) => a.file.localeCompare(b.file));
  assert.deepEqual(byFile(compatibility.outputs), byFile(manifest.outputs));
  for (const output of compatibility.outputs) assert.equal(sha256(read(output.file)), output.sha256, output.file);
  const sourceMap = JSON.parse(read('runtime-tree.cjs.map'));
  assert.equal(sourceMap.sources.length, manifest.inputs.length);
  assert.equal(sourceMap.sourcesContent.length, sourceMap.sources.length);
  const retained = new Map(sourceMap.sources.map((file, index) => [file, sha256(Buffer.from(sourceMap.sourcesContent[index]))]));
  for (const input of manifest.inputs) assert.equal(retained.get(input.file), input.sha256, input.file);
});

test('compatibility does not claim a new build or runtime, host, installation or release acceptance', () => {
  assert.equal(compatibility.verification.verifiedOn, '2026-10-18');
  assert.equal(compatibility.verification.bundleRebuilt, false);
  for (const field of ['runtimeAccepted', 'hostAccepted', 'installationAccepted', 'releaseAccepted']) {
    assert.equal(compatibility[field], false, field);
  }
  assert.match(compatibility.scope, /original alpha\.1 build provenance/);
  assert.match(compatibility.scope, /not runtime payload, native behavior, desktop host, packaged installation or release acceptance/);
});
