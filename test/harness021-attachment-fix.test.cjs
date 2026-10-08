const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { postimages, digest, profile, validateOutputRoot } = require('../scripts/prepare-harness021-attachment-fix.cjs');

test('reviewed attachment increment pins its parent, complete patch and standalone regression input', () => {
  const base = path.resolve(__dirname, '../runtime/harness-021-attachment-fix');
  assert.equal(digest(fs.readFileSync(path.resolve(base, '../harness-021-candidate/profile.json'))), profile.parentProfileSha256);
  assert.equal(digest(fs.readFileSync(path.join(base, 'source.patch'))), profile.patchSha256);
  assert.equal(digest(fs.readFileSync(path.join(base, profile.regression.input))), profile.regression.sha256);
  assert.equal(profile.promotionAllowed, false);
  assert.equal(profile.deployed, false);
  const patchPaths = [...fs.readFileSync(path.join(base, 'source.patch'), 'utf8').matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]);
  assert.deepEqual(patchPaths.sort(), [...profile.files.map(file => file.path), profile.regression.path].sort());
});

test('attachment preparation refuses implicit or relative source roots', () => {
  assert.throws(() => postimages(), /Absolute source root/);
  assert.throws(() => postimages('.'), /Absolute source root/);
});

test('attachment preparation rejects mismatched source before any writes', t => {
  const parent = fs.realpathSync(os.tmpdir());
  const source = fs.mkdtempSync(path.join(parent, 'dsh-attachment-input-'));
  t.after(() => {
    assert.equal(path.dirname(source), parent);
    assert.ok(path.basename(source).startsWith('dsh-attachment-input-'));
    assert.equal(fs.lstatSync(source).isSymbolicLink(), false);
    fs.rmSync(source, { recursive: true });
  });
  const bytes = '{"version":"unexpected"}\n';
  fs.writeFileSync(path.join(source, 'package.json'), bytes, { flag: 'wx' });
  assert.throws(() => postimages(source), /Source version mismatch/);
  assert.deepEqual(fs.readdirSync(source), ['package.json']);
  assert.equal(fs.readFileSync(path.join(source, 'package.json'), 'utf8'), bytes);
});

test('attachment outputs reject source overlap, existing destinations and linked ancestors before writes', t => {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'dsh-attachment-output-'));
  const source = path.join(directory, 'source'), target = path.join(directory, 'target'), linked = path.join(directory, 'linked');
  fs.mkdirSync(source); fs.mkdirSync(target);
  t.after(() => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith('dsh-attachment-output-'));
    if (fs.existsSync(linked)) fs.unlinkSync(linked);
    fs.rmSync(directory, { recursive: true });
  });
  assert.throws(() => validateOutputRoot(source, source), /overlap/);
  assert.throws(() => validateOutputRoot(source, path.join(source, 'output')), /overlap/);
  assert.throws(() => validateOutputRoot(source, directory), /overlap/);
  assert.throws(() => validateOutputRoot(source, target), /already exists/);
  fs.symlinkSync(target, linked, 'junction');
  assert.throws(() => validateOutputRoot(source, path.join(linked, 'output')), /Linked/);
  assert.equal(fs.existsSync(path.join(target, 'output')), false);
  assert.deepEqual(fs.readdirSync(source), []);
  assert.equal(validateOutputRoot(source, path.join(target, 'output')), path.join(target, 'output'));
});
