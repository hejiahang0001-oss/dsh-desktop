const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { GitChangeReviewer } = require('./change-review.cjs');
const { getDeepSeekCredentialStatus } = require('./credential-status.cjs');
const { HarnessSupervisor, isSafeHarnessUrl, probeHarness } = require('./harness-supervisor.cjs');
const {
  selectHarnessSession,
  synchronizeHarnessWorkspace,
  waitForHarnessSessionSelection
} = require('./harness-workspace-sync.cjs');
const {
  invokeHarnessCommandAction,
  invokeHarnessUiAction,
  isAgentActionSettled,
  readHarnessAgentState
} = require('./harness-ui-actions.cjs');
const { scanSessionCatalog } = require('./session-catalog.cjs');
const { TerminalRunner, normalizeTerminalCommand } = require('./terminal-runner.cjs');
const {
  getWorkbenchPanelBootstrapScript,
  getWorkbenchPanelLayoutScript
} = require('./workbench-panel.cjs');
const { WorkbenchStore, normalizeWorkbenchState } = require('./workbench-store.cjs');
const { WorkspaceStore } = require('./workspace-store.cjs');

app.commandLine.appendSwitch('lang', 'zh-CN');
app.setName('DSH Desktop');

let mainWindow;
let supervisor;
let workspaceStore;
let workbenchStore;
let changeReviewer;
let terminalRunner;
let dataRoot;
let harnessOrigin = null;
let allowQuit = false;
let loadFailureHandled = false;
let agentPollTimer;
const unavailableWorkspaceSync = (status = 'pending', error = null) => Object.freeze({
  status,
  workspacePath: '',
  workspaceId: '',
  workspaceTitle: '',
  sessionId: '',
  sessionCreated: false,
  error
});
let workspaceSyncDiagnostics = unavailableWorkspaceSync();
const unavailableAgentDiagnostics = () => Object.freeze({
  status: 'unavailable',
  canStop: false,
  canSteer: false,
  canFocusInput: false,
  canFocusPending: false,
  pendingCount: 0,
  queuedCount: 0,
  toolCount: 0,
  activeToolCount: 0,
  failedToolCount: 0,
  stoppedToolCount: 0,
  latestToolState: 'none',
  latestToolKind: 'none',
  canFocusTool: false,
  canOpenTrajectory: false,
  testCount: 0,
  latestTestState: 'none',
  latestTestExitCode: null,
  permissionMode: 'unknown',
  canOpenPermission: false,
  planMode: 'unavailable',
  canEnterPlan: false,
  canExitPlan: false,
  powerShellCompatibility: 'unknown',
  diffCount: 0,
  producedPaths: Object.freeze([]),
  latestProducedPath: '',
  canFocusChange: false
});
let agentDiagnostics = unavailableAgentDiagnostics();
const emptyChangeReviewDiagnostics = (reason = 'no-change') => Object.freeze({
  status: reason === 'no-change' ? 'none' : 'unavailable',
  path: '',
  repoPath: '',
  canAccept: false,
  canReject: false,
  protected: false,
  untracked: false,
  staged: false,
  reason,
  total: 0,
  pendingCount: 0,
  protectedCount: 0,
  acceptedCount: 0,
  canAcceptCount: 0,
  canRejectCount: 0,
  truncated: false,
  items: Object.freeze([])
});
let changeReviewDiagnostics = emptyChangeReviewDiagnostics();
let desktopDiagnostics = Object.freeze({
  credential: Object.freeze({ status: 'missing', source: 'managed-file', reason: 'not-checked', message: '尚未检查软件模型配置。', policy: 'software-first', environmentIgnored: false }),
  sessions: Object.freeze({ available: true, count: 0, latestUpdatedAt: null, encodings: Object.freeze({ zstd: 0, jsonl: 0 }) })
});

const rootDir = path.resolve(__dirname, '..');
const statusPage = path.join(rootDir, 'harness-status.html');
const workbenchPanelCssPath = path.join(rootDir, 'assets', 'workbench-panel.css');
const workbenchPanelScriptPath = path.join(rootDir, 'assets', 'workbench-panel.js');
const workbenchTerminalCssPath = path.join(rootDir, 'assets', 'workbench-terminal.css');
const workbenchTerminalScriptPath = path.join(rootDir, 'assets', 'workbench-terminal.js');
let workbenchPanelCss = '';
let workbenchPanelScript = '';
let workbenchTerminalCss = '';
let workbenchTerminalScript = '';
const desktopSmokeTarget = process.argv.find((argument) => argument.startsWith('--smoke-test-file='));
const harnessSmokeTarget = process.argv.find((argument) => argument.startsWith('--harness-smoke-file='));

const createSupervisor = (dataRoot = app.getPath('userData'), launchDir = path.join(dataRoot, 'launch-root')) => {
  const instance = new HarnessSupervisor({
    rootDir,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    homeDir: path.join(dataRoot, 'harness'),
    launchDir,
    logFile: path.join(dataRoot, 'logs', 'harness.log')
  });
  instance.on('state', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('harness:state', state);
  });
  return instance;
};

const currentUrlAllowed = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return decodeURIComponent(url.pathname).replace(/\\/g, '/').endsWith('/harness-status.html');
    return Boolean(harnessOrigin && url.origin === harnessOrigin);
  } catch {
    return false;
  }
};

const showStatusPage = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = mainWindow.webContents.getURL();
  if (!current.endsWith('/harness-status.html')) await mainWindow.loadFile(statusPage);
};

const startHarnessForWindow = async ({ restart = false } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: '窗口不可用。' };
  stopAgentPolling();
  harnessOrigin = null;
  loadFailureHandled = false;
  agentDiagnostics = unavailableAgentDiagnostics();
  changeReviewDiagnostics = emptyChangeReviewDiagnostics();
  workspaceSyncDiagnostics = unavailableWorkspaceSync('syncing');
  installApplicationMenu();
  await showStatusPage();
  try {
    const url = restart ? await supervisor.restart() : await supervisor.start();
    await probeHarness(url);
    if (!isSafeHarnessUrl(url)) throw new Error('Harness 地址未通过回环安全校验。');
    harnessOrigin = new URL(url).origin;
    const workspace = getWorkspaceState();
    workspaceSyncDiagnostics = await synchronizeHarnessWorkspace({
      origin: harnessOrigin,
      workspacePath: workspace.activePath,
      fallbackTitle: workspace.isFallback ? 'DSH 临时工作区' : undefined
    });
    await mainWindow.loadURL(url);
    const selection = await selectHarnessSession(mainWindow.webContents, workspaceSyncDiagnostics.sessionId);
    if (selection.changed) {
      await mainWindow.loadURL(url);
      await waitForHarnessSessionSelection(mainWindow.webContents, workspaceSyncDiagnostics.sessionId);
    }
    void refreshDesktopDiagnostics();
    startAgentPolling();
    return { ok: true, url };
  } catch (error) {
    workspaceSyncDiagnostics = unavailableWorkspaceSync('failed', error.message);
    harnessOrigin = null;
    supervisor.reportFailure(error);
    await showStatusPage();
    void refreshAgentDiagnostics();
    return { ok: false, error: error.message };
  }
};

