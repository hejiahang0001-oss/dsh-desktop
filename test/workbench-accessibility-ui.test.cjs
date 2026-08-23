const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop exposes bounded persisted interface zoom and complete layout reset', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  assert.match(main, /setZoomFactor/);
  assert.match(main, /set-ui-zoom-factor/);
  assert.match(main, /reset-workbench|reset-layout/);
  assert.match(main, /界面大小：/);
  assert.match(main, /重置整个工作台布局/);
  assert.match(preload, /setUiZoomFactor/);
  assert.match(preload, /resetLayout/);
  assert.doesNotMatch(preload, /sendSync|ipcRenderer\.on\('workbench/);
});

test('compact desktop smoke size and 720px terminal budget are explicit', () => {
  const main = read('electron/main.cjs');
  const terminal = read('assets/workbench-terminal.css');
  const files = read('assets/workbench-files.css');
  const preview = read('assets/workbench-preview.css');
  assert.match(main, /--smoke-window-size=/);
  assert.match(main, /Math\.max\(820/);
  assert.match(main, /Math\.max\(600/);
  assert.match(terminal, /max-height: 760px/);
  assert.match(terminal, /210px/);
  assert.match(files, /dsh-terminal-effective-height/);
  assert.match(preview, /dsh-terminal-effective-height/);
});
