const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, safeStorage, screen, session, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { GitChangeReviewer } = require('./change-review.cjs');
const { isTrustedClipboardWrite } = require('./clipboard-policy.cjs');
const { GitCheckpointManager, isCheckpointId } = require('./checkpoint-manager.cjs');
const { getDeepSeekCredentialStatus } = require('./credential-status.cjs');
const { buildPermissionCenterDialog } = require('./permission-center.cjs');
const { ContextSourceCatalog } = require('./context-sources.cjs');
const {
  ControlledPluginInstaller,
  controlledCatalog,
  resolveControlledPnpmRuntime
} = require('./controlled-plugin-installer.cjs');
const { PluginHealthCatalog } = require('./plugin-health.cjs');
const { buildExtensionCenter, callHarnessRemote } = require('./extension-center.cjs');
const { inspectOfficeCenter, isOfficeSkillId } = require('./office-center.cjs');
const { ProfileBundleManager } = require('./profile-bundle-manager.cjs');
const {
  captureHarnessCheckpointLink,
  forkHarnessCheckpointSession
} = require('./harness-checkpoint-link.cjs');
const { HarnessSupervisor, isSafeHarnessUrl, probeHarness, resolveHarnessRuntimePaths } = require('./harness-supervisor.cjs');
const { captureFrameOwner, isFrameOwner, isTrustedMainFrameEvent } = require('./ipc-policy.cjs');
const {
  readHarnessSessionSelection,
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
const {
  ProxySettingsStore,
  buildHarnessProxyEnvironment,
  confirmProxySettingsChange,
  normalizeProxySettings,
  parseResolvedProxy,
  sessionProxyConfig
} = require('./network-proxy.cjs');
const { TerminalRunner, resolveTerminalRuntime } = require('./terminal-runner.cjs');
const {
  TasksSubagentsController,
  TasksSubagentsError,
  getHarnessSubagentSelectionScript,
  unavailableState: unavailableTasksSubagentsState
} = require('./tasks-subagents.cjs');
const {
  getWorkbenchPanelBootstrapScript,
  getWorkbenchPanelLayoutScript
} = require('./workbench-panel.cjs');
const { WorkbenchStore, normalizeWorkbenchState } = require('./workbench-store.cjs');
const { GitWorktreeManager, runGitCommand } = require('./worktree-manager.cjs');
const { WorkspaceFiles, WorkspaceFilesError } = require('./workspace-files.cjs');
const { WorkspaceStore } = require('./workspace-store.cjs');
const { SideChatController, SideChatError } = require('./side-chat.cjs');

app.commandLine.appendSwitch('lang', 'zh-CN');
app.setName('DSH Desktop');

let mainWindow;
let terminalWindow;
let contextSourcesWindow;
let pluginHealthWindow;
let officeCenterWindow;
let worktreesWindow;
let tasksSubagentsWindow;
let sideChatWindow;
let supervisor;
let workspaceStore;
let workbenchStore;
let proxyStore;
let changeReviewer;
let checkpointManager;
let terminalRunner;
let terminalOwner = null;
let previewManager;
let workspaceFiles;
let contextSourceCatalog;
let pluginHealthCatalog;
let profileBundleManager;
let controlledPluginInstaller;
let worktreeManager;
let tasksSubagentsController;
let sideChatController;
let pluginRecoveryOutcomes = Object.freeze([]);
let pluginTogglePromise = null;
let pluginInstallPromise = null;
let worktreeOperationPromise = null;
let tasksSubagentsOperationPromise = null;
let sideChatOperationPromise = null;
let sideChatSelectionTimer;
let sideChatPartitionSession;
let sideChatMainLayout;
let dataRoot;
let harnessOrigin = null;
let harnessProxyEnvironment = Object.freeze({});
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
let checkpointDiagnostics = Object.freeze({ available: false, reason: 'not-initialized', status: 'empty', last: null });
let checkpointCreatePromise = null;
let checkpointRestorePromise = null;
let checkpointForkPromise = null;
let desktopDiagnostics = Object.freeze({
  credential: Object.freeze({ status: 'missing', source: 'managed-file', reason: 'not-checked', message: '尚未检查软件模型配置。', policy: 'software-first', environmentIgnored: false }),
  sessions: Object.freeze({ available: true, count: 0, latestUpdatedAt: null, encodings: Object.freeze({ zstd: 0, jsonl: 0 }) })
});
let networkDiagnostics = Object.freeze({
  mode: 'direct',
  proxyUrl: '',
  effectiveProxy: '',
  status: 'direct',
  reason: 'not-checked',
  message: '当前为直连模式。'
});

const rootDir = path.resolve(__dirname, '..');
const statusPage = path.join(rootDir, 'harness-status.html');
const terminalPage = path.join(rootDir, 'terminal.html');
const contextSourcesPage = path.join(rootDir, 'context-sources.html');
const pluginHealthPage = path.join(rootDir, 'plugin-health.html');
const officeCenterPage = path.join(rootDir, 'office-center.html');
const worktreesPage = path.join(rootDir, 'worktrees.html');
const tasksSubagentsPage = path.join(rootDir, 'tasks-subagents.html');
const workbenchPanelCssPath = path.join(rootDir, 'assets', 'workbench-panel.css');
const workbenchPanelScriptPath = path.join(rootDir, 'assets', 'workbench-panel.js');
const workbenchFilesCssPath = path.join(rootDir, 'assets', 'workbench-files.css');
const workbenchFilesScriptPath = path.join(rootDir, 'assets', 'workbench-files.js');
const workbenchPreviewCssPath = path.join(rootDir, 'assets', 'workbench-preview.css');
const workbenchPreviewScriptPath = path.join(rootDir, 'assets', 'workbench-preview.js');
const workbenchCommandCssPath = path.join(rootDir, 'assets', 'workbench-command.css');
const workbenchCommandScriptPath = path.join(rootDir, 'assets', 'workbench-command.js');
const workbenchCheckpointCssPath = path.join(rootDir, 'assets', 'workbench-checkpoint.css');
const workbenchCheckpointScriptPath = path.join(rootDir, 'assets', 'workbench-checkpoint.js');
const workbenchNetworkCssPath = path.join(rootDir, 'assets', 'workbench-network.css');
const workbenchNetworkScriptPath = path.join(rootDir, 'assets', 'workbench-network.js');
const harnessLocalizationScriptPath = path.join(rootDir, 'assets', 'harness-localization.js');
let workbenchPanelCss = '';
let workbenchPanelScript = '';
let workbenchFilesCss = '';
let workbenchFilesScript = '';
let workbenchPreviewCss = '';
let workbenchPreviewScript = '';
let workbenchCommandCss = '';
let workbenchCommandScript = '';
let workbenchCheckpointCss = '';
let workbenchCheckpointScript = '';
let workbenchNetworkCss = '';
let workbenchNetworkScript = '';
let harnessLocalizationScript = '';
const desktopSmokeTarget = process.argv.find((argument) => argument.startsWith('--smoke-test-file='));
const harnessSmokeTarget = process.argv.find((argument) => argument.startsWith('--harness-smoke-file='));
const ipcSecuritySmokeTarget = process.argv.find((argument) => argument.startsWith('--ipc-security-smoke-file='));
const pdfSmokeTarget = process.argv.find((argument) => argument.startsWith('--pdf-smoke-file='));
const contextSourcesSmokeTarget = process.argv.find((argument) => argument.startsWith('--context-sources-smoke-file='));
const pluginHealthSmokeTarget = process.argv.find((argument) => argument.startsWith('--plugin-health-smoke-file='));
const officeCenterSmokeTarget = process.argv.find((argument) => argument.startsWith('--office-center-smoke-file='));
const worktreesSmokeTarget = process.argv.find((argument) => argument.startsWith('--worktrees-smoke-file='));
const tasksSubagentsSmokeTarget = process.argv.find((argument) => argument.startsWith('--tasks-subagents-smoke-file='));
const sideChatSmokeTarget = process.argv.find((argument) => argument.startsWith('--side-chat-smoke-file='));
const windowSizeSmokeTarget = process.argv.find((argument) => argument.startsWith('--smoke-window-size='));
const isolatedSmokeTarget = [
  desktopSmokeTarget,
  harnessSmokeTarget,
  ipcSecuritySmokeTarget,
  pdfSmokeTarget,
  contextSourcesSmokeTarget,
  pluginHealthSmokeTarget,
  officeCenterSmokeTarget,
  worktreesSmokeTarget,
  tasksSubagentsSmokeTarget,
  sideChatSmokeTarget
].find(Boolean);
if (isolatedSmokeTarget) {
  const outputPath = isolatedSmokeTarget.slice(isolatedSmokeTarget.indexOf('=') + 1);
  app.setPath('userData', `${path.resolve(outputPath)}.user-data`);
}

const parseWindowSize = (value) => {
  const match = /^(\d{3,4})x(\d{3,4})$/i.exec(value || '');
  if (!match) return null;
  const width = Math.min(3840, Math.max(820, Number(match[1])));
  const height = Math.min(2160, Math.max(600, Number(match[2])));
  return { width, height };
};

const initialWindowSize = parseWindowSize(windowSizeSmokeTarget?.slice('--smoke-window-size='.length));

const createSupervisor = (dataRoot = app.getPath('userData'), launchDir = path.join(dataRoot, 'launch-root')) => {
  const instance = new HarnessSupervisor({
    rootDir,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    homeDir: path.join(dataRoot, 'harness'),
    launchDir,
    logFile: path.join(dataRoot, 'logs', 'harness.log'),
    env: harnessProxyEnvironment
  });
  instance.on('state', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('harness:state', state);
  });
  return instance;
};

const currentUrlAllowed = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return localFileUrlMatches(value, statusPage);
    return Boolean(harnessOrigin && url.origin === harnessOrigin);
  } catch {
    return false;
  }
};

const sideChatUrlAllowed = (value) => {
  try {
    return Boolean(harnessOrigin && new URL(value).origin === harnessOrigin);
  } catch {
    return false;
  }
};

const configureHarnessSessionPermissions = (targetSession, getTrustedWebContents) => {
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    isTrustedClipboardWrite({
      webContents,
      mainWebContents: getTrustedWebContents?.(),
      permission,
      requestingUrl: details?.requestingUrl || requestingOrigin,
      harnessOrigin,
      isMainFrame: details?.isMainFrame
    })
  ));
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(isTrustedClipboardWrite({
      webContents,
      mainWebContents: getTrustedWebContents?.(),
      permission,
      requestingUrl: details?.requestingUrl,
      harnessOrigin,
      isMainFrame: details?.isMainFrame
    }));
  });
};

const localFileUrlMatches = (value, target) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.search || url.hash) return false;
    const candidate = decodeURIComponent(url.pathname).replace(/\\/g, '/').toLocaleLowerCase();
    const expected = `/${path.resolve(target).replace(/\\/g, '/').toLocaleLowerCase()}`;
    return candidate === expected;
  } catch {
    return false;
  }
};

const terminalUrlAllowed = (value) => localFileUrlMatches(value, terminalPage);
const contextSourcesUrlAllowed = (value) => localFileUrlMatches(value, contextSourcesPage);
const pluginHealthUrlAllowed = (value) => localFileUrlMatches(value, pluginHealthPage);
const officeCenterUrlAllowed = (value) => localFileUrlMatches(value, officeCenterPage);
const worktreesUrlAllowed = (value) => localFileUrlMatches(value, worktreesPage);
const tasksSubagentsUrlAllowed = (value) => localFileUrlMatches(value, tasksSubagentsPage);

const showStatusPage = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = mainWindow.webContents.getURL();
  if (!current.endsWith('/harness-status.html')) await mainWindow.loadFile(statusPage);
};

const startHarnessForWindow = async ({ restart = false } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: '窗口不可用。' };
  if (sideChatOperationPromise) await sideChatOperationPromise;
  closeSideChatWindow();
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

const publicCheckpointRecord = (record) => {
  if (!record) return null;
  const { commit, tree, indexTree, sessionId, sessionAtSeq, ...safe } = record;
  return {
    ...safe,
    conversationLinked: Boolean(sessionId),
    conversationForkAvailable: Boolean(sessionId && Number.isInteger(sessionAtSeq))
  };
};

const getCheckpointState = () => {
  const { last, restoredTo, safety, preview, ...state } = checkpointDiagnostics;
  if (preview) {
    const { targetCommit, currentIndexTree, ...safePreview } = preview;
    state.preview = { ...safePreview };
  }
  return {
    ...state,
    last: publicCheckpointRecord(last),
    ...(restoredTo ? { restoredTo: publicCheckpointRecord(restoredTo) } : {}),
    ...(safety ? { safety: publicCheckpointRecord(safety) } : {})
  };
};

const checkpointTimeLabel = (value) => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime())
    ? '--:--:--'
    : date.toLocaleTimeString('zh-CN', { hour12: false });
};

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

const getNetworkState = () => ({ ...networkDiagnostics });

const applySessionProxy = async (targetSession, settings) => {
  const normalized = normalizeProxySettings(settings);
  await targetSession.setProxy(sessionProxyConfig(normalized));
  await targetSession.forceReloadProxyConfig();
  if (normalized.mode === 'direct') return { settings: normalized, effectiveProxy: '' };
  if (normalized.mode === 'custom') return { settings: normalized, effectiveProxy: normalized.proxyUrl };
  const resolved = await targetSession.resolveProxy('https://api.deepseek.com');
  const effectiveProxy = parseResolvedProxy(resolved);
  await targetSession.setProxy(effectiveProxy
    ? sessionProxyConfig({ mode: 'custom', proxyUrl: effectiveProxy })
    : { mode: 'direct' });
  await targetSession.forceReloadProxyConfig();
  return { settings: normalized, effectiveProxy };
};

const setNetworkDiagnostics = ({ settings, effectiveProxy = '', status = 'ready', reason = 'configured', message = '' }) => {
  const direct = !effectiveProxy;
  networkDiagnostics = Object.freeze({
    mode: settings.mode,
    proxyUrl: settings.proxyUrl,
    effectiveProxy,
    status: status === 'ready' ? (direct ? 'direct' : 'proxied') : status,
    reason: direct && settings.mode === 'system' ? 'system-direct' : reason,
    message: message || (direct
      ? (settings.mode === 'system' ? 'Windows 系统代理当前解析为直连。' : '当前为直连模式。')
      : (settings.mode === 'system' ? '已使用 Windows 系统 HTTP(S) 代理。' : '已使用软件自定义 HTTP(S) 代理。'))
  });
  installApplicationMenu();
  return getNetworkState();
};

const applyProxySettings = async (settings, { persist = false } = {}) => {
  const previous = proxyStore?.getState() || normalizeProxySettings();
  let applied;
  try {
    applied = await applySessionProxy(session.defaultSession, settings);
    if (persist) await proxyStore.set(applied.settings);
  } catch (error) {
    if (persist) {
      try { await applySessionProxy(session.defaultSession, previous); } catch { /* Keep the error from the requested setting. */ }
    }
    throw error;
  }
  harnessProxyEnvironment = buildHarnessProxyEnvironment(applied.effectiveProxy);
  supervisor?.setEnvironment(harnessProxyEnvironment);
  return setNetworkDiagnostics({ settings: applied.settings, effectiveProxy: applied.effectiveProxy });
};

const initializeProxySettings = async () => {
  const settings = proxyStore.getState();
  try {
    return await applyProxySettings(settings);
  } catch (error) {
    await session.defaultSession.setProxy({ mode: 'direct' });
    harnessProxyEnvironment = Object.freeze({});
    return setNetworkDiagnostics({
      settings,
      status: 'error',
      reason: error.code || 'unavailable',
      message: error.message || '代理设置不可用，Harness 已保持直连。'
    });
  }
};

const networkModeLabel = () => {
  if (networkDiagnostics.status === 'error') return '网络：代理配置不可用';
  if (networkDiagnostics.mode === 'system') {
    return networkDiagnostics.effectiveProxy ? '网络：Windows 系统代理' : '网络：Windows 系统直连';
  }
  if (networkDiagnostics.mode === 'custom') return '网络：自定义代理';
  return '网络：直连';
};

const openNetworkSettings = async () => {
  if (!harnessUiReady()) return false;
  return Boolean(await mainWindow.webContents.executeJavaScript('Boolean(window.__DSH_NETWORK__?.open?.())', true));
};

const networkChangeBlocked = () => agentDiagnostics.canStop || agentDiagnostics.status === 'waiting';

const saveNetworkSettings = async (settings) => {
  if (networkChangeBlocked()) {
    return { ok: false, reason: 'agent-busy', message: '请先结束当前生成或待确认操作，再修改代理。', state: getNetworkState() };
  }
  try {
    const decision = await confirmProxySettingsChange({
      dialog,
      parentWindow: mainWindow,
      previous: proxyStore.getState(),
      proposed: settings
    });
    if (!decision.changed) {
      return { ok: true, restarting: false, unchanged: true, state: getNetworkState() };
    }
    if (!decision.confirmed) {
      return { ok: false, canceled: true, reason: 'canceled', message: '已取消，代理设置未修改。', state: getNetworkState() };
    }
    const state = await applyProxySettings(decision.settings, { persist: true });
    setTimeout(() => { void startHarnessForWindow({ restart: true }); }, 250).unref?.();
    return { ok: true, restarting: true, state };
  } catch (error) {
    return { ok: false, reason: error.code || 'save-failed', message: error.message || '代理设置保存失败。', state: getNetworkState() };
  }
};

