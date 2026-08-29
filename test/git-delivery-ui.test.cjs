'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Git delivery window is isolated, packaged, and exposes only fixed operations', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/git-delivery-preload.cjs');
  const desktopPreload = read('electron/preload.cjs');
  const page = read('git-delivery.html');
  const manifest = JSON.parse(read('package.json'));

  assert.match(page, /default-src 'self'/);
  assert.match(page, /connect-src 'none'/);
  assert.doesNotMatch(page, /unsafe-inline|https?:\/\//);
  assert.match(main, /gitDeliveryIpcAllowed/);
  assert.match(main, /isTrustedMainFrameEvent\(\s*event,\s*gitDeliveryWindow\?\.webContents,\s*gitDeliveryUrlAllowed\s*\)/);
  assert.match(main, /git-delivery-preload\.cjs/);
  assert.match(main, /contextIsolation: true[\s\S]*?nodeIntegration: false[\s\S]*?sandbox: true/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  for (const channel of ['get-state', 'refresh', 'commit', 'open-link']) {
    assert.match(preload, new RegExp(`git-delivery:${channel}`));
    assert.match(main, new RegExp(`ipcMain\\.handle\\('git-delivery:${channel}'`));
  }
  assert.match(desktopPreload, /delivery: Object\.freeze/);
  assert.match(main, /git-delivery:open-window/);
  for (const asset of ['git-delivery.html', 'assets/git-delivery.css', 'assets/git-delivery.js']) {
    assert.ok(manifest.build.files.includes(asset), asset);
  }
});

test('Git delivery UI is accessible, bounded, optional, and never injects remote markup', () => {
  const page = read('git-delivery.html');
  const source = read('assets/git-delivery.js');
  const css = read('assets/git-delivery.css');
  const command = read('assets/workbench-command.js');
  const main = read('electron/main.cjs');

  assert.match(page, /maxlength="200"/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /Ctrl\+Enter 提交 · F5 刷新 · Esc 关闭/);
  assert.match(source, /event\.key === 'F5'/);
  assert.match(source, /event\.ctrlKey && event\.key === 'Enter'/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|eval\(/);
  assert.match(source, /这不会影响聊天、Office、Excel 或 Wiki/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /max-width: 900px/);
  assert.match(command, /id: 'delivery\.center'/);
  assert.match(command, /api\.delivery\.openWindow/);
  assert.match(main, /buttons: \['取消', '创建本地提交'\][\s\S]*?defaultId: 0[\s\S]*?cancelId: 0/);
  assert.match(main, /不会自动暂存、不会推送/);
  assert.match(main, /--git-delivery-smoke-file=/);
});