const getWorkspaceState = () => workspaceStore?.getState() || {
  activePath: supervisor?.getState().workspacePath || '',
  displayName: '未选择仓库',
  isFallback: true,
  recentPaths: []
};

const applyWindowTitle = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const workspace = getWorkspaceState();
  mainWindow.setTitle(`DSH Desktop — ${workspace.displayName}`);
};

const workspaceSyncLabel = () => {
  if (workspaceSyncDiagnostics.status === 'synced') return `Harness：已同步到 ${workspaceSyncDiagnostics.workspaceTitle}`;
  if (workspaceSyncDiagnostics.status === 'syncing') return 'Harness：正在同步工作区…';
  if (workspaceSyncDiagnostics.status === 'failed') return 'Harness：工作区同步失败';
  return 'Harness：等待工作区同步';
};

const getDiagnosticsState = () => ({
  credential: { ...desktopDiagnostics.credential },
  sessions: { ...desktopDiagnostics.sessions, encodings: { ...desktopDiagnostics.sessions.encodings } },
  agent: { ...agentDiagnostics, producedPaths: [...agentDiagnostics.producedPaths] },
  changes: {
    ...changeReviewDiagnostics,
    items: changeReviewDiagnostics.items.map((item) => ({ ...item }))
  },
  workspaceSync: { ...workspaceSyncDiagnostics }
});

const refreshDesktopDiagnostics = async ({ rebuildMenu = true } = {}) => {
  if (!dataRoot) return getDiagnosticsState();
  const harnessDataRoot = path.join(dataRoot, 'harness');
  let sessions;
  try {
    sessions = await scanSessionCatalog(path.join(harnessDataRoot, 'sessions'));
  } catch {
    sessions = Object.freeze({
      available: false,
      count: 0,
      latestUpdatedAt: null,
      encodings: Object.freeze({ zstd: 0, jsonl: 0 })
    });
  }
  const credential = await getDeepSeekCredentialStatus({
    credentialFile: path.join(harnessDataRoot, '.credentials.yaml')
  });
  desktopDiagnostics = Object.freeze({ credential, sessions });
  if (rebuildMenu) installApplicationMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('diagnostics:state', getDiagnosticsState());
  }
  return getDiagnosticsState();
};

const harnessUiReady = () => {
  if (!mainWindow || mainWindow.isDestroyed() || !harnessOrigin) return false;
  try {
    return new URL(mainWindow.webContents.getURL()).origin === harnessOrigin;
  } catch {
    return false;
  }
};

const getWorkbenchState = () => workbenchStore?.getState() || normalizeWorkbenchState();

const loadWorkbenchPanelAssets = async () => {
  if (!workbenchPanelCss) workbenchPanelCss = await fsp.readFile(workbenchPanelCssPath, 'utf8');
  if (!workbenchPanelScript) workbenchPanelScript = await fsp.readFile(workbenchPanelScriptPath, 'utf8');
  if (!workbenchTerminalCss) workbenchTerminalCss = await fsp.readFile(workbenchTerminalCssPath, 'utf8');
  if (!workbenchTerminalScript) workbenchTerminalScript = await fsp.readFile(workbenchTerminalScriptPath, 'utf8');
  return {
    css: `${workbenchPanelCss}\n${workbenchTerminalCss}`,
    reviewScript: workbenchPanelScript,
    terminalScript: workbenchTerminalScript
  };
};

const installWorkbenchPanel = async () => {
  if (!harnessUiReady()) return false;
  try {
    const assets = await loadWorkbenchPanelAssets();
    await mainWindow.webContents.insertCSS(assets.css, { cssOrigin: 'author' });
    await mainWindow.webContents.executeJavaScript(getWorkbenchPanelBootstrapScript(getWorkbenchState()), true);
    const reviewInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.reviewScript, true));
    const terminalInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.terminalScript, true));
    return reviewInstalled && terminalInstalled;
  } catch {
    return false;
  }
};

const applyWorkbenchPanelLayout = async ({ focus = false, focusTarget = 'review' } = {}) => {
  if (!harnessUiReady()) return false;
  const applied = Boolean(await mainWindow.webContents.executeJavaScript(
    getWorkbenchPanelLayoutScript(getWorkbenchState()),
    true
  ));
  if (applied && focus) {
    const globalName = focusTarget === 'terminal' ? '__DSH_TERMINAL__' : '__DSH_WORKBENCH__';
    await mainWindow.webContents.executeJavaScript(`Boolean(window.${globalName}?.focus?.())`, true);
  }
  return applied;
};

const setReviewPanelOpen = async (open, { focus = false } = {}) => {
  const state = await workbenchStore.setReviewPanelOpen(Boolean(open));
  installApplicationMenu();
  if (harnessUiReady()) {
    const applied = await applyWorkbenchPanelLayout({ focus: focus && state.reviewPanelOpen });
    if (!applied) await installWorkbenchPanel();
  }
  return state;
};

const setReviewPanelWidth = async (width) => {
  const state = await workbenchStore.setReviewPanelWidth(width);
  if (harnessUiReady()) await applyWorkbenchPanelLayout();
  return state;
};

const setTerminalPanelOpen = async (open, { focus = false } = {}) => {
  const state = await workbenchStore.setTerminalPanelOpen(Boolean(open));
  installApplicationMenu();
  if (harnessUiReady()) {
    const applied = await applyWorkbenchPanelLayout({
      focus: focus && state.terminalPanelOpen,
      focusTarget: 'terminal'
    });
    if (!applied) await installWorkbenchPanel();
  }
  return state;
};

const setTerminalPanelHeight = async (height) => {
  const state = await workbenchStore.setTerminalPanelHeight(height);
  if (harnessUiReady()) await applyWorkbenchPanelLayout();
  return state;
};

const desktopIpcAllowed = (event) => Boolean(
  mainWindow
  && !mainWindow.isDestroyed()
  && event?.sender === mainWindow.webContents
  && currentUrlAllowed(event.senderFrame?.url || event.sender.getURL())
);

const harnessIpcAllowed = (event) => desktopIpcAllowed(event) && harnessUiReady();

const sameStringArray = (left = [], right = []) => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const sameAgentDiagnostics = (left, right) => (
  left.status === right.status
  && left.canStop === right.canStop
  && left.canSteer === right.canSteer
  && left.canFocusInput === right.canFocusInput
  && left.canFocusPending === right.canFocusPending
  && left.pendingCount === right.pendingCount
  && left.queuedCount === right.queuedCount
  && left.toolCount === right.toolCount
  && left.activeToolCount === right.activeToolCount
  && left.failedToolCount === right.failedToolCount
  && left.stoppedToolCount === right.stoppedToolCount
  && left.latestToolState === right.latestToolState
  && left.latestToolKind === right.latestToolKind
  && left.canFocusTool === right.canFocusTool
  && left.canOpenTrajectory === right.canOpenTrajectory
  && left.testCount === right.testCount
  && left.latestTestState === right.latestTestState
  && left.latestTestExitCode === right.latestTestExitCode
  && left.permissionMode === right.permissionMode
  && left.canOpenPermission === right.canOpenPermission
  && left.planMode === right.planMode
  && left.canEnterPlan === right.canEnterPlan
  && left.canExitPlan === right.canExitPlan
  && left.powerShellCompatibility === right.powerShellCompatibility
  && left.diffCount === right.diffCount
  && sameStringArray(left.producedPaths, right.producedPaths)
  && left.latestProducedPath === right.latestProducedPath
  && left.canFocusChange === right.canFocusChange
);

