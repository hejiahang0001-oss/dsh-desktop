const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

test('formal desktop profile owns one instance while isolated smoke profiles stay independent', () => {
  const isolatedPath = main.indexOf("app.setPath('userData'");
  const lockPath = main.indexOf('app.requestSingleInstanceLock');
  assert.ok(isolatedPath >= 0 && lockPath > isolatedPath);
  assert.match(main, /Boolean\(isolatedSmokeTarget\) \|\| app\.requestSingleInstanceLock/);
  assert.match(main, /app\.on\('second-instance',[\s\S]*pendingSecondInstanceFocus = !showMainWindow\(\)/);
  assert.match(main, /if \(pendingSecondInstanceFocus\)[\s\S]*showMainWindow\(\)/);
  assert.match(main, /const smokeProfileTarget = isolatedSmokeTarget \|\| safeExitSmokeTarget/);
  assert.doesNotMatch(
    main.slice(main.indexOf('const isolatedSmokeTarget ='), main.indexOf('const smokeProfileTarget =')),
    /safeExitSmokeTarget/
  );
});

test('packaged safe-exit smoke uses the normal quit path with live owned resources', () => {
  const safeExit = main.slice(main.indexOf('const runSafeExitSmoke ='), main.indexOf('const runCommandFeedbackSmoke ='));
  assert.match(safeExit, /workspace\.isFallback/);
  assert.match(safeExit, /terminalRunner\.start/);
  assert.match(safeExit, /previewManager\.openFile/);
  assert.match(safeExit, /lifecycleStatus: lifecycle\.status/);
  assert.match(safeExit, /quitBypassActive: allowQuit/);
  assert.match(safeExit, /JSON\.parse\(fs\.readFileSync\(continuePath, 'utf8'\)\)\.nonce === nonce/);
  assert.match(safeExit, /requestApplicationQuit\('explicit-exit'\)/);
  assert.doesNotMatch(safeExit, /allowQuit\s*=\s*true|app\.exit|\.destroy\(\)/);
});

test('safe exit waits for mutable operations and refuses to ignore owned-resource failures', () => {
  const quit = main.slice(main.indexOf("app.on('before-quit'"), main.indexOf("app.on('window-all-closed'"));
  for (const name of [
    'pluginTogglePromise',
    'pluginInstallPromise',
    'harnessOperationPromise',
    'documentIntakeOperationPromise',
    'changeReviewOperationPromise',
    'previewOperationPromise',
    'wikiMutationOperationPromise',
    'checkpointCreatePromise',
    'checkpointRestorePromise',
    'checkpointForkPromise',
    'tasksSubagentsOperationPromise',
    'sideChatOperationPromise',
    'worktreeOperationPromise',
    'networkOperationPromise',
    'updateCheckPromise'
  ]) assert.match(quit, new RegExp(name));
  assert.match(quit, /verify: \(\) => !terminalRunner\.isActive\(\)/);
  assert.match(quit, /verify: \(\) => !previewManager\.isActive\(\)/);
  assert.match(quit, /verify: \(\) => !supervisor\.isActive\(\)/);
  assert.match(quit, /name: '会话草稿写入', run: \(\) => flushComposerDraft\(\)/);
  assert.match(quit, /timeoutMs: 5_000/);
  assert.match(quit, /markClean\(requestedQuitReason\)/);
  assert.match(quit, /lifecycleGate\.beginClosing\(\)/);
  assert.ok(quit.indexOf('lifecycleGate.beginClosing()') < quit.indexOf("transition('quitting')"));
  assert.ok(quit.indexOf('closeManagedAuxiliaryWindows()') < quit.indexOf('const operations = ['));
  assert.ok(quit.indexOf('lifecycleGate.reopen()') < quit.indexOf('backgroundTasks?.start()'));
  assert.doesNotMatch(quit, /Promise\.allSettled\(stops\)/);
  assert.match(quit, /isBackgroundSupervisionRequired\(agentDiagnostics\)/);
  assert.match(quit, /当前会话仍在运行，完全退出会中断 Harness 和正在执行的工具/);
});

test('shutdown gate blocks new owned resources and terminal input', () => {
  for (const functionName of [
    'startHarnessForWindow',
    'openWorkspacePreview',
    'startTerminalSession',
    'openTerminalWindow',
    'openOfficeCenterWindow',
    'openWikiCenterWindow',
    'openWorktreesWindow'
  ]) {
    const start = main.indexOf(`const ${functionName} =`);
    const end = main.indexOf('\n};', start);
    assert.ok(start >= 0 && end > start, `${functionName} must exist`);
    assert.match(main.slice(start, end), /appIsClosing\(\)/, `${functionName} must honor the shutdown gate`);
  }
  assert.match(main, /ipcMain\.on\('terminal:write',[\s\S]{0,160}appIsClosing\(\)/);
  assert.match(main, /ipcMain\.on\('terminal:resize',[\s\S]{0,160}appIsClosing\(\)/);
  const harnessStart = main.slice(main.indexOf('const performStartHarnessForWindow ='), main.indexOf('const startHarnessForWindow ='));
  assert.match(harnessStart, /await flushComposerDraft\(\);[\s\S]{0,180}assertApplicationOpen\(\)/);
  assert.match(harnessStart, /supervisor\.restart\(\) : await supervisor\.start\(\);\s*assertApplicationOpen\(\)/);
  assert.match(main, /const runPreviewOperation = [\s\S]*previewOperationPromise = pending/);
  assert.match(main, /const runWikiMutation = [\s\S]*wikiMutationOperationPromise = pending/);
  assert.match(main, /const runNetworkOperation = [\s\S]*networkOperationPromise = pending/);
  assert.match(main, /network:test'[\s\S]{0,220}runNetworkOperation/);
  assert.match(main, /network:save'[\s\S]{0,220}runNetworkOperation/);
});

test('recovery messaging is cautious and task worktree copy explains its real boundary', () => {
  assert.match(main, /不会依据旧进程号或旧端口结束任何进程/);
  assert.match(main, /不会自动重发结果不明的后台任务/);
  assert.match(main, /未提交的源文件和软件托管 Key 不会复制/);
  assert.match(main, /当前提交已经跟踪的文件会按 Git 正常检出/);
  assert.match(main, /工作树只负责隔离任务，不是内容脱敏或秘密扫描/);
});

test('closing the main window also closes every managed auxiliary window', () => {
  const close = main.slice(main.indexOf('const closeManagedAuxiliaryWindows'), main.indexOf('const showLifecycleRecoveryNotice'));
  for (const name of [
    'terminalWindow',
    'contextSourcesWindow',
    'pluginHealthWindow',
    'officeCenterWindow',
    'wikiCenterWindow',
    'worktreesWindow',
    'tasksSubagentsWindow',
    'gitDeliveryWindow'
  ]) assert.match(close, new RegExp(name));
  assert.match(main, /mainWindow\.on\('closed',[\s\S]{0,300}closeManagedAuxiliaryWindows\(\)/);
});
