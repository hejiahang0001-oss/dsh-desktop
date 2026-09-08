const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hydratePackages } = require('../scripts/assemble-harness-runtime.cjs');

// These integration tests exercise the Windows release assembler's actual tar
// and rename operations, without building or changing any bundled dependency.
const windowsOnly = { skip: process.platform !== 'win32' };
const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-assembler-regression-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), root);
    assert.ok(relative.startsWith('dsh-assembler-regression-') && !relative.includes(path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runtimeRoot = path.join(root, 'runtime-output');
  fs.mkdirSync(path.join(runtimeRoot, 'node_modules'), { recursive: true });
  return { root, runtimeRoot, expectedPackages: [{ manifest: { name: '@deepseek-ai/dsh-test-only', version: '0.0.0-fixture' } }] };
};
const archive = (f, manifest = f.expectedPackages[0].manifest) => {
  const input = path.join(f.root, 'archive-input');
  fs.mkdirSync(path.join(input, 'package', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(input, 'package', 'package.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(input, 'package', 'lib', 'index.js'), 'module.exports = "synthetic";\n');
  const result = path.join(f.root, 'fixture.tgz');
  execFileSync('tar.exe', ['-czf', result, '-C', input, 'package'], { windowsHide: true, timeout: 15000 });
  return result;
};
const assertNoScratch = (runtimeRoot) => assert.deepEqual(fs.readdirSync(runtimeRoot).filter((name) => name.startsWith('.dsh-harness-pack-')), []);

test('assembler extracts beside its destination, then renames and cleans scratch', windowsOnly, async (t) => {
  const f = fixture(t), packed = archive(f), originalRename = fs.renameSync, renames = [];
  fs.renameSync = (source, destination) => {
    const relative = path.relative(f.runtimeRoot, source);
    assert.ok(relative.startsWith('.dsh-harness-pack-') && !relative.startsWith('..'), 'scratch must be inside runtimeRoot, never system TEMP');
    assert.equal(path.parse(source).root.toLowerCase(), path.parse(destination).root.toLowerCase(), 'atomic move must stay on the same volume');
    renames.push({ source, destination });
    return originalRename(source, destination);
  };
  try { await hydratePackages({ ...f, archives: [packed] }); }
  finally { fs.renameSync = originalRename; }
  assert.equal(renames.length, 1);
  const installed = path.join(f.runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-test-only');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')), f.expectedPackages[0].manifest);
  assert.equal(fs.readFileSync(path.join(installed, 'lib', 'index.js'), 'utf8'), 'module.exports = "synthetic";\n');
  assertNoScratch(f.runtimeRoot);
});

test('assembler clears same-volume scratch after a corrupt archive without changing deployed packages', windowsOnly, async (t) => {
  const f = fixture(t), corrupt = path.join(f.root, 'corrupt.tgz');
  fs.writeFileSync(corrupt, 'not a tarball');
  const sentinel = path.join(f.runtimeRoot, 'node_modules', 'retained.txt');
  fs.writeFileSync(sentinel, 'unchanged');
  await assert.rejects(hydratePackages({ ...f, archives: [corrupt] }), /tar\.exe exited/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
  assertNoScratch(f.runtimeRoot);
});

test('assembler rejects mismatched packed identity and cleans scratch before replacement', windowsOnly, async (t) => {
  const f = fixture(t), packed = archive(f, { ...f.expectedPackages[0].manifest, version: 'wrong' });
  const installed = path.join(f.runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-test-only');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'retained.txt'), 'original payload');
  await assert.rejects(hydratePackages({ ...f, archives: [packed] }), /Unexpected packed package/);
  assert.equal(fs.readFileSync(path.join(installed, 'retained.txt'), 'utf8'), 'original payload');
  assertNoScratch(f.runtimeRoot);
});
