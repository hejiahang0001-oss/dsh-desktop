const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('global command palette exposes only fixed workbench actions and complete keyboard behavior', () => {
  const source = read('assets/workbench-command.js');
  assert.match(source, /Ctrl\+Shift\+P/);
  assert.match(source, /role', 'listbox/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /Escape/);
  assert.match(source, /api\.workbench\.getState/);
  assert.match(source, /__DSH_FILES__/);
  assert.match(source, /__DSH_PREVIEW__/);
  assert.match(source, /__DSH_TERMINAL__/);
  assert.match(source, /__DSH_WORKBENCH__/);
  assert.doesNotMatch(source, /eval\(|innerHTML|ipcRenderer|shell\./);
});

test('command palette is packaged and supports compact, forced-color, and reduced-motion states', () => {
  const manifest = JSON.parse(read('package.json'));
  const css = read('assets/workbench-command.css');
  const main = read('electron/main.cjs');
  assert.ok(manifest.build.files.includes('assets/workbench-command.js'));
  assert.ok(manifest.build.files.includes('assets/workbench-command.css'));
  assert.match(css, /max-width: 700px/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(main, /commandInstalled/);
  assert.match(main, /打开命令面板/);
});
