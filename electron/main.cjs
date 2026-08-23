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
const { PreviewManager, isSafePreviewNavigation } = require('./preview-manager.cjs');
const { TerminalRunner, resolveTerminalRuntime } = require('./terminal-runner.cjs');
const {
  getWorkbenchPanelBootstrapScript,
  getWorkbenchPanelLayoutScript
} = require('./workbench-panel.cjs');
const { WorkbenchStore, normalizeWorkbenchState } = require('./workbench-store.cjs');
const { WorkspaceFiles, WorkspaceFilesError } = require('./workspace-files.cjs');
const { WorkspaceStore } = require('./workspace-store.cjs');

app.commandLine.appendSwitch('lang', 'zh-CN');
app.setName('DSH Desktop');

let mainWindow;
let supervisor;
let workspaceStore;
let workbenchStore;
let changeReviewer;
let terminalRunner;
let previewManager;
let workspaceFiles;
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
const xtermCssPath = path.join(rootDir, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css');
const xtermScriptPath = path.join(rootDir, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js');
const xtermFitScriptPath = path.join(rootDir, 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js');
const workbenchFilesCssPath = path.join(rootDir, 'assets', 'workbench-files.css');
const workbenchFilesScriptPath = path.join(rootDir, 'assets', 'workbench-files.js');
const workbenchPreviewCssPath = path.join(rootDir, 'assets', 'workbench-preview.css');
const workbenchPreviewScriptPath = path.join(rootDir, 'assets', 'workbench-preview.js');
const workbenchCommandCssPath = path.join(rootDir, 'assets', 'workbench-command.css');
const workbenchCommandScriptPath = path.join(rootDir, 'assets', 'workbench-command.js');
const harnessLocalizationScriptPath = path.join(rootDir, 'assets', 'harness-localization.js');
let workbenchPanelCss = '';
let workbenchPanelScript = '';
let workbenchTerminalCss = '';
let workbenchTerminalScript = '';
let xtermCss = '';
let xtermScript = '';
let xtermFitScript = '';
let workbenchFilesCss = '';
let workbenchFilesScript = '';
let workbenchPreviewCss = '';
let workbenchPreviewScript = '';
let workbenchCommandCss = '';
let workbenchCommandScript = '';
let harnessLocalizationScript = '';
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
  if (!xtermCss) xtermCss = await fsp.readFile(xtermCssPath, 'utf8');
  if (!xtermScript) xtermScript = await fsp.readFile(xtermScriptPath, 'utf8');
  if (!xtermFitScript) xtermFitScript = await fsp.readFile(xtermFitScriptPath, 'utf8');
  if (!workbenchFilesCss) workbenchFilesCss = await fsp.readFile(workbenchFilesCssPath, 'utf8');
  if (!workbenchFilesScript) workbenchFilesScript = await fsp.readFile(workbenchFilesScriptPath, 'utf8');
  if (!workbenchPreviewCss) workbenchPreviewCss = await fsp.readFile(workbenchPreviewCssPath, 'utf8');
  if (!workbenchPreviewScript) workbenchPreviewScript = await fsp.readFile(workbenchPreviewScriptPath, 'utf8');
  if (!workbenchCommandCss) workbenchCommandCss = await fsp.readFile(workbenchCommandCssPath, 'utf8');
  if (!workbenchCommandScript) workbenchCommandScript = await fsp.readFile(workbenchCommandScriptPath, 'utf8');
  if (!harnessLocalizationScript) harnessLocalizationScript = await fsp.readFile(harnessLocalizationScriptPath, 'utf8');
  return {
    css: `${workbenchPanelCss}\n${xtermCss}\n${workbenchTerminalCss}\n${workbenchFilesCss}\n${workbenchPreviewCss}\n${workbenchCommandCss}`,
    reviewScript: workbenchPanelScript,
    terminalScript: workbenchTerminalScript,
    xtermScript,
    xtermFitScript,
    filesScript: workbenchFilesScript,
    previewScript: workbenchPreviewScript,
    commandScript: workbenchCommandScript,
    localizationScript: harnessLocalizationScript
  };
};

const installWorkbenchPanel = async () => {
  if (!harnessUiReady()) return false;
  try {
    const assets = await loadWorkbenchPanelAssets();
    await mainWindow.webContents.insertCSS(assets.css, { cssOrigin: 'author' });
    await mainWindow.webContents.executeJavaScript(getWorkbenchPanelBootstrapScript(getWorkbenchState()), true);
    const localizationInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.localizationScript, true));
    const reviewInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.reviewScript, true));
    await mainWindow.webContents.executeJavaScript(assets.xtermScript, true);
    await mainWindow.webContents.executeJavaScript(assets.xtermFitScript, true);
    const terminalInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.terminalScript, true));
    const previewInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.previewScript, true));
    const filesInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.filesScript, true));
    const commandInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.commandScript, true));
    return localizationInstalled && reviewInstalled && terminalInstalled && previewInstalled && filesInstalled && commandInstalled;
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
    const globalName = {
      files: '__DSH_FILES__',
      preview: '__DSH_PREVIEW__',
      terminal: '__DSH_TERMINAL__',
      review: '__DSH_WORKBENCH__'
    }[focusTarget] || '__DSH_WORKBENCH__';
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