const sameChangeReviewDiagnostics = (left, right) => (
  left.status === right.status
  && left.path === right.path
  && left.repoPath === right.repoPath
  && left.canAccept === right.canAccept
  && left.canReject === right.canReject
  && left.protected === right.protected
  && left.untracked === right.untracked
  && left.reason === right.reason
  && left.total === right.total
  && left.pendingCount === right.pendingCount
  && left.protectedCount === right.protectedCount
  && left.acceptedCount === right.acceptedCount
  && left.canAcceptCount === right.canAcceptCount
  && left.canRejectCount === right.canRejectCount
  && left.truncated === right.truncated
  && left.items.length === right.items.length
  && left.items.every((item, index) => {
    const other = right.items[index];
    return item.path === other.path
      && item.status === other.status
      && item.canAccept === other.canAccept
      && item.canReject === other.canReject
      && item.protected === other.protected
      && item.untracked === other.untracked;
  })
);

const refreshChangeReviewDiagnostics = async ({ rebuildMenu = true } = {}) => {
  let next = emptyChangeReviewDiagnostics();
  if (changeReviewer) {
    const list = await changeReviewer.listChanges({ limit: 30 });
    const latestPath = agentDiagnostics.latestProducedPath;
    const latest = latestPath ? await changeReviewer.inspect(latestPath) : emptyChangeReviewDiagnostics(list.reason);
    next = {
      ...latest,
      total: list.total,
      pendingCount: list.pendingCount,
      protectedCount: list.protectedCount,
      acceptedCount: list.acceptedCount,
      canAcceptCount: list.canAcceptCount,
      canRejectCount: list.canRejectCount,
      truncated: list.truncated,
      items: list.items
    };
  }
  const changed = !sameChangeReviewDiagnostics(changeReviewDiagnostics, next);
  changeReviewDiagnostics = Object.freeze({
    ...next,
    items: Object.freeze([...(next.items || [])])
  });
  if (changed && rebuildMenu) installApplicationMenu();
  if (changed && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('diagnostics:state', getDiagnosticsState());
  }
  return changed;
};

let terminalWasActive = false;
let terminalSettlePromise = Promise.resolve();
const recaptureUserChangeBaseline = async () => {
  if (!changeReviewer) return;
  try {
    await changeReviewer.captureBaseline();
    await refreshChangeReviewDiagnostics();
  } catch {
    // Terminal changes stay on disk even if conservative Git baseline metadata cannot be refreshed.
  }
};

const bindTerminalRunner = (runner) => {
  runner.on('output', (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:output', event);
  });
  runner.on('state', (state) => {
    const active = state.status === 'running' || state.status === 'stopping';
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:state', state);
    if (terminalWasActive && !active) terminalSettlePromise = recaptureUserChangeBaseline();
    terminalWasActive = active;
    installApplicationMenu();
  });
};

const runTerminalCommand = async (value) => {
  if (!terminalRunner || !harnessUiReady()) {
    return { ok: false, message: '集成终端尚未就绪。', state: terminalRunner?.getState() };
  }
  let command;
  try {
    command = normalizeTerminalCommand(value);
  } catch (error) {
    return { ok: false, message: error.message, state: terminalRunner.getState() };
  }
  if (terminalRunner.isActive()) {
    return { ok: false, message: '已有终端命令正在运行。', state: terminalRunner.getState() };
  }
  const workspace = getWorkspaceState();
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '确认运行终端命令',
    message: '将在当前工作区运行以下 PowerShell 命令。',
    detail: `工作区：${workspace.activePath}\n\n${command}\n\n软件内保存的 DeepSeek API Key 不会传入此命令。`,
    buttons: ['运行', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) {
    return { ok: false, canceled: true, state: terminalRunner.getState() };
  }
  try {
    return { ok: true, state: terminalRunner.start(command) };
  } catch (error) {
    return { ok: false, message: error.message, state: terminalRunner.getState() };
  }
};

const refreshAgentDiagnostics = async ({ rebuildMenu = true } = {}) => {
  let next = unavailableAgentDiagnostics();
  if (harnessUiReady()) {
    try {
      next = await readHarnessAgentState(mainWindow.webContents);
    } catch {
      // A navigation can invalidate the page between the readiness check and DOM read.
    }
  }
  const enteringActiveTurn = !['running', 'waiting'].includes(agentDiagnostics.status)
    && ['running', 'waiting'].includes(next.status);
  if (enteringActiveTurn && changeReviewer) {
    try {
      await changeReviewer.captureBaseline();
    } catch {
      // Baseline capture is conservative safety metadata; Git state remains untouched on failure.
    }
  }
  const changed = !sameAgentDiagnostics(agentDiagnostics, next);
  agentDiagnostics = Object.freeze({ ...next, producedPaths: Object.freeze([...(next.producedPaths || [])]) });
  const reviewChanged = await refreshChangeReviewDiagnostics({ rebuildMenu: false });
  if ((changed || reviewChanged) && rebuildMenu) installApplicationMenu();
  if ((changed || reviewChanged) && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('diagnostics:state', getDiagnosticsState());
  }
  return { ...agentDiagnostics };
};

function stopAgentPolling() {
  if (!agentPollTimer) return;
  clearInterval(agentPollTimer);
  agentPollTimer = undefined;
}

function startAgentPolling() {
  stopAgentPolling();
  void refreshAgentDiagnostics();
  agentPollTimer = setInterval(() => {
    void refreshAgentDiagnostics();
  }, 1500);
  agentPollTimer.unref?.();
}

const showHarnessActionFailure = async () => {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Harness 界面尚未就绪',
    message: '当前无法执行该操作。',
    detail: '请等待 DeepSeek Harness 完成加载后重试。',
    buttons: ['确定'],
    defaultId: 0
  });
};

const runHarnessUiAction = async (action) => {
  if (!harnessUiReady()) {
    await showHarnessActionFailure();
    return false;
  }
  mainWindow.show();
  mainWindow.focus();
  try {
    const handled = await invokeHarnessUiAction(mainWindow.webContents, action);
    if (!handled) {
      const state = await refreshAgentDiagnostics();
      const stateAlreadySettled = isAgentActionSettled(action, state);
      if (!stateAlreadySettled) await showHarnessActionFailure();
      return stateAlreadySettled;
    }
    if (handled) setTimeout(() => { void refreshAgentDiagnostics(); }, 120);
    return handled;
  } catch {
    await showHarnessActionFailure();
    return false;
  }
};

