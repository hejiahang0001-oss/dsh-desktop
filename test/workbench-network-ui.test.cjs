const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('network settings expose bounded accessible direct, system, and custom proxy controls', () => {
  const source = read('assets/workbench-network.js');
  assert.match(source, /role', 'dialog/);
  assert.match(source, /aria-modal/);
  assert.match(source, /直连/);
  assert.match(source, /Windows 系统代理/);
  assert.match(source, /自定义代理/);
  assert.match(source, /maxLength = 512/);
  assert.match(source, /api\.network\.getState/);
  assert.match(source, /api\.network\.test/);
  assert.match(source, /api\.network\.save/);
  assert.match(source, /127\.0\.0\.1、localhost、::1/);
  assert.match(source, /event\.key === ','/);
  assert.doesNotMatch(source, /eval\(|innerHTML|ipcRenderer|shell\./);
});

test('network settings are packaged and preserve compact and accessibility modes', () => {
  const manifest = JSON.parse(read('package.json'));
  const css = read('assets/workbench-network.css');
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  assert.ok(manifest.build.files.includes('assets/workbench-network.js'));
  assert.ok(manifest.build.files.includes('assets/workbench-network.css'));
  assert.match(css, /max-height: 720px/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(main, /networkInstalled/);
  assert.match(main, /network-state\.json/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /role: 'copy'/);
  assert.match(preload, /network:get-state/);
  assert.match(preload, /network:test/);
  assert.match(preload, /network:save/);
});
