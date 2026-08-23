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
  assert.match(main, /GitCheckpointManager/);
  assert.match(main, /立即创建代码检查点/);
  assert.match(css, /dsh-terminal-effective-height/);
  assert.match(css, /forced-colors: active/);
});
