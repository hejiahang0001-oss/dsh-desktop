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
  assert.doesNotMatch(preload, /ipcRenderer\.on\('workbench/);
  assert.equal((preload.match(/ipcRenderer\.sendSync\(/g) || []).length, 1);
  assert.match(preload, /if \(process\.isMainFrame\)[\s\S]*sendSync\('harness:take-selection-intent'\)/);
  assert.match(main, /ipcMain\.on\('harness:take-selection-intent'/);
  assert.doesNotMatch(main, /event\.returnValue = null;\s*if \(isolatedSmokeTarget/);
});

test('compact desktop smoke size and isolated terminal window budget are explicit', () => {
  const main = read('electron/main.cjs');
  const terminal = read('assets/terminal-window.css');
  const terminalHtml = read('terminal.html');
  const files = read('assets/workbench-files.css');
  const preview = read('assets/workbench-preview.css');
  assert.match(main, /--smoke-window-size=/);
  assert.match(main, /Math\.max\(820/);
  assert.match(main, /Math\.max\(600/);
  assert.match(main, /minWidth: 720/);
  assert.match(main, /minHeight: 420/);
  assert.match(terminalHtml, /aria-label="PowerShell 交互区"/);
  assert.match(terminal, /forced-colors: active/);
  assert.match(terminal, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(files, /dsh-terminal-effective-height/);
  assert.doesNotMatch(preview, /dsh-terminal-effective-height/);
});