const testNetworkSettings = async (settings) => {
  let testSession;
  const startedAt = Date.now();
  try {
    const normalized = normalizeProxySettings(settings);
    testSession = session.fromPartition('dsh-proxy-test', { cache: false });
    const applied = await applySessionProxy(testSession, normalized);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await testSession.fetch('https://api.deepseek.com', { method: 'HEAD', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    void response.body?.cancel?.();
    return {
      ok: true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      effectiveProxy: applied.effectiveProxy,
      message: `已连接 DeepSeek API（HTTP ${response.status}）。`
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.code || (error.name === 'AbortError' ? 'timeout' : 'connection-failed'),
      latencyMs: Date.now() - startedAt,
      message: error.name === 'AbortError' ? '连接测试超时，请检查代理地址和网络策略。' : (error.message || '无法连接 DeepSeek API。')
    };
  } finally {
    if (testSession) {
      try { await testSession.setProxy({ mode: 'direct' }); } catch { /* The in-memory test session is disposable. */ }
    }
  }
};

const loadWorkbenchPanelAssets = async () => {
  if (!workbenchPanelCss) workbenchPanelCss = await fsp.readFile(workbenchPanelCssPath, 'utf8');
  if (!workbenchPanelScript) workbenchPanelScript = await fsp.readFile(workbenchPanelScriptPath, 'utf8');
  if (!workbenchFilesCss) workbenchFilesCss = await fsp.readFile(workbenchFilesCssPath, 'utf8');
  if (!workbenchFilesScript) workbenchFilesScript = await fsp.readFile(workbenchFilesScriptPath, 'utf8');
  if (!workbenchPreviewCss) workbenchPreviewCss = await fsp.readFile(workbenchPreviewCssPath, 'utf8');
  if (!workbenchPreviewScript) workbenchPreviewScript = await fsp.readFile(workbenchPreviewScriptPath, 'utf8');
  if (!workbenchCommandCss) workbenchCommandCss = await fsp.readFile(workbenchCommandCssPath, 'utf8');
  if (!workbenchCommandScript) workbenchCommandScript = await fsp.readFile(workbenchCommandScriptPath, 'utf8');
  if (!workbenchCheckpointCss) workbenchCheckpointCss = await fsp.readFile(workbenchCheckpointCssPath, 'utf8');
  if (!workbenchCheckpointScript) workbenchCheckpointScript = await fsp.readFile(workbenchCheckpointScriptPath, 'utf8');
  if (!workbenchNetworkCss) workbenchNetworkCss = await fsp.readFile(workbenchNetworkCssPath, 'utf8');
  if (!workbenchNetworkScript) workbenchNetworkScript = await fsp.readFile(workbenchNetworkScriptPath, 'utf8');
  if (!harnessLocalizationScript) harnessLocalizationScript = await fsp.readFile(harnessLocalizationScriptPath, 'utf8');
  return {
    css: `${workbenchPanelCss}\n${workbenchFilesCss}\n${workbenchPreviewCss}\n${workbenchCommandCss}\n${workbenchCheckpointCss}\n${workbenchNetworkCss}`,
    reviewScript: workbenchPanelScript,
    filesScript: workbenchFilesScript,
    previewScript: workbenchPreviewScript,
    checkpointScript: workbenchCheckpointScript,
    networkScript: workbenchNetworkScript,
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
    const previewInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.previewScript, true));
    const filesInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.filesScript, true));
    const checkpointInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.checkpointScript, true));
    const networkInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.networkScript, true));
    const commandInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.commandScript, true));
    return localizationInstalled && reviewInstalled && previewInstalled && filesInstalled && checkpointInstalled && networkInstalled && commandInstalled;
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

const applyUiZoomFactor = (factor = getWorkbenchState().uiZoomFactor) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.setZoomFactor(factor);
  return true;
};

const setUiZoomFactor = async (factor) => {
  const state = await workbenchStore.setUiZoomFactor(factor);
  applyUiZoomFactor(state.uiZoomFactor);
  installApplicationMenu();
  return state;
};

const adjustUiZoomFactor = (delta) => setUiZoomFactor(getWorkbenchState().uiZoomFactor + delta);

const resetWorkbenchLayout = async () => {
  if (getWorkbenchState().previewPanelOpen) await previewManager?.stop();
  const state = await workbenchStore.resetLayout();
  applyUiZoomFactor(state.uiZoomFactor);
  installApplicationMenu();
  if (harnessUiReady()) {
    const applied = await applyWorkbenchPanelLayout();
    if (!applied) await installWorkbenchPanel();
  }
  return state;
};

const publishCheckpointState = (state) => {
  checkpointDiagnostics = Object.freeze({
    ...state,
    last: state?.last ? Object.freeze({ ...state.last }) : null
  });
  installApplicationMenu();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('checkpoints:state', getCheckpointState());
  return getCheckpointState();
};

const createCodeCheckpoint = async (source = 'manual') => {
  if (!checkpointManager) return getCheckpointState();
  if (checkpointRestorePromise || checkpointForkPromise) return getCheckpointState();
  if (checkpointCreatePromise) return checkpointCreatePromise;
  checkpointCreatePromise = (async () => {
    publishCheckpointState({ ...checkpointManager.getState(), status: 'creating' });
    let sessionLink = null;
    try {
      if (harnessUiReady()) {
        sessionLink = await captureHarnessCheckpointLink({
          origin: harnessOrigin,
          webContents: mainWindow.webContents,
          workspacePath: getWorkspaceState().activePath
        });
      }
    } catch {
      // Conversation linkage is fail-soft; it must never prevent the code checkpoint or prompt.
    }
    const pending = checkpointManager.create({ source, sessionLink });
    publishCheckpointState(checkpointManager.getState());
    return publishCheckpointState(await pending);
  })().finally(() => { checkpointCreatePromise = null; });
  return checkpointCreatePromise;
};

const checkpointMatchesCurrentSession = async () => {
  const last = checkpointManager?.last;
  if (!last?.sessionId || !harnessUiReady()) return Object.freeze({ matches: false, linked: Boolean(last?.sessionId) });
  try {
    const currentSessionId = await readHarnessSessionSelection(mainWindow.webContents);
    return Object.freeze({ matches: currentSessionId === last.sessionId, linked: true });
  } catch {
    return Object.freeze({ matches: false, linked: true });
  }
};

const performRestoreCheckpoint = async (checkpointId = '') => {
  if (checkpointForkPromise || checkpointDiagnostics.status === 'forking') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '会话分支正在建立',
      message: '请等待当前会话分支建立完成后再恢复代码。',
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  if (checkpointCreatePromise || checkpointManager?.pending || checkpointDiagnostics.status === 'creating') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '代码检查点正在建立',
      message: '请等待当前检查点建立完成后再恢复。',
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  const terminalActive = ['starting', 'running', 'stopping'].includes(terminalRunner?.getState()?.status);
  const agentBusy = agentDiagnostics.canStop
    || agentDiagnostics.status === 'running'
    || agentDiagnostics.status === 'waiting'
    || agentDiagnostics.pendingCount > 0;
  if (terminalActive || agentBusy) {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '暂时无法恢复',
      message: terminalActive ? '请先停止集成终端。' : '请先等待或停止当前 Agent 回合。',
      detail: '恢复会改写当前工作区文件和 Git 索引，只允许在工作区静止时执行。',
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  const selected = Boolean(checkpointId);
  const preview = selected
    ? await checkpointManager?.previewCheckpoint(checkpointId)
    : await checkpointManager?.previewRestore();
  if (!preview?.available) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '无法恢复检查点',
      message: preview?.reason === 'too-many-paths'
        ? '待恢复文件超过 500 个。'
        : `${selected ? '所选' : '最近'}检查点当前不可恢复。`,
      detail: '工作区必须是 Git 仓库根目录，且检查点对象和索引树必须仍然存在。',
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  if (preview.unchanged) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '无需恢复',
      message: `当前代码和 Git 索引已经与${selected ? '所选' : '最近'}检查点一致。`,
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: `恢复到${selected ? '所选' : '最近'}代码检查点`,
    message: `将恢复 ${preview.affectedCount} 个代码路径${preview.indexWillChange ? '并恢复 Git 索引' : ''}。`,
    detail: [
      `检查点时间：${checkpointTimeLabel(preview.targetCreatedAt)}`,
      `将送入 Windows 回收站的新文件：${preview.untrackedTrashCount} 个`,
      `保持不变的敏感路径：${preview.sensitiveExcludedCount} 个`,
      '',
      '恢复前会自动建立新的 safety checkpoint；分支和 HEAD 不会移动。'
    ].join('\n'),
    buttons: ['恢复', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (answer.response !== 0) return getCheckpointState();

  if (previewManager?.isActive()) await previewManager.stop();
  publishCheckpointState({ ...getCheckpointState(), status: 'restoring' });
  const restored = selected
    ? await checkpointManager.restoreCheckpoint({
      id: checkpointId,
      expectedCommit: preview.targetCommit,
      trashItem: (target) => shell.trashItem(target)
    })
    : await checkpointManager.restoreCheckpoint({
      expectedCommit: preview.targetCommit,
      trashItem: (target) => shell.trashItem(target)
    });
  const state = publishCheckpointState(restored);
  if (restored.restored) {
    await changeReviewer.activate(getWorkspaceState().activePath);
    await refreshChangeReviewDiagnostics();
    if (harnessUiReady()) {
      await mainWindow.webContents.executeJavaScript('void window.__DSH_FILES__?.refresh?.(); true', true);
    }
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '代码检查点已恢复',
      message: `已恢复 ${restored.preview.affectedCount} 个代码路径。`,
      detail: '恢复前状态已保存为 safety checkpoint；敏感路径、当前分支和 HEAD 保持不变。',
      buttons: ['确定'],
      defaultId: 0
    });
  } else {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '代码恢复未完成',
      message: restored.rolledBack ? '恢复失败，软件已自动回到恢复前状态。' : '恢复和自动回滚均未完整完成。',
      detail: restored.rolledBack
        ? '请检查 Git 状态后重试。safety checkpoint 已保留。'
        : '请停止继续修改并使用 Git 工具检查 refs/dsh/checkpoints/items 下的 safety checkpoint。',
      buttons: ['确定'],
      defaultId: 0
    });
  }
  return state;
};

const restoreCodeCheckpoint = (checkpointId = '') => {
  if (checkpointRestorePromise) return checkpointRestorePromise;
  checkpointRestorePromise = performRestoreCheckpoint(checkpointId)
    .finally(() => { checkpointRestorePromise = null; });
  return checkpointRestorePromise;
};

const restoreLatestCheckpoint = () => restoreCodeCheckpoint();

const performForkCheckpointSession = async (checkpointId) => {
  if (checkpointCreatePromise || checkpointManager?.pending || checkpointDiagnostics.status === 'creating') {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '代码检查点正在建立',
      message: '请等待当前检查点建立完成后再创建会话分支。',
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  const terminalActive = ['starting', 'running', 'stopping'].includes(terminalRunner?.getState()?.status);
  const agentBusy = agentDiagnostics.canStop
    || agentDiagnostics.status === 'running'
    || agentDiagnostics.status === 'waiting'
    || agentDiagnostics.pendingCount > 0;
  if (terminalActive || agentBusy || checkpointRestorePromise) {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '暂时无法建立会话分支',
      message: terminalActive ? '请先停止集成终端。' : '请先等待或停止当前 Agent 回合。',
      detail: '会话分支只允许在工作区静止、检查点未恢复时执行。',
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  const anchor = await checkpointManager?.resolveConversationAnchor(checkpointId);
  if (!anchor) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '此检查点不能建立会话分支',
      message: '所选检查点没有关联到可分支的完整 Harness 回合。',
      detail: '旧版检查点和会话尚未完成首个回合时建立的检查点仍可只恢复代码。',
      buttons: ['确定'],
      defaultId: 0
    });
    return getCheckpointState();
  }
  const answer = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '从检查点回合建立会话分支',
    message: '将创建一个新的 Harness 会话分支，并保留原会话。',
    detail: [
      `检查点时间：${checkpointTimeLabel(anchor.createdAt)}`,
      '新会话包含关联回合及此前对话，建立后会自动切换过去。',
      '',
      '当前代码、Git 索引和原会话不会改变；如需恢复代码，请使用“只恢复代码”。'
    ].join('\n'),
    buttons: ['建立会话分支', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (answer.response !== 0) return getCheckpointState();

  publishCheckpointState({ ...checkpointManager.getState(), status: 'forking' });
  let forked = null;
  try {
    forked = await forkHarnessCheckpointSession({
      origin: harnessOrigin,
      workspacePath: getWorkspaceState().activePath,
      sessionId: anchor.sessionId,
      atSeq: anchor.atSeq
    });
    const selection = await selectHarnessSession(mainWindow.webContents, forked.sessionId);
    workspaceSyncDiagnostics = Object.freeze({
      ...workspaceSyncDiagnostics,
      status: 'synced',
      sessionId: forked.sessionId,
      sessionCreated: true,
      error: null
    });
    if (selection.changed) {
      await mainWindow.loadURL(harnessOrigin);
      await waitForHarnessSessionSelection(mainWindow.webContents, forked.sessionId);
    }
    const state = publishCheckpointState({ ...checkpointManager.getState(), forked: true });
    void refreshDesktopDiagnostics();
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '会话分支已建立',
      message: '已切换到新的 Harness 会话分支。',
      detail: '原会话、当前代码和 Git 索引均保持不变。',
      buttons: ['确定'],
      defaultId: 0
    });
    return state;
  } catch (error) {
    const state = publishCheckpointState({ ...checkpointManager.getState(), forked: false, forkReason: error?.code || 'fork-failed' });
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: '无法建立会话分支',
      message: 'Harness 没有完成所选检查点的会话分支。',
      detail: forked
        ? '新会话可能已经建立但未能自动切换，请在 Harness 会话列表中检查最近会话。'
        : '源会话、关联回合或工作区已变化；当前代码和 Git 索引未修改。',
      buttons: ['确定'],
      defaultId: 0
    });
    return state;
  }
};

const forkCheckpointSession = (checkpointId) => {
  if (checkpointForkPromise) return checkpointForkPromise;
  checkpointForkPromise = performForkCheckpointSession(checkpointId)
    .finally(() => { checkpointForkPromise = null; });
  return checkpointForkPromise;
};

const desktopIpcAllowed = (event) => isTrustedMainFrameEvent(event, mainWindow?.webContents, currentUrlAllowed);

