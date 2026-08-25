const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('worktree manager window is local-only, fixed-action, accessible, and packaged', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/worktrees-preload.cjs');
  const renderer = read('assets/worktrees.js');
  const page = read('worktrees.html');
  const manager = read('electron/worktree-manager.cjs');
  const manifest = JSON.parse(read('package.json'));

  assert.match(main, /worktreesIpcAllowed/);
  assert.match(main, /isTrustedMainFrameEvent\(\s*event,\s*worktreesWindow\?\.webContents,\s*worktreesUrlAllowed\s*\)/);
  assert.match(main, /label: '管理隔离工作树…'/);
  assert.match(main, /accelerator: 'CmdOrCtrl\+Shift\+W'/);
  assert.match(main, /--worktrees-smoke-file=/);
  assert.match(main, /worktreeManager\.previewRemove\(\{/);
  assert.match(main, /expectedFingerprint: removalPreview\.fingerprint/);
  assert.match(main, /recoveryCheckpoint: Boolean\(removal\.checkpoint\?\.id\)/);
  assert.match(main, /branchRetained: retainedBranch/);
  assert.match(main, /runWorktreesSmoke/);
  assert.match(main, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
  assert.match(main, /buttons: \['取消', '创建工作树'\]/);
  assert.match(main, /buttons: \['取消', '切换并重启 Harness'\]/);
  assert.match(main, /buttons: \['取消', '建立恢复并回收'\]/);
  assert.match(main, /defaultId: 0/g);
  assert.match(main, /\^\[0-9a-f\]\{24\}\$/);
  for (const channel of ['get-state', 'refresh', 'create', 'activate', 'reveal', 'remove']) {
    assert.match(preload, new RegExp(`worktrees:${channel}`));
  }
  assert.doesNotMatch(preload, /path|branch|command|readFile|writeFile|shell|ipcRenderer\.send/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /api\.activate\(item\.id\)/);
  assert.match(renderer, /api\.remove\(item\.id\)/);
  assert.match(renderer, /api\.reveal\(item\.id\)/);
  assert.doesNotMatch(renderer, /document\.createElement\(['"]input['"]\)|innerHTML|eval\(/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /role="status"/);
  assert.match(page, /未提交修改.*私有恢复点/);
  assert.match(manager, /core\.hooksPath=NUL/);
  assert.match(manager, /core\.fsmonitor=false/);
  assert.match(manager, /before\.counts\.total >= MAX_WORKTREES/);
  assert.match(manager, /ownership\.json/);
  assert.match(manager, /ownership\.branch === entry\.branch/);
  assert.match(manager, /ownership\.state === 'owned'/);
  assert.match(manager, /_setOwnershipState\(context, item, 'removing'\)/);
  assert.match(main, /const workspacePath = getWorkspaceState\(\)\.activePath/);
  assert.match(main, /worktreeManager\.create\(\{ workspacePath \}\)/);
  assert.match(manager, /new GitCheckpointManager/);
  assert.match(manager, /refs\/heads\/\$\{item\.branch\}/);
  assert.match(manager, /DEEPSEEK/);
  for (const asset of ['worktrees.html', 'assets/worktrees.css', 'assets/worktrees.js']) {
    assert.ok(manifest.build.files.includes(asset), asset);
  }
});
