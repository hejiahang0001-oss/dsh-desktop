const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('automatic checkpoint UI arms on composer input and waits before a verified send action', () => {
  const source = read('assets/workbench-checkpoint.js');
  assert.match(source, /focusin/);
  assert.match(source, /createAutomatic/);
  assert.match(source, /isSendButton/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /await ensureCheckpoint/);
  assert.match(source, /agentWasBusy/);
  assert.match(source, /aria-live/);
  assert.match(source, /toLocaleTimeString\('zh-CN'/);
  assert.doesNotMatch(source, /innerHTML|eval\(|ipcRenderer|child_process|shell\./);
});

test('checkpoint renderer bridge and assets expose fixed manual and automatic operations', () => {
  const manifest = JSON.parse(read('package.json'));
  const preload = read('electron/preload.cjs');
  const main = read('electron/main.cjs');
  const css = read('assets/workbench-checkpoint.css');
  assert.ok(manifest.build.files.includes('assets/workbench-checkpoint.js'));
  assert.ok(manifest.build.files.includes('assets/workbench-checkpoint.css'));
  assert.match(preload, /create-manual/);
  assert.match(preload, /create-automatic/);
  assert.match(preload, /list-history/);
  assert.match(preload, /checkpoints:restore/);
  assert.match(preload, /restore-latest/);
  assert.match(main, /GitCheckpointManager/);
  assert.match(main, /立即创建代码检查点/);
  assert.match(main, /恢复到最近代码检查点/);
  assert.match(main, /浏览代码检查点/);
  assert.match(main, /isCheckpointId/);
  assert.match(main, /shell\.trashItem/);
  assert.match(main, /defaultId:\s*1/);
  assert.match(main, /checkpointRestorePromise/);
  assert.match(css, /dsh-terminal-effective-height/);
  assert.match(css, /forced-colors: active/);
});

test('checkpoint history is bounded, selectable, and keyboard accessible without executable input', () => {
  const source = read('assets/workbench-checkpoint.js');
  const css = read('assets/workbench-checkpoint.css');
  assert.match(source, /listHistory/);
  assert.match(source, /slice\(0, 12\)/);
  assert.match(source, /role', 'listbox/);
  assert.match(source, /aria-selected/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /historyPreviousFocus/);
  assert.doesNotMatch(source, /innerHTML|eval\(|child_process|shell\./);
  assert.match(css, /dsh-checkpoint-history-dialog/);
  assert.match(css, /max-height: 680px/);
  assert.match(css, /focus-visible/);
});