const enterPlanMode = async () => {
  if (!harnessUiReady()) {
    await showHarnessActionFailure();
    return false;
  }
  await refreshAgentDiagnostics();
  if (!agentDiagnostics.canEnterPlan) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '当前无法进入 Plan 模式',
      message: agentDiagnostics.planMode === 'on' ? '当前会话已经处于 Plan 模式。' : '请等待当前 Agent 操作结束后重试。',
      buttons: ['确定'],
      defaultId: 0
    });
    return false;
  }
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '进入 Plan 模式',
    message: '让当前会话先分析并形成计划？',
    detail: 'DSH Desktop 将通过 Harness 官方 /plan 命令进入 Plan 模式。完成的计划仍由 Harness 官方确认卡审批；Plan 状态不替代访问模式和命令权限。现有输入草稿不会被覆盖。',
    buttons: ['进入 Plan 模式', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (confirmation.response !== 0) return false;
  const result = await invokeHarnessCommandAction(mainWindow.webContents, 'enter-plan-mode');
  if (!result.ok) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '未进入 Plan 模式',
      message: result.reason === 'composer-has-draft'
        ? '输入区已有未发送内容，应用没有覆盖。'
        : 'Harness 输入区尚未准备好。',
      detail: result.reason === 'composer-has-draft'
        ? '请先发送、保存或清空现有草稿，再从 Agent 菜单进入 Plan 模式。'
        : '请等待当前页面和会话完成加载后重试。',
      buttons: ['确定'],
      defaultId: 0
    });
    return false;
  }
  setTimeout(() => { void refreshAgentDiagnostics(); }, 200);
  return true;
};

const exitPlanModeWithoutApproval = async () => {
  await refreshAgentDiagnostics();
  if (agentDiagnostics.planMode !== 'on') return true;
  if (agentDiagnostics.status === 'waiting') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '计划正在等待确认',
      message: '请在 Harness 计划确认卡中选择“批准”或“继续规划”。',
      detail: '桌面端不会把关闭 Plan 模式冒充成批准计划。可以使用“定位 Plan 确认”直接回到确认卡。',
      buttons: ['确定'],
      defaultId: 0
    });
    return false;
  }
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '退出 Plan 模式',
    message: '退出 Plan 模式并返回默认执行模式？',
    detail: '这会调用 Harness 官方 /plan off。它不会批准某个计划，也不会自动运行命令；后续执行仍受当前访问模式和审批策略控制。',
    buttons: ['退出 Plan 模式', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (confirmation.response !== 0) return false;
  return runHarnessUiAction('exit-plan-mode');
};

const agentStatusLabel = () => {
  const labels = {
    ready: 'Agent 状态：空闲',
    running: 'Agent 状态：运行中',
    waiting: 'Agent 状态：等待用户确认',
    unavailable: 'Agent 状态：不可用'
  };
  const base = labels[agentDiagnostics.status] || labels.unavailable;
  if (agentDiagnostics.status === 'waiting' && agentDiagnostics.pendingCount > 1) {
    return `${base}（${agentDiagnostics.pendingCount}）`;
  }
  return base;
};

const toolStatusLabel = () => {
  if (agentDiagnostics.activeToolCount > 0) return `工具状态：运行中（${agentDiagnostics.activeToolCount}）`;
  const labels = {
    ok: '工具状态：最近完成',
    error: '工具状态：最近失败',
    stopped: '工具状态：最近已停止',
    none: '工具状态：尚无工具调用'
  };
  return labels[agentDiagnostics.latestToolState] || labels.none;
};

const latestToolLabel = () => {
  const labels = {
    read: '读取',
    search: '搜索',
    write: '写入',
    edit: '编辑',
    command: '命令',
    code: '代码',
    web: '联网',
    skill: '技能',
    task: '任务',
    other: '其他工具',
    none: '无'
  };
  const prefix = agentDiagnostics.activeToolCount > 0 ? '当前工具' : '最近工具';
  return `${prefix}：${labels[agentDiagnostics.latestToolKind] || labels.other}`;
};

const latestTestLabel = () => {
  const labels = {
    running: '测试结果：运行中',
    passed: '测试结果：通过',
    failed: '测试结果：失败',
    stopped: '测试结果：已停止',
    none: '测试结果：尚未检测'
  };
  const base = labels[agentDiagnostics.latestTestState] || labels.none;
  return Number.isSafeInteger(agentDiagnostics.latestTestExitCode)
    ? `${base}（退出码 ${agentDiagnostics.latestTestExitCode}）`
    : base;
};

const permissionModeLabel = () => {
  const labels = {
    'read-only': '权限模式：Read Only',
    'workspace-write': '权限模式：Workspace Write',
    'danger-full-access': '权限模式：Full Access',
    unknown: '权限模式：未检测'
  };
  return labels[agentDiagnostics.permissionMode] || labels.unknown;
};

const planModeLabel = () => {
  const labels = {
    on: 'Plan 模式：已开启',
    off: 'Plan 模式：已关闭',
    unavailable: 'Plan 模式：不可用'
  };
  const base = labels[agentDiagnostics.planMode] || labels.unavailable;
  return agentDiagnostics.planMode === 'on' && agentDiagnostics.status === 'waiting'
    ? `${base}（等待计划确认）`
    : base;
};

const powerShellCompatibilityLabel = () => agentDiagnostics.powerShellCompatibility === 'sandbox-crash'
  ? 'PowerShell：受限模式不兼容（0xC0000005）'
  : 'PowerShell：尚未检测到兼容问题';

const changeStatusLabel = () => {
  if (changeReviewDiagnostics.total > 0) {
    const truncated = changeReviewDiagnostics.truncated ? '+' : '';
    return `变更：${changeReviewDiagnostics.total}${truncated} 个 · 待审 ${changeReviewDiagnostics.pendingCount} · 保护 ${changeReviewDiagnostics.protectedCount} · 已接受 ${changeReviewDiagnostics.acceptedCount}`;
  }
  const fileName = changeReviewDiagnostics.path ? path.basename(changeReviewDiagnostics.path) : '';
  const suffix = fileName ? ` — ${fileName}` : '';
  const labels = {
    pending: `变更状态：待审查${suffix}`,
    protected: `变更状态：已有修改，拒绝已保护${suffix}`,
    accepted: `变更状态：已接受并暂存${suffix}`,
    clean: `变更状态：工作区已恢复${suffix}`,
    unavailable: `变更状态：仅可查看${suffix}`,
    none: '变更状态：尚未检测到产物文件'
  };
  return labels[changeReviewDiagnostics.status] || labels.none;
};

const changeItemStatusLabel = (state) => {
  const labels = {
    pending: '待审查',
    protected: '原有修改已保护',
    accepted: '已接受并暂存',
    clean: '已恢复',
    unavailable: '仅可查看'
  };
  return labels[state.status] || '状态未知';
};