const setFilePanelOpen = async (open, { focus = false } = {}) => {
  const state = await workbenchStore.setFilePanelOpen(Boolean(open));
  installApplicationMenu();
  if (harnessUiReady()) {
    const applied = await applyWorkbenchPanelLayout({
      focus: focus && state.filePanelOpen,
      focusTarget: 'files'
    });
    if (!applied) await installWorkbenchPanel();
  }
  return state;
};

const setFilePanelWidth = async (width) => {
  const state = await workbenchStore.setFilePanelWidth(width);
  if (harnessUiReady()) await applyWorkbenchPanelLayout();
  return state;
};

const setPreviewPanelOpen = async (open, { focus = false, stopOnClose = true } = {}) => {
  const nextOpen = Boolean(open);
  if (!nextOpen && stopOnClose) await previewManager?.stop();
  const state = await workbenchStore.setPreviewPanelOpen(nextOpen);
  installApplicationMenu();
  if (harnessUiReady()) {
    const applied = await applyWorkbenchPanelLayout({
      focus: focus && state.previewPanelOpen,
      focusTarget: 'preview'
    });
    if (!applied) await installWorkbenchPanel();
  }
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
    const active = ['starting', 'running', 'stopping'].includes(state.status);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('terminal:state', state);
    if (terminalWasActive && !active) terminalSettlePromise = recaptureUserChangeBaseline();
    terminalWasActive = active;
    installApplicationMenu();
  });
};

const bindPreviewManager = (manager) => {
  manager.on('state', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('preview:state', state);
    installApplicationMenu();
  });
};

const openWorkspacePreview = async (filePath) => {
  if (!previewManager || !harnessUiReady()) return { ok: false, message: '应用预览尚未就绪。' };
  try {
    const state = await previewManager.openFile(filePath);
    await setPreviewPanelOpen(true, { focus: true, stopOnClose: false });
    return { ok: true, state };
  } catch (error) {
    return { ok: false, message: error.message, state: previewManager.getState() };
  }
};

const connectLocalPreview = async (url) => {
  if (!previewManager || !harnessUiReady()) return { ok: false, message: '应用预览尚未就绪。' };
  try {
    const state = await previewManager.connect(url, { reservedOrigins: [harnessOrigin] });
    await setPreviewPanelOpen(true, { focus: true, stopOnClose: false });
    return { ok: state.status === 'ready', message: state.error || '', state };
  } catch (error) {
    return { ok: false, message: error.message, state: previewManager.getState() };
  }
};

const openPreviewExternally = async () => {
  const state = previewManager?.getState();
  if (!state?.url || !isSafePreviewNavigation(state.url, { reservedOrigins: [harnessOrigin] })) {
    return { ok: false, message: '当前没有可在浏览器中打开的本机预览。' };
  }
  await shell.openExternal(state.url);
  return { ok: true };
};

