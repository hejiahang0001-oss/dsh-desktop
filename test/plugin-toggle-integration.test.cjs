const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('legacy toggle is retired while interrupted profile recovery stays available', () => {
  const main = read('electron/main.cjs');
  const manager = read('electron/profile-bundle-manager.cjs');
  assert.match(main, /registerRetiredPluginMutations\(ipcMain, pluginHealthIpcAllowed\)/);
  assert.doesNotMatch(main, /performPluginToggle|profileBundleManager\.apply/);
  assert.match(main, /profileBundleManager\.recoverPending\(\)/);
  assert.match(manager, /Object\.hasOwn\(current\.value\.dependencies, packageName\)/);
  assert.match(manager, /避免覆盖用户编辑/);
  assert.doesNotMatch(manager, /spawn|exec|pnpm|child_process/);
});
