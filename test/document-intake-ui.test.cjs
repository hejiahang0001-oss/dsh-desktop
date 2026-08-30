const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
test('document intake is packaged, guarded and does not expose absolute source paths', () => {
  const manifest = JSON.parse(read('package.json'));
  for (const name of ['document-intake.js', 'document-intake.css', 'composer-text-bridge.js']) assert.ok(manifest.build.files.includes(`assets/${name}`));
  const preload = read('electron/preload.cjs');
  assert.match(preload, /webUtils\.getPathForFile\(file\)/);
  assert.match(preload, /documents: Object\.freeze/);
  const main = read('electron/main.cjs');
  assert.match(main, /runDocumentRequest[\s\S]*?harnessIpcAllowed\(event\)/);
  assert.match(main, /documents:import[\s\S]*?expectedContext: context, paths/);
  assert.match(main, /verifyReady\(harnessOrigin, harnessFetch\)/);
});
test('upstream editing bridge preserves rich chips and checks session immediately before insertion', () => {
  const bridge = read('assets/composer-text-bridge.js');
  assert.match(bridge, /data-composer-input/);
  assert.match(bridge, /ClipboardEvent\('paste'/);
  assert.match(bridge, /!guard\(\)/);
  assert.doesNotMatch(bridge, /innerHTML\s*=|__lexicalEditor/);
  const intake = read('assets/document-intake.js');
  assert.match(intake, /before\.context !== after\.context/);
  assert.match(intake, /aria-live', 'polite/);
  assert.match(intake, /原文件和已导入副本未删除/);
});
test('encrypted credentials component is a fixed packaged bridge and migration follows runtime verification', () => {
  const main = read('electron/desktop-credential-host.cjs');
  assert.match(main, /deferMigration: true/);
  assert.match(main, /fiberPhase === 'active'/);
  assert.match(main, /await vault.finalizeMigration\(\)/);
  const provider = read('runtime/dsh-desktop-credentials/index.mjs');
  assert.doesNotMatch(provider, /process\.env\.DEEPSEEK_API_KEY|writeFile|http:|https:/);
  const manifest = JSON.parse(read('package.json'));
  assert.ok(manifest.build.extraResources.some((item) => item.from === 'runtime/dsh-desktop-credentials'));
});
