'use strict';

// Build-only recipe. No dependency installation and no application/runtime deployment.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const cryptoHash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = Object.freeze({
  'runtime-tree.ts': 'aaef471a94c1bb295c7aecd080f2bf9f4fa037a8fc3f2d76c63db9b367c80778',
  'core-package-set.ts': '578403a76103a378a6abff4257cf45ee65b9e31d0b87b83a475d12da33f85667',
  'release.ts': 'ab4c40200893effa8e3ea0840c43630ba10403242f90ecccba49ae9a11c82140',
  'host-protocol.ts': '3ac3b9c5416144de212ed2e1fae3ae17a12dedd9389df99f07283012df5d77b9'
});
const root = path.resolve(__dirname, '../..');
const candidateModules = path.join(root, 'artifacts/harness-021-final-replay/node_modules/.pnpm');
const esbuildRoot = path.join(candidateModules, 'esbuild@0.28.1/node_modules/esbuild');
const esbuildBinary = path.join(candidateModules, '@esbuild+win32-x64@0.28.1/node_modules/@esbuild/win32-x64/esbuild.exe');
const semverRoot = path.join(candidateModules, 'semver@7.8.5/node_modules/semver');

async function build() {
  const assertHash = (file, expected) => {
    if (cryptoHash(fs.readFileSync(file)) !== expected) throw new Error('Official verifier build input hash mismatch.');
  };
  if (process.version !== 'v24.19.0') throw new Error('Expected the fixed project Node 24.19.0.');
  assertHash(process.execPath, '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237');
  for (const [name, hash] of Object.entries(sourceHashes)) assertHash(path.join(__dirname, 'sources', name), hash);
  assertHash(path.join(esbuildRoot, 'lib/main.js'), '8331fe1d8b3a07381f33cc425fcfaa94776e263113653f80ec3ba433e9657e73');
  assertHash(esbuildBinary, 'ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3');
  if (JSON.parse(fs.readFileSync(path.join(esbuildRoot, 'package.json'))).version !== '0.28.1'
    || JSON.parse(fs.readFileSync(path.join(semverRoot, 'package.json'))).version !== '7.8.5') throw new Error('Unexpected verifier build tool version.');
  process.env.ESBUILD_BINARY_PATH = esbuildBinary;
  const buildResult = await require(esbuildRoot).build({
    absWorkingDir: __dirname,
    entryPoints: ['sources/runtime-tree.ts'],
    outfile: 'runtime-tree.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    alias: { semver: semverRoot },
    sourcemap: 'external',
    sourcesContent: true,
    legalComments: 'inline',
    metafile: true,
    write: false
  });
  const inputFiles = Object.keys(buildResult.metafile.inputs).sort();
  const inputs = inputFiles.map(file => ({
    file: file.replaceAll('\\', '/'),
    sha256: cryptoHash(fs.readFileSync(path.resolve(__dirname, file)))
  }));
  const outputs = buildResult.outputFiles.map(file => ({ file: path.basename(file.path), sha256: cryptoHash(file.contents) }));
  const record = {
    schemaVersion: 1,
    upstream: { repository: 'https://github.com/deepseek-ai/deepseek-harness.git', tag: 'dsh-v0.2.1-alpha.1', commit: '5badb15009ae1756c3afe0ae0cef1faafc290ccc' },
    build: { node: '24.19.0', esbuild: '0.28.1', semver: '7.8.5', command: 'vendor/runtime/win32-x64/node.exe runtime/harness-official/build.cjs' },
    sourceHashes,
    licenses: {
      'LICENSE.deepseek.txt': 'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be',
      'LICENSE.semver.txt': '4ec3d4c66cd87f5c8d8ad911b10f99bf27cb00cdfcff82621956e379186b016b',
      'LICENSE.esbuild.txt': 'b40ec5baec7bb34fa5b1c09521fa3cd52d5fad7adafed74932a2010d3612a681'
    },
    inputs,
    outputs
  };
  for (const [name, expected] of Object.entries(record.licenses)) assertHash(path.join(__dirname, name), expected);
  const recordPath = path.join(__dirname, 'build-manifest.json');
  if (fs.existsSync(recordPath) && JSON.stringify(JSON.parse(fs.readFileSync(recordPath))) !== JSON.stringify(record)) {
    throw new Error('Official verifier rebuild differs from the reviewed source/output record.');
  }
  for (const output of buildResult.outputFiles) fs.writeFileSync(output.path, output.contents);
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, inputs: inputs.length, outputs }));
}
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