const harnessIpcAllowed = (event) => desktopIpcAllowed(event) && harnessUiReady();
const terminalIpcAllowed = (event) => isTrustedMainFrameEvent(event, terminalWindow?.webContents, terminalUrlAllowed);
const terminalOwnedBy = (event) => terminalIpcAllowed(event) && isFrameOwner(event, terminalOwner);
const contextSourcesIpcAllowed = (event) => isTrustedMainFrameEvent(
  event,
  contextSourcesWindow?.webContents,
  contextSourcesUrlAllowed
);
const pluginHealthIpcAllowed = (event) => isTrustedMainFrameEvent(
  event,
  pluginHealthWindow?.webContents,
  pluginHealthUrlAllowed
);
const officeCenterIpcAllowed = (event) => isTrustedMainFrameEvent(
  event,
  officeCenterWindow?.webContents,
  officeCenterUrlAllowed
);
const worktreesIpcAllowed = (event) => isTrustedMainFrameEvent(
  event,
  worktreesWindow?.webContents,
  worktreesUrlAllowed
);
const tasksSubagentsIpcAllowed = (event) => isTrustedMainFrameEvent(
  event,
  tasksSubagentsWindow?.webContents,
  tasksSubagentsUrlAllowed
);

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
    if (terminalWindow && !terminalWindow.isDestroyed()) terminalWindow.webContents.send('terminal:output', event);
  });
  runner.on('state', (state) => {
    const active = ['starting', 'running', 'stopping'].includes(state.status);
    if (terminalWindow && !terminalWindow.isDestroyed()) terminalWindow.webContents.send('terminal:state', state);
    if (!active) terminalOwner = null;
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
  if (!terminalRunner) {
    return { ok: false, message: '交互式终端尚未就绪。', state: terminalRunner?.getState() };
  }
  if (terminalRunner.isActive()) {
    return { ok: false, message: '交互式终端已经在运行。', state: terminalRunner.getState() };
  }
  const workspace = getWorkspaceState();
  const options = {
    type: 'question',
    title: '启动交互式终端',
    message: '在当前工作区启动持久 PowerShell 会话？',
    detail: `工作区：${workspace.activePath}\n\n启动后，你在终端中的输入会直接执行，直到主动停止、切换工作区或退出应用。软件内保存的 DeepSeek API Key 不会传入终端；终端运行期间 Git 一键接受/拒绝会暂时禁用。`,
    buttons: ['启动终端', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
  const parent = terminalWindow && !terminalWindow.isDestroyed() ? terminalWindow : mainWindow;
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (result.response !== 0) {
    return { ok: false, canceled: true, state: terminalRunner.getState() };
  }
  try {
    return { ok: true, state: terminalRunner.start(size) };
  } catch (error) {
    return { ok: false, message: error.message, state: terminalRunner.getState() };
  }
};

const createTerminalWindow = async () => {
  const created = new BrowserWindow({
    width: 980,
    height: 620,
    minWidth: 720,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171716',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH 安全终端',
    webPreferences: {
      preload: path.join(__dirname, 'terminal-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  terminalWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!terminalUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.webContents.on('render-process-gone', () => {
    terminalOwner = null;
    if (terminalRunner?.isActive()) void terminalRunner.stop();
  });
  created.once('ready-to-show', () => {
    if (!ipcSecuritySmokeTarget) created.show();
  });
  created.on('closed', () => {
    if (terminalWindow === created) terminalWindow = undefined;
    terminalOwner = null;
    if (terminalRunner?.isActive()) void terminalRunner.stop();
    installApplicationMenu();
  });
  await created.loadFile(terminalPage);
  return created;
};

const openTerminalWindow = async () => {
  if (terminalWindow && !terminalWindow.isDestroyed()) {
    if (terminalWindow.isMinimized()) terminalWindow.restore();
    terminalWindow.show();
    terminalWindow.focus();
    return { ok: true, reused: true };
  }
  await createTerminalWindow();
  installApplicationMenu();
  return { ok: true, reused: false };
};

const getContextSourcesState = () => contextSourceCatalog?.scan({
  sessionActive: workspaceSyncDiagnostics.status === 'synced' && Boolean(workspaceSyncDiagnostics.sessionId)
}) || Promise.resolve({
  available: false,
  workspacePath: '',
  projectRoot: '',
  sources: [],
  layers: [],
  memory: { status: 'unavailable', title: '长期记忆', detail: '上下文来源尚未初始化。' }
});

const createContextSourcesWindow = async () => {
  const created = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 680,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171716',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH 上下文来源',
    webPreferences: {
      preload: path.join(__dirname, 'context-sources-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  contextSourcesWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!contextSourcesUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.once('ready-to-show', () => created.show());
  created.on('closed', () => {
    if (contextSourcesWindow === created) contextSourcesWindow = undefined;
  });
  await created.loadFile(contextSourcesPage);
  return created;
};

const openContextSourcesWindow = async () => {
  if (contextSourcesWindow && !contextSourcesWindow.isDestroyed()) {
    if (contextSourcesWindow.isMinimized()) contextSourcesWindow.restore();
    contextSourcesWindow.show();
    contextSourcesWindow.focus();
    return { ok: true, reused: true };
  }
  await createContextSourcesWindow();
  return { ok: true, reused: false };
};

const unavailablePluginHealth = (message = '扩展中心尚未初始化。') => ({
  available: false,
  profilesRoot: '本机 Harness 配置 / profiles',
  runtime: { status: 'unavailable', version: '', expected: 0, healthy: 0, missing: 0, misdirected: 0, issues: [] },
  profiles: [],
  extensionCenter: buildExtensionCenter({ inventoryError: message }),
  message
});

const readHarnessExtensionInventory = async () => {
  if (!harnessOrigin || !harnessUiReady()) return { inventoryError: 'Harness 尚未就绪，无法读取实时扩展清单。' };
  try {
    const inventory = await callHarnessRemote(harnessOrigin, 'pluginInventory', 'list', {}, { timeoutMs: 3000 });
    return { inventory };
  } catch (error) {
    return { inventoryError: `Harness 实时扩展清单不可用：${error?.message || String(error)}` };
  }
};

const getPluginHealthState = async () => {
  const state = pluginHealthCatalog ? await pluginHealthCatalog.scan() : unavailablePluginHealth();
  const live = await readHarnessExtensionInventory();
  const pnpm = controlledPluginInstaller?.getRuntimeStatus() || { status: 'unavailable', version: '', registry: 'registry.npmjs.org' };
  const catalog = await Promise.all(controlledCatalog().map(async (item) => ({
    ...item,
    targets: await Promise.all(item.profiles.map(async (profileName) => {
      const profile = state.profiles.find((candidate) => candidate.name === profileName);
      const dependency = profile?.dependencies.find((candidate) => candidate.name === item.name);
      const profileDir = profile?.id ? await pluginHealthCatalog.resolveProfilePath(profile.id) : null;
      const lifecycle = profileDir && controlledPluginInstaller
        ? await controlledPluginInstaller.inspectLifecycle({ profileDir, catalogId: item.id })
        : { status: 'blocked', canInstall: false, canUpgrade: false, canUninstall: false, canRollback: false };
      const lifecycleReady = pnpm.status === 'ready'
        && state.runtime.status === 'healthy'
        && profile?.status === 'healthy'
        && profile.workspaceReady
        && lifecycle.status === 'ready';
      return {
        profileId: profile?.id || '',
        profileName,
        available: Boolean(profile),
        installed: Boolean(dependency),
        installedVersion: dependency?.version || '',
        enabled: dependency?.enabled === true,
        lifecycleStatus: lifecycle.status,
        lifecycleReason: lifecycle.reason || '',
        canInstall: lifecycleReady && lifecycle.canInstall,
        canUpgrade: lifecycleReady && lifecycle.canUpgrade,
        canUninstall: lifecycleReady && lifecycle.canUninstall,
        canRollback: lifecycleReady && lifecycle.canRollback
      };
    }))
  })));
  return {
    ...state,
    extensionCenter: buildExtensionCenter({
      runtimeVersion: state.runtime?.version || '',
      runtimeCapabilities: state.runtime?.capabilities || {},
      profiles: state.profiles,
      ...live
    }),
    pnpm,
    catalog,
    recovery: pluginRecoveryOutcomes.map((item) => ({ ...item }))
  };
};

const createPluginHealthWindow = async () => {
  const created = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 700,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171716',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH 扩展中心',
    webPreferences: {
      preload: path.join(__dirname, 'plugin-health-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  pluginHealthWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!pluginHealthUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.once('ready-to-show', () => created.show());
  created.on('closed', () => {
    if (pluginHealthWindow === created) pluginHealthWindow = undefined;
  });
  await created.loadFile(pluginHealthPage);
  return created;
};

const openPluginHealthWindow = async () => {
  if (pluginHealthWindow && !pluginHealthWindow.isDestroyed()) {
    if (pluginHealthWindow.isMinimized()) pluginHealthWindow.restore();
    pluginHealthWindow.show();
    pluginHealthWindow.focus();
    return { ok: true, reused: true };
  }
  await createPluginHealthWindow();
  return { ok: true, reused: false };
};

const getOfficeCenterState = () => inspectOfficeCenter({
  rootDir,
  resourcesPath: process.resourcesPath,
  isPackaged: app.isPackaged,
  harnessReady: Boolean(officeCenterSmokeTarget) || harnessUiReady(),
  workspaceSynced: workspaceSyncDiagnostics.status === 'synced',
  workspaceName: workspaceStore?.getState()?.displayName || '当前工作区'
});

const createOfficeCenterWindow = async () => {
  const created = new BrowserWindow({
    width: 1030,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#151618',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH Office 交付中心',
    webPreferences: {
      preload: path.join(__dirname, 'office-center-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  officeCenterWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!officeCenterUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.once('ready-to-show', () => {
    if (!officeCenterSmokeTarget) created.show();
  });
  created.on('closed', () => {
    if (officeCenterWindow === created) officeCenterWindow = undefined;
  });
  await created.loadFile(officeCenterPage);
  return created;
};

const openOfficeCenterWindow = async () => {
  if (officeCenterWindow && !officeCenterWindow.isDestroyed()) {
    if (officeCenterWindow.isMinimized()) officeCenterWindow.restore();
    officeCenterWindow.show();
    officeCenterWindow.focus();
    return { ok: true, reused: true };
  }
  await createOfficeCenterWindow();
  return { ok: true, reused: false };
};

const createWorktreesWindow = async () => {
  const created = new BrowserWindow({
    width: 1040,
    height: 740,
    minWidth: 700,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171716',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH 隔离工作树',
    webPreferences: {
      preload: path.join(__dirname, 'worktrees-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  worktreesWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!worktreesUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.once('ready-to-show', () => created.show());
  created.on('closed', () => {
    if (worktreesWindow === created) worktreesWindow = undefined;
  });
  await created.loadFile(worktreesPage);
  return created;
};

const openWorktreesWindow = async () => {
  if (worktreesWindow && !worktreesWindow.isDestroyed()) {
    if (worktreesWindow.isMinimized()) worktreesWindow.restore();
    worktreesWindow.show();
    worktreesWindow.focus();
    return { ok: true, reused: true };
  }
  await createWorktreesWindow();
  return { ok: true, reused: false };
};

const getTasksSubagentsState = () => {
  const workspace = getWorkspaceState();
  return tasksSubagentsController?.scan({
    agentDiagnostics,
    workspacePath: workspace.activePath,
    workspaceName: workspace.displayName
  }) || Promise.resolve(unavailableTasksSubagentsState());
};

const publishTasksSubagentsState = async () => {
  const state = await getTasksSubagentsState();
  if (tasksSubagentsWindow && !tasksSubagentsWindow.isDestroyed()) {
    tasksSubagentsWindow.webContents.send('tasks-subagents:state', state);
  }
  return state;
};

const createTasksSubagentsWindow = async () => {
  const created = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171716',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH 任务与子代理',
    webPreferences: {
      preload: path.join(__dirname, 'tasks-subagents-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  tasksSubagentsWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!tasksSubagentsUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.once('ready-to-show', () => {
    if (!tasksSubagentsSmokeTarget) created.show();
  });
  created.on('closed', () => {
    if (tasksSubagentsWindow === created) tasksSubagentsWindow = undefined;
  });
  await created.loadFile(tasksSubagentsPage);
  return created;
};

const openTasksSubagentsWindow = async () => {
  if (tasksSubagentsWindow && !tasksSubagentsWindow.isDestroyed()) {
    if (tasksSubagentsWindow.isMinimized()) tasksSubagentsWindow.restore();
    tasksSubagentsWindow.show();
    tasksSubagentsWindow.focus();
    await publishTasksSubagentsState();
    return { ok: true, reused: true };
  }
  await createTasksSubagentsWindow();
  return { ok: true, reused: false };
};

const captureSideChatMainLayout = () => {
  if (!mainWindow || mainWindow.isDestroyed() || sideChatMainLayout) return;
  sideChatMainLayout = Object.freeze({
    bounds: mainWindow.getBounds(),
    maximized: mainWindow.isMaximized(),
    fullScreen: mainWindow.isFullScreen()
  });
};

const arrangeSideChatWindows = () => {
  if (!mainWindow || mainWindow.isDestroyed() || !sideChatWindow || sideChatWindow.isDestroyed()) return;
  captureSideChatMainLayout();
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const area = display.workArea;
  if (area.width < 1480) {
    sideChatWindow.center();
    return;
  }
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  const gap = 8;
  const mainWidth = Math.max(820, Math.floor((area.width - gap) * 0.55));
  const sideWidth = area.width - gap - mainWidth;
  if (sideWidth < 640) return;
  mainWindow.setBounds({ x: area.x, y: area.y, width: mainWidth, height: area.height });
  sideChatWindow.setBounds({ x: area.x + mainWidth + gap, y: area.y, width: sideWidth, height: area.height });
};

const restoreSideChatMainLayout = () => {
  const layout = sideChatMainLayout;
  sideChatMainLayout = undefined;
  if (!layout || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBounds(layout.bounds);
  if (layout.maximized) mainWindow.maximize();
  if (layout.fullScreen) mainWindow.setFullScreen(true);
};

const stopSideChatSelectionMonitor = () => {
  clearInterval(sideChatSelectionTimer);
  sideChatSelectionTimer = undefined;
};

const releaseSideChatPartition = () => {
  const isolated = sideChatPartitionSession;
  sideChatPartitionSession = undefined;
  if (isolated) void isolated.clearStorageData().catch(() => {});
};

const closeSideChatWindow = () => {
  stopSideChatSelectionMonitor();
  const current = sideChatWindow;
  sideChatWindow = undefined;
  if (current && !current.isDestroyed()) current.destroy();
  releaseSideChatPartition();
  restoreSideChatMainLayout();
};

const createSideChatHarnessWindow = async (context) => {
  if (!harnessOrigin || !sideChatUrlAllowed(harnessOrigin)) {
    throw new SideChatError('harness-unavailable', 'Harness 页面尚未就绪。');
  }
  const partitionOptions = Object.freeze({ partition: `dsh-side-chat-${randomBytes(12).toString('hex')}` });
  const partition = partitionOptions.partition;
  sideChatPartitionSession = session.fromPartition(partition);
  await applySessionProxy(sideChatPartitionSession, proxyStore?.getState() || { mode: 'direct' });

  const created = new BrowserWindow({
    width: 760,
    height: 800,
    minWidth: 640,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#171b24',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: context.sideTitle,
    webPreferences: {
      partition,
      preload: path.join(__dirname, 'side-chat-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: false,
      sandbox: true,
      spellcheck: true,
      webSecurity: true
    }
  });
  sideChatWindow = created;
  configureHarnessSessionPermissions(sideChatPartitionSession, () => (
    sideChatWindow && !sideChatWindow.isDestroyed() ? sideChatWindow.webContents : undefined
  ));
  sideChatPartitionSession.on('will-download', (event) => event.preventDefault());
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!sideChatUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-frame-navigate', (details) => {
    if (details.url.startsWith('blob:')) return;
    if (!sideChatUrlAllowed(details.url)) details.preventDefault();
  });
  created.webContents.on('will-redirect', (event, url) => {
    if (!sideChatUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    if (!created.isDestroyed()) created.setTitle(context.sideTitle);
  });
  created.on('closed', () => {
    if (sideChatWindow === created) sideChatWindow = undefined;
    stopSideChatSelectionMonitor();
    releaseSideChatPartition();
    restoreSideChatMainLayout();
    installApplicationMenu();
  });

  await created.loadURL(harnessOrigin);
  const selected = await selectHarnessSession(created.webContents, context.sideSessionId);
  if (selected.changed) {
    await created.loadURL(harnessOrigin);
    await waitForHarnessSessionSelection(created.webContents, context.sideSessionId);
  }
  const [mainSelection, sideSelection] = await Promise.all([
    readHarnessSessionSelection(mainWindow.webContents),
    readHarnessSessionSelection(created.webContents)
  ]);
  if (mainSelection !== context.sourceSessionId || sideSelection !== context.sideSessionId) {
    throw new SideChatError('selection-mismatch', '主会话或 Side Chat 的独立选择状态没有保持稳定。');
  }

  sideChatSelectionTimer = setInterval(() => {
    if (!sideChatWindow || sideChatWindow.isDestroyed()) return;
    void readHarnessSessionSelection(sideChatWindow.webContents).then(async (sessionId) => {
      if (sessionId === context.sideSessionId || !sideChatWindow || sideChatWindow.isDestroyed()) return;
      const restored = await selectHarnessSession(sideChatWindow.webContents, context.sideSessionId);
      if (restored.changed && sideChatWindow && !sideChatWindow.isDestroyed()) sideChatWindow.webContents.reload();
    }).catch(() => {});
  }, 1000);
  sideChatSelectionTimer.unref?.();
  arrangeSideChatWindows();
  if (!sideChatSmokeTarget) {
    created.show();
    created.focus();
  }
  installApplicationMenu();
  return created;
};

const openSideChatWindow = () => {
  if (sideChatWindow && !sideChatWindow.isDestroyed()) {
    if (sideChatWindow.isMinimized()) sideChatWindow.restore();
    sideChatWindow.show();
    sideChatWindow.focus();
    return Promise.resolve({ ok: true, reused: true });
  }
  if (sideChatOperationPromise) return sideChatOperationPromise;
  sideChatOperationPromise = Promise.resolve().then(async () => {
    if (!sideChatController || !mainWindow || mainWindow.isDestroyed() || !harnessUiReady()) {
      throw new SideChatError('harness-unavailable', 'Harness 页面尚未就绪。');
    }
    await refreshAgentDiagnostics({ rebuildMenu: false });
    const context = await sideChatController.create({
      mainWebContents: mainWindow.webContents,
      workspacePath: getWorkspaceState().activePath,
      agentState: agentDiagnostics
    });
    await createSideChatHarnessWindow(context);
    return { ok: true, reused: false, kind: context.kind, permission: context.permission };
  }).catch(async (error) => {
    closeSideChatWindow();
    if (!sideChatSmokeTarget) {
      const options = {
        type: 'warning',
        title: '无法打开 Side Chat',
        message: error instanceof SideChatError ? error.message : 'Side Chat 建立失败。',
        detail: error instanceof SideChatError ? '主会话和工作区没有被修改。' : (error?.message || String(error)),
        buttons: ['关闭'],
        defaultId: 0,
        cancelId: 0
      };
      if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
    }
    return { ok: false, reason: error?.code || 'failed', message: error?.message || 'Side Chat 建立失败。' };
  }).finally(() => {
    sideChatOperationPromise = null;
    installApplicationMenu();
  });
  return sideChatOperationPromise;
};

const taskActionFailure = async (error) => ({
  ok: false,
  message: error instanceof TasksSubagentsError ? error.message : 'Harness 任务状态已变化，请刷新后重试。',
  state: await getTasksSubagentsState()
});

const runTasksSubagentsOperation = (operation) => {
  if (tasksSubagentsOperationPromise) return Promise.resolve({ ok: false, message: '另一个任务面板操作仍在处理中。' });
  tasksSubagentsOperationPromise = Promise.resolve()
    .then(operation)
    .catch(taskActionFailure)
    .finally(() => { tasksSubagentsOperationPromise = null; });
  return tasksSubagentsOperationPromise;
};

const performOpenSubagent = async (id) => {
  if (!tasksSubagentsController || !mainWindow || mainWindow.isDestroyed() || !harnessUiReady()) {
    throw new TasksSubagentsError('harness-unavailable', 'Harness 页面尚未就绪。');
  }
  const address = await tasksSubagentsController.address(id);
  await mainWindow.webContents.executeJavaScript(getHarnessSubagentSelectionScript(address), true);
  const loaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TasksSubagentsError('reload-timeout', 'Harness 子代理记录打开超时。')), 10000);
    timer.unref?.();
    mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  mainWindow.webContents.reload();
  await loaded;
  await waitForHarnessSessionSelection(mainWindow.webContents, address.childSessionId);
  const restored = await mainWindow.webContents.executeJavaScript(`(() => {
    try { return JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}'); }
    catch { return {}; }
  })()`, true);
  if (restored?.subagentAddress?.parentSessionId !== address.parentSessionId
    || restored?.subagentAddress?.childSessionId !== address.childSessionId
    || restored?.subagentAddress?.mode !== address.mode) {
    throw new TasksSubagentsError('selection-mismatch', 'Harness 未确认子代理的直接父子地址。');
  }
  mainWindow.show();
  mainWindow.focus();
  const state = await publishTasksSubagentsState();
  return { ok: true, message: '已在 Harness 中打开子代理记录。', state };
};

const performPromptSubagent = async (id, text) => {
  if (!tasksSubagentsController || !harnessUiReady()) throw new TasksSubagentsError('harness-unavailable', 'Harness 页面尚未就绪。');
  const receipt = await tasksSubagentsController.prompt(id, text);
  const state = await publishTasksSubagentsState();
  return { ...receipt, state };
};

const performInterruptSubagent = async (id) => {
  if (!tasksSubagentsController || !harnessUiReady()) throw new TasksSubagentsError('harness-unavailable', 'Harness 页面尚未就绪。');
  const confirmation = await dialog.showMessageBox(tasksSubagentsWindow || mainWindow, {
    type: 'warning',
    title: '中断子代理当前轮次',
    message: '要向 Harness 发送中断请求吗？',
    detail: '该操作只请求停止当前轮次。Harness 返回“已受理”后，子代理仍可能短暂显示为运行中，队列里的补充消息也不会被删除。',
    buttons: ['取消', '发送中断请求'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) {
    return { ok: false, canceled: true, message: '已取消中断请求。', state: await getTasksSubagentsState() };
  }
  const receipt = await tasksSubagentsController.interrupt(id);
  const state = await publishTasksSubagentsState();
  return { ...receipt, state };
};

const pluginMutationBusy = () => (
  Boolean(terminalRunner?.isActive())
  || agentDiagnostics.canStop
  || agentDiagnostics.status === 'waiting'
  || ['creating', 'restoring', 'forking'].includes(checkpointDiagnostics.status)
);

const worktreeExternalBusy = () => (
  pluginMutationBusy()
  || Boolean(pluginTogglePromise || pluginInstallPromise)
);
const worktreeMutationBusy = () => worktreeExternalBusy() || Boolean(worktreeOperationPromise);

const performPluginToggle = async ({ profileId, packageName, enable }) => {
  if (!profileBundleManager || !pluginHealthCatalog) {
    return { ok: false, message: '扩展管理尚未初始化。', state: await getPluginHealthState() };
  }
  if (pluginMutationBusy()) {
    return { ok: false, message: '请先结束当前 Agent、待确认操作、终端或检查点任务。', state: await getPluginHealthState() };
  }
  const before = await getPluginHealthState();
  const profile = before.profiles.find((item) => item.id === profileId);
  const dependency = profile?.dependencies.find((item) => item.name === packageName);
  const lifecycleBlocked = before.catalog.some((item) => item.targets.some((target) => target.profileId === profileId && target.lifecycleStatus !== 'ready'));
  if (before.runtime.status !== 'healthy' || profile?.status !== 'healthy' || lifecycleBlocked || !dependency?.toggleable || dependency.enabled === enable) {
    return { ok: false, message: '扩展状态已变化或健康门禁未通过，请刷新后重试。', state: before };
  }
  const action = enable ? '启用' : '关闭';
  const confirmation = await dialog.showMessageBox(pluginHealthWindow || mainWindow, {
    type: 'warning',
    title: `${action} Profile 外部扩展`,
    message: `确认${action} ${packageName}？`,
    detail: enable
      ? `只会把已安装且声明 dsh.bundle 的扩展重新加入 ${profile.name} 的加载顺序，然后重启 Harness。不会运行 pnpm 或安装新包。`
      : `只会从 ${profile.name} 的加载顺序移除该扩展，然后重启 Harness。包和依赖仍保留在 Profile 中，可随时重新启用。`,
    buttons: ['取消', `${action}并重启 Harness`],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { ok: false, canceled: true, message: '已取消，Profile 未修改。', state: before };
  if (pluginMutationBusy()) {
    return { ok: false, message: '确认期间 Agent、终端或检查点状态已变化，Profile 未修改。', state: await getPluginHealthState() };
  }
  const confirmed = await getPluginHealthState();
  const confirmedProfile = confirmed.profiles.find((item) => item.id === profileId);
  const confirmedDependency = confirmedProfile?.dependencies.find((item) => item.name === packageName);
  const confirmedLifecycleBlocked = confirmed.catalog.some((item) => item.targets.some((target) => target.profileId === profileId && target.lifecycleStatus !== 'ready'));
  if (confirmed.runtime.status !== 'healthy' || confirmedProfile?.status !== 'healthy' || confirmedLifecycleBlocked || !confirmedDependency?.toggleable || confirmedDependency.enabled === enable) {
    return { ok: false, message: '确认期间扩展状态或健康结果已变化，Profile 未修改。', state: confirmed };
  }
  const profileDir = await pluginHealthCatalog.resolveProfilePath(profileId);
  if (!profileDir) return { ok: false, message: 'Profile 已变化，请刷新后重试。', state: confirmed };

  let transaction;
  let restartAttempted = false;
  try {
    transaction = await profileBundleManager.apply({ profileDir, packageName, enable });
    if (!transaction.changed) return { ok: true, unchanged: true, message: '扩展已经处于目标状态。', state: await getPluginHealthState() };
    if (pluginMutationBusy()) throw new Error('写入期间 Agent、终端或检查点状态发生变化。');
    restartAttempted = true;
    const restarted = await startHarnessForWindow({ restart: true });
    if (!restarted.ok) throw new Error(restarted.error || 'Harness 重启失败。');
    const verifiedState = await getPluginHealthState();
    const verifiedProfile = verifiedState.profiles.find((item) => item.id === profileId);
    const verifiedDependency = verifiedProfile?.dependencies.find((item) => item.name === packageName);
    if (verifiedState.runtime.status !== 'healthy' || verifiedProfile?.status !== 'healthy' || verifiedDependency?.enabled !== enable) {
      throw new Error('重启后的扩展健康状态与请求不一致。');
    }
    await profileBundleManager.commit(transaction.id);
    pluginRecoveryOutcomes = Object.freeze(pluginRecoveryOutcomes.filter((item) => item.profile !== profile.name));
    return { ok: true, message: `${packageName} 已${action}，Harness 已完成健康重启。`, state: verifiedState };
  } catch (error) {
    let rollbackOk = false;
    let restartOk = false;
    if (transaction?.changed) {
      try {
        await profileBundleManager.rollback(transaction.id);
        rollbackOk = true;
        restartOk = restartAttempted ? Boolean((await startHarnessForWindow({ restart: true })).ok) : true;
      } catch {
        // The verified manifest backup and pending journal remain available for startup recovery.
      }
    }
    const suffix = rollbackOk
      ? (!restartAttempted
          ? '已自动恢复变更前状态，运行中的 Harness 未加载此次变更。'
          : (restartOk ? '已自动恢复变更前状态并重新启动 Harness。' : 'Profile 已恢复，但 Harness 未能重新启动。'))
      : '未确认写入完成；下次启动会按事务日志尝试恢复。';
    return { ok: false, message: `${error.message || '扩展变更失败。'} ${suffix}`, state: await getPluginHealthState() };
  }
};

const performPluginInstall = async ({ profileId, catalogId, action = 'install' }) => {
  if (!controlledPluginInstaller || !pluginHealthCatalog) {
    return { ok: false, message: '受控插件生命周期尚未初始化。', state: await getPluginHealthState() };
  }
  const actions = Object.freeze({
    install: Object.freeze({ capability: 'canInstall', title: '安装已验证扩展', verb: '安装', method: 'install' }),
    upgrade: Object.freeze({ capability: 'canUpgrade', title: '升级已验证扩展', verb: '升级', method: 'upgrade' }),
    uninstall: Object.freeze({ capability: 'canUninstall', title: '卸载已验证扩展', verb: '卸载', method: 'uninstall' }),
    rollback: Object.freeze({ capability: 'canRollback', title: '回退到最近可用状态', verb: '回退', method: 'rollbackLastKnownGood' })
  });
  const selectedAction = actions[action];
  if (!selectedAction) return { ok: false, message: '插件生命周期操作不受支持。', state: await getPluginHealthState() };
  if (pluginMutationBusy()) {
    return { ok: false, message: '请先结束当前 Agent、待确认操作、终端或检查点任务。', state: await getPluginHealthState() };
  }
  const before = await getPluginHealthState();
  const catalogItem = before.catalog.find((item) => item.id === catalogId);
  const target = catalogItem?.targets.find((item) => item.profileId === profileId);
  if (!catalogItem || !target?.[selectedAction.capability]) {
    return { ok: false, message: '生命周期状态、Profile 或健康门禁已变化，请刷新后重试。', state: before };
  }
  const operationDetail = action === 'install'
    ? `将安装固定版本 ${catalogItem.version}。`
    : action === 'upgrade'
      ? `将从已审核版本 ${target.installedVersion} 升级到 ${catalogItem.version}。`
      : action === 'uninstall'
        ? `将移除已审核版本 ${target.installedVersion}；提交后仍可用“回退”恢复。`
        : '将恢复最近一次提交前的插件版本、启用状态和 Profile 清单；当前状态会成为新的可回退点。';
  const confirmation = await dialog.showMessageBox(pluginHealthWindow || mainWindow, {
    type: 'warning',
    title: selectedAction.title,
    message: `确认${selectedAction.verb} ${catalogItem.displayName}？`,
    detail: `固定包：${catalogItem.name}\nProfile：${target.profileName}\n${operationDetail}\n\n软件只会使用随附 pnpm ${before.pnpm.version}、已审核版本和完整性摘要，并强制忽略安装脚本。事务会先持久记录；软件 Key 不会进入子进程。完成后将重启 Harness 并重新检查兼容状态。`,
    buttons: ['取消', `${selectedAction.verb}并重启 Harness`],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { ok: false, canceled: true, message: '已取消，Profile 未修改。', state: before };
  if (pluginMutationBusy()) {
    return { ok: false, message: '确认期间 Agent、终端或检查点状态已变化，Profile 未修改。', state: await getPluginHealthState() };
  }
  const confirmed = await getPluginHealthState();
  const confirmedItem = confirmed.catalog.find((item) => item.id === catalogId);
  const confirmedTarget = confirmedItem?.targets.find((item) => item.profileId === profileId);
  if (!confirmedItem || !confirmedTarget?.[selectedAction.capability]) {
    return { ok: false, message: '确认期间生命周期状态、Profile 或健康门禁已变化，Profile 未修改。', state: confirmed };
  }
  const profileDir = await pluginHealthCatalog.resolveProfilePath(profileId);
  if (!profileDir) return { ok: false, message: 'Profile 已变化，请刷新后重试。', state: confirmed };

  let transaction;
  let restartAttempted = false;
  try {
    transaction = await controlledPluginInstaller[selectedAction.method]({
      profileDir,
      catalogId,
      workspacePath: workspaceStore.getState().activePath,
      proxyEnvironment: harnessProxyEnvironment
    });
    if (pluginMutationBusy()) throw new Error('插件变更期间 Agent、终端或检查点状态发生变化。');
    restartAttempted = true;
    const restarted = await startHarnessForWindow({ restart: true });
    if (!restarted.ok) throw new Error(restarted.error || 'Harness 重启失败。');
    const verifiedState = await getPluginHealthState();
    const verifiedProfile = verifiedState.profiles.find((item) => item.id === profileId);
    const verifiedDependency = verifiedProfile?.dependencies.find((item) => item.name === transaction.plugin.name);
    const targetVerified = transaction.target.version === null
      ? !verifiedDependency
      : verifiedDependency?.version === transaction.target.version
        && verifiedDependency?.enabled === transaction.target.enabled
        && verifiedDependency?.compatibility?.status === 'verified';
    if (verifiedState.runtime.status !== 'healthy' || verifiedProfile?.status !== 'healthy' || !targetVerified) {
      throw new Error('重启后的插件版本、启用状态或兼容健康结果不一致。');
    }
    await controlledPluginInstaller.commit(transaction.id);
    return {
      ok: true,
      message: `${transaction.plugin.name} 已完成${selectedAction.verb}，Harness 已健康重启，并保留最近可用回退点。`,
      state: await getPluginHealthState()
    };
  } catch (error) {
    let rollbackOk = false;
    let restartOk = false;
    const unresolvedRollback = error?.code === 'install-rollback-failed';
    if (transaction?.changed) {
      try {
        await controlledPluginInstaller.rollback(transaction.id);
        rollbackOk = true;
        restartOk = restartAttempted ? Boolean((await startHarnessForWindow({ restart: true })).ok) : true;
      } catch {
        // The persistent journal remains for guarded startup recovery.
      }
    }
    const suffix = unresolvedRollback
      ? '未能确认 Profile 已恢复；本次运行已封锁该 Profile，请退出软件并检查 Profile 后再继续。'
      : transaction?.changed
      ? (rollbackOk
          ? (restartOk ? '已恢复变更前 Profile 并重新启动 Harness。' : 'Profile 已恢复，但 Harness 未能重新启动。')
          : '未能确认 Profile 已恢复；持久日志会在下次启动继续处理。')
      : '受控生命周期管理器未提交可见变更。';
    return { ok: false, message: `${error.message || '插件生命周期操作失败。'} ${suffix}`, state: await getPluginHealthState() };
  }
};

const unavailableWorktreeState = (message = 'Git 工作树管理尚未初始化。') => Object.freeze({
  available: false,
  reason: 'unavailable',
  status: 'unavailable',
  message,
  repository: Object.freeze({ root: '', commonDir: '', branch: '', head: '', headShort: '', detached: false }),
  limits: Object.freeze({ total: 32, managed: 12 }),
  counts: Object.freeze({ total: 0, managed: 0, dirty: 0, unavailable: 0 }),
  worktrees: Object.freeze([])
});

const getWorktreeState = () => worktreeManager
  ? worktreeManager.inspect(getWorkspaceState().activePath)
  : Promise.resolve(unavailableWorktreeState());

const performWorktreeCreate = async () => {
  if (!worktreeManager) return { ok: false, message: 'Git 工作树管理尚未初始化。', state: unavailableWorktreeState() };
  if (worktreeExternalBusy()) return { ok: false, message: '请先结束当前 Agent、插件、终端或检查点任务。', state: await getWorktreeState() };
  const workspacePath = getWorkspaceState().activePath;
  const before = await getWorktreeState();
  if (!before.available || before.status !== 'ready' || before.counts.managed >= before.limits.managed) {
    return { ok: false, message: before.message || '当前仓库不能创建更多隔离工作树。', state: before };
  }
  const confirmation = await dialog.showMessageBox(worktreesWindow || mainWindow, {
    type: 'info',
    title: '新建隔离工作树',
    message: '确认从当前提交创建新的隔离分支和目录？',
    detail: `基础分支：${before.repository.branch || 'detached HEAD'}\n基础提交：${before.repository.headShort}\n\n软件会生成固定的 dsh/worktree-* 分支，并把目录放在 DSH Desktop 的受控数据目录。当前工作区不会自动切换；软件 Key 不进入 Git 子进程。`,
    buttons: ['取消', '创建工作树'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { ok: false, canceled: true, message: '已取消，仓库未修改。', state: before };
  if (worktreeExternalBusy()) return { ok: false, message: '确认期间运行状态已变化，仓库未修改。', state: await getWorktreeState() };
  const confirmedWorkspacePath = getWorkspaceState().activePath;
  const confirmed = await getWorktreeState();
  if (!confirmed.available || confirmed.repository.root !== before.repository.root
    || confirmed.repository.head !== before.repository.head || confirmed.repository.branch !== before.repository.branch
    || confirmedWorkspacePath !== workspacePath) {
    return { ok: false, message: '确认期间当前仓库、分支或提交已变化，请刷新后重试。', state: confirmed };
  }
  try {
    const result = await worktreeManager.create({ workspacePath });
    return { ok: true, message: `${result.branch} 已创建；可在列表中切换进入。`, state: result.state };
  } catch (error) {
    return { ok: false, message: error?.message || '隔离工作树创建失败。', state: await getWorktreeState() };
  }
};

const performWorktreeActivate = async (id) => {
  if (!worktreeManager) return { ok: false, message: 'Git 工作树管理尚未初始化。', state: unavailableWorktreeState() };
  if (worktreeExternalBusy()) return { ok: false, message: '请先结束当前 Agent、插件、终端或检查点任务。', state: await getWorktreeState() };
  let resolved;
  try { resolved = await worktreeManager.resolve({ workspacePath: getWorkspaceState().activePath, id }); } catch (error) {
    return { ok: false, message: error?.message || '工作树已变化。', state: await getWorktreeState() };
  }
  const item = resolved.item;
  if (!item.canActivate) return { ok: false, message: '所选工作树当前不能切换。', state: await getWorktreeState() };
  const confirmation = await dialog.showMessageBox(worktreesWindow || mainWindow, {
    type: 'warning',
    title: '切换工作树',
    message: `确认切换到 ${item.branch || item.directoryName}？`,
    detail: `目录：${item.path}\n提交：${item.headShort}\n未提交修改：${item.status.changed}\n\n切换会停止当前预览并重启 Harness；当前工作树及其修改不会被删除。`,
    buttons: ['取消', '切换并重启 Harness'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { ok: false, canceled: true, message: '已取消，当前工作区未切换。', state: await getWorktreeState() };
  if (worktreeExternalBusy()) return { ok: false, message: '确认期间运行状态已变化，当前工作区未切换。', state: await getWorktreeState() };
  try {
    const confirmed = await worktreeManager.resolve({ workspacePath: getWorkspaceState().activePath, id });
    if (confirmed.item.path !== item.path || confirmed.item.head !== item.head || !confirmed.item.canActivate) {
      return { ok: false, message: '确认期间工作树状态已变化，请刷新后重试。', state: await getWorktreeState() };
    }
    const activated = await activateWorkspace(item.path);
    if (!activated.ok) return { ok: false, message: activated.error || 'Harness 未能切换到所选工作树。', state: await getWorktreeState() };
    return { ok: true, message: `已切换到 ${item.branch || item.directoryName}，Harness 已重新绑定。`, state: await getWorktreeState() };
  } catch (error) {
    return { ok: false, message: error?.message || '工作树切换失败。', state: await getWorktreeState() };
  }
};

const performWorktreeRemove = async (id) => {
  if (!worktreeManager) return { ok: false, message: 'Git 工作树管理尚未初始化。', state: unavailableWorktreeState() };
  if (worktreeExternalBusy()) return { ok: false, message: '请先结束当前 Agent、插件、终端或检查点任务。', state: await getWorktreeState() };
  let preview;
  try { preview = await worktreeManager.previewRemove({ workspacePath: getWorkspaceState().activePath, id }); } catch (error) {
    return { ok: false, message: error?.message || '工作树已变化。', state: await getWorktreeState() };
  }
  const recoveryDetail = preview.status.clean
    ? `工作树没有未提交修改；分支 ${preview.branch} 和提交 ${preview.headShort} 会保留。`
    : `检测到 ${preview.status.changed} 项未提交修改（暂存 ${preview.status.staged}、未暂存 ${preview.status.unstaged}、新文件 ${preview.status.untracked}）。软件会先建立私有恢复点；只有恢复点和最终状态复核都成功后才移除目录。`;
  const confirmation = await dialog.showMessageBox(worktreesWindow || mainWindow, {
    type: 'warning',
    title: '安全回收隔离工作树',
    message: `确认回收 ${preview.branch} 的工作树目录？`,
    detail: `目录：${preview.path}\n${recoveryDetail}\n\n分支不会删除，当前打开的工作树不能从这里回收。`,
    buttons: ['取消', '建立恢复并回收'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { ok: false, canceled: true, message: '已取消，工作树和分支均未修改。', state: await getWorktreeState() };
  if (worktreeExternalBusy()) return { ok: false, message: '确认期间运行状态已变化，工作树未回收。', state: await getWorktreeState() };
  try {
    const result = await worktreeManager.remove({
      workspacePath: getWorkspaceState().activePath,
      id,
      expectedFingerprint: preview.fingerprint
    });
    const recovery = result.checkpoint
      ? `私有恢复点 ${result.checkpoint.id} 已保留。`
      : `分支 ${result.branch} 与提交 ${result.head.slice(0, 10)} 已保留。`;
    return { ok: true, message: `工作树目录已安全回收；${recovery}`, state: result.state };
  } catch (error) {
    return { ok: false, message: error?.message || '安全回收失败；工作树保持原状态。', state: await getWorktreeState() };
  }
};

const queueWorktreeOperation = (operation) => {
  if (worktreeOperationPromise) return worktreeOperationPromise;
  worktreeOperationPromise = Promise.resolve().then(operation)
    .finally(() => { worktreeOperationPromise = null; });
  return worktreeOperationPromise;
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

const invokeWordDocxSkill = async () => {
  if (!harnessUiReady()) return false;
  const invoked = await mainWindow.webContents.executeJavaScript('Boolean(window.__DSH_COMMAND_PALETTE__?.invokeWord?.())', true).catch(() => false);
  if (invoked) return true;
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Word 文档能力',
    message: '在对话输入框中输入 /word-docx 后描述文档。',
    detail: '内置 Skill 可离线创建、检查和受控替换当前工作区内的可编辑 DOCX。输出默认不覆盖已有文件；覆盖时会保留同目录回退副本。',
    buttons: ['确定'],
    defaultId: 0
  });
  return false;
};

const invokeExcelXlsxSkill = async () => {
  if (!harnessUiReady()) return false;
  const invoked = await mainWindow.webContents.executeJavaScript('Boolean(window.__DSH_COMMAND_PALETTE__?.invokeExcel?.())', true).catch(() => false);
  if (invoked) return true;
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Excel 工作簿能力',
    message: '在对话输入框中输入 /excel-xlsx 后描述工作簿。',
    detail: '内置 Skill 可离线创建、导入、检查和受控修改当前工作区内的可编辑 XLSX，并提供勾稽与公式风险检查。输出默认不覆盖已有文件；覆盖时会保留同目录回退副本。',
    buttons: ['确定'],
    defaultId: 0
  });
  return false;
};

const invokePowerPointPptxSkill = async () => {
  if (!harnessUiReady()) return false;
  const invoked = await mainWindow.webContents.executeJavaScript('Boolean(window.__DSH_COMMAND_PALETTE__?.invokePowerPoint?.())', true).catch(() => false);
  if (invoked) return true;
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'PowerPoint 演示文稿能力',
    message: '在对话输入框中输入 /powerpoint-pptx 后描述演示文稿。',
    detail: '内置 Skill 可离线创建、检查和精确替换当前工作区内的可编辑 PPTX，支持文本、形状、表格、原生图表、PNG/JPEG、母版、版式与演讲者备注。输出默认不覆盖已有文件；覆盖时会保留同目录回退副本。',
    buttons: ['确定'],
    defaultId: 0
  });
  return false;
};

const invokeOfficeCenterSkill = async (id) => {
  if (!isOfficeSkillId(id)) return { ok: false, message: '交付类型不在固定清单中。' };
  if (!harnessUiReady() || workspaceSyncDiagnostics.status !== 'synced') {
    return { ok: false, message: '请等待 Harness 与当前工作区同步后再使用。' };
  }
  const invokers = {
    word: invokeWordDocxSkill,
    excel: invokeExcelXlsxSkill,
    powerpoint: invokePowerPointPptxSkill
  };
  if (officeCenterWindow && !officeCenterWindow.isDestroyed()) officeCenterWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  const invoked = await invokers[id]();
  return {
    ok: invoked,
    message: invoked ? '已写入固定 Skill 命令，请继续描述要生成或修改的文件。' : '未找到当前 Harness 输入框；请在对话中手动输入对应 Skill 命令。'
  };
};

const showPermissionCenter = async () => {
  await refreshAgentDiagnostics({ rebuildMenu: false });
  const model = buildPermissionCenterDialog({
    agent: agentDiagnostics,
    terminalActive: Boolean(terminalRunner?.isActive())
  });
  const result = await dialog.showMessageBox(mainWindow, model.options);
  const action = model.actions[result.response] || null;
  if (action) await runHarnessUiAction(action);
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
    if (sideChatOperationPromise) await sideChatOperationPromise;
    closeSideChatWindow();
    if (terminalRunner?.isActive()) await terminalRunner.stop();
    await previewManager?.stop();
    await terminalSettlePromise;
    const workspace = await workspaceStore.activate(workspacePath);
    if (contextSourcesWindow && !contextSourcesWindow.isDestroyed()) contextSourcesWindow.close();
    if (tasksSubagentsWindow && !tasksSubagentsWindow.isDestroyed()) tasksSubagentsWindow.close();
    if (officeCenterWindow && !officeCenterWindow.isDestroyed()) officeCenterWindow.close();
    contextSourceCatalog?.setWorkspace(workspace.activePath);
    await workspaceFiles.activate(workspace.activePath);
    await previewManager.activate(workspace.activePath);
    await changeReviewer.activate(workspace.activePath);
    checkpointDiagnostics = await checkpointManager.activate(workspace.activePath);
    changeReviewDiagnostics = emptyChangeReviewDiagnostics();
    terminalRunner?.setWorkspace(workspace.activePath);
    supervisor.setLaunchDir(workspace.activePath);
    installApplicationMenu();
    applyWindowTitle();
    const result = await startHarnessForWindow({ restart: true });
    if (worktreesWindow && !worktreesWindow.isDestroyed()) {
      worktreesWindow.webContents.send('worktrees:state', await getWorktreeState());
    }
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
  const checkpointIdle = reviewIdle && !['creating', 'restoring', 'forking'].includes(checkpointDiagnostics.status);
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
        {
          label: '管理隔离工作树…',
          accelerator: 'CmdOrCtrl+Shift+W',
          enabled: !workspace.isFallback,
          click: () => { void openWorktreesWindow(); }
        },
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
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
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
          label: '任务与子代理…',
          accelerator: 'CmdOrCtrl+Shift+A',
          enabled: harnessReady,
          click: () => { void openTasksSubagentsWindow(); }
        },
        {
          label: sideChatWindow && !sideChatWindow.isDestroyed() ? '聚焦 Side Chat' : '打开 Side Chat…',
          accelerator: 'CmdOrCtrl+Shift+S',
          enabled: harnessReady && (Boolean(sideChatWindow && !sideChatWindow.isDestroyed())
            || (agentDiagnostics.status === 'ready'
              && agentDiagnostics.pendingCount === 0
              && agentDiagnostics.queuedCount === 0)),
          click: () => { void openSideChatWindow(); }
        },
        { type: 'separator' },
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
          label: '权限中心…',
          click: () => { void showPermissionCenter(); }
        },
        {
          label: '上下文来源…',
          click: () => { void openContextSourcesWindow(); }
        },
        {
          label: '扩展中心…',
          click: () => { void openPluginHealthWindow(); }
        },
        {
          label: 'Office 交付中心…',
          click: () => { void openOfficeCenterWindow(); }
        },
        { label: 'Word / Excel / PowerPoint：可编辑文件统一入口', enabled: false },
        {
          label: '创建或修改 Word 文档…',
          enabled: harnessReady,
          click: () => { void invokeWordDocxSkill(); }
        },
        { label: 'Word 文档：内置 /word-docx · 工作区内离线生成', enabled: false },
        {
          label: '创建或修改 Excel 工作簿…',
          enabled: harnessReady,
          click: () => { void invokeExcelXlsxSkill(); }
        },
        { label: 'Excel 工作簿：内置 /excel-xlsx · 公式与勾稽检查', enabled: false },
        {
          label: '创建或修改 PowerPoint 演示文稿…',
          enabled: harnessReady,
          click: () => { void invokePowerPointPptxSkill(); }
        },
        { label: 'PowerPoint：内置 /powerpoint-pptx · 可编辑对象与严格检查', enabled: false },
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
        },
        { type: 'separator' },
        { label: networkModeLabel(), enabled: false },
        {
          label: '网络与代理设置…',
          accelerator: 'CmdOrCtrl+,',
          enabled: harnessReady,
          click: () => { void openNetworkSettings(); }
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
        {
          label: '立即创建代码检查点',
          accelerator: 'CmdOrCtrl+Alt+B',
          enabled: checkpointDiagnostics.available && checkpointIdle,
          click: () => { void createCodeCheckpoint('manual'); }
        },
        {
          label: '浏览代码检查点…',
          accelerator: 'CmdOrCtrl+Alt+H',
          enabled: checkpointDiagnostics.available && Boolean(checkpointDiagnostics.last) && checkpointIdle && harnessReady,
          click: () => { void mainWindow?.webContents.executeJavaScript('Boolean(window.__DSH_CHECKPOINTS__?.openHistory?.())', true); }
        },
        {
          label: '恢复到最近代码检查点…',
          accelerator: 'CmdOrCtrl+Alt+R',
          enabled: checkpointDiagnostics.available && Boolean(checkpointDiagnostics.last) && checkpointIdle,
          click: () => { void restoreLatestCheckpoint(); }
        },
        {
          label: ['creating', 'restoring', 'forking'].includes(checkpointDiagnostics.status)
            ? `检查点：正在${checkpointDiagnostics.status === 'creating' ? '建立' : (checkpointDiagnostics.status === 'restoring' ? '恢复' : '建立会话分支')}…`
            : (checkpointDiagnostics.last ? `检查点：${checkpointTimeLabel(checkpointDiagnostics.last.createdAt)}` : '检查点：尚未建立'),
          enabled: false
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
          label: '打开安全终端窗口',
          accelerator: 'CmdOrCtrl+Alt+T',
          enabled: Boolean(mainWindow),
          click: () => { void openTerminalWindow(); }
        },
        {
          label: '聚焦安全终端窗口',
          accelerator: 'CmdOrCtrl+Alt+K',
          enabled: Boolean(mainWindow),
          click: () => { void openTerminalWindow(); }
        },
        {
          label: terminalActive ? '停止交互式终端' : '终端：当前未启动',
          enabled: terminalActive,
          click: () => { void terminalRunner.stop(); }
        },
        {
          label: '终端与 Harness 页面已隔离',
          enabled: false
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
        {
          label: '界面放大',
          accelerator: 'CmdOrCtrl+=',
          enabled: Boolean(mainWindow) && getWorkbenchState().uiZoomFactor < 1.4,
          click: () => { void adjustUiZoomFactor(0.1); }
        },
        {
          label: '界面缩小',
          accelerator: 'CmdOrCtrl+-',
          enabled: Boolean(mainWindow) && getWorkbenchState().uiZoomFactor > 0.8,
          click: () => { void adjustUiZoomFactor(-0.1); }
        },
        {
          label: '界面大小重置',
          accelerator: 'CmdOrCtrl+0',
          enabled: Boolean(mainWindow),
          click: () => { void setUiZoomFactor(1); }
        },
        { label: `界面大小：${Math.round(getWorkbenchState().uiZoomFactor * 100)}%`, enabled: false },
        {
          label: '重置整个工作台布局',
          accelerator: 'CmdOrCtrl+Alt+0',
          enabled: Boolean(mainWindow),
          click: () => { void resetWorkbenchLayout(); }
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

ipcMain.handle('app:get-info', (event) => (
  desktopIpcAllowed(event)
    ? { name: app.getName(), version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }
    : { name: '', version: '', platform: '', packaged: app.isPackaged }
));
ipcMain.handle('network:get-state', (event) => (
  desktopIpcAllowed(event)
    ? getNetworkState()
    : { mode: 'direct', proxyUrl: '', effectiveProxy: '', status: 'unavailable', reason: 'untrusted', message: '代理状态请求来源未通过安全校验。' }
));
ipcMain.handle('network:test', (event, settings) => (
  harnessIpcAllowed(event)
    ? testNetworkSettings(settings)
    : { ok: false, reason: 'untrusted', message: '代理测试请求来源未通过安全校验。' }
));
ipcMain.handle('network:save', (event, settings) => (
  harnessIpcAllowed(event)
    ? saveNetworkSettings(settings)
    : { ok: false, reason: 'untrusted', message: '代理设置请求来源未通过安全校验。' }
));
ipcMain.handle('workspace:get-state', (event) => (
  desktopIpcAllowed(event) ? getWorkspaceState() : { activePath: '', recentPaths: [], isFallback: true }
));
ipcMain.handle('workspace:choose', (event) => (
  desktopIpcAllowed(event) ? chooseWorkspace() : { ok: false, canceled: true, workspace: { activePath: '', recentPaths: [] } }
));
ipcMain.handle('diagnostics:get-state', (event) => (
  desktopIpcAllowed(event) ? getDiagnosticsState() : { status: 'unavailable', reason: 'untrusted' }
));
ipcMain.handle('diagnostics:refresh', (event) => (
  desktopIpcAllowed(event) ? refreshDesktopDiagnostics() : { status: 'unavailable', reason: 'untrusted' }
));
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
ipcMain.handle('workbench:set-ui-zoom-factor', async (event, factor) => {
  if (!desktopIpcAllowed(event) || !Number.isFinite(factor)) return getWorkbenchState();
  return setUiZoomFactor(factor);
});
ipcMain.handle('workbench:reset-layout', async (event) => {
  if (!desktopIpcAllowed(event)) return getWorkbenchState();
  return resetWorkbenchLayout();
});
ipcMain.handle('checkpoints:get-state', (event) => (
  desktopIpcAllowed(event) ? getCheckpointState() : { available: false, reason: 'untrusted', status: 'empty', last: null }
));
ipcMain.handle('checkpoints:create-manual', async (event) => {
  if (!harnessIpcAllowed(event)) return { available: false, reason: 'untrusted', status: 'empty', last: null };
  return createCodeCheckpoint('manual');
});
ipcMain.handle('checkpoints:create-automatic', async (event) => {
  if (!harnessIpcAllowed(event)) return { available: false, reason: 'untrusted', status: 'empty', last: null };
  return createCodeCheckpoint('automatic');
});
ipcMain.handle('checkpoints:matches-current-session', async (event) => {
  if (!harnessIpcAllowed(event)) return { matches: false, linked: false };
  return checkpointMatchesCurrentSession();
});
ipcMain.handle('checkpoints:list-history', async (event) => {
  if (!harnessIpcAllowed(event) || checkpointRestorePromise || checkpointForkPromise) {
    return { available: false, reason: 'untrusted-or-busy', items: [] };
  }
  return checkpointManager.listHistory();
});
ipcMain.handle('checkpoints:restore', async (event, id) => {
  if (!harnessIpcAllowed(event) || !isCheckpointId(id)) {
    return { available: false, reason: 'untrusted', status: 'empty', last: null };
  }
  return restoreCodeCheckpoint(id);
});
ipcMain.handle('checkpoints:fork-session', async (event, id) => {
  if (!harnessIpcAllowed(event) || !isCheckpointId(id)) {
    return { available: false, reason: 'untrusted', status: 'empty', last: null };
  }
  return forkCheckpointSession(id);
});
ipcMain.handle('checkpoints:restore-latest', async (event) => {
  if (!harnessIpcAllowed(event)) return { available: false, reason: 'untrusted', status: 'empty', last: null };
  return restoreLatestCheckpoint();
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
ipcMain.handle('terminal:open-window', (event) => (
  harnessIpcAllowed(event)
    ? openTerminalWindow()
    : { ok: false, message: '终端窗口请求来源未通过安全校验。' }
));
ipcMain.handle('terminal:get-state', (event) => {
  if (!terminalIpcAllowed(event) || !terminalRunner) {
    return { state: { status: 'unavailable', cwd: '', runId: 0, mode: 'pty' }, output: '' };
  }
  if (terminalRunner.isActive()) terminalOwner = captureFrameOwner(event);
  return terminalRunner.getSnapshot();
});
ipcMain.handle('terminal:start', async (event, size) => {
  if (!terminalIpcAllowed(event)) return { ok: false, message: '终端启动请求来源未通过安全校验。' };
  const result = await startTerminalSession(size);
  if (result?.ok) terminalOwner = captureFrameOwner(event);
  return result;
});
ipcMain.on('terminal:write', (event, data) => {
  if (!terminalOwnedBy(event) || !terminalRunner) return;
  try { terminalRunner.write(data); } catch { /* Drop invalid or oversized PTY input. */ }
});
ipcMain.on('terminal:resize', (event, size) => {
  if (!terminalOwnedBy(event) || !terminalRunner || !size) return;
  terminalRunner.resize(size.cols, size.rows);
});
ipcMain.handle('terminal:stop', async (event) => {
  if (!terminalOwnedBy(event) || !terminalRunner) return { status: 'unavailable' };
  return terminalRunner.stop();
});
ipcMain.handle('context-sources:get-state', (event) => (
  contextSourcesIpcAllowed(event)
    ? getContextSourcesState()
    : { available: false, workspacePath: '', projectRoot: '', sources: [], layers: [], memory: { status: 'unavailable', title: '长期记忆', detail: '请求来源未通过安全校验。' } }
));
ipcMain.handle('context-sources:refresh', (event) => (
  contextSourcesIpcAllowed(event)
    ? getContextSourcesState()
    : { available: false, workspacePath: '', projectRoot: '', sources: [], layers: [], memory: { status: 'unavailable', title: '长期记忆', detail: '请求来源未通过安全校验。' } }
));
ipcMain.handle('context-sources:reveal', async (event, id) => {
  if (!contextSourcesIpcAllowed(event) || !contextSourceCatalog) {
    return { ok: false, message: '上下文来源请求未通过安全校验。' };
  }
  const target = await contextSourceCatalog.resolveSourcePath(id);
  if (!target) return { ok: false, message: '规则文件已变化，请刷新后重试。' };
  shell.showItemInFolder(target);
  return { ok: true };
});
ipcMain.handle('plugin-health:get-state', (event) => (
  pluginHealthIpcAllowed(event)
    ? getPluginHealthState()
    : unavailablePluginHealth('请求来源未通过安全校验。')
));
ipcMain.handle('plugin-health:refresh', (event) => (
  pluginHealthIpcAllowed(event)
    ? getPluginHealthState()
    : unavailablePluginHealth('请求来源未通过安全校验。')
));
ipcMain.handle('plugin-health:reveal', async (event, id) => {
  if (!pluginHealthIpcAllowed(event) || !pluginHealthCatalog) {
    return { ok: false, message: '扩展健康请求未通过安全校验。' };
  }
  const target = await pluginHealthCatalog.resolveProfilePath(id);
  if (!target) return { ok: false, message: 'Profile 已变化，请刷新后重试。' };
  shell.showItemInFolder(target);
  return { ok: true };
});
ipcMain.handle('plugin-health:toggle', (event, profileId, packageName, enable) => {
  if (!pluginHealthIpcAllowed(event)) {
    return { ok: false, message: '扩展变更请求未通过安全校验。' };
  }
  if (typeof profileId !== 'string' || typeof packageName !== 'string' || typeof enable !== 'boolean') {
    return { ok: false, message: '扩展变更参数无效。' };
  }
  if (pluginTogglePromise || pluginInstallPromise) return { ok: false, message: '另一个扩展变更仍在处理中。' };
  pluginTogglePromise = performPluginToggle({ profileId, packageName, enable })
    .finally(() => { pluginTogglePromise = null; });
  return pluginTogglePromise;
});
ipcMain.handle('plugin-health:install', (event, profileId, catalogId) => {
  if (!pluginHealthIpcAllowed(event)) {
    return { ok: false, message: '插件安装请求未通过安全校验。' };
  }
  if (typeof profileId !== 'string' || typeof catalogId !== 'string') {
    return { ok: false, message: '插件安装参数无效。' };
  }
  if (pluginTogglePromise || pluginInstallPromise) return { ok: false, message: '另一个扩展变更仍在处理中。' };
  pluginInstallPromise = performPluginInstall({ profileId, catalogId })
    .finally(() => { pluginInstallPromise = null; });
  return pluginInstallPromise;
});
ipcMain.handle('plugin-health:lifecycle', (event, profileId, catalogId, action) => {
  if (!pluginHealthIpcAllowed(event)) {
    return { ok: false, message: '插件生命周期请求未通过安全校验。' };
  }
  if (typeof profileId !== 'string' || typeof catalogId !== 'string' || !['install', 'upgrade', 'uninstall', 'rollback'].includes(action)) {
    return { ok: false, message: '插件生命周期参数无效。' };
  }
  if (pluginTogglePromise || pluginInstallPromise) return { ok: false, message: '另一个扩展变更仍在处理中。' };
  pluginInstallPromise = performPluginInstall({ profileId, catalogId, action })
    .finally(() => { pluginInstallPromise = null; });
  return pluginInstallPromise;
});
ipcMain.handle('office-center:get-state', (event) => (
  officeCenterIpcAllowed(event)
    ? getOfficeCenterState()
    : { available: false, readyCount: 0, total: 3, harness: { status: 'waiting' }, workspace: { status: 'waiting' }, office: [], integrations: [] }
));
ipcMain.handle('office-center:invoke', (event, id) => {
  if (!officeCenterIpcAllowed(event) || typeof id !== 'string') {
    return { ok: false, message: 'Office 交付请求未通过安全校验。' };
  }
  return invokeOfficeCenterSkill(id);
});
ipcMain.handle('worktrees:get-state', (event) => (
  worktreesIpcAllowed(event) ? getWorktreeState() : unavailableWorktreeState('请求来源未通过安全校验。')
));
ipcMain.handle('worktrees:refresh', (event) => (
  worktreesIpcAllowed(event) ? getWorktreeState() : unavailableWorktreeState('请求来源未通过安全校验。')
));
ipcMain.handle('worktrees:create', (event) => {
  if (!worktreesIpcAllowed(event)) return { ok: false, message: '工作树创建请求未通过安全校验。', state: unavailableWorktreeState() };
  if (worktreeMutationBusy()) return { ok: false, message: '另一个仓库操作仍在进行。' };
  return queueWorktreeOperation(() => performWorktreeCreate());
});
ipcMain.handle('worktrees:activate', (event, id) => {
  if (!worktreesIpcAllowed(event) || typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) {
    return { ok: false, message: '工作树切换请求未通过安全校验。' };
  }
  if (worktreeMutationBusy()) return { ok: false, message: '另一个仓库操作仍在进行。' };
  return queueWorktreeOperation(() => performWorktreeActivate(id));
});
ipcMain.handle('worktrees:reveal', async (event, id) => {
  if (!worktreesIpcAllowed(event) || !worktreeManager || typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) {
    return { ok: false, message: '工作树定位请求未通过安全校验。' };
  }
  try {
    const resolved = await worktreeManager.resolve({ workspacePath: getWorkspaceState().activePath, id });
    shell.showItemInFolder(resolved.item.path);
    return { ok: true, message: '已在文件资源管理器中定位工作树。', state: await getWorktreeState() };
  } catch (error) {
    return { ok: false, message: error?.message || '工作树已变化。', state: await getWorktreeState() };
  }
});
ipcMain.handle('worktrees:remove', (event, id) => {
  if (!worktreesIpcAllowed(event) || typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) {
    return { ok: false, message: '工作树回收请求未通过安全校验。' };
  }
  if (worktreeMutationBusy()) return { ok: false, message: '另一个仓库操作仍在进行。' };
  return queueWorktreeOperation(() => performWorktreeRemove(id));
});
ipcMain.handle('tasks-subagents:get-state', (event) => (
  tasksSubagentsIpcAllowed(event) ? getTasksSubagentsState() : unavailableTasksSubagentsState('请求来源未通过安全校验。')
));
ipcMain.handle('tasks-subagents:refresh', (event) => (
  tasksSubagentsIpcAllowed(event) ? getTasksSubagentsState() : unavailableTasksSubagentsState('请求来源未通过安全校验。')
));
ipcMain.handle('tasks-subagents:open', (event, id) => {
  if (!tasksSubagentsIpcAllowed(event) || typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) {
    return { ok: false, message: '子代理打开请求未通过安全校验。' };
  }
  return runTasksSubagentsOperation(() => performOpenSubagent(id));
});
ipcMain.handle('tasks-subagents:prompt', (event, id, text) => {
  if (!tasksSubagentsIpcAllowed(event) || typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id) || typeof text !== 'string') {
    return { ok: false, message: '子代理补充消息请求未通过安全校验。' };
  }
  return runTasksSubagentsOperation(() => performPromptSubagent(id, text));
});
ipcMain.handle('tasks-subagents:interrupt', (event, id) => {
  if (!tasksSubagentsIpcAllowed(event) || typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) {
    return { ok: false, message: '子代理中断请求未通过安全校验。' };
  }
  return runTasksSubagentsOperation(() => performInterruptSubagent(id));
});
ipcMain.handle('side-chat:open-window', (event) => (
  harnessIpcAllowed(event)
    ? openSideChatWindow()
    : { ok: false, reason: 'untrusted', message: 'Side Chat 请求未通过安全校验。' }
));
ipcMain.handle('extensions:open-window', (event) => (
  harnessIpcAllowed(event)
    ? openPluginHealthWindow()
    : { ok: false, message: '扩展中心请求未通过安全校验。' }
));
ipcMain.handle('office-center:open-window', (event) => (
  harnessIpcAllowed(event)
    ? openOfficeCenterWindow()
    : { ok: false, message: 'Office 交付中心请求未通过安全校验。' }
));
ipcMain.handle('harness:get-state', (event) => (
  desktopIpcAllowed(event) ? (supervisor?.getState() || { status: 'idle' }) : { status: 'unavailable' }
));
ipcMain.handle('harness:restart', (event) => (
  desktopIpcAllowed(event) ? startHarnessForWindow({ restart: true }) : { ok: false, reason: 'untrusted' }
));
ipcMain.handle('harness:open-log', async (event) => {
  if (!desktopIpcAllowed(event)) return { ok: false, reason: 'untrusted' };
  const logFile = supervisor?.getState().logFile;
  if (!logFile) return { ok: false };
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  await fsp.appendFile(logFile, '', 'utf8');
  shell.showItemInFolder(logFile);
  return { ok: true };
});

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: initialWindowSize?.width || 1220,
    height: initialWindowSize?.height || 800,
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
      plugins: true,
      sandbox: true,
      spellcheck: true,
      webSecurity: true
    }
  });

  applyUiZoomFactor();

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
    closeSideChatWindow();
    if (terminalWindow && !terminalWindow.isDestroyed()) terminalWindow.close();
    if (worktreesWindow && !worktreesWindow.isDestroyed()) worktreesWindow.close();
    if (tasksSubagentsWindow && !tasksSubagentsWindow.isDestroyed()) tasksSubagentsWindow.close();
    if (officeCenterWindow && !officeCenterWindow.isDestroyed()) officeCenterWindow.close();
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
    electronVersion: process.versions.electron,
    locale: app.getLocale(),
    safeStorage: safeStorage.isEncryptionAvailable()
  }, null, 2));
};

const buildPdfSmokeDocument = () => {
  const content = [
    'BT',
    '/F1 22 Tf',
    '72 712 Td',
    '(DSH Electron 43 PDF Smoke) Tj',
    '0 -34 Td',
    '/F1 13 Tf',
    '(PDF preview rendered successfully.) Tj',
    'ET'
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let pdf = '%PDF-1.4\n%DSH\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
};

const runPdfSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = path.join(path.dirname(resolvedTarget), 'pdf-smoke-data');
  const pdfPath = path.join(smokeRoot, 'preview.pdf');
  const htmlPath = path.join(smokeRoot, 'preview.html');
  const screenshotPath = `${resolvedTarget}.png`;
  await fsp.mkdir(smokeRoot, { recursive: true });
  await fsp.writeFile(pdfPath, buildPdfSmokeDocument());
  await fsp.writeFile(htmlPath, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>DSH PDF smoke</title>
  <style>
    html, body { height: 100%; margin: 0; background: #e7e5e4; font-family: system-ui, sans-serif; }
    main { box-sizing: border-box; display: grid; grid-template-rows: auto 1fr; gap: 12px; height: 100%; padding: 16px; }
    header { color: #292524; font-size: 15px; font-weight: 650; }
    embed { width: 100%; height: 100%; min-height: 600px; border: 1px solid #a8a29e; border-radius: 8px; background: white; }
  </style>
</head>
<body><main><header>DSH Desktop · Electron PDF 兼容性验证</header><embed id="preview" src="./preview.pdf#page=1&amp;view=FitH" type="application/pdf"></main></body>
</html>`, 'utf8');

  let renderProcessGone = null;
  let smokeWindow;
  let result;
  try {
    smokeWindow = new BrowserWindow({
      width: 1000,
      height: 780,
      show: false,
      backgroundColor: '#e7e5e4',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true,
        sandbox: true,
        spellcheck: false,
        webSecurity: true
      }
    });
    smokeWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    smokeWindow.webContents.once('render-process-gone', (_event, details) => {
      renderProcessGone = { reason: details.reason, exitCode: details.exitCode };
    });
    await smokeWindow.loadFile(htmlPath);
    const embed = await smokeWindow.webContents.executeJavaScript(`(() => {
      const element = document.querySelector('#preview');
      const rect = element?.getBoundingClientRect();
      return {
        found: Boolean(element),
        type: element?.type || '',
        width: Math.round(rect?.width || 0),
        height: Math.round(rect?.height || 0)
      };
    })()`, true);
    smokeWindow.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1000, height: 780 },
      fetchWindowIcons: false
    });
    const source = sources.find((candidate) => candidate.id === smokeWindow.getMediaSourceId());
    const screenshot = source?.thumbnail || await smokeWindow.webContents.capturePage();
    const screenshotSize = screenshot.getSize();
    const bitmap = screenshot.toBitmap();
    let darkPixels = 0;
    const pixelCount = Math.floor(bitmap.length / 4);
    for (let offset = 0; offset + 3 < bitmap.length; offset += 4) {
      if (Math.max(bitmap[offset], bitmap[offset + 1], bitmap[offset + 2]) < 96) darkPixels += 1;
    }
    const viewerDarkPixelRatio = pixelCount ? darkPixels / pixelCount : 0;
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
    result = {
      ok: !renderProcessGone
        && embed.found
        && embed.type === 'application/pdf'
        && embed.width > 0
        && embed.height > 0
        && screenshotSize.width > 0
        && screenshotSize.height > 0
        && viewerDarkPixelRatio > 0.08,
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      renderProcessGone,
      embed,
      visualSignal: {
        viewerDarkPixelRatio: Number(viewerDarkPixelRatio.toFixed(4))
      },
      screenshot: {
        method: source ? 'desktop-capturer' : 'web-contents-fallback',
        path: screenshotPath,
        width: screenshotSize.width,
        height: screenshotSize.height
      }
    };
  } catch (error) {
    result = {
      ok: false,
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      renderProcessGone,
      error: error.message
    };
  } finally {
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    allowQuit = true;
    smokeWindow?.destroy();
  }
  if (!result.ok) process.exitCode = 1;
};

const runHarnessSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = path.join(path.dirname(resolvedTarget), 'harness-smoke-data');
  supervisor = createSupervisor(smokeRoot);
  let result;
  try {
    const url = await supervisor.start();
    const probe = await probeHarness(url);
    const rootResponse = await fetch(url);
    const workspaceSync = await synchronizeHarnessWorkspace({
      origin: url,
      workspacePath: supervisor.getState().workspacePath,
      fallbackTitle: 'DSH 临时工作区'
    });
    const sideChat = await new SideChatController({
      getOrigin: () => url,
      readSelection: async () => workspaceSync.sessionId
    }).create({
      mainWebContents: {},
      workspacePath: supervisor.getState().workspacePath,
      agentState: { status: 'ready', pendingCount: 0, queuedCount: 0 }
    });
    const liveInventory = await callHarnessRemote(url, 'pluginInventory', 'list');
    const runtimePaths = resolveHarnessRuntimePaths({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
    const runtimeCatalog = new PluginHealthCatalog({
      harnessHome: path.join(smokeRoot, 'harness'),
      dshPackageDir: path.resolve(path.dirname(runtimePaths.dshBinPath), '..')
    });
    const runtimeState = await runtimeCatalog.scan();
    const extensionCenter = buildExtensionCenter({
      runtimeVersion: runtimeState.runtime?.version || '',
      runtimeCapabilities: runtimeState.runtime?.capabilities || {},
      inventory: liveInventory
    });
    const skillSurface = extensionCenter.surfaces.find((item) => item.id === 'skills');
    const pluginSurface = extensionCenter.surfaces.find((item) => item.id === 'plugins');
    const hookSurface = extensionCenter.surfaces.find((item) => item.id === 'hooks');
    const mcpSurface = extensionCenter.surfaces.find((item) => item.id === 'mcp');
    result = {
      ok: sideChat.kind === 'fresh'
        && sideChat.sourceSessionId === workspaceSync.sessionId
        && sideChat.sideSessionId !== workspaceSync.sessionId
        && sideChat.permission === 'workspace-write'
        && extensionCenter.available
        && pluginSurface?.total > 0
        && skillSurface?.total > 0
        && mcpSurface?.status === 'ready'
        && mcpSurface?.total === 0
        && hookSurface?.status === 'unsupported',
      name: app.getName(),
      version: app.getVersion(),
      url,
      ...probe,
      responseHeaders: {
        contentSecurityPolicy: rootResponse.headers.get('content-security-policy') || '',
        contentType: rootResponse.headers.get('content-type') || ''
      },
      workspaceSync: {
        status: workspaceSync.status,
        workspaceTitle: workspaceSync.workspaceTitle,
        sessionCreated: workspaceSync.sessionCreated
      },
      sideChat: {
        kind: sideChat.kind,
        independent: sideChat.sideSessionId !== sideChat.sourceSessionId,
        permission: sideChat.permission
      },
      extensionCenter: {
        source: extensionCenter.source,
        plugins: { total: pluginSurface?.total || 0, active: pluginSurface?.active || 0, failed: pluginSurface?.failed || 0 },
        skills: { total: skillSurface?.total || 0, active: skillSurface?.active || 0 },
        mcp: { status: mcpSurface?.status || 'unknown', version: mcpSurface?.version || '', total: mcpSurface?.total || 0, active: mcpSurface?.active || 0 },
        hooks: hookSurface?.status || 'unknown'
      }
    };
  } catch (error) {
    result = { ok: false, name: app.getName(), version: app.getVersion(), error: error.message };
    process.exitCode = 1;
  } finally {
    await supervisor.stop();
  }
  await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
  await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
};

const runIpcSecuritySmoke = async (target) => {
  mainWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await mainWindow.loadFile(statusPage);
  const remoteTerminalKeys = await mainWindow.webContents.executeJavaScript(
    'Object.keys(window.desktopAPI?.terminal || {}).sort()',
    true
  );
  await createTerminalWindow();
  const localTerminalKeys = await terminalWindow.webContents.executeJavaScript(
    'Object.keys(window.terminalAPI || {}).sort()',
    true
  );
  const localState = await terminalWindow.webContents.executeJavaScript(
    'window.terminalAPI.getState()',
    true
  );
  await terminalWindow.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    true
  );
  const screenshot = await terminalWindow.webContents.capturePage();
  const screenshotPath = `${target}.png`;
  const screenshotSize = screenshot.getSize();
  const expectedLocalKeys = ['getState', 'onOutput', 'onState', 'resize', 'start', 'stop', 'write'];
  const result = {
    ok: remoteTerminalKeys.length === 1
      && remoteTerminalKeys[0] === 'openWindow'
      && JSON.stringify(localTerminalKeys) === JSON.stringify(expectedLocalKeys)
      && localState?.state?.status === 'unavailable'
      && screenshotSize.width > 0
      && screenshotSize.height > 0,
    remoteTerminalKeys,
    localTerminalKeys,
    localTerminalStatus: localState?.state?.status || 'missing',
    screenshot: {
      path: screenshotPath,
      width: screenshotSize.width,
      height: screenshotSize.height
    }
  };
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(screenshotPath, screenshot.toPNG());
  await fsp.writeFile(target, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (!result.ok) process.exitCode = 1;
  terminalWindow?.destroy();
  mainWindow?.destroy();
  terminalWindow = undefined;
  mainWindow = undefined;
};

const runContextSourcesSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = path.join(path.dirname(resolvedTarget), 'context-sources-smoke-data');
  const workspacePath = path.join(smokeRoot, 'workspace');
  const harnessHome = path.join(smokeRoot, 'harness');
  let result;
  try {
    await fsp.mkdir(path.join(workspacePath, '.git'), { recursive: true });
    await fsp.mkdir(harnessHome, { recursive: true });
    await fsp.writeFile(path.join(workspacePath, 'AGENTS.md'), 'hidden-rule-prose-marker', 'utf8');
    await fsp.writeFile(path.join(harnessHome, 'AGENTS.md'), 'hidden-global-prose-marker', 'utf8');
    contextSourceCatalog = new ContextSourceCatalog({ workspacePath, harnessHome });
    await createContextSourcesWindow();
    await contextSourcesWindow.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5_000;
        const check = () => {
          const text = document.getElementById('status')?.textContent || '';
          if (text.startsWith('\u5df2\u5237\u65b0') || text.includes('\u4e0d\u53ef\u7528') || text.includes('\u5931\u8d25')) return resolve();
          if (Date.now() >= deadline) return reject(new Error('Timed out waiting for context sources to render'));
          setTimeout(check, 25);
        };
        check();
      })`,
      true
    );
    const rendered = await contextSourcesWindow.webContents.executeJavaScript(`({
      apiKeys: Object.keys(window.contextSourcesAPI || {}).sort(),
      title: document.querySelector('h1')?.textContent || '',
      sourceRows: document.querySelectorAll('.source-row').length,
      text: document.body.innerText
    })`, true);
    const screenshot = await contextSourcesWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    result = {
      ok: JSON.stringify(rendered.apiKeys) === JSON.stringify(['getState', 'refresh', 'reveal'])
        && rendered.title === '上下文来源'
        && rendered.sourceRows === 2
        && rendered.text.includes('AGENTS.md')
        && rendered.text.includes('内容去重、总预算省略和截断由 Harness 决定')
        && !rendered.text.includes('hidden-rule-prose-marker')
        && !rendered.text.includes('hidden-global-prose-marker')
        && screenshotSize.width > 0
        && screenshotSize.height > 0,
      version: app.getVersion(),
      apiKeys: rendered.apiKeys,
      title: rendered.title,
      sourceRows: rendered.sourceRows,
      proseHidden: !rendered.text.includes('hidden-rule-prose-marker') && !rendered.text.includes('hidden-global-prose-marker'),
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error.message };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    contextSourcesWindow?.destroy();
    contextSourcesWindow = undefined;
  }
  if (!result.ok) process.exitCode = 1;
};

const writeSmokePackage = async (directory, manifest) => {
  await fsp.mkdir(directory, { recursive: true });
  await fsp.writeFile(path.join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};

const linkSmokePackage = async (modulesRoot, packageName, target) => {
  const link = path.join(modulesRoot, ...packageName.split('/'));
  await fsp.mkdir(path.dirname(link), { recursive: true });
  try {
    const [info, actual, expected] = await Promise.all([fsp.lstat(link), fsp.realpath(link), fsp.realpath(target)]);
    if (info.isSymbolicLink() && actual === expected) return;
    throw new Error(`smoke link already exists with an unexpected target: ${packageName}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fsp.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
};

const runPluginHealthSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = path.join(path.dirname(resolvedTarget), 'plugin-health-smoke-data');
  const installRoot = path.join(smokeRoot, 'runtime', 'node_modules');
  const dshPackageDir = path.join(installRoot, '@deepseek-ai', 'dsh');
  const basePackageDir = path.join(installRoot, '@deepseek-ai', 'dsh-base');
  const capabilityPackageNames = ['dsh-skill', 'dsh-mcp-client', 'dsh-host-plugin-inventory'];
  const harnessHome = path.join(smokeRoot, 'harness');
  const fallbackRoot = path.join(harnessHome, 'profiles', 'node_modules');
  const profileDir = path.join(harnessHome, 'profiles', 'web');
  const externalPackageDir = path.join(profileDir, 'node_modules', 'community-bundle');
  let result;
  try {
    await writeSmokePackage(dshPackageDir, {
      name: '@deepseek-ai/dsh',
      version: '0.1.1-rc.2',
      dependencies: Object.fromEntries([
        ['@deepseek-ai/dsh-base', '0.1.1-rc.2'],
        ...capabilityPackageNames.map((name) => [`@deepseek-ai/${name}`, '0.1.1-rc.2'])
      ])
    });
    await writeSmokePackage(basePackageDir, { name: '@deepseek-ai/dsh-base', version: '0.1.1-rc.2', dsh: { bundle: { patch: './cordis.patch.yml' } } });
    for (const name of capabilityPackageNames) {
      const packageDir = path.join(installRoot, '@deepseek-ai', name);
      await writeSmokePackage(packageDir, { name: `@deepseek-ai/${name}`, version: '0.1.1-rc.2' });
      await linkSmokePackage(fallbackRoot, `@deepseek-ai/${name}`, packageDir);
    }
    await writeSmokePackage(externalPackageDir, { name: 'community-bundle', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } });
    await fsp.writeFile(path.join(externalPackageDir, 'cordis.patch.yml'), 'hidden-patch-prose-marker', 'utf8');
    await linkSmokePackage(fallbackRoot, '@deepseek-ai/dsh', dshPackageDir);
    await linkSmokePackage(fallbackRoot, '@deepseek-ai/dsh-base', basePackageDir);
    await writeSmokePackage(profileDir, { name: 'dsh-profile-web', dependencies: { 'community-bundle': '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'community-bundle'] } }, hiddenMarker: 'hidden-plugin-config-marker' });
    await fsp.writeFile(path.join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n', 'utf8');
    pluginHealthCatalog = new PluginHealthCatalog({ harnessHome, dshPackageDir });
    const packagedHarness = resolveHarnessRuntimePaths({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
    controlledPluginInstaller = new ControlledPluginInstaller({
      profilesRoot: path.join(harnessHome, 'profiles'),
      harnessHome,
      nodePath: packagedHarness.nodePath,
      dshBinPath: packagedHarness.dshBinPath,
      runtimeModulesDir: path.join(process.resourcesPath, 'harness', 'node_modules'),
      pnpmRuntime: resolveControlledPnpmRuntime({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged })
    });
    await controlledPluginInstaller.inspectRuntime();
    await createPluginHealthWindow();
    const renderedInTime = await pluginHealthWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 15000;
      const check = () => {
        const profileReady = document.querySelectorAll('.profile-card').length === 1;
        const toggleReady = document.querySelectorAll('.toggle-button').length === 1;
        const surfacesReady = document.querySelectorAll('.surface-card').length === 4;
        if (profileReady && toggleReady && surfacesReady) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`, true);
    if (!renderedInTime) throw new Error('plugin-health-smoke-timeout');
    const rendered = await pluginHealthWindow.webContents.executeJavaScript(`({
      apiKeys: Object.keys(window.pluginHealthAPI || {}).sort(),
      title: document.querySelector('h1')?.textContent || '',
      catalogRows: document.querySelectorAll('.catalog-card').length,
      installButtons: document.querySelectorAll('.install-button').length,
      surfaceRows: document.querySelectorAll('.surface-card').length,
      profileRows: document.querySelectorAll('.profile-card').length,
      toggleButtons: document.querySelectorAll('.toggle-button').length,
      text: document.body.innerText
    })`, true);
    const screenshot = await pluginHealthWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    result = {
      ok: JSON.stringify(rendered.apiKeys) === JSON.stringify(['getState', 'install', 'lifecycle', 'refresh', 'reveal', 'toggle'])
        && rendered.title === '扩展中心'
        && rendered.surfaceRows === 4
        && rendered.catalogRows === 1
        && rendered.installButtons === 1
        && rendered.profileRows === 1
        && rendered.toggleButtons === 1
        && rendered.text.includes('@deepseek-ai/dsh-base')
        && rendered.text.includes('community-bundle')
        && rendered.text.includes('兼容已验证')
        && rendered.text.includes('固定 registry · Web · Patch 正常 · Peer 0/0')
        && rendered.text.includes('Skills')
        && rendered.text.includes('Plugins')
        && rendered.text.includes('Hooks')
        && rendered.text.includes('MCP')
        && rendered.text.includes('上游未提供')
        && rendered.text.includes('共享回退由 Harness 启动时维护')
        && !rendered.text.includes('hidden-plugin-config-marker')
        && !rendered.text.includes('hidden-patch-prose-marker')
        && screenshotSize.width > 0
        && screenshotSize.height > 0,
      version: app.getVersion(),
      apiKeys: rendered.apiKeys,
      title: rendered.title,
      catalogRows: rendered.catalogRows,
      installButtons: rendered.installButtons,
      surfaceRows: rendered.surfaceRows,
      profileRows: rendered.profileRows,
      toggleButtons: rendered.toggleButtons,
      compatibilityVerified: rendered.text.includes('兼容已验证'),
      configHidden: !rendered.text.includes('hidden-plugin-config-marker') && !rendered.text.includes('hidden-patch-prose-marker'),
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error.message };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    pluginHealthWindow?.destroy();
    pluginHealthWindow = undefined;
    controlledPluginInstaller = undefined;
  }
  if (!result.ok) process.exitCode = 1;
};

const runOfficeCenterSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  let result;
  try {
    workspaceStore = {
      getState: () => ({ activePath: rootDir, displayName: 'V0.6 集成工作区', isFallback: false, recentPaths: [rootDir] })
    };
    workspaceSyncDiagnostics = Object.freeze({
      ...unavailableWorkspaceSync(),
      status: 'synced',
      workspacePath: rootDir,
      workspaceTitle: 'V0.6 集成工作区',
      sessionId: 'session-33333333-3333-4333-8333-333333333333'
    });
    await createOfficeCenterWindow();
    const renderedInTime = await officeCenterWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelectorAll('.office-card').length === 3 && document.querySelectorAll('.integration-card').length === 3) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`, true);
    if (!renderedInTime) throw new Error('office-center-smoke-timeout');
    const rendered = await officeCenterWindow.webContents.executeJavaScript(`({
      apiKeys: Object.keys(window.officeCenterAPI || {}).sort(),
      title: document.querySelector('h1')?.textContent || '',
      officeRows: document.querySelectorAll('.office-card').length,
      integrationRows: document.querySelectorAll('.integration-card').length,
      buttons: document.querySelectorAll('.invoke').length,
      enabledButtons: document.querySelectorAll('.invoke:not(:disabled)').length,
      text: document.body.innerText
    })`, true);
    const screenshot = await officeCenterWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    await officeCenterWindow.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)', true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const integrationScreenshot = await officeCenterWindow.webContents.capturePage();
    const integrationScreenshotPath = `${resolvedTarget}.integration.png`;
    const integrationScreenshotSize = integrationScreenshot.getSize();
    result = {
      ok: JSON.stringify(rendered.apiKeys) === JSON.stringify(['getState', 'invoke'])
        && rendered.title === 'Office 交付中心'
        && rendered.officeRows === 3
        && rendered.integrationRows === 3
        && rendered.buttons === 3
        && rendered.enabledButtons === 3
        && rendered.text.includes('Word')
        && rendered.text.includes('Excel')
        && rendered.text.includes('PowerPoint')
        && rendered.text.includes('Tasks / Subagents')
        && rendered.text.includes('扩展与 pnpm')
        && !rendered.text.includes('hidden-office-secret-marker')
        && screenshotSize.width > 0
        && screenshotSize.height > 0
        && integrationScreenshotSize.width > 0
        && integrationScreenshotSize.height > 0,
      version: app.getVersion(),
      apiKeys: rendered.apiKeys,
      title: rendered.title,
      officeRows: rendered.officeRows,
      integrationRows: rendered.integrationRows,
      buttons: rendered.buttons,
      enabledButtons: rendered.enabledButtons,
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height },
      integrationScreenshot: { path: integrationScreenshotPath, width: integrationScreenshotSize.width, height: integrationScreenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
    await fsp.writeFile(integrationScreenshotPath, integrationScreenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error?.stack || error?.message || String(error) };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    officeCenterWindow?.destroy();
    officeCenterWindow = undefined;
    workspaceStore = undefined;
    workspaceSyncDiagnostics = unavailableWorkspaceSync();
  }
  if (!result.ok) process.exitCode = 1;
};

const runWorktreesSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = path.join(path.dirname(resolvedTarget), `worktrees-smoke-data-${process.pid}-${Date.now()}`);
  const repositoryPath = path.join(smokeRoot, 'repository');
  const managedRoot = path.join(smokeRoot, 'managed');
  let result;
  let createdWorktree;
  try {
    await fsp.mkdir(repositoryPath, { recursive: true });
    const gitSmoke = (args) => runGitCommand('git', repositoryPath, args, {
      baseEnv: { ...process.env, DEEPSEEK_API_KEY: 'hidden-worktree-smoke-key' }
    });
    await gitSmoke(['init', '--initial-branch=main']);
    await gitSmoke(['config', 'user.name', 'DSH Worktree Smoke']);
    await gitSmoke(['config', 'user.email', 'worktree-smoke@dsh-desktop.local']);
    await fsp.writeFile(path.join(repositoryPath, 'README.md'), '# Worktree smoke\n', 'utf8');
    await gitSmoke(['add', 'README.md']);
    await gitSmoke(['commit', '-m', 'smoke baseline']);
    workspaceStore = {
      getState: () => ({ activePath: repositoryPath, displayName: 'repository', isFallback: false, recentPaths: [repositoryPath] })
    };
    worktreeManager = new GitWorktreeManager({
      managedRoot,
      now: () => new Date('2026-08-25T09:10:11.000Z'),
      random: () => Buffer.from('0a0b0c', 'hex'),
      baseEnv: { ...process.env, DEEPSEEK_API_KEY: 'hidden-worktree-smoke-key' }
    });
    createdWorktree = await worktreeManager.create({ workspacePath: repositoryPath });
    await fsp.writeFile(path.join(createdWorktree.path, 'pending-change.txt'), 'recoverable smoke change\n', 'utf8');
    await createWorktreesWindow();
    const renderedInTime = await worktreesWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelectorAll('.worktree-card').length === 2) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`, true);
    if (!renderedInTime) throw new Error('worktrees-smoke-timeout');
    await worktreesWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`, true);
    const rendered = await worktreesWindow.webContents.executeJavaScript(`({
      apiKeys: Object.keys(window.worktreesAPI || {}).sort(),
      title: document.querySelector('h1')?.textContent || '',
      cards: document.querySelectorAll('.worktree-card').length,
      managedBadges: [...document.querySelectorAll('.badge')].filter((node) => node.textContent === 'DSH 管理').length,
      removeButtons: [...document.querySelectorAll('.worktree-actions button')].filter((node) => node.textContent === '安全回收').length,
      switchButtons: [...document.querySelectorAll('.worktree-actions button')].filter((node) => node.textContent === '切换').length,
      text: document.body.innerText
    })`, true);
    const screenshot = await worktreesWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    const removalPreview = await worktreeManager.previewRemove({
      workspacePath: repositoryPath,
      id: createdWorktree.createdId
    });
    const removal = await worktreeManager.remove({
      workspacePath: repositoryPath,
      id: createdWorktree.createdId,
      expectedFingerprint: removalPreview.fingerprint
    });
    const retainedBranch = (await gitSmoke(['show-ref', '--verify', `refs/heads/${createdWorktree.branch}`]))
      .trim()
      .endsWith(` refs/heads/${createdWorktree.branch}`);
    result = {
      ok: JSON.stringify(rendered.apiKeys) === JSON.stringify(['activate', 'create', 'getState', 'onState', 'refresh', 'remove', 'reveal'])
        && rendered.title === '隔离工作树'
        && rendered.cards === 2
        && rendered.managedBadges === 1
        && rendered.removeButtons === 1
        && rendered.switchButtons === 1
        && rendered.text.includes('dsh/worktree-20260825-091011-0a0b0c')
        && rendered.text.includes('1 项修改')
        && !rendered.text.includes('hidden-worktree-smoke-key')
        && removal.ok
        && Boolean(removal.checkpoint?.id)
        && retainedBranch
        && removal.state.worktrees.length === 1
        && screenshotSize.width > 0
        && screenshotSize.height > 0,
      version: app.getVersion(),
      apiKeys: rendered.apiKeys,
      cards: rendered.cards,
      managedBadges: rendered.managedBadges,
      removeButtons: rendered.removeButtons,
      switchButtons: rendered.switchButtons,
      credentialHidden: !rendered.text.includes('hidden-worktree-smoke-key'),
      lifecycle: {
        dirtyRemoval: removal.ok,
        recoveryCheckpoint: Boolean(removal.checkpoint?.id),
        branchRetained: retainedBranch,
        remainingWorktrees: removal.state.worktrees.length
      },
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error.message };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    worktreesWindow?.destroy();
    worktreesWindow = undefined;
    if (createdWorktree?.path) {
      await runGitCommand('git', repositoryPath, ['worktree', 'remove', '--force', createdWorktree.path]).catch(() => {});
    }
    worktreeManager = undefined;
    workspaceStore = undefined;
  }
  if (!result.ok) process.exitCode = 1;
};

const runTasksSubagentsSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const rootSessionId = 'session-11111111-1111-4111-8111-111111111111';
  const childSessionId = 'session-22222222-2222-4222-8222-222222222222';
  const oneShotSessionId = 'session-33333333-3333-4333-8333-333333333333';
  const grandchildSessionId = 'session-44444444-4444-4444-8444-444444444444';
  const observations = [];
  let idCounter = 0;
  let result;
  try {
    const apiCall = async (_origin, method, payload) => {
      observations.push({ method, payload });
      if (method === 'session.list') {
        return {
          items: [
            { sessionId: rootSessionId, updatedAt: 1, running: true, blank: false, cwd: 'C:\\smoke\\project', projections: { values: { title: '主任务：桌面发布' } } },
            { sessionId: childSessionId, updatedAt: 2, running: true, blank: false, cwd: 'C:\\smoke\\project', parentSessionId: rootSessionId, origin: 'subagent', projections: { values: { title: '审核发布门禁' } } },
            { sessionId: oneShotSessionId, updatedAt: 3, running: false, blank: false, cwd: 'C:\\smoke\\other-worktree', parentSessionId: rootSessionId, origin: 'subagent' },
            { sessionId: grandchildSessionId, updatedAt: 4, running: false, blank: false, cwd: 'C:\\smoke\\project', parentSessionId: childSessionId, origin: 'subagent' }
          ]
        };
      }
      if (method === 'subagent.list' && payload.parentSessionId === rootSessionId) {
        return {
          parentAvailable: true,
          entries: [
            { kind: 'child', id: childSessionId, mode: 'continuable', label: '审核发布门禁', activity: 'running', hasChildren: true },
            { kind: 'child', id: oneShotSessionId, mode: 'one-shot', activity: 'inactive', hasChildren: false }
          ]
        };
      }
      if (method === 'subagent.list' && payload.parentSessionId === childSessionId) {
        return {
          parentAvailable: true,
          entries: [{ kind: 'child', id: grandchildSessionId, mode: 'one-shot', label: '检查安装包', activity: 'inactive', hasChildren: false }]
        };
      }
      if (method === 'subagent.prompt') return { messageId: 'message-smoke-accepted' };
      if (method === 'subagent.interrupt') return { accepted: true };
      throw new Error(`unexpected smoke API call: ${method}`);
    };
    tasksSubagentsController = new TasksSubagentsController({
      getOrigin: () => 'http://127.0.0.1:19001',
      getWebContents: () => ({}),
      apiCall,
      readSelection: async () => rootSessionId,
      readJobs: async () => ({
        status: 'ready',
        entries: [
          { kind: 'pwsh', label: 'pnpm test DEEPSEEK_API_KEY=smoke-secret-value', status: '运行中', duration: '12 秒', live: true },
          { kind: 'subagent', label: '历史检查', status: '已完成', duration: '8 秒', live: false }
        ]
      }),
      mintId: () => (++idCounter).toString(16).padStart(24, '0')
    });
    workspaceStore = {
      getState: () => ({ activePath: 'C:\\smoke\\project', displayName: 'project', isFallback: false, recentPaths: [] })
    };
    await createTasksSubagentsWindow();
    const renderedInTime = await tasksSubagentsWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelectorAll('.subagent-row').length === 3 && document.querySelectorAll('.job-row').length === 2) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`, true);
    if (!renderedInTime) throw new Error('tasks-subagents-smoke-timeout');
    await tasksSubagentsWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`, true);
    await tasksSubagentsWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const control = [...document.querySelectorAll('.subagent-actions button')].find((node) => node.textContent === '补充消息');
      control?.click();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(Boolean(control))));
    })`, true);
    const state = await getTasksSubagentsState();
    const continuable = state.subagents.find((item) => item.kind === 'child' && item.mode === 'continuable');
    if (!continuable) throw new Error('tasks-subagents-smoke-continuable-missing');
    const promptReceipt = await tasksSubagentsController.prompt(continuable.id, '补充核对远端资产');
    const interruptReceipt = await tasksSubagentsController.interrupt(continuable.id);
    const rendered = await tasksSubagentsWindow.webContents.executeJavaScript(`({
      apiKeys: Object.keys(window.tasksSubagentsAPI || {}).sort(),
      title: document.querySelector('h1')?.textContent || '',
      subagents: document.querySelectorAll('.subagent-row').length,
      jobs: document.querySelectorAll('.job-row').length,
      promptButtons: [...document.querySelectorAll('.subagent-actions button')].filter((node) => node.textContent === '补充消息').length,
      interruptButtons: [...document.querySelectorAll('.subagent-actions button')].filter((node) => node.textContent === '中断当前轮次').length,
      composeOpen: document.querySelectorAll('.compose.open textarea[maxlength="8000"]').length,
      composeVisible: (() => { const node = document.querySelector('.compose.open'); return Boolean(node && getComputedStyle(node).display === 'grid' && node.getBoundingClientRect().height > 40); })(),
      text: document.body.innerText
    })`, true);
    const screenshot = await tasksSubagentsWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    const promptCall = observations.find((item) => item.method === 'subagent.prompt');
    result = {
      ok: JSON.stringify(rendered.apiKeys) === JSON.stringify(['getState', 'interrupt', 'onState', 'open', 'prompt', 'refresh'])
        && rendered.title === '任务与子代理'
        && rendered.subagents === 3
        && rendered.jobs === 2
        && rendered.promptButtons === 1
        && rendered.interruptButtons === 1
        && rendered.composeOpen === 1
        && rendered.composeVisible
        && rendered.text.includes('主任务：桌面发布')
        && rendered.text.includes('检查安装包')
        && !rendered.text.includes('smoke-secret-value')
        && rendered.text.includes('[已隐藏]')
        && promptReceipt.accepted === true
        && interruptReceipt.accepted === true
        && promptCall?.payload?.content?.[0]?.text === '补充核对远端资产'
        && screenshotSize.width > 0
        && screenshotSize.height > 0,
      version: app.getVersion(),
      apiKeys: rendered.apiKeys,
      subagents: rendered.subagents,
      jobs: rendered.jobs,
      controlledPrompt: promptReceipt.accepted === true,
      interruptAcknowledgement: interruptReceipt.accepted === true,
      credentialHidden: !rendered.text.includes('smoke-secret-value'),
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error.message };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    tasksSubagentsWindow?.destroy();
    tasksSubagentsWindow = undefined;
    tasksSubagentsController = undefined;
    workspaceStore = undefined;
  }
  if (!result.ok) process.exitCode = 1;
};

const runSideChatSmoke = async (target) => {
  const http = require('node:http');
  const resolvedTarget = path.resolve(target);
  const mainSessionId = 'session-11111111-1111-4111-8111-111111111111';
  const sideSessionId = 'session-22222222-2222-4222-8222-222222222222';
  let fixtureServer;
  let result;
  try {
    fixtureServer = http.createServer((_request, response) => {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'"
      });
      response.end(`<!doctype html><html><head><meta charset="utf-8"><title>Harness Smoke</title>
        <style>body{margin:0;background:#0f1117;color:#eef3ff;font:16px system-ui}.smoke_frame{display:grid;grid-template-columns:220px 1fr;min-height:100vh}.smoke_sidebarCol{padding:56px 20px;background:#202637}.content{padding:72px 32px}code{color:#9ec4ff}</style>
        </head><body><div class="smoke_frame"><aside class="smoke_sidebarCol">Harness sidebar</aside><main class="content"><h1>Harness Side Chat</h1><p>Official session selection is stored by the Harness renderer.</p></main></div></body></html>`);
    });
    await new Promise((resolve, reject) => {
      fixtureServer.once('error', reject);
      fixtureServer.listen(0, '127.0.0.1', resolve);
    });
    const address = fixtureServer.address();
    harnessOrigin = `http://127.0.0.1:${address.port}`;
    workspaceStore = {
      getState: () => ({ activePath: path.resolve(rootDir), displayName: 'Side Chat Smoke', isFallback: false, recentPaths: [] })
    };
    proxyStore = { getState: () => ({ mode: 'direct', proxyUrl: '' }) };
    agentDiagnostics = Object.freeze({ ...unavailableAgentDiagnostics(), status: 'ready' });
    mainWindow = new BrowserWindow({
      width: 1120,
      height: 760,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await mainWindow.loadURL(harnessOrigin);
    await selectHarnessSession(mainWindow.webContents, mainSessionId);
    await createSideChatHarnessWindow({
      sourceSessionId: mainSessionId,
      sideSessionId,
      sourceTitle: '主线发布',
      sideTitle: 'Side Chat · 主线发布',
      workspacePath: path.resolve(rootDir),
      permission: 'workspace-write',
      kind: 'fork'
    });
    const [mainSelection, sideSelection, rendered] = await Promise.all([
      readHarnessSessionSelection(mainWindow.webContents),
      readHarnessSessionSelection(sideChatWindow.webContents),
      sideChatWindow.webContents.executeJavaScript(`(() => ({
        banner: document.getElementById('dsh-side-chat-banner')?.textContent || '',
        sidebarDisplay: getComputedStyle(document.querySelector('.smoke_sidebarCol')).display,
        desktopApiExposed: Boolean(window.desktopAPI),
        bodyText: document.body.innerText
      }))()`, true)
    ]);
    const screenshot = await sideChatWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    result = {
      ok: mainSelection === mainSessionId
        && sideSelection === sideSessionId
        && rendered.banner.includes('Workspace Write / Ask')
        && rendered.sidebarDisplay === 'none'
        && rendered.desktopApiExposed === false
        && rendered.bodyText.includes('Harness Side Chat')
        && screenshotSize.width > 0
        && screenshotSize.height > 0,
      version: app.getVersion(),
      mainSelection,
      sideSelection,
      independentStorage: mainSelection !== sideSelection,
      permission: 'workspace-write',
      approval: 'ask',
      desktopApiExposed: rendered.desktopApiExposed,
      sidebarDisplay: rendered.sidebarDisplay,
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error?.stack || error?.message || String(error) };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    if (fixtureServer) await new Promise((resolve) => fixtureServer.close(resolve));
    closeSideChatWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    mainWindow = undefined;
  }
  if (!result.ok) process.exitCode = 1;
};

app.whenReady().then(async () => {
  app.setAppUserModelId('com.dsh.desktop');
  configureHarnessSessionPermissions(session.defaultSession, () => mainWindow?.webContents);

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
  if (ipcSecuritySmokeTarget) {
    await runIpcSecuritySmoke(ipcSecuritySmokeTarget.slice('--ipc-security-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (pdfSmokeTarget) {
    await runPdfSmoke(pdfSmokeTarget.slice('--pdf-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (contextSourcesSmokeTarget) {
    await runContextSourcesSmoke(contextSourcesSmokeTarget.slice('--context-sources-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (pluginHealthSmokeTarget) {
    await runPluginHealthSmoke(pluginHealthSmokeTarget.slice('--plugin-health-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (officeCenterSmokeTarget) {
    await runOfficeCenterSmoke(officeCenterSmokeTarget.slice('--office-center-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (worktreesSmokeTarget) {
    await runWorktreesSmoke(worktreesSmokeTarget.slice('--worktrees-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (tasksSubagentsSmokeTarget) {
    await runTasksSubagentsSmoke(tasksSubagentsSmokeTarget.slice('--tasks-subagents-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (sideChatSmokeTarget) {
    await runSideChatSmoke(sideChatSmokeTarget.slice('--side-chat-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }

  dataRoot = app.getPath('userData');
  workspaceStore = new WorkspaceStore({
    filePath: path.join(dataRoot, 'desktop-state.json'),
    fallbackDir: path.join(dataRoot, 'launch-root')
  });
  worktreeManager = new GitWorktreeManager({
    managedRoot: path.join(dataRoot, 'worktrees')
  });
  workbenchStore = new WorkbenchStore({
    filePath: path.join(dataRoot, 'workbench-state.json')
  });
  proxyStore = new ProxySettingsStore({
    filePath: path.join(dataRoot, 'network-state.json')
  });
  await workbenchStore.init();
  await proxyStore.init();
  const workspace = await workspaceStore.init();
  workspaceFiles = new WorkspaceFiles();
  await workspaceFiles.activate(workspace.activePath);
  contextSourceCatalog = new ContextSourceCatalog({
    workspacePath: workspace.activePath,
    harnessHome: path.join(dataRoot, 'harness')
  });
  const harnessRuntime = resolveHarnessRuntimePaths({
    rootDir,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  });
  const dshPackageDir = path.resolve(path.dirname(harnessRuntime.dshBinPath), '..');
  pluginHealthCatalog = new PluginHealthCatalog({
    harnessHome: path.join(dataRoot, 'harness'),
    dshPackageDir
  });
  controlledPluginInstaller = new ControlledPluginInstaller({
    profilesRoot: path.join(dataRoot, 'harness', 'profiles'),
    harnessHome: path.join(dataRoot, 'harness'),
    nodePath: harnessRuntime.nodePath,
    dshBinPath: harnessRuntime.dshBinPath,
    runtimeModulesDir: path.resolve(dshPackageDir, '..', '..'),
    pnpmRuntime: resolveControlledPnpmRuntime({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged })
  });
  await controlledPluginInstaller.inspectRuntime();
  profileBundleManager = new ProfileBundleManager({
    profilesRoot: path.join(dataRoot, 'harness', 'profiles')
  });
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
  checkpointManager = new GitCheckpointManager();
  checkpointDiagnostics = await checkpointManager.activate(workspace.activePath);
  await initializeProxySettings();
  const lifecycleRecovery = await controlledPluginInstaller.recoverPending({
    workspacePath: workspace.activePath,
    proxyEnvironment: harnessProxyEnvironment
  });
  const toggleRecovery = await profileBundleManager.recoverPending();
  pluginRecoveryOutcomes = Object.freeze([...lifecycleRecovery, ...toggleRecovery]);
  supervisor = createSupervisor(dataRoot, workspace.activePath);
  tasksSubagentsController = new TasksSubagentsController({
    getOrigin: () => harnessOrigin,
    getWebContents: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined)
  });
  sideChatController = new SideChatController({ getOrigin: () => harnessOrigin });
  await refreshDesktopDiagnostics({ rebuildMenu: false });
  installApplicationMenu();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('before-quit', (event) => {
  stopAgentPolling();
  stopSideChatSelectionMonitor();
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
