const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildPermissionCenterDialog } = require('../electron/permission-center.cjs');

const root = path.resolve(__dirname, '..');

test('permission center reports upstream Harness state and fixed desktop boundaries', () => {
  const model = buildPermissionCenterDialog({
    agent: {
      permissionMode: 'workspace-write',
      canOpenPermission: true,
      canFocusPending: true,
      pendingCount: 2
    },
    terminalActive: false
  });
  assert.equal(model.options.title, '权限中心');
  assert.match(model.options.message, /Workspace Write/);
  assert.match(model.options.detail, /2 个待确认操作/);
  assert.match(model.options.detail, /Harness/);
  assert.match(model.options.detail, /文件面板与检查点/);
  assert.match(model.options.detail, /代理修改/);
  assert.deepEqual(model.options.buttons, ['定位待确认操作', '打开 Harness 权限模式', '关闭']);
  assert.equal(model.options.defaultId, 2);
  assert.equal(model.options.cancelId, 2);
  assert.deepEqual(model.actions, ['focus-pending', 'open-permission-mode', null]);
});

test('permission center does not invent controls when upstream permission UI is unavailable', () => {
  const model = buildPermissionCenterDialog({
    agent: { permissionMode: 'forged', canOpenPermission: true, pendingCount: -3 },
    terminalActive: true
  });
  assert.match(model.options.message, /未检测/);
  assert.match(model.options.detail, /交互终端：运行中/);
  assert.deepEqual(model.options.buttons, ['关闭']);
  assert.deepEqual(model.actions, [null]);
});

test('native permission center is integrated without adding renderer privileges', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8');
  assert.match(main, /buildPermissionCenterDialog/);
  assert.match(main, /label: '权限中心…'/);
  assert.match(main, /dialog\.showMessageBox\(mainWindow, model\.options\)/);
  assert.match(main, /runHarnessUiAction\(action\)/);
  assert.doesNotMatch(preload, /permission-center|permission:save|permission:allow/);
});
