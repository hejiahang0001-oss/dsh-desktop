const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('application preview UI uses a sandboxed iframe with explicit local-server lifecycle controls', () => {
  const source = read('assets/workbench-preview.js');
  assert.match(source, /create\('iframe'/);
  assert.match(source, /allow-scripts allow-same-origin allow-forms allow-modals allow-popups/);
  assert.match(source, /api\.preview\.openFile/);
  assert.match(source, /api\.preview\.connect/);
  assert.match(source, /api\.preview\.stop/);
  assert.match(source, /api\.preview\.openExternal/);
  assert.match(source, /软件管理的端口已释放/);
  assert.match(source, /本机开发服务器地址/);
  assert.doesNotMatch(source, /innerHTML|eval\(/);
});

test('packaged V0.4.5 includes the preview assets and main-process manager', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.version, '0.4.5');
  assert.ok(manifest.build.files.includes('assets/workbench-preview.css'));
  assert.ok(manifest.build.files.includes('assets/workbench-preview.js'));
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  assert.match(main, /new PreviewManager/);
  assert.match(main, /on\('will-frame-navigate', \(details\) =>/);
  assert.match(main, /isSafePreviewNavigation\(details\.url/);
  assert.doesNotMatch(main, /will-frame-navigate', \(event, details\)/);
  assert.match(main, /setPreviewPanelOpen/);
  assert.match(preload, /preview:open-file/);
  assert.match(preload, /preview:connect/);
});
