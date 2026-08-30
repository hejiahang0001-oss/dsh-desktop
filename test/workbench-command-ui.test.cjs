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
  assert.match(source, /api\.terminal\.openWindow/);
  assert.doesNotMatch(source, /__DSH_TERMINAL__|api\.terminal\.(start|write|resize|stop)/);
  assert.match(source, /__DSH_WORKBENCH__/);
  assert.match(source, /setUiZoomFactor/);
  assert.match(source, /resetLayout/);
  assert.match(source, /界面大小重置/);
  assert.match(source, /checkpoint\.create/);
  assert.match(source, /api\.checkpoints\.create/);
  assert.match(source, /role', 'alert/);
  assert.match(source, /重试此命令/);
  assert.match(source, /result\?\.ok === false/);
  assert.match(source, /showFailure\(command, error\)/);
  assert.match(source, /focusableInDialog/);
  assert.match(source, /trapDialogFocus\(event\)/);
  assert.doesNotMatch(source, /没有执行任何修改/);
  assert.doesNotMatch(source, /catch \{\s*if \(fallbackFocus/);
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
  assert.match(main, /runVisibleDesktopAction\('命令面板'/);
  assert.match(main, /runVisibleDesktopAction\('网络与代理设置'/);
  assert.match(main, /buttons: \['重试', '确定'\]/);
  assert.match(main, /--command-feedback-smoke-file=/);
  assert.match(main, /runCommandFeedbackSmoke/);
});

test('command feedback smoke waits for network state and proves the maximized command surface is unobstructed', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /network\.ready/);
  assert.match(main, /maximized\.networkHidden/);
  assert.match(main, /networkStatus\.textContent !== '正在读取当前设置…'/);
  assert.match(main, /networkHidden: Boolean\(networkBackdrop\?\.hidden\)/);
  assert.match(main, /const paintReady = \(\) => new Promise/);
  assert.match(main, /await paintReady\(\)/);
  assert.match(main, /const maximizedPaintReady = \(\) => new Promise/);
  assert.match(main, /await maximizedPaintReady\(\)/);
});
