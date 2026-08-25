const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('Side Chat is an isolated Harness window with no renderer command bridge', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/side-chat-preload.cjs');
  const desktopPreload = read('electron/preload.cjs');
  const command = read('assets/workbench-command.js');
  const packageJson = JSON.parse(read('package.json'));
  assert.match(main, /session\.fromPartition\(partition\)/);
  assert.match(main, /partition: `dsh-side-chat-/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.match(main, /will-frame-navigate/);
  assert.match(main, /app\.setPath\('userData'/);
  assert.match(main, /readHarnessSessionSelection\(created\.webContents\)/);
  assert.match(main, /selectHarnessSession\(created\.webContents, context\.sideSessionId\)/);
  assert.match(main, /CmdOrCtrl\+Shift\+S/);
  assert.match(preload, /Workspace Write \/ Ask/);
  assert.doesNotMatch(preload, /contextBridge|ipcRenderer|require\('electron'\)/);
  assert.match(desktopPreload, /sideChat: Object\.freeze/);
  assert.match(command, /side-chat\.open/);
  for (const required of ['electron/side-chat.cjs', 'electron/side-chat-preload.cjs']) {
    assert.ok(packageJson.build.files.includes(required), `${required} must be packaged`);
  }
});