const changeItemMenuLabel = (state) => {
  const prefix = {
    pending: '待审',
    protected: '保护',
    accepted: '已接受',
    clean: '已恢复',
    unavailable: '只读'
  }[state.status] || '未知';
  const value = `${state.path}`;
  return `[${prefix}] ${value.length > 90 ? `${value.slice(0, 87)}…` : value}`;
};

const showChangeReviewFailure = async (error) => {
  const protectedChange = error?.code === 'preexisting-unstaged-change';
  await dialog.showMessageBox(mainWindow, {
    type: protectedChange ? 'warning' : 'error',
    title: protectedChange ? '已保护原有修改' : '无法处理文件变更',
    message: protectedChange
      ? '这个文件在打开仓库时已经有未暂存修改。'
      : '没有执行接受或拒绝操作。',
    detail: error?.message || String(error),
    buttons: ['确定'],
    defaultId: 0
  });
};

const reviewChangePath = async (reportedPath, action) => {
  try {
    await refreshChangeReviewDiagnostics();
    if (!reportedPath || !changeReviewer) throw new Error('尚未检测到可审查文件。');
    const state = await changeReviewer.inspect(reportedPath);
    if (state.status === 'unavailable') throw new Error('当前文件无法安全审查。');
    if (agentDiagnostics.canStop || agentDiagnostics.status === 'waiting') {
      throw new Error('Agent 仍在运行或等待确认，请完成当前操作后再审查变更。');
    }
    if (state.protected && action === 'reject') {
      const error = new Error('为避免覆盖你打开仓库前已有的内容，一键拒绝已禁用。你仍可先查看 Diff，再手动处理。');
      error.code = 'preexisting-unstaged-change';
      throw error;
    }
    const fileName = path.basename(state.path);
    const accepting = action === 'accept';
    const result = await dialog.showMessageBox(mainWindow, {
      type: accepting ? 'question' : 'warning',
      title: accepting ? '接受文件变更' : '拒绝文件变更',
      message: accepting
        ? `接受并暂存 ${fileName}？`
        : `拒绝并恢复 ${fileName}？`,
      detail: accepting
        ? `${state.path}\n\n这会把该文件当前内容加入 Git 暂存区，作为后续拒绝操作的恢复基线；不会提交或推送。`
        : state.untracked
          ? `${state.path}\n\n这是新文件。拒绝后会移动到 Windows 回收站，仍可从回收站恢复。`
          : `${state.path}\n\n这会把工作区文件恢复到当前 Git 暂存版本；已有暂存内容会保留，不会提交或推送。`,
      buttons: [accepting ? '接受并暂存' : '拒绝并恢复', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return false;
    if (accepting) await changeReviewer.accept(state.path);
    else await changeReviewer.reject(state.path);
    await refreshChangeReviewDiagnostics();
    return true;
  } catch (error) {
    await showChangeReviewFailure(error);
    return false;
  }
};

const reviewLatestChange = async (action) => reviewChangePath(changeReviewDiagnostics.path, action);

const reviewChangeBatch = async (action) => {
  try {
    if (!changeReviewer) throw new Error('当前没有可用的 Git 审查器。');
    if (agentDiagnostics.canStop || agentDiagnostics.status === 'waiting') {
      throw new Error('Agent 仍在运行或等待确认，请完成当前操作后再审查变更。');
    }
    const list = await changeReviewer.listChanges({ limit: 100 });
    const candidates = list.items.filter((item) => item.status === 'pending' && !item.protected);
    if (candidates.length === 0) throw new Error('当前没有可批量处理的 Agent 变更。');
    const accepting = action === 'accept';
    const newFileCount = candidates.filter((item) => item.untracked).length;
    const result = await dialog.showMessageBox(mainWindow, {
      type: accepting ? 'question' : 'warning',
      title: accepting ? '接受全部待审文件' : '拒绝全部待审文件',
      message: accepting
        ? `接受并暂存 ${candidates.length} 个文件？`
        : `拒绝并恢复 ${candidates.length} 个文件？`,
      detail: accepting
        ? `只处理标记为“待审”的文件；${list.protectedCount} 个原有修改保护文件不会包含。操作只写入 Git 暂存区，不会提交或推送。`
        : `只处理标记为“待审”的文件；${list.protectedCount} 个原有修改保护文件不会包含。其中 ${newFileCount} 个新文件会进入 Windows 回收站，其余文件恢复到当前 Git 暂存版本。`,
      buttons: [accepting ? '全部接受并暂存' : '全部拒绝并恢复', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (result.response !== 0) return false;
    const paths = candidates.map((item) => item.path);
    if (accepting) await changeReviewer.acceptMany(paths);
    else await changeReviewer.rejectMany(paths);
    await refreshChangeReviewDiagnostics();
    return true;
  } catch (error) {
    await showChangeReviewFailure(error);
    return false;
  }
};

const showPowerShellCompatibility = async () => {
  const affected = agentDiagnostics.powerShellCompatibility === 'sandbox-crash';
  const canOpenPermission = harnessUiReady() && agentDiagnostics.canOpenPermission;
  const result = await dialog.showMessageBox(mainWindow, {
    type: affected ? 'warning' : 'info',
    title: 'PowerShell 兼容性',
    message: affected ? '当前 Windows 受限 PowerShell 运行环境发生崩溃。' : '尚未从当前会话检测到受限 PowerShell 崩溃。',
    detail: affected
      ? '工具进程以 0xC0000005 退出，DSH Desktop 已将其保留为失败，不会伪装成测试通过。\n\n可以打开 Harness 权限模式，并在明确接受风险后选择 Full Access 重试。Full Access 会绕过命令沙盒，允许命令访问工作区之外的文件；应用不会自动切换。'
      : '受限模式会继续保持。若后续出现退出码 3221225477，可从这里打开权限模式检查。',
    buttons: canOpenPermission ? ['打开权限模式', '确定'] : ['确定'],
    defaultId: canOpenPermission ? 1 : 0,
    cancelId: canOpenPermission ? 1 : 0
  });
  if (canOpenPermission && result.response === 0) await runHarnessUiAction('open-permission-mode');
};

const credentialLabel = () => {
  const labels = {
    configured: '软件 Key：已配置',
    invalid: '软件 Key：格式无效',
    missing: '软件 Key：未配置',
    unavailable: '软件 Key：状态不可用'
  };
  return labels[desktopDiagnostics.credential.status] || labels.unavailable;
};

const showCredentialDiagnostics = async () => {
  const state = await refreshDesktopDiagnostics();
  const credential = state.credential;
  const type = credential.status === 'configured' ? 'info' : 'warning';
  const detailByStatus = {
    configured: `${credential.message}\n\n软件托管 Key 优先于 Windows 环境变量；密钥值不会显示或写入桌面日志。`,
    invalid: `${credential.message}\n\n请在 Harness 的“设置 → 模型”中重新输入原始 API Key。`,
    missing: `${credential.message}\n\n请打开 Harness 的“设置 → 模型”直接配置。保存后立即由软件托管，无需维护 Windows 环境变量。`,
    unavailable: `${credential.message}\n\n请检查 Harness 数据目录权限后重试。`
  };
  const canOpenSettings = harnessUiReady();
  const result = await dialog.showMessageBox(mainWindow, {
    type,
    title: '模型配置诊断',
    message: credentialLabel(),
    detail: detailByStatus[credential.status] || credential.message,
    buttons: canOpenSettings ? ['打开模型设置', '确定'] : ['确定'],
    defaultId: 0,
    cancelId: canOpenSettings ? 1 : 0
  });
  if (canOpenSettings && result.response === 0) await runHarnessUiAction('models-settings');
};

const showWorkspaceError = async (error) => {
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: '无法打开代码仓库',
    message: '无法使用所选目录作为 Harness 工作区。',
    detail: error?.message || String(error),
    buttons: ['确定'],
    defaultId: 0
  });
};

const activateWorkspace = async (workspacePath) => {
  try {
    if (terminalRunner?.isActive()) await terminalRunner.stop();
    await terminalSettlePromise;
    const workspace = await workspaceStore.activate(workspacePath);
    await changeReviewer.activate(workspace.activePath);
    changeReviewDiagnostics = emptyChangeReviewDiagnostics();
    terminalRunner?.setWorkspace(workspace.activePath);
    supervisor.setLaunchDir(workspace.activePath);
    installApplicationMenu();
    applyWindowTitle();
    const result = await startHarnessForWindow({ restart: true });
    return { ...result, workspace };
  } catch (error) {
    await showWorkspaceError(error);
    return { ok: false, error: error.message };
  }
};

const chooseWorkspace = async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择本地代码仓库',
    buttonLabel: '打开仓库',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  return activateWorkspace(result.filePaths[0]);
};

function installApplicationMenu() {
  const workspace = getWorkspaceState();
  const harnessReady = harnessUiReady();
  const reviewIdle = !agentDiagnostics.canStop && agentDiagnostics.status !== 'waiting';
  const terminalState = terminalRunner?.getState() || { status: 'idle' };
  const terminalActive = terminalState.status === 'running' || terminalState.status === 'stopping';
  const recentItems = workspace.recentPaths.length > 0
    ? workspace.recentPaths.map((recentPath) => ({
      label: `${path.basename(recentPath) || path.parse(recentPath).root} — ${path.dirname(recentPath)}`,
      type: 'checkbox',
      checked: recentPath === workspace.activePath,
      click: () => { void activateWorkspace(recentPath); }
    }))
    : [{ label: '暂无最近仓库', enabled: false }];
  const changeFileItems = changeReviewDiagnostics.items.length > 0
    ? changeReviewDiagnostics.items.map((state) => ({
      label: changeItemMenuLabel(state),
      submenu: [
        { label: `状态：${changeItemStatusLabel(state)}`, enabled: false },
        { label: state.path, enabled: false },
        { type: 'separator' },
        {
          label: '接受并暂存…',
          enabled: harnessReady && reviewIdle && state.canAccept,
          click: () => { void reviewChangePath(state.path, 'accept'); }
        },
        {
          label: '拒绝并恢复…',
          enabled: harnessReady && reviewIdle && state.canReject,
          click: () => { void reviewChangePath(state.path, 'reject'); }
        }
      ]
    }))
    : [{ label: '暂无 Git 变更', enabled: false }];
  if (changeReviewDiagnostics.truncated) {
    changeFileItems.push({ label: '仅显示前 30 个文件，请先处理后刷新', enabled: false });
  }
  const template = [
    {
      label: '项目',
      submenu: [
        { label: '打开代码仓库…', accelerator: 'CmdOrCtrl+O', click: () => { void chooseWorkspace(); } },
        { label: '最近使用', submenu: recentItems },
        { type: 'separator' },
        { label: `当前：${workspace.displayName}`, enabled: false },
        { label: workspaceSyncLabel(), enabled: false },
        {
          label: '在文件资源管理器中显示',
          enabled: !workspace.isFallback,
          click: () => { void shell.openPath(workspace.activePath); }
        }
      ]
    },
    {
      label: '会话',
      submenu: [
        {
          label: '新建会话',
          accelerator: 'CmdOrCtrl+N',
          enabled: harnessReady,
          click: () => { void runHarnessUiAction('new-session'); }
        },
        {
          label: '搜索会话',
          accelerator: 'CmdOrCtrl+Shift+F',
          enabled: harnessReady,
          click: () => { void runHarnessUiAction('search-sessions'); }
        },
        {
          label: '定位会话列表',
          enabled: harnessReady,
          click: () => { void runHarnessUiAction('focus-session-list'); }
        },
        { type: 'separator' },
        { label: `已保存会话：${desktopDiagnostics.sessions.count}`, enabled: false },
        {
          label: '刷新会话状态',
          click: () => { void refreshDesktopDiagnostics(); }
        },
        {
          label: '打开会话数据目录',
          click: async () => {
            const sessionsRoot = path.join(dataRoot, 'harness', 'sessions');
            await fsp.mkdir(sessionsRoot, { recursive: true });
            await shell.openPath(sessionsRoot);
          }
        }
      ]
    },
    {
      label: 'Agent',
      submenu: [
        { label: agentStatusLabel(), enabled: false },
        { label: planModeLabel(), enabled: false },
        {
          label: '进入 Plan 模式…',
          enabled: harnessReady && agentDiagnostics.canEnterPlan,
          click: () => { void enterPlanMode(); }
        },
        {
          label: '定位 Plan 确认',
          enabled: harnessReady && agentDiagnostics.planMode === 'on' && agentDiagnostics.canFocusPending,
          click: () => { void runHarnessUiAction('focus-pending'); }
        },
        {
          label: '退出 Plan 模式（不批准计划）…',
          enabled: harnessReady && agentDiagnostics.canExitPlan && agentDiagnostics.status !== 'waiting',
          click: () => { void exitPlanModeWithoutApproval(); }
        },
        { type: 'separator' },
        {
          label: '停止当前生成',
          accelerator: 'Esc',
          enabled: harnessReady && agentDiagnostics.canStop,
          click: () => { void runHarnessUiAction('stop-agent'); }
        },
        {
          label: '聚焦补充/纠正输入',
          accelerator: 'CmdOrCtrl+Shift+I',
          enabled: harnessReady && agentDiagnostics.canFocusInput,
          click: () => { void runHarnessUiAction('focus-agent-input'); }
        },
        {
          label: agentDiagnostics.queuedCount > 1
            ? `插话发送首条排队消息（共 ${agentDiagnostics.queuedCount} 条）`
            : '插话发送首条排队消息',
          enabled: harnessReady && agentDiagnostics.canSteer,
          click: () => { void runHarnessUiAction('steer-queued'); }
        },
        {
          label: '定位待确认操作',
          enabled: harnessReady && agentDiagnostics.canFocusPending,
          click: () => { void runHarnessUiAction('focus-pending'); }
        },
        { type: 'separator' },
        { label: '运行中：Enter 排队；Ctrl+Enter 插话', enabled: false },
        {
          label: '刷新 Agent 状态',
          enabled: harnessReady,
          click: () => { void refreshAgentDiagnostics(); }
        }
      ]
    },
    {
      label: '工具',
      submenu: [
        { label: toolStatusLabel(), enabled: false },
        { label: latestToolLabel(), enabled: false },
        { label: latestTestLabel(), enabled: false },
        { label: permissionModeLabel(), enabled: false },
        { label: powerShellCompatibilityLabel(), enabled: false },
        { type: 'separator' },
        {
          label: '定位当前/最近工具',
          enabled: harnessReady && agentDiagnostics.canFocusTool,
          click: () => { void runHarnessUiAction('focus-latest-tool'); }
        },
        {
          label: '打开工具轨迹',
          enabled: harnessReady && agentDiagnostics.canOpenTrajectory,
          click: () => { void runHarnessUiAction('open-trajectory'); }
        },
        {
          label: '打开权限模式…',
          enabled: harnessReady && agentDiagnostics.canOpenPermission,
          click: () => { void runHarnessUiAction('open-permission-mode'); }
        },
        {
          label: 'PowerShell 兼容性说明…',
          click: () => { void showPowerShellCompatibility(); }
        },
        { type: 'separator' },
        {
          label: `当前窗口：${agentDiagnostics.toolCount} 次调用 · ${agentDiagnostics.failedToolCount} 次失败 · ${agentDiagnostics.stoppedToolCount} 次停止`,
          enabled: false
        },
        {
          label: '刷新工具状态',
          enabled: harnessReady,
          click: () => { void refreshAgentDiagnostics(); }
        }
      ]
    },
    {
      label: '变更',
      submenu: [
        { label: changeStatusLabel(), enabled: false },
        {
          label: '定位最近 Diff',
          accelerator: 'CmdOrCtrl+Shift+D',
          enabled: harnessReady && agentDiagnostics.canFocusChange,
          click: () => { void runHarnessUiAction('focus-latest-change'); }
        },
        { type: 'separator' },
        {
          label: `多文件审查（${changeReviewDiagnostics.total}${changeReviewDiagnostics.truncated ? '+' : ''}）`,
          submenu: changeFileItems
        },
        {
          label: `全部接受待审文件…（${changeReviewDiagnostics.canAcceptCount}）`,
          enabled: harnessReady && reviewIdle && changeReviewDiagnostics.canAcceptCount > 0,
          click: () => { void reviewChangeBatch('accept'); }
        },
        {
          label: `全部拒绝待审文件…（${changeReviewDiagnostics.canRejectCount}）`,
          enabled: harnessReady && reviewIdle && changeReviewDiagnostics.canRejectCount > 0,
          click: () => { void reviewChangeBatch('reject'); }
        },
        { label: '批量操作自动排除打开仓库前已有修改', enabled: false },
        { type: 'separator' },
        {
          label: '接受并暂存最近文件…',
          enabled: harnessReady && reviewIdle && changeReviewDiagnostics.canAccept,
          click: () => { void reviewLatestChange('accept'); }
        },
        {
          label: '拒绝最近文件并恢复…',
          enabled: harnessReady && reviewIdle && changeReviewDiagnostics.canReject,
          click: () => { void reviewLatestChange('reject'); }
        },
        { label: '接受只写入暂存区；拒绝不会提交或推送', enabled: false },
        { type: 'separator' },
        {
          label: '刷新变更状态',
          enabled: harnessReady,
          click: () => { void refreshChangeReviewDiagnostics(); }
        }
      ]
    },
    {
      label: '模型',
      submenu: [
        { label: credentialLabel(), enabled: false },
        { label: '凭据优先级：软件托管', enabled: false },
        { type: 'separator' },
        {
          label: '打开软件 Key 设置',
          enabled: harnessReady,
          click: () => { void runHarnessUiAction('models-settings'); }
        },
        {
          label: '检查模型配置…',
          click: () => { void showCredentialDiagnostics(); }
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '显示集成终端',
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+Alt+T',
          checked: getWorkbenchState().terminalPanelOpen,
          enabled: harnessReady,
          click: (item) => { void setTerminalPanelOpen(item.checked, { focus: item.checked }); }
        },
        {
          label: '聚焦集成终端',
          accelerator: 'CmdOrCtrl+Alt+K',
          enabled: harnessReady && getWorkbenchState().terminalPanelOpen,
          click: () => { void applyWorkbenchPanelLayout({ focus: true, focusTarget: 'terminal' }); }
        },
        {
          label: terminalActive ? '停止当前终端命令' : '终端：当前无运行命令',
          enabled: harnessReady && terminalActive,
          click: () => { void terminalRunner.stop(); }
        },
        {
          label: '重置终端高度',
          enabled: harnessReady,
          click: () => { void setTerminalPanelHeight(240); }
        },
        { type: 'separator' },
        {
          label: '显示变更审查面板',
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+Alt+D',
          checked: getWorkbenchState().reviewPanelOpen,
          enabled: harnessReady,
          click: (item) => { void setReviewPanelOpen(item.checked, { focus: item.checked }); }
        },
        {
          label: '聚焦变更审查面板',
          accelerator: 'CmdOrCtrl+Alt+J',
          enabled: harnessReady && getWorkbenchState().reviewPanelOpen,
          click: () => { void applyWorkbenchPanelLayout({ focus: true }); }
        },
        {
          label: '重置审查面板宽度',
          enabled: harnessReady,
          click: () => { void setReviewPanelWidth(340); }
        },
        { type: 'separator' },
        { role: 'reload', label: '重新加载页面' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '打开运行日志',
          click: async () => {
            const logFile = supervisor?.getState().logFile;
            if (logFile) shell.showItemInFolder(logFile);
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('app:get-info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  packaged: app.isPackaged
}));
ipcMain.handle('workspace:get-state', () => getWorkspaceState());
ipcMain.handle('workspace:choose', () => chooseWorkspace());
ipcMain.handle('diagnostics:get-state', () => getDiagnosticsState());
ipcMain.handle('diagnostics:refresh', () => refreshDesktopDiagnostics());
ipcMain.handle('changes:get-diff', async (event, reportedPath) => {
  if (!harnessIpcAllowed(event) || !changeReviewer) {
    return { available: false, reason: 'untrusted-or-unavailable', content: '', truncated: false, binary: false };
  }
  return changeReviewer.getDiff(reportedPath);
});
ipcMain.handle('changes:refresh', async (event) => {
  if (!harnessIpcAllowed(event)) return getDiagnosticsState();
  await refreshChangeReviewDiagnostics();
  return getDiagnosticsState();
});
ipcMain.handle('changes:accept', async (event, reportedPath) => {
  if (!harnessIpcAllowed(event)) return { ok: false, diagnostics: getDiagnosticsState() };
  const ok = await reviewChangePath(reportedPath, 'accept');
  return { ok, diagnostics: getDiagnosticsState() };
});
ipcMain.handle('changes:reject', async (event, reportedPath) => {
  if (!harnessIpcAllowed(event)) return { ok: false, diagnostics: getDiagnosticsState() };
  const ok = await reviewChangePath(reportedPath, 'reject');
  return { ok, diagnostics: getDiagnosticsState() };
});
ipcMain.handle('changes:accept-all', async (event) => {
  if (!harnessIpcAllowed(event)) return { ok: false, diagnostics: getDiagnosticsState() };
  const ok = await reviewChangeBatch('accept');
  return { ok, diagnostics: getDiagnosticsState() };
});
ipcMain.handle('changes:reject-all', async (event) => {
  if (!harnessIpcAllowed(event)) return { ok: false, diagnostics: getDiagnosticsState() };
  const ok = await reviewChangeBatch('reject');
  return { ok, diagnostics: getDiagnosticsState() };
});
ipcMain.handle('workbench:get-state', (event) => (
  desktopIpcAllowed(event)
    ? getWorkbenchState()
    : normalizeWorkbenchState({ reviewPanelOpen: false, terminalPanelOpen: false })
));
ipcMain.handle('workbench:set-review-panel-open', async (event, open) => {
  if (!harnessIpcAllowed(event) || typeof open !== 'boolean') return getWorkbenchState();
  return setReviewPanelOpen(open);
});
ipcMain.handle('workbench:set-review-panel-width', async (event, width) => {
  if (!harnessIpcAllowed(event) || !Number.isFinite(width)) return getWorkbenchState();
  return setReviewPanelWidth(width);
});
ipcMain.handle('workbench:set-terminal-panel-open', async (event, open) => {
  if (!harnessIpcAllowed(event) || typeof open !== 'boolean') return getWorkbenchState();
  return setTerminalPanelOpen(open);
});
ipcMain.handle('workbench:set-terminal-panel-height', async (event, height) => {
  if (!harnessIpcAllowed(event) || !Number.isFinite(height)) return getWorkbenchState();
  return setTerminalPanelHeight(height);
});
ipcMain.handle('terminal:get-state', (event) => (
  harnessIpcAllowed(event) && terminalRunner
    ? terminalRunner.getState()
    : { status: 'unavailable', cwd: '', runId: 0 }
));
ipcMain.handle('terminal:run', (event, command) => (
  harnessIpcAllowed(event)
    ? runTerminalCommand(command)
    : { ok: false, message: '终端请求来源未通过安全校验。' }
));
ipcMain.handle('terminal:stop', async (event) => {
  if (!harnessIpcAllowed(event) || !terminalRunner) return { status: 'unavailable' };
  return terminalRunner.stop();
});
ipcMain.handle('harness:get-state', () => supervisor?.getState() || { status: 'idle' });
ipcMain.handle('harness:restart', () => startHarnessForWindow({ restart: true }));
ipcMain.handle('harness:open-log', async () => {
  const logFile = supervisor?.getState().logFile;
  if (!logFile) return { ok: false };
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  await fsp.appendFile(logFile, '', 'utf8');
  shell.showItemInFolder(logFile);
  return { ok: true };
});

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#f5f5f4',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    applyWindowTitle();
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!currentUrlAllowed(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!currentUrlAllowed(url)) event.preventDefault();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (harnessUiReady()) void installWorkbenchPanel();
  });
  mainWindow.webContents.on('did-fail-load', async (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || loadFailureHandled || !harnessOrigin || !url.startsWith(harnessOrigin)) return;
    loadFailureHandled = true;
    stopAgentPolling();
    harnessOrigin = null;
    supervisor.reportFailure(new Error(`Harness 页面加载失败（${code}: ${description}）。`));
    await showStatusPage();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    stopAgentPolling();
    mainWindow = undefined;
  });

  applyWindowTitle();
  await mainWindow.loadFile(statusPage);
  void startHarnessForWindow();
};

const runDesktopSmoke = async (target) => {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, JSON.stringify({
    ok: true,
    name: app.getName(),
    version: app.getVersion(),
    locale: app.getLocale(),
    safeStorage: safeStorage.isEncryptionAvailable()
  }, null, 2));
};

const runHarnessSmoke = async (target) => {
  const smokeRoot = path.join(path.dirname(target), 'harness-smoke-data');
  supervisor = createSupervisor(smokeRoot);
  let result;
  try {
    const url = await supervisor.start();
    const probe = await probeHarness(url);
    const workspaceSync = await synchronizeHarnessWorkspace({
      origin: url,
      workspacePath: supervisor.getState().workspacePath,
      fallbackTitle: 'DSH 临时工作区'
    });
    result = {
      ok: true,
      name: app.getName(),
      version: app.getVersion(),
      url,
      ...probe,
      workspaceSync: {
        status: workspaceSync.status,
        workspaceTitle: workspaceSync.workspaceTitle,
        sessionCreated: workspaceSync.sessionCreated
      }
    };
  } catch (error) {
    result = { ok: false, name: app.getName(), version: app.getVersion(), error: error.message };
    process.exitCode = 1;
  } finally {
    await supervisor.stop();
  }
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
};

app.whenReady().then(async () => {
  app.setAppUserModelId('com.dsh.desktop');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  if (desktopSmokeTarget) {
    await runDesktopSmoke(desktopSmokeTarget.slice('--smoke-test-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (harnessSmokeTarget) {
    await runHarnessSmoke(harnessSmokeTarget.slice('--harness-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }

  dataRoot = app.getPath('userData');
  workspaceStore = new WorkspaceStore({
    filePath: path.join(dataRoot, 'desktop-state.json'),
    fallbackDir: path.join(dataRoot, 'launch-root')
  });
  workbenchStore = new WorkbenchStore({
    filePath: path.join(dataRoot, 'workbench-state.json')
  });
  await workbenchStore.init();
  const workspace = await workspaceStore.init();
  terminalRunner = new TerminalRunner({ workspacePath: workspace.activePath });
  bindTerminalRunner(terminalRunner);
  changeReviewer = new GitChangeReviewer({
    trashItem: (target) => shell.trashItem(target)
  });
  await changeReviewer.activate(workspace.activePath);
  supervisor = createSupervisor(dataRoot, workspace.activePath);
  await refreshDesktopDiagnostics({ rebuildMenu: false });
  installApplicationMenu();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', (event) => {
  stopAgentPolling();
  if (allowQuit || (!supervisor?.isActive() && !terminalRunner?.isActive())) return;
  event.preventDefault();
  const stops = [];
  if (terminalRunner?.isActive()) stops.push(terminalRunner.stop());
  if (supervisor?.isActive()) stops.push(supervisor.stop());
  void Promise.allSettled(stops).then(() => terminalSettlePromise).finally(() => {
    allowQuit = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  try {
    const logDir = app.getPath('userData');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'desktop-error.log'), `${new Date().toISOString()} ${error.stack || error.message}\n`);
  } catch {
    // Last-resort handler: avoid throwing again while recording the crash.
  }
});
