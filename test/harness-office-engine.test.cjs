const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { inspectOfficeEngine, verifyEngineFiles } = require('../scripts/harness-office-engine.cjs');

const fixture = (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-office-engine-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, '@deepseek-ai/libreoffice-kit');
  fs.mkdirSync(entry, { recursive: true });
  fs.writeFileSync(path.join(entry, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/libreoffice-kit', version: '0.0.1', license: 'MPL-2.0',
    optionalDependencies: { '@deepseek-ai/libreoffice-kit-win32-x64': '0.0.1' }
  }));
  return root;
};

test('Office packaging requires the declared Windows native engine without WASM fallback', (context) => {
  const root = fixture(context);
  assert.throws(() => inspectOfficeEngine(root), /native engine.*missing/i);
  fs.mkdirSync(path.join(root, '@deepseek-ai/libreoffice-kit-wasm'));
  assert.throws(() => inspectOfficeEngine(root), /unexpected Office engine/i);
});

test('Office packaging rejects changed version, license, or native dependency declaration', (context) => {
  const root = fixture(context);
  const manifestPath = path.join(root, '@deepseek-ai/libreoffice-kit/package.json');
  const valid = JSON.parse(fs.readFileSync(manifestPath));
  for (const change of [{ version: '0.0.2' }, { license: 'MIT' }, { optionalDependencies: {} }]) {
    fs.writeFileSync(manifestPath, JSON.stringify({ ...valid, ...change }));
    assert.throws(() => inspectOfficeEngine(root), /Office kit identity/i);
  }
});

test('Office packaging rejects an unreviewed prebuild manifest', (context) => {
  const root = fixture(context);
  const engine = path.join(root, '@deepseek-ai/libreoffice-kit-win32-x64');
  fs.mkdirSync(engine);
  fs.writeFileSync(path.join(engine, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/libreoffice-kit-win32-x64', version: '0.0.1', license: 'MPL-2.0'
  }));
  fs.writeFileSync(path.join(engine, 'prebuilds.json'), '{}');
  assert.throws(() => inspectOfficeEngine(root), /prebuild manifest digest/i);
});

test('Office engine file verification binds bytes and refuses traversal or linked assets', (context) => {
  const root = fixture(context);
  const digest = createHash('sha256').update('engine').digest('hex');
  fs.writeFileSync(path.join(root, 'engine.exe'), 'engine');
  assert.deepEqual(verifyEngineFiles(root, { 'engine.exe': digest }), { files: 1, bytes: 6 });
  assert.throws(() => verifyEngineFiles(root, { '../escape': digest }), /unsafe/i);
  assert.throws(() => verifyEngineFiles(root, { 'C:/escape': digest }), /unsafe/i);
  assert.throws(() => verifyEngineFiles(root, { 'engine.exe': '0'.repeat(64) }), /digest/i);
  assert.throws(() => verifyEngineFiles(root, { 'missing.exe': digest }), /ENOENT/);
  fs.symlinkSync(root, path.join(root, 'linked'), 'junction');
  assert.throws(() => verifyEngineFiles(root, { 'linked/engine.exe': digest }), /linked/i);
});
