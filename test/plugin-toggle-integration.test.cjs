const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('extension toggle is native-confirmed, busy-gated, health-verified, and rollback-capable', () => {
  const main = read('electron/main.cjs');
  const manager = read('electron/profile-bundle-manager.cjs');
  assert.match(main, /ipcMain\.handle\('plugin-health:toggle'/);
  assert.match(main, /if \(!pluginHealthIpcAllowed\(event\)\)/);
  assert.match(main, /pluginMutationBusy\(\)/);
  assert.match(main, /buttons: \['取消', `\$\{action\}并重启 Harness`\]/);
  assert.match(main, /defaultId: 0/);
  assert.match(main, /cancelId: 0/);
  assert.match(main, /确认期间 Agent、终端或检查点状态已变化/);
  assert.match(main, /confirmedDependency\?\.toggleable/);
  assert.match(main, /写入期间 Agent、终端或检查点状态发生变化/);
  assert.match(main, /profileBundleManager\.apply/);
  assert.match(main, /profileBundleManager\.commit/);
  assert.match(main, /profileBundleManager\.rollback/);
  assert.match(main, /verifiedDependency\?\.enabled !== enable/);
  assert.match(manager, /Object\.hasOwn\(current\.value\.dependencies, packageName\)/);
  assert.match(manager, /避免覆盖用户编辑/);
  assert.doesNotMatch(manager, /spawn|exec|pnpm|child_process/);
});