const startTerminalSession = async (size = {}) => {
  if (!terminalRunner || !harnessUiReady()) {
    return { ok: false, message: '交互式终端尚未就绪。', state: terminalRunner?.getState() };
  }
  if (terminalRunner.isActive()) {
    return { ok: false, message: '交互式终端已经在运行。', state: terminalRunner.getState() };
  }
  const workspace = getWorkspaceState();
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '启动交互式终端',
    message: '在当前工作区启动持久 PowerShell 会话？',
    detail: `工作区：${workspace.activePath}\n\n启动后，你在终端中的输入会直接执行，直到主动停止、切换工作区或退出应用。软件内保存的 DeepSeek API Key 不会传入终端；终端运行期间 Git 一键接受/拒绝会暂时禁用。`,
    buttons: ['启动终端', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (result.response !== 0) {
    return { ok: false, canceled: true, state: terminalRunner.getState() };
  }
  try {
    return { ok: true, state: terminalRunner.start(size) };
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
    if (terminalRunner?.isActive()) {
      throw new Error('交互式终端仍在运行。请先停止终端，让桌面重新保护用户修改后再接受或拒绝文件。');
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
    if (terminalRunner?.isActive()) {
      throw new Error('交互式终端仍在运行。请先停止终端，让桌面重新保护用户修改后再批量审查。');
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
    await previewManager?.stop();
    await terminalSettlePromise;
    const workspace = await workspaceStore.activate(workspacePath);
    await workspaceFiles.activate(workspace.activePath);
    await previewManager.activate(workspace.activePath);
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
  const terminalState = terminalRunner?.getState() || { status: 'idle' };
  const terminalActive = ['starting', 'running', 'stopping'].includes(terminalState.status);
  const previewState = previewManager?.getState() || { status: 'idle', mode: 'none', port: null };
  const previewActive = ['starting', 'ready', 'offline'].includes(previewState.status);
  const previewStatus = {
    idle: '应用预览：当前未启动',
    starting: '应用预览：正在连接',
    ready: previewState.owned ? `应用预览：本机端口 ${previewState.port}` : '应用预览：本机服务已连接',
    offline: '应用预览：本机服务离线',
    failed: '应用预览：启动失败',
    stopped: '应用预览：已停止'
  }[previewState.status] || '应用预览：状态未知';
  const reviewIdle = !agentDiagnostics.canStop && agentDiagnostics.status !== 'waiting' && !terminalActive;
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
          label: '打开命令面板…',
          accelerator: 'CmdOrCtrl+Shift+P',
          enabled: harnessReady,
          click: () => { void mainWindow?.webContents.executeJavaScript('Boolean(window.__DSH_COMMAND_PALETTE__?.open?.())', true); }
        },
        { type: 'separator' },
        {
          label: '显示工作区文件',
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+Alt+E',
          checked: getWorkbenchState().filePanelOpen,
          enabled: harnessReady,
          click: (item) => { void setFilePanelOpen(item.checked, { focus: item.checked }); }
        },
        {
          label: '聚焦文件搜索',
          accelerator: 'CmdOrCtrl+Alt+F',
          enabled: harnessReady && getWorkbenchState().filePanelOpen,
          click: () => { void applyWorkbenchPanelLayout({ focus: true, focusTarget: 'files' }); }
        },
        {
          label: '重置文件面板宽度',
          enabled: harnessReady,
          click: () => { void setFilePanelWidth(260); }
        },
        { type: 'separator' },
        {
          label: '显示应用预览',
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+Alt+P',
          checked: getWorkbenchState().previewPanelOpen,
          enabled: harnessReady,
          click: (item) => { void setPreviewPanelOpen(item.checked, { focus: item.checked }); }
        },
        {
          label: '聚焦应用预览',
          accelerator: 'CmdOrCtrl+Alt+L',
          enabled: harnessReady && getWorkbenchState().previewPanelOpen,
          click: () => { void applyWorkbenchPanelLayout({ focus: true, focusTarget: 'preview' }); }
        },
        { label: previewStatus, enabled: false },
        {
          label: '在默认浏览器中打开预览',
          enabled: harnessReady && previewState.status === 'ready',
          click: () => { void openPreviewExternally(); }
        },
        {
          label: '停止应用预览',
          enabled: harnessReady && previewActive,
          click: () => { void previewManager.stop(); }
        },
        { type: 'separator' },
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
          label: terminalActive ? '停止交互式终端' : '终端：当前未启动',
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
    : normalizeWorkbenchState({ filePanelOpen: false, reviewPanelOpen: false, terminalPanelOpen: false })
));
ipcMain.handle('workbench:set-file-panel-open', async (event, open) => {
  if (!harnessIpcAllowed(event) || typeof open !== 'boolean') return getWorkbenchState();
  return setFilePanelOpen(open);
});
ipcMain.handle('workbench:set-file-panel-width', async (event, width) => {
  if (!harnessIpcAllowed(event) || !Number.isFinite(width)) return getWorkbenchState();
  return setFilePanelWidth(width);
});
ipcMain.handle('workbench:set-review-panel-open', async (event, open) => {
  if (!harnessIpcAllowed(event) || typeof open !== 'boolean') return getWorkbenchState();
  return setReviewPanelOpen(open);
});
ipcMain.handle('workbench:set-review-panel-width', async (event, width) => {
  if (!harnessIpcAllowed(event) || !Number.isFinite(width)) return getWorkbenchState();
  return setReviewPanelWidth(width);
});
ipcMain.handle('workbench:set-preview-panel-open', async (event, open) => {
  if (!harnessIpcAllowed(event) || typeof open !== 'boolean') return getWorkbenchState();
  return setPreviewPanelOpen(open);
});
ipcMain.handle('workbench:set-terminal-panel-open', async (event, open) => {
  if (!harnessIpcAllowed(event) || typeof open !== 'boolean') return getWorkbenchState();
  return setTerminalPanelOpen(open);
});
ipcMain.handle('workbench:set-terminal-panel-height', async (event, height) => {
  if (!harnessIpcAllowed(event) || !Number.isFinite(height)) return getWorkbenchState();
  return setTerminalPanelHeight(height);
});
const runWorkspaceFilesRequest = async (event, operation) => {
  if (!harnessIpcAllowed(event) || !workspaceFiles) {
    return { available: false, reason: 'untrusted-or-unavailable', message: '文件面板请求来源未通过安全校验。' };
  }
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceFilesError) {
      return { available: false, reason: error.code, message: error.message };
    }
    return { available: false, reason: 'unavailable', message: '文件状态已变化，请刷新后重试。' };
  }
};
ipcMain.handle('files:list', (event, directoryPath) => (
  runWorkspaceFilesRequest(event, () => workspaceFiles.listDirectory(directoryPath))
));
ipcMain.handle('files:read', (event, filePath) => (
  runWorkspaceFilesRequest(event, () => workspaceFiles.readFile(filePath))
));
ipcMain.handle('files:preview', (event, filePath) => (
  runWorkspaceFilesRequest(event, () => workspaceFiles.readPreviewFile(filePath))
));
ipcMain.handle('files:search', (event, query) => (
  runWorkspaceFilesRequest(event, () => workspaceFiles.search(query))
));
ipcMain.handle('preview:get-state', (event) => (
  harnessIpcAllowed(event) && previewManager
    ? previewManager.getState()
    : { status: 'unavailable', mode: 'none', url: '', owned: false }
));
ipcMain.handle('preview:open-file', (event, filePath) => (
  harnessIpcAllowed(event)
    ? openWorkspacePreview(filePath)
    : { ok: false, message: '应用预览请求来源未通过安全校验。' }
));
ipcMain.handle('preview:connect', (event, url) => (
  harnessIpcAllowed(event)
    ? connectLocalPreview(url)
    : { ok: false, message: '应用预览请求来源未通过安全校验。' }
));
ipcMain.handle('preview:stop', async (event) => {
  if (!harnessIpcAllowed(event) || !previewManager) return { status: 'unavailable' };
  return previewManager.stop();
});
ipcMain.handle('preview:open-external', (event) => (
  harnessIpcAllowed(event)
    ? openPreviewExternally()
    : { ok: false, message: '应用预览请求来源未通过安全校验。' }
));
ipcMain.handle('terminal:get-state', (event) => (
  harnessIpcAllowed(event) && terminalRunner
    ? terminalRunner.getSnapshot()
    : { state: { status: 'unavailable', cwd: '', runId: 0, mode: 'pty' }, output: '' }
));
ipcMain.handle('terminal:start', (event, size) => (
  harnessIpcAllowed(event)
    ? startTerminalSession(size)
    : { ok: false, message: '终端启动请求来源未通过安全校验。' }
));
ipcMain.on('terminal:write', (event, data) => {
  if (!harnessIpcAllowed(event) || !terminalRunner) return;
  try { terminalRunner.write(data); } catch { /* Drop invalid or oversized PTY input. */ }
});
ipcMain.on('terminal:resize', (event, size) => {
  if (!harnessIpcAllowed(event) || !terminalRunner || !size) return;
  terminalRunner.resize(size.cols, size.rows);
});
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
  mainWindow.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return;
    if (details.url.startsWith('blob:')) return;
    const currentPreviewUrl = previewManager?.getState()?.url || '';
    const currentPreviewOrigin = currentPreviewUrl ? new URL(currentPreviewUrl).origin : '';
    if (!isSafePreviewNavigation(details.url, {
      reservedOrigins: [harnessOrigin],
      allowedOrigins: [currentPreviewOrigin].filter(Boolean)
    })) details.preventDefault();
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
  workspaceFiles = new WorkspaceFiles();
  await workspaceFiles.activate(workspace.activePath);
  previewManager = new PreviewManager();
  await previewManager.activate(workspace.activePath);
  bindPreviewManager(previewManager);
  terminalRunner = new TerminalRunner({
    workspacePath: workspace.activePath,
    ...resolveTerminalRuntime({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged })
  });
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
  if (allowQuit || (!supervisor?.isActive() && !terminalRunner?.isActive() && !previewManager?.isActive())) return;
  event.preventDefault();
  const stops = [];
  if (terminalRunner?.isActive()) stops.push(terminalRunner.stop());
  if (previewManager?.isActive()) stops.push(previewManager.stop());
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
