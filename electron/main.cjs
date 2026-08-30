const { app, BrowserWindow, WebContentsView, desktopCapturer, dialog, ipcMain, Menu, Notification, safeStorage, screen, session, shell, Tray } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { GitChangeReviewer } = require('./change-review.cjs');
const { ReviewScopes } = require('./review-scopes.cjs');
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
const { extractWikiSessionCandidates, selectCaptureCandidate } = require('./wiki-center.cjs');
const {
  DshHistorySelectionCatalog,
  prepareDshHistorySource
} = require('./wiki-history-ingest.cjs');
const {
  MANIFEST_NAME: SUPPORT_BACKUP_MANIFEST,
  collectSupportBackupFiles,
  createRedactedDiagnosticReport,
  createSupportBackup,
  validateSupportBackup
} = require('./support-backup.cjs');
const { ProfileBundleManager } = require('./profile-bundle-manager.cjs');
const {
  captureHarnessCheckpointLink,
  forkHarnessCheckpointSession
} = require('./harness-checkpoint-link.cjs');
const {
  HARNESS_VERSION,
  HarnessSupervisor,
  createAuthenticatedHarnessFetch,
  establishHarnessSession,
  isSafeHarnessUrl,
  parseHarnessCookie,
  resolveHarnessRuntimePaths
} = require('./harness-supervisor.cjs');
const { captureFrameOwner, isFrameOwner, isTrustedMainFrameEvent } = require('./ipc-policy.cjs');
const {
  callHarnessApi,
  readHarnessSessionSelection,
  isSessionId,
  pathKey,
  selectHarnessSession,
  synchronizeHarnessWorkspace,
  waitForHarnessSessionSelection
} = require('./harness-workspace-sync.cjs');
const {
  ReliableInterruptController,
  ReliableInterruptError,
  readHarnessQueueSnapshotFromWebContents
} = require('./harness-reliable-interrupt.cjs');
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
const { GitDeliveryError, GitDeliveryManager, normalizeCommitMessage } = require('./git-delivery.cjs');
const {
  UpdatePreferenceStore,
  checkForProductUpdate,
  selectLatestProductRelease
} = require('./release-update.cjs');
const {
  AgentTransitionTracker,
  isBackgroundSupervisionRequired,
  trayStatusLabel
} = require('./tray-supervision.cjs');
const { WorkspaceFiles, WorkspaceFilesError } = require('./workspace-files.cjs');
const { WorkspaceStore } = require('./workspace-store.cjs');
const { SideChatController, SideChatError } = require('./side-chat.cjs');
const { DocumentIntakeController } = require('./document-intake-controller.cjs');
const { contextKey } = require('./document-intake-controller.cjs');
const { createDesktopCredentialHost } = require('./desktop-credential-host.cjs');
const { NativeWorkbenchDock } = require('./native-workbench-dock.cjs');
const { DockLayoutStore, TOOLS: DOCK_TOOLS } = require('./dock-layout.cjs');
const { TerminalReadBroker } = require('./terminal-read-broker.cjs');
const { SessionContinuityStore } = require('./session-continuity-store.cjs');

app.commandLine.appendSwitch('lang', 'zh-CN');
app.setName('DSH Desktop');

let mainWindow;
let nativeDock;
let dockLayoutStore;
let continuityStorePromise;
const draftWriteGrants = new Map();
const getContinuityStore = () => continuityStorePromise ||= (async () => {
  const store = new SessionContinuityStore(path.join(app.getPath('userData'), 'session-continuity.json')); await store.init(); return store;
})();
let terminalWindow;
let contextSourcesWindow;
let pluginHealthWindow;
let officeCenterWindow;
let wikiCenterWindow;
let worktreesWindow;
let tasksSubagentsWindow;
let sideChatWindow;
let gitDeliveryWindow;
let appTray;
let supervisor;
let workspaceStore;
let workbenchStore;
let proxyStore;
let changeReviewer;
let reviewScopes;
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
let gitDeliveryManager;
let updatePreferenceStore;
let reliableInterruptController;
let pluginRecoveryOutcomes = Object.freeze([]);
let pluginTogglePromise = null;
let pluginInstallPromise = null;
let worktreeOperationPromise = null;
let tasksSubagentsOperationPromise = null;
let sideChatOperationPromise = null;
let supportBackupOperationPromise = null;
let gitDeliveryOperationPromise = null;
let updateCheckPromise = null;
let sideChatSelectionTimer;
let sideChatPartitionSession;
let sideChatMainLayout;
let dataRoot;
let harnessRuntimePaths;
let wikiRuntime;
let wikiSettingsStore;
const dshHistorySelectionCatalog = new DshHistorySelectionCatalog();
let dshHistoryExpiryTimer;
let harnessOrigin = null;
let harnessAuthCookie = null;
let harnessSelectionIntent = null;
const harnessSelectionTrace = [];
let harnessFetch = null;
let harnessProxyEnvironment = Object.freeze({});
let allowQuit = false;
let loadFailureHandled = false;
let agentPollTimer;
const agentTransitionTracker = new AgentTransitionTracker();
const activeNotifications = new Set();
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
  reviewState: reason === 'no-change' ? 'clean' : reason,
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
const wikiCenterPage = path.join(rootDir, 'wiki-center.html');
const worktreesPage = path.join(rootDir, 'worktrees.html');
const tasksSubagentsPage = path.join(rootDir, 'tasks-subagents.html');
const gitDeliveryPage = path.join(rootDir, 'git-delivery.html');
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
const harnessReliableInterruptScriptPath = path.join(rootDir, 'assets', 'harness-reliable-interrupt.js');
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
let harnessReliableInterruptScript = '';
const desktopSmokeTarget = process.argv.find((argument) => argument.startsWith('--smoke-test-file='));
const harnessSmokeTarget = process.argv.find((argument) => argument.startsWith('--harness-smoke-file='));
const documentIntakeSmokeTarget = process.argv.find((argument) => argument.startsWith('--document-intake-smoke-file='));
const reviewSmokeTarget = process.argv.find((argument) => argument.startsWith('--review-smoke-file='));
const dockSmokeTarget = process.argv.find((argument) => argument.startsWith('--dock-smoke-file='));
const continuitySmokeTarget = process.argv.find((argument) => argument.startsWith('--continuity-smoke-file='));
const handoffSmokeTarget = process.argv.find((argument) => argument.startsWith('--handoff-smoke-file='));
const credentialAgentSmokeTarget = process.argv.find((argument) => argument.startsWith('--credential-agent-smoke-file='));
const ipcSecuritySmokeTarget = process.argv.find((argument) => argument.startsWith('--ipc-security-smoke-file='));
const pdfSmokeTarget = process.argv.find((argument) => argument.startsWith('--pdf-smoke-file='));
const contextSourcesSmokeTarget = process.argv.find((argument) => argument.startsWith('--context-sources-smoke-file='));
const pluginHealthSmokeTarget = process.argv.find((argument) => argument.startsWith('--plugin-health-smoke-file='));
const officeCenterSmokeTarget = process.argv.find((argument) => argument.startsWith('--office-center-smoke-file='));
const wikiCenterSmokeTarget = process.argv.find((argument) => argument.startsWith('--wiki-center-smoke-file='));
const worktreesSmokeTarget = process.argv.find((argument) => argument.startsWith('--worktrees-smoke-file='));
const tasksSubagentsSmokeTarget = process.argv.find((argument) => argument.startsWith('--tasks-subagents-smoke-file='));
const sideChatSmokeTarget = process.argv.find((argument) => argument.startsWith('--side-chat-smoke-file='));
const supportSmokeTarget = process.argv.find((argument) => argument.startsWith('--support-smoke-file='));
const gitDeliverySmokeTarget = process.argv.find((argument) => argument.startsWith('--git-delivery-smoke-file='));
const traySmokeTarget = process.argv.find((argument) => argument.startsWith('--tray-smoke-file='));
const commandFeedbackSmokeTarget = process.argv.find((argument) => argument.startsWith('--command-feedback-smoke-file='));
const windowSizeSmokeTarget = process.argv.find((argument) => argument.startsWith('--smoke-window-size='));
const isolatedSmokeTarget = [
  desktopSmokeTarget,
  harnessSmokeTarget,
  documentIntakeSmokeTarget,
  reviewSmokeTarget,
  dockSmokeTarget,
  continuitySmokeTarget,
  handoffSmokeTarget,
  credentialAgentSmokeTarget,
  ipcSecuritySmokeTarget,
  pdfSmokeTarget,
  contextSourcesSmokeTarget,
  pluginHealthSmokeTarget,
  officeCenterSmokeTarget,
  wikiCenterSmokeTarget,
  worktreesSmokeTarget,
  tasksSubagentsSmokeTarget,
  sideChatSmokeTarget,
  supportSmokeTarget,
  gitDeliverySmokeTarget,
  traySmokeTarget,
  commandFeedbackSmokeTarget
].find(Boolean);
if (isolatedSmokeTarget) {
  const outputPath = isolatedSmokeTarget.slice(isolatedSmokeTarget.indexOf('=') + 1);
  app.setPath('userData', `${path.resolve(outputPath)}.user-data`);
  const source = process.argv.find((argument) => argument.startsWith('--smoke-credential-source='))?.slice('--smoke-credential-source='.length);
  if (source && path.basename(source) === '.credentials.dpapi.json') {
    if (!path.isAbsolute(source) || fs.lstatSync(source).isSymbolicLink()) throw new Error('加密测试凭据源无效。');
    const profile = path.dirname(path.dirname(source));
    const localState = path.join(profile, 'Local State');
    if (!fs.lstatSync(localState).isFile() || fs.lstatSync(localState).isSymbolicLink()) throw new Error('缺少加密配置所属的 Chromium 状态。');
    const target = app.getPath('userData');
    fs.mkdirSync(path.join(target, 'harness'), { recursive: true });
    fs.copyFileSync(localState, path.join(target, 'Local State'), fs.constants.COPYFILE_EXCL);
    fs.copyFileSync(source, path.join(target, 'harness', '.credentials.dpapi.json'), fs.constants.COPYFILE_EXCL);
  }
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
    wikiConfigPath: path.join(dataRoot, 'wiki-settings.json'),
    wikiHistorySourcePath: path.join(dataRoot, 'wiki-history-source.json'),
    launchDir,
    logFile: path.join(dataRoot, 'logs', 'harness.log'),
    env: harnessProxyEnvironment,
    createCredentialHost: (options) => createDesktopCredentialHost({ ...options, rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, crypto: safeStorage, terminalReadBroker })
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
const wikiCenterUrlAllowed = (value) => localFileUrlMatches(value, wikiCenterPage);
const worktreesUrlAllowed = (value) => localFileUrlMatches(value, worktreesPage);
const tasksSubagentsUrlAllowed = (value) => localFileUrlMatches(value, tasksSubagentsPage);
const gitDeliveryUrlAllowed = (value) => localFileUrlMatches(value, gitDeliveryPage);

const showStatusPage = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = mainWindow.webContents.getURL();
  if (!current.endsWith('/harness-status.html')) await mainWindow.loadFile(statusPage);
};

const clearHarnessAuthentication = () => {
  harnessAuthCookie = null;
  harnessFetch = null;
};

const authenticatedHarnessApi = (origin, method, payload, options = {}) => {
  if (!harnessFetch) throw new Error('Harness 本地认证尚未就绪。');
  return callHarnessApi(origin, method, payload, { ...options, fetchImpl: harnessFetch });
};

const authenticatedHarnessRemote = (origin, namespace, method, args = {}, options = {}) => {
  if (!harnessFetch) throw new Error('Harness 本地认证尚未就绪。');
  return callHarnessRemote(origin, namespace, method, args, { ...options, fetchImpl: harnessFetch });
};

const installHarnessCookie = async (targetSession) => {
  const cookie = parseHarnessCookie(harnessAuthCookie?.header);
  if (!targetSession?.cookies || !harnessOrigin || !cookie) throw new Error('Harness 本地认证会话无效。');
  await targetSession.cookies.set({
    url: harnessOrigin,
    name: cookie.name,
    value: cookie.value,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: false
  });
};

const waitForInitialHarnessSelection = async (webContents, { timeoutMs = 8000, intervalMs = 100 } = {}) => {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const sessionId = await readHarnessSessionSelection(webContents);
      if (sessionId) return sessionId;
    } catch {
      // The freshly loaded page may not have initialized its local storage yet.
    }
    if (Date.now() >= deadline) return '';
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
};

const flushComposerDraft = async () => {
  if (!mainWindow || mainWindow.isDestroyed() || !harnessUiReady()) return;
  await mainWindow.webContents.executeJavaScript('window.__DSH_CONTINUITY__?.flush()', true);
};
const startHarnessForWindow = async ({ restart = false, preferredSessionId = '' } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: '窗口不可用。' };
  await flushComposerDraft();
  if (sideChatOperationPromise) await sideChatOperationPromise;
  closeSideChatWindow();
  stopAgentPolling();
  harnessOrigin = null;
  clearHarnessAuthentication();
  loadFailureHandled = false;
  agentDiagnostics = unavailableAgentDiagnostics();
  changeReviewDiagnostics = emptyChangeReviewDiagnostics();
  workspaceSyncDiagnostics = unavailableWorkspaceSync('syncing');
  installApplicationMenu();
  await showStatusPage();
  try {
    const url = restart ? await supervisor.restart() : await supervisor.start();
    const authentication = await establishHarnessSession(url);
    if (!isSafeHarnessUrl(authentication.origin)) throw new Error('Harness 地址未通过回环安全校验。');
    harnessOrigin = authentication.origin;
    harnessAuthCookie = authentication.cookie;
    harnessFetch = createAuthenticatedHarnessFetch({ origin: harnessOrigin, cookie: harnessAuthCookie });
    await supervisor.credentialHost?.verifyReady(harnessOrigin, harnessFetch);
    await installHarnessCookie(mainWindow.webContents.session);
    await mainWindow.loadURL(harnessOrigin);
    const selectedSessionId = isSessionId(preferredSessionId) ? preferredSessionId : await waitForInitialHarnessSelection(mainWindow.webContents);
    const workspace = getWorkspaceState();
    workspaceSyncDiagnostics = await synchronizeHarnessWorkspace({
      origin: harnessOrigin,
      workspacePath: workspace.activePath,
      fallbackTitle: workspace.isFallback ? 'DSH 临时工作区' : undefined,
      selectedSessionId,
      fetchImpl: harnessFetch
    });
    const selection = await selectHarnessSession(mainWindow.webContents, workspaceSyncDiagnostics.sessionId);
    if (selection.changed) {
      harnessSelectionIntent = { sessionId: workspaceSyncDiagnostics.sessionId, expires: Date.now() + 15000 };
      await mainWindow.loadURL(harnessOrigin);
      await waitForHarnessSessionSelection(mainWindow.webContents, workspaceSyncDiagnostics.sessionId);
    }
    void refreshDesktopDiagnostics();
    if (nativeDock && dockLayoutStore.getState().open) await openDockTool(dockLayoutStore.getState().active);
    startAgentPolling();
    return { ok: true, url };
  } catch (error) {
    if (isolatedSmokeTarget) {
      const listing = harnessOrigin ? await authenticatedHarnessApi(harnessOrigin, 'session.list', {}).catch(() => null) : null;
      await fsp.writeFile(`${path.resolve(isolatedSmokeTarget.slice(isolatedSmokeTarget.indexOf('=') + 1))}.selection.json`, JSON.stringify({
        error: error.message, expected: workspaceSyncDiagnostics.sessionId, selected: await readHarnessSessionSelection(mainWindow.webContents).catch(() => ''),
        intentPending: Boolean(harnessSelectionIntent), trace: harnessSelectionTrace,
        sessions: listing?.items?.map((item) => ({ sessionId: item.sessionId, cwd: item.cwd, origin: item.origin, blank: item.blank, running: item.running }))
      }, null, 2)).catch(() => {});
    }
    harnessSelectionIntent = null;
    workspaceSyncDiagnostics = unavailableWorkspaceSync('failed', error.message);
    harnessOrigin = null;
    clearHarnessAuthentication();
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
    credentialFile: path.join(harnessDataRoot, '.credentials.yaml'),
    protectedStatus: supervisor?.credentialHost?.status()
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
  if (!mainWindow || mainWindow.isDestroyed() || !currentUrlAllowed(mainWindow.webContents.getURL())) return false;
  return Boolean(await mainWindow.webContents.executeJavaScript('Boolean(window.__DSH_NETWORK__?.open?.())', true));
};

const runVisibleDesktopAction = async (title, action) => {
  try {
    const result = await action();
    if (result === false || (result?.ok === false && !result?.canceled)) {
      throw new Error(result?.message || `${title}入口当前不可用。`);
    }
    return result;
  } catch (error) {
    const detail = String(error?.message || error || `${title}入口当前不可用。`)
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 400);
    const response = await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: `${title}未执行`,
      message: '入口未成功打开。',
      detail: `${detail || '入口当前不可用。'}\n\n可以重试；若问题与连接有关，可从“模型 → 网络与代理设置”恢复。`,
      buttons: ['重试', '确定'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (response.response === 0) return runVisibleDesktopAction(title, action);
    return false;
  }
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
  const documentsCss = await fsp.readFile(path.join(rootDir, 'assets', 'document-intake.css'), 'utf8');
  const documentsScript = await fsp.readFile(path.join(rootDir, 'assets', 'document-intake.js'), 'utf8');
  const composerTextScript = await fsp.readFile(path.join(rootDir, 'assets', 'composer-text-bridge.js'), 'utf8');
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
  if (!harnessReliableInterruptScript) harnessReliableInterruptScript = await fsp.readFile(harnessReliableInterruptScriptPath, 'utf8');
  return {
    css: `${workbenchPanelCss}\n${workbenchFilesCss}\n${workbenchPreviewCss}\n${workbenchCommandCss}\n${workbenchCheckpointCss}\n${workbenchNetworkCss}\n${documentsCss}`,
    documentsScript,
    composerTextScript,
    reviewScript: workbenchPanelScript,
    filesScript: workbenchFilesScript,
    previewScript: workbenchPreviewScript,
    checkpointScript: workbenchCheckpointScript,
    networkScript: workbenchNetworkScript,
    commandScript: workbenchCommandScript,
    localizationScript: harnessLocalizationScript,
    reliableInterruptScript: harnessReliableInterruptScript
  };
};

const installReliableInterrupt = async (assets) => Boolean(
  await mainWindow.webContents.executeJavaScript(assets.reliableInterruptScript, true)
);

const installWorkbenchPanel = async () => {
  if (!harnessUiReady()) return false;
  try {
    await fitWorkbenchSidePanels();
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
    const reliableInterruptInstalled = await installReliableInterrupt(assets);
    await mainWindow.webContents.executeJavaScript(assets.composerTextScript, true);
    const documentsInstalled = Boolean(await mainWindow.webContents.executeJavaScript(assets.documentsScript, true));
    await mainWindow.webContents.executeJavaScript(await fsp.readFile(path.join(rootDir, 'assets', 'session-continuity.js'), 'utf8'), true);
    await mainWindow.webContents.executeJavaScript(await fsp.readFile(path.join(rootDir, 'assets', 'session-workflow.js'), 'utf8'), true);
    if (nativeDock) { await mainWindow.webContents.insertCSS(await fsp.readFile(path.join(rootDir, 'assets', 'workbench-native-layout.css'), 'utf8')); nativeDock.layout(); }
    return localizationInstalled && reviewInstalled && previewInstalled && filesInstalled && checkpointInstalled
      && networkInstalled && commandInstalled && reliableInterruptInstalled && documentsInstalled;
  } catch {
    return false;
  }
};

const applyWorkbenchPanelLayout = async ({ focus = false, focusTarget = 'review' } = {}) => {
  if (!harnessUiReady()) return false;
  await fitWorkbenchSidePanels(focusTarget);
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
  await workbenchStore.setReviewPanelOpen(Boolean(open));
  await fitWorkbenchSidePanels('review');
  const state = getWorkbenchState();
  await persistProjectPanels();
  installApplicationMenu();
  if (harnessUiReady()) {
    const applied = await applyWorkbenchPanelLayout({ focus: focus && state.reviewPanelOpen });
    if (!applied) await installWorkbenchPanel();
  }
  return state;
};

const setReviewPanelWidth = async (width) => {
  const state = await workbenchStore.setReviewPanelWidth(width);
  await persistProjectPanels();
  if (harnessUiReady()) await applyWorkbenchPanelLayout();
  return state;
};

const setFilePanelOpen = async (open, { focus = false } = {}) => {
  await workbenchStore.setFilePanelOpen(Boolean(open));
  await fitWorkbenchSidePanels('files');
  const state = getWorkbenchState();
  await persistProjectPanels();
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
  await persistProjectPanels();
  if (harnessUiReady()) await applyWorkbenchPanelLayout();
  return state;
};

const setPreviewPanelOpen = async (open, { focus = false, stopOnClose = true } = {}) => {
  const nextOpen = Boolean(open);
  if (!nextOpen && stopOnClose) await previewManager?.stop();
  const state = await workbenchStore.setPreviewPanelOpen(nextOpen);
  await persistProjectPanels();
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
  nativeDock?.layout();
  if (nativeDock && harnessUiReady()) void applyWorkbenchPanelLayout().catch(() => {});
  return true;
};

const setUiZoomFactor = async (factor) => {
  const state = await workbenchStore.setUiZoomFactor(factor);
  await persistProjectPanels();
  applyUiZoomFactor(state.uiZoomFactor);
  installApplicationMenu();
  return state;
};

const adjustUiZoomFactor = (delta) => setUiZoomFactor(getWorkbenchState().uiZoomFactor + delta);

const resetWorkbenchLayout = async () => {
  if (getWorkbenchState().previewPanelOpen) await previewManager?.stop();
  const state = await workbenchStore.resetLayout();
  if (dockLayoutStore) await dockLayoutStore.update({ open: false, active: 'terminal', height: 330, panels: state });
  nativeDock?.layout();
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
    publishCheckpointState({ ...checkpointManager.getState(), status: 'creating', requestSource: source });
    let sessionLink = null;
    try {
      if (harnessUiReady()) {
        sessionLink = await captureHarnessCheckpointLink({
          origin: harnessOrigin,
          webContents: mainWindow.webContents,
          workspacePath: getWorkspaceState().activePath,
          apiCall: authenticatedHarnessApi
        });
      }
    } catch {
      // Conversation linkage is fail-soft; it must never prevent the code checkpoint or prompt.
    }
    const pending = checkpointManager.create({ source, sessionLink });
    publishCheckpointState({ ...checkpointManager.getState(), requestSource: source });
    return publishCheckpointState({ ...(await pending), requestSource: source });
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
      atSeq: anchor.atSeq,
      apiCall: authenticatedHarnessApi
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
ipcMain.on('harness:take-selection-intent', (event) => {
  if (isolatedSmokeTarget && harnessSelectionTrace.length < 30) harnessSelectionTrace.push({ intent: Boolean(harnessSelectionIntent), frameOrigin: (() => { try { return new URL(event.senderFrame.url).origin; } catch { return ''; } })(), trusted: isTrustedMainFrameEvent(event, mainWindow?.webContents, currentUrlAllowed) });
  if (!harnessOrigin || !isTrustedMainFrameEvent(event, mainWindow?.webContents, (value) => { try { return new URL(value).origin === harnessOrigin; } catch { return false; } })) { event.returnValue = null; return; }
  const intent = harnessSelectionIntent; harnessSelectionIntent = null;
  // sendSync replies on assignment: assigning a default first would consume
  // the one-shot intent while returning null to the preload.
  event.returnValue = intent && intent.expires >= Date.now() && isSessionId(intent.sessionId) ? intent.sessionId : null;
});
const documentIntakeController = new DocumentIntakeController({
  getPersistence: getContinuityStore,
  getContext: async () => {
    if (!harnessUiReady()) throw new Error('请等待工作区连接完成后添加文件。');
    const workspacePath = getWorkspaceState().activePath;
    if (!workspacePath) throw new Error('请先选择工作区。');
    const sessionId = await readHarnessSessionSelection(mainWindow.webContents);
    if (sessionId) {
      const listing = await authenticatedHarnessApi(harnessOrigin, 'session.list', {});
      const selected = listing.items?.find((item) => item.sessionId === sessionId);
      if (!selected || selected.origin === 'subagent' || pathKey(selected.cwd) !== pathKey(workspacePath)) {
        throw new Error('当前会话与工作区尚未同步，请等待同步后重试。');
      }
    }
    return { workspacePath, sessionId };
  },
  chooseFiles: async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '添加参考资料（外部文件复制到工作区，原文件不修改）',
      buttonLabel: '选择并添加', properties: ['openFile', 'multiSelections'],
      filters: [{ name: '文档与表格', extensions: ['xlsx', 'docx', 'pdf', 'pptx', 'csv', 'txt', 'md'] }]
    });
    return result.canceled ? [] : result.filePaths;
  },
  confirmImport: async (paths, context) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: '确认添加参考资料', message: `将 ${paths.length} 个文件添加到当前工作区？`,
      detail: `${paths.map((value) => path.basename(value)).join('\n')}\n\n工作区：${context.workspacePath}\n外部文件将复制到工作区；原文件不修改。发送后，文件内容可交由模型处理。`,
      buttons: ['取消', '添加文件'], defaultId: 0, cancelId: 0, noLink: true
    });
    return result.response === 1;
  }
});
const terminalIpcAllowed = (event) => isTrustedMainFrameEvent(event, terminalWindow?.webContents, terminalUrlAllowed);
ipcMain.handle('drafts:get-state', async (event) => {
  if (!harnessIpcAllowed(event)) throw new Error('草稿来源未通过校验。');
  const context = await documentIntakeController.getContext(), key = contextKey(context);
  if (!isSessionId(context.sessionId)) throw new Error('请等待当前会话就绪后恢复草稿。');
  const row = (await getContinuityStore()).read(key);
  const token = require('node:crypto').randomUUID();
  draftWriteGrants.set(token, { key, sender: event.sender, expires: Date.now() + 120000 });
  while (draftWriteGrants.size > 100) draftWriteGrants.delete(draftWriteGrants.keys().next().value);
  return { ...row, context: key, token, sessionId: context.sessionId, workspacePath: context.workspacePath };
});
ipcMain.handle('drafts:save', async (event, request) => {
  if (!harnessIpcAllowed(event)) throw new Error('草稿来源未通过校验。');
  const grant = draftWriteGrants.get(request?.token);
  if (!grant || grant.sender !== event.sender || grant.expires < Date.now() || request?.context !== grant.key) throw new Error('草稿会话已过期，请重新打开当前会话。');
  // A short-lived grant may finish an outgoing session's already captured draft after a UI switch.
  const row = await (await getContinuityStore()).saveDraft(grant.key, request.text, request.revision);
  return { context: grant.key, revision: row.revision, updatedAt: row.updatedAt };
});
const nativeParent = (surface) => surface?.getDialogParent?.() || surface || mainWindow;
const terminalReadBroker = new TerminalReadBroker({
  getContext: () => documentIntakeController.getContext(),
  getSnapshot: () => terminalRunner?.getSnapshot(),
  redact: (text) => supervisor?.credentialHost?.redact(text) || '',
  confirm: async ({ preview, chars, workspacePath }, signal) => (await dialog.showMessageBox(mainWindow, {
    type: 'question', title: '允许 AI 读取当前终端输出？',
    message: `将最近 ${chars} 个字符交给当前会话的模型？`,
    detail: `工作区：${workspacePath}\n只读，不会执行命令，不读取剪贴板。已尽量遮蔽已知凭据，请确认下面没有敏感业务数据：\n\n${preview}`,
    buttons: ['取消', '允许本次读取'], defaultId: 0, cancelId: 0, noLink: true, signal
  })).response === 1
});
const createToolSurface = (id, options) => nativeDock ? nativeDock.create(id, options) : new BrowserWindow(options);
const persistProjectPanels = () => dockLayoutStore?.update({ panels: getWorkbenchState() }) || Promise.resolve();
const fitWorkbenchSidePanels = async (preferred = 'review') => {
  if (!nativeDock || !mainWindow || mainWindow.isDestroyed() || !workbenchStore) return;
  const state = getWorkbenchState();
  const available = mainWindow.getContentSize()[0] / mainWindow.webContents.getZoomFactor();
  if (state.filePanelOpen && state.reviewPanelOpen && available < state.filePanelWidth + state.reviewPanelWidth + 560) {
    await workbenchStore.applyProjectLayout({ ...state, ...(preferred === 'files' ? { reviewPanelOpen: false } : { filePanelOpen: false }) });
    await persistProjectPanels();
  }
};
const openDockTool = async (id) => {
  if (!DOCK_TOOLS.includes(id)) throw new Error('未知工作台工具。');
  const actions = { terminal: openTerminalWindow, office: openOfficeCenterWindow, tasks: openTasksSubagentsWindow,
    extensions: openPluginHealthWindow, wiki: openWikiCenterWindow, worktrees: openWorktreesWindow };
  return actions[id]();
};
const ensureNativeDock = async () => {
  if (nativeDock || !mainWindow || mainWindow.isDestroyed()) return nativeDock;
  dockLayoutStore = new DockLayoutStore(path.join(app.getPath('userData'), 'workbench-dock.json'));
  await dockLayoutStore.init(); dockLayoutStore.activate(getWorkspaceState().activePath);
  if (dockLayoutStore.getPanels()) { await workbenchStore.applyProjectLayout(dockLayoutStore.getPanels()); applyUiZoomFactor(); }
  nativeDock = new NativeWorkbenchDock({ window: mainWindow, WebContentsView, BrowserWindow, rootDir, store: dockLayoutStore,
    surfaceCss: await fsp.readFile(path.join(rootDir, 'assets', 'docked-surfaces.css'), 'utf8'),
    onSelect: openDockTool,
    onPanel: async (id) => {
      if (!harnessUiReady()) throw new Error('请等待工作区连接完成。');
      const state = getWorkbenchState();
      if (id === 'files') return setFilePanelOpen(!state.filePanelOpen, { focus: true });
      if (id === 'review') return setReviewPanelOpen(!state.reviewPanelOpen, { focus: true });
      if (id === 'preview') return setPreviewPanelOpen(!state.previewPanelOpen, { focus: true });
      throw new Error('未知工作台面板。');
    }
  });
  await nativeDock.init();
  mainWindow.on('resize', () => { if (harnessUiReady()) void applyWorkbenchPanelLayout().catch(() => {}); });
  return nativeDock;
};
const dockIpcAllowed = (event) => isTrustedMainFrameEvent(event, nativeDock?.bar?.webContents, (url) => localFileUrlMatches(url, path.join(rootDir, 'workbench-dock.html')));
ipcMain.handle('dock:get-state', (event) => { if (!dockIpcAllowed(event)) throw new Error('工作台来源未通过校验。'); return nativeDock.state(); });
ipcMain.handle('dock:act', (event, action, value) => { if (!dockIpcAllowed(event)) throw new Error('工作台来源未通过校验。'); return nativeDock.act(action, value); });
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
const wikiCenterIpcAllowed = (event) => isTrustedMainFrameEvent(
  event,
  wikiCenterWindow?.webContents,
  wikiCenterUrlAllowed
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
const gitDeliveryIpcAllowed = (event) => isTrustedMainFrameEvent(
  event,
  gitDeliveryWindow?.webContents,
  gitDeliveryUrlAllowed
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
  && left.reviewState === right.reviewState
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
      reviewState: list.reviewState,
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
  const parent = nativeParent(terminalWindow && !terminalWindow.isDestroyed() ? terminalWindow : mainWindow);
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
  const created = createToolSurface('terminal', {
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
    const inventory = await authenticatedHarnessRemote(harnessOrigin, 'pluginInventory', 'list', {}, { timeoutMs: 3000 });
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
  const created = createToolSurface('extensions', {
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
  appVersion: app.getVersion(),
  harnessReady: Boolean(officeCenterSmokeTarget) || harnessUiReady(),
  workspaceSynced: workspaceSyncDiagnostics.status === 'synced',
  workspaceName: workspaceStore?.getState()?.displayName || '当前工作区'
});

const createOfficeCenterWindow = async () => {
  const created = createToolSurface('office', {
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

const WIKI_SKILLS = Object.freeze([
  Object.freeze({ id: 'llm-wiki', name: 'Wiki 基础结构' }),
  Object.freeze({ id: 'wiki-setup', name: '知识库初始化' }),
  Object.freeze({ id: 'wiki-query', name: '知识查询' }),
  Object.freeze({ id: 'wiki-capture', name: '会话结论保存' }),
  Object.freeze({ id: 'wiki-update', name: '项目增量同步' }),
  Object.freeze({ id: 'wiki-history-ingest', name: 'DSH 历史批量导入' })
]);

const inspectWikiSkills = async () => Promise.all(WIKI_SKILLS.map(async (skill) => {
  const skillFile = harnessRuntimePaths?.bundledSkillDir
    ? path.join(harnessRuntimePaths.bundledSkillDir, skill.id, 'SKILL.md')
    : '';
  try {
    const info = await fsp.lstat(skillFile);
    return { ...skill, status: info.isFile() && !info.isSymbolicLink() ? 'ready' : 'missing' };
  } catch {
    return { ...skill, status: 'missing' };
  }
}));

const unavailableWikiCenterState = (message = 'Wiki 中心尚未完成初始化。') => ({
  available: false,
  vault: { configured: false, ready: false, status: 'unconfigured', vaultPath: '', missing: [], pageCount: 0, message },
  skills: WIKI_SKILLS.map((skill) => ({ ...skill, status: 'missing' })),
  harness: { status: 'waiting' },
  session: { available: false },
  project: { available: false, status: 'waiting', name: '', path: '' },
  history: { available: false, status: 'waiting' }
});

const getWikiCenterState = async () => {
  if (!wikiRuntime || !wikiSettingsStore) return unavailableWikiCenterState();
  const settings = wikiSettingsStore.getState();
  const [vaultState, skills] = await Promise.all([
    wikiRuntime.inspectWikiVault(settings.vaultPath),
    inspectWikiSkills()
  ]);
  const vault = { ...vaultState, ready: vaultState.status === 'ready' };
  const harnessReady = Boolean(wikiCenterSmokeTarget) || harnessUiReady();
  const sessionAvailable = harnessReady
    && workspaceSyncDiagnostics.status === 'synced'
    && isSessionId(workspaceSyncDiagnostics.sessionId)
    && agentDiagnostics.status === 'ready'
    && !agentDiagnostics.canStop
    && agentDiagnostics.pendingCount === 0
    && agentDiagnostics.queuedCount === 0;
  const projectAvailable = vault.ready && typeof getWorkspaceState().activePath === 'string' && path.isAbsolute(getWorkspaceState().activePath);
  return {
    available: vault.ready && skills.every((skill) => skill.status === 'ready'),
    vault,
    skills,
    harness: { status: harnessReady ? 'ready' : 'waiting' },
    session: { available: sessionAvailable },
    project: {
      available: projectAvailable,
      status: vault.ready ? 'ready' : 'waiting',
      name: getWorkspaceState().displayName || '',
      path: getWorkspaceState().activePath || ''
    },
    history: {
      available: projectAvailable && harnessReady,
      status: projectAvailable && harnessReady ? 'ready' : 'waiting'
    }
  };
};

const createWikiCenterWindow = async () => {
  const created = createToolSurface('wiki', {
    width: 1080,
    height: 820,
    minWidth: 760,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#151618',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH Wiki 中心',
    webPreferences: {
      preload: path.join(__dirname, 'wiki-center-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  wikiCenterWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!wikiCenterUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.once('ready-to-show', () => {
    if (!wikiCenterSmokeTarget) created.show();
  });
  created.on('closed', () => {
    if (wikiCenterWindow === created) wikiCenterWindow = undefined;
  });
  await created.loadFile(wikiCenterPage);
  return created;
};

const openWikiCenterWindow = async () => {
  if (wikiCenterWindow && !wikiCenterWindow.isDestroyed()) {
    if (wikiCenterWindow.isMinimized()) wikiCenterWindow.restore();
    wikiCenterWindow.show();
    wikiCenterWindow.focus();
    return { ok: true, reused: true };
  }
  await createWikiCenterWindow();
  return { ok: true, reused: false };
};

const chooseWikiVault = async () => {
  if (!wikiSettingsStore) return { ok: false, message: 'Wiki 设置存储不可用。' };
  const selected = await dialog.showOpenDialog(nativeParent(wikiCenterWindow), {
    title: '选择本地 Wiki 知识库目录',
    buttonLabel: '使用此目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, message: '未更改知识库。' };
  try {
    await wikiSettingsStore.setVault(selected.filePaths[0]);
    return { ok: true, state: await getWikiCenterState(), message: '已选择知识库；如结构不完整，请执行初始化。' };
  } catch (error) {
    return { ok: false, message: error?.message || '无法使用所选目录。', state: await getWikiCenterState() };
  }
};

const initializeSelectedWikiVault = async () => {
  const vaultPath = wikiSettingsStore?.getState()?.vaultPath;
  if (!wikiRuntime || !vaultPath) return { ok: false, message: '请先选择知识库目录。', state: await getWikiCenterState() };
  const confirmation = await dialog.showMessageBox(nativeParent(wikiCenterWindow), {
    type: 'question',
    title: '初始化 Wiki 知识库',
    message: '只创建缺失的基础目录和文件，继续吗？',
    detail: `目标：${vaultPath}\n\n不会覆盖已有页面，不要求 Git，也不会读取或复制其他会话历史。`,
    buttons: ['初始化缺失结构', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  });
  if (confirmation.response !== 0) return { ok: false, canceled: true, message: '知识库未改变。', state: await getWikiCenterState() };
  try {
    const initialized = await wikiRuntime.initializeWikiVault(vaultPath);
    return {
      ok: true,
      message: `初始化完成：新建 ${initialized.created.length} 项，保留 ${initialized.preserved.length} 项。`,
      state: await getWikiCenterState()
    };
  } catch (error) {
    return { ok: false, message: error?.message || '知识库初始化失败。', state: await getWikiCenterState() };
  }
};

const querySelectedWiki = async (query) => {
  if (typeof query !== 'string' || query.length > 300) return { ok: false, message: 'Wiki 查询内容无效。', results: [] };
  const vaultPath = wikiSettingsStore?.getState()?.vaultPath;
  if (!wikiRuntime || !vaultPath) return { ok: false, message: '请先配置并初始化知识库。', results: [] };
  try {
    return await wikiRuntime.queryWiki(vaultPath, query, { limit: 8 });
  } catch (error) {
    return { ok: false, message: error?.message || 'Wiki 查询失败。', results: [] };
  }
};

const previewCurrentProjectWikiSync = async () => {
  const vaultPath = wikiSettingsStore?.getState()?.vaultPath;
  const workspacePath = getWorkspaceState().activePath;
  if (!wikiRuntime || !vaultPath) return { ok: false, message: '请先配置并初始化知识库。' };
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) return { ok: false, message: '当前工作区路径不可用。' };
  try {
    const preview = await wikiRuntime.previewProjectSync(vaultPath, workspacePath);
    return {
      ok: true,
      project: preview.project,
      mode: preview.mode,
      unchanged: preview.unchanged,
      limited: preview.limited,
      scannedFiles: preview.scannedFiles,
      delta: {
        added: preview.delta.added.length,
        modified: preview.delta.modified.length,
        removed: preview.delta.removed.length
      },
      existingPages: preview.existingPages.length,
      message: preview.unchanged
        ? '当前项目与上次同步清单一致。'
        : `发现 ${preview.delta.added.length} 个新增、${preview.delta.modified.length} 个修改、${preview.delta.removed.length} 个移除文件。`
    };
  } catch (error) {
    return { ok: false, message: error?.message || '当前项目增量检查失败。' };
  }
};

const invokeCurrentProjectWikiSync = async () => {
  const state = await getWikiCenterState();
  if (!state.vault?.ready) return { ok: false, message: '请先配置并初始化知识库。' };
  if (!state.project?.available) return { ok: false, message: '当前工作区不可用。' };
  if (wikiCenterWindow && !wikiCenterWindow.isDestroyed()) wikiCenterWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  const invoked = await invokeWikiSkill('wiki-update');
  return { ok: invoked, message: invoked ? '已在当前对话中加载 /wiki-update。' : '请在对话输入框中输入 /wiki-update。' };
};

const currentWikiHistorySourcePath = () => (
  typeof dataRoot === 'string' && path.isAbsolute(dataRoot)
    ? path.join(dataRoot, 'wiki-history-source.json')
    : ''
);

const discardPreparedDshHistorySource = async () => {
  if (dshHistoryExpiryTimer) clearTimeout(dshHistoryExpiryTimer);
  dshHistoryExpiryTimer = undefined;
  const sourcePath = currentWikiHistorySourcePath();
  if (!sourcePath) return false;
  return fsp.unlink(sourcePath).then(() => true, (error) => {
    if (error?.code === 'ENOENT') return false;
    throw error;
  });
};

const scheduleDshHistorySourceExpiry = (sourcePath, sourceToken, expiresAt) => {
  if (dshHistoryExpiryTimer) clearTimeout(dshHistoryExpiryTimer);
  const delay = Math.max(1000, Math.min(31 * 60 * 1000, Date.parse(expiresAt) - Date.now() + 1000));
  dshHistoryExpiryTimer = setTimeout(() => {
    dshHistoryExpiryTimer = undefined;
    void wikiRuntime?.clearDshHistorySource(sourcePath, sourceToken).catch(() => undefined);
  }, delay);
  dshHistoryExpiryTimer.unref?.();
};

const listDshHistorySessions = async () => {
  const state = await getWikiCenterState();
  const workspacePath = getWorkspaceState().activePath;
  if (!state.vault?.ready) return { ok: false, message: '请先配置并初始化知识库。', items: [] };
  if (!state.history?.available || !harnessOrigin) return { ok: false, message: '请等待 Harness 与当前工作区就绪。', items: [] };
  try {
    await discardPreparedDshHistorySource();
    const response = await authenticatedHarnessApi(harnessOrigin, 'session.list', {}, { timeoutMs: 5000 });
    const items = dshHistorySelectionCatalog.refresh(response?.items, workspacePath);
    return {
      ok: true,
      items,
      limit: 8,
      message: items.length > 0 ? `已找到 ${items.length} 个当前工作区的普通会话。` : '当前工作区没有可导入的普通会话。'
    };
  } catch {
    dshHistorySelectionCatalog.refresh([], '');
    return { ok: false, message: 'DSH 历史列表读取失败；原始会话没有改变。', items: [] };
  }
};

const prepareSelectedDshHistory = async (selection) => {
  const state = await getWikiCenterState();
  const vaultPath = wikiSettingsStore?.getState()?.vaultPath;
  const workspacePath = getWorkspaceState().activePath;
  const sourcePath = currentWikiHistorySourcePath();
  if (!state.vault?.ready || !vaultPath) return { ok: false, message: '请先配置并初始化知识库。' };
  if (!state.history?.available || !harnessOrigin || !sourcePath) return { ok: false, message: '请等待 Harness 与当前工作区就绪。' };
  let prepared;
  try {
    await discardPreparedDshHistorySource();
    const response = await authenticatedHarnessApi(harnessOrigin, 'session.list', {}, { timeoutMs: 5000 });
    const summaries = dshHistorySelectionCatalog.resolve(selection, response?.items, workspacePath);
    prepared = await prepareDshHistorySource({
      apiCall: authenticatedHarnessApi,
      origin: harnessOrigin,
      summaries,
      workspacePath,
      sourcePath
    });
    const preview = await wikiRuntime.previewDshHistoryIngest(vaultPath, workspacePath, sourcePath);
    scheduleDshHistorySourceExpiry(sourcePath, prepared.sourceToken, prepared.expiresAt);
    const result = {
      ok: true,
      unchanged: preview.unchanged,
      project: { id: preview.project.id, name: preview.project.name },
      sessionCount: preview.sessions.length,
      addedCount: preview.delta.added.length,
      modifiedCount: preview.delta.modified.length,
      unchangedCount: preview.delta.unchanged.length,
      totalMessages: preview.totalMessages,
      totalChars: preview.totalChars,
      limited: preview.limited,
      expiresAt: preview.expiresAt,
      redactions: preview.redactions.map(({ id, label, count }) => ({ id, label, count })),
      sessions: preview.sessions.map(({ title, messageCount, status, limited }) => ({ title, messageCount, status, limited }))
    };
    if (preview.unchanged) {
      await wikiRuntime.clearDshHistorySource(sourcePath, prepared.sourceToken);
      if (dshHistoryExpiryTimer) clearTimeout(dshHistoryExpiryTimer);
      dshHistoryExpiryTimer = undefined;
      return { ...result, message: '所选会话与上次成功导入一致，无需重复处理。' };
    }
    return { ...result, message: '历史范围已准备，可让 Agent 先整理、校验，再等待你的明确确认。' };
  } catch {
    if (prepared?.sourceToken) await wikiRuntime.clearDshHistorySource(sourcePath, prepared.sourceToken).catch(() => undefined);
    if (dshHistoryExpiryTimer) clearTimeout(dshHistoryExpiryTimer);
    dshHistoryExpiryTimer = undefined;
    return { ok: false, message: 'DSH 历史准备失败；请重新加载会话后再试，知识库没有被修改。' };
  }
};

const invokePreparedDshHistory = async () => {
  const vaultPath = wikiSettingsStore?.getState()?.vaultPath;
  const workspacePath = getWorkspaceState().activePath;
  const sourcePath = currentWikiHistorySourcePath();
  if (!wikiRuntime || !vaultPath || !sourcePath) return { ok: false, message: '请先在 Wiki 中心准备 DSH 历史。' };
  try {
    const preview = await wikiRuntime.previewDshHistoryIngest(vaultPath, workspacePath, sourcePath);
    if (preview.unchanged) {
      await wikiRuntime.clearDshHistorySource(sourcePath, preview.sourceToken);
      return { ok: false, message: '所选会话已导入，无需重复处理。' };
    }
  } catch {
    return { ok: false, message: '准备内容已失效，请重新选择 DSH 历史。' };
  }
  if (wikiCenterWindow && !wikiCenterWindow.isDestroyed()) wikiCenterWindow.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  const invoked = await invokeWikiSkill('wiki-history-ingest');
  return { ok: invoked, message: invoked ? '已在当前对话中加载 /wiki-history-ingest dsh。' : '请在对话输入框中输入 /wiki-history-ingest dsh。' };
};

const loadCurrentWikiCandidates = async ({ includeSessionId = false } = {}) => {
  if (!harnessUiReady() || workspaceSyncDiagnostics.status !== 'synced' || !isSessionId(workspaceSyncDiagnostics.sessionId)) {
    return { ok: false, message: '请等待当前 Harness 会话与工作区同步。', items: [] };
  }
  if (agentDiagnostics.status !== 'ready' || agentDiagnostics.canStop || agentDiagnostics.pendingCount > 0 || agentDiagnostics.queuedCount > 0) {
    return { ok: false, message: '当前会话仍在运行或等待确认，请完成后再读取结论。', items: [] };
  }
  try {
    const selected = await readHarnessSessionSelection(mainWindow?.webContents);
    if (!isSessionId(selected)) return { ok: false, message: '当前界面没有可读取的普通 Harness 会话。', items: [] };
    const sessionList = await authenticatedHarnessApi(harnessOrigin, 'session.list', {}, { timeoutMs: 5000 });
    const selectedSummary = Array.isArray(sessionList?.items)
      ? sessionList.items.find((item) => item?.sessionId === selected)
      : undefined;
    if (!selectedSummary
      || selectedSummary.origin === 'subagent'
      || typeof selectedSummary.cwd !== 'string'
      || pathKey(selectedSummary.cwd) !== pathKey(getWorkspaceState().activePath)) {
      return { ok: false, message: '当前会话不是这个工作区的普通 Harness 会话。', items: [] };
    }
    if (selectedSummary.running === true) return { ok: false, message: '当前会话仍在运行，请完成后再读取结论。', items: [] };
    const history = await authenticatedHarnessApi(harnessOrigin, 'session.history', {
      sessionId: selected,
      maxMessages: 40
    }, { timeoutMs: 5000 });
    const items = extractWikiSessionCandidates(history);
    return {
      ok: true,
      items,
      message: items.length > 0 ? `已读取 ${items.length} 个候选结论。` : '当前会话没有可保存的助手结论。',
      ...(includeSessionId ? { sessionId: selected } : {})
    };
  } catch (error) {
    return { ok: false, message: error?.message || '当前会话读取失败。', items: [] };
  }
};

const resolveWikiCapture = async (payload) => {
  const candidates = await loadCurrentWikiCandidates({ includeSessionId: true });
  if (!candidates.ok) return { ok: false, message: candidates.message };
  const selected = selectCaptureCandidate(payload, candidates.items);
  if (!selected) return { ok: false, message: '保存内容与当前会话候选不匹配，请重新加载并选择。' };
  return {
    ok: true,
    vaultPath: wikiSettingsStore?.getState()?.vaultPath || '',
    capture: {
      title: selected.title,
      content: selected.content,
      sourceSessionId: candidates.sessionId,
      sourceSeq: selected.candidate.seq,
      sourceTime: selected.candidate.sourceTime
    }
  };
};

const previewWikiCapture = async (payload) => {
  if (!wikiRuntime) return { ok: false, message: 'Wiki 保存能力不可用。' };
  const resolved = await resolveWikiCapture(payload);
  if (!resolved.ok || !resolved.vaultPath) return { ok: false, message: resolved.message || '请先配置知识库。' };
  try {
    const preview = wikiRuntime.buildCapturePreview(resolved.vaultPath, resolved.capture);
    return {
      ok: true,
      path: preview.relativePath,
      summary: preview.summary,
      sensitive: preview.sensitive,
      source: `当前会话事件 ${preview.sourceSeq}`
    };
  } catch (error) {
    return { ok: false, message: error?.message || '保存预览失败。' };
  }
};

const saveWikiCapture = async (payload) => {
  if (!wikiRuntime) return { ok: false, message: 'Wiki 保存能力不可用。' };
  const resolved = await resolveWikiCapture(payload);
  if (!resolved.ok || !resolved.vaultPath) return { ok: false, message: resolved.message || '请先配置知识库。' };
  try {
    const preview = wikiRuntime.buildCapturePreview(resolved.vaultPath, resolved.capture);
    const sensitive = preview.sensitive.map((item) => item.label).join('、');
    const confirmation = await dialog.showMessageBox(nativeParent(wikiCenterWindow), {
      type: sensitive ? 'warning' : 'question',
      title: sensitive ? '确认保存可能敏感的结论' : '确认保存 Wiki 结论',
      message: `保存“${preview.title}”到当前知识库？`,
      detail: `目标：${preview.relativePath}\n来源：当前会话事件 ${preview.sourceSeq}\n\n将新增一个页面并更新 index.md 与 log.md；不会修改原始会话，也不会执行 Git 操作。${sensitive ? `\n\n敏感检查：${sensitive}` : ''}`,
      buttons: ['保存到 Wiki', '取消'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    if (confirmation.response !== 0) return { ok: false, canceled: true, message: '结论未保存。' };
    return await wikiRuntime.saveCapture(resolved.vaultPath, resolved.capture, {
      confirmedSensitive: preview.sensitive.length > 0,
      workspaceName: workspaceStore?.getState()?.displayName || '当前工作区'
    });
  } catch (error) {
    return { ok: false, message: error?.message || '结论保存失败。' };
  }
};

const createWorktreesWindow = async () => {
  const created = createToolSurface('worktrees', {
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

const unavailableGitDeliveryState = (message = 'Git 交付中心尚未初始化。') => Object.freeze({
  available: false,
  reason: 'unavailable',
  message,
  repository: Object.freeze({ root: getWorkspaceState().activePath, branch: '', head: '', headShort: '' }),
  status: Object.freeze({ changed: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, clean: true, fingerprint: '' }),
  recentCommits: Object.freeze([]),
  remote: Object.freeze({ available: false, status: 'unavailable', message: 'Git 仓库不可用。', pullRequests: Object.freeze([]), canCreate: false })
});

const getGitDeliveryState = async ({ includeRemote = false } = {}) => {
  if (!gitDeliveryManager) return unavailableGitDeliveryState();
  try {
    return await gitDeliveryManager.inspect({ includeRemote: includeRemote === true });
  } catch (error) {
    return unavailableGitDeliveryState(error?.message || 'Git 交付状态读取失败。');
  }
};

const publishGitDeliveryState = async (options = {}) => {
  const state = await getGitDeliveryState(options);
  if (gitDeliveryWindow && !gitDeliveryWindow.isDestroyed()) {
    gitDeliveryWindow.webContents.send('git-delivery:state', state);
  }
  return state;
};

const gitDeliveryBusyReason = async () => {
  await refreshAgentDiagnostics({ rebuildMenu: false });
  if (terminalRunner?.isActive()) return '请先停止正在运行的安全终端。';
  if (sideChatWindow && !sideChatWindow.isDestroyed()) return '请先关闭 Side Chat。';
  if (sideChatOperationPromise) return '请等待 Side Chat 操作完成。';
  if (agentDiagnostics.status === 'running' || agentDiagnostics.status === 'waiting'
    || agentDiagnostics.pendingCount > 0 || agentDiagnostics.queuedCount > 0) return '请先结束当前 Agent 回合，并处理待确认与排队消息。';
  if (checkpointCreatePromise || checkpointRestorePromise || checkpointForkPromise
    || ['creating', 'restoring', 'forking'].includes(checkpointDiagnostics.status)) return '请等待代码检查点操作完成。';
  if (worktreeOperationPromise) return '请等待 Git 工作树操作完成。';
  if (supportBackupOperationPromise) return '请等待 DSH 数据备份完成。';
  return '';
};

const performGitDeliveryCommit = async (message, fingerprint) => {
  let normalized;
  try { normalized = normalizeCommitMessage(message); }
  catch (error) {
    return { ok: false, message: error?.message || '提交说明无效。', state: await getGitDeliveryState() };
  }
  const busyReason = await gitDeliveryBusyReason();
  if (busyReason) return { ok: false, message: busyReason, state: await getGitDeliveryState() };
  const before = await getGitDeliveryState();
  if (!before.available) return { ok: false, message: before.message, state: before };
  if (before.status.conflicted > 0) return { ok: false, message: '存在未解决冲突，不能创建提交。', state: before };
  if (before.status.staged < 1) return { ok: false, message: '没有已暂存改动；本窗口不会自动暂存文件。', state: before };
  if (before.status.fingerprint !== fingerprint) return { ok: false, message: '暂存区在确认前已变化，请刷新后重试。', state: before };
  const options = {
    type: 'question',
    title: '创建本地 Git 提交',
    message: `提交 ${before.status.staged} 项已暂存改动？`,
    detail: `分支：${before.repository.branch || 'detached HEAD'}\n提交说明：${normalized}\n\n不会自动暂存、不会推送，也不会包含未暂存或未跟踪文件。`,
    buttons: ['取消', '创建本地提交'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
  const parent = gitDeliveryWindow && !gitDeliveryWindow.isDestroyed() ? gitDeliveryWindow : mainWindow;
  const confirmation = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (confirmation.response !== 1) return { ok: false, canceled: true, message: '已取消，没有创建提交。', state: before };
  const result = await gitDeliveryManager.commit(normalized, fingerprint);
  if (gitDeliveryWindow && !gitDeliveryWindow.isDestroyed()) gitDeliveryWindow.webContents.send('git-delivery:state', result.state);
  await refreshChangeReviewDiagnostics({ rebuildMenu: false });
  installApplicationMenu();
  return result;
};

const queueGitDeliveryCommit = (message, fingerprint) => {
  if (gitDeliveryOperationPromise) return Promise.resolve({ ok: false, message: '另一个 Git 提交操作仍在进行。' });
  gitDeliveryOperationPromise = Promise.resolve()
    .then(() => performGitDeliveryCommit(message, fingerprint))
    .catch(async (error) => ({
      ok: false,
      message: error instanceof GitDeliveryError ? error.message : '没有创建 Git 提交。',
      state: await getGitDeliveryState()
    }))
    .finally(() => { gitDeliveryOperationPromise = null; });
  return gitDeliveryOperationPromise;
};

const createGitDeliveryWindow = async () => {
  const created = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#141516',
    icon: path.join(rootDir, 'build', 'icon.ico'),
    title: 'DSH Git 交付中心',
    webPreferences: {
      preload: path.join(__dirname, 'git-delivery-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });
  gitDeliveryWindow = created;
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-attach-webview', (event) => event.preventDefault());
  created.webContents.on('will-navigate', (event, url) => {
    if (!gitDeliveryUrlAllowed(url)) event.preventDefault();
  });
  created.webContents.on('will-redirect', (event) => event.preventDefault());
  created.once('ready-to-show', () => {
    if (!gitDeliverySmokeTarget) created.show();
  });
  created.on('closed', () => {
    if (gitDeliveryWindow === created) gitDeliveryWindow = undefined;
  });
  await created.loadFile(gitDeliveryPage);
  return created;
};

const openGitDeliveryWindow = async () => {
  if (gitDeliveryWindow && !gitDeliveryWindow.isDestroyed()) {
    if (gitDeliveryWindow.isMinimized()) gitDeliveryWindow.restore();
    gitDeliveryWindow.show();
    gitDeliveryWindow.focus();
    return { ok: true, reused: true };
  }
  await createGitDeliveryWindow();
  return { ok: true, reused: false };
};

const getTasksSubagentsState = async () => {
  const workspace = getWorkspaceState();
  const state = await (tasksSubagentsController?.scan({
    agentDiagnostics,
    workspacePath: workspace.activePath,
    workspaceName: workspace.displayName
  }) || Promise.resolve(unavailableTasksSubagentsState()));
  const workflow = await getCurrentWorkflow();
  return { ...state, workflow };
};

const publishTasksSubagentsState = async () => {
  const state = await getTasksSubagentsState();
  if (tasksSubagentsWindow && !tasksSubagentsWindow.isDestroyed()) {
    tasksSubagentsWindow.webContents.send('tasks-subagents:state', state);
  }
  return state;
};

const createTasksSubagentsWindow = async () => {
  const created = createToolSurface('tasks', {
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
  if (harnessAuthCookie) await installHarnessCookie(sideChatPartitionSession);

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
  const confirmation = await dialog.showMessageBox(nativeParent(tasksSubagentsWindow), {
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
const handoffOperationBusy = () => Boolean(worktreeOperationPromise || pluginTogglePromise || pluginInstallPromise
  || supportBackupOperationPromise || checkpointRestorePromise || checkpointForkPromise || terminalRunner?.isActive()
  || ['creating', 'restoring', 'forking'].includes(checkpointDiagnostics.status));
const handoffAvailable = async () => require('./handoff-availability.cjs').handoffWorkflowIdle(await getCurrentWorkflow(), handoffOperationBusy());

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
  const confirmation = await dialog.showMessageBox(nativeParent(pluginHealthWindow), {
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
  const confirmation = await dialog.showMessageBox(nativeParent(pluginHealthWindow), {
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

let handoffServicePromise;
const getHandoffService = () => handoffServicePromise ||= (async () => {
  const { SessionHandoff } = require('./session-handoff.cjs');
  const service = new SessionHandoff({ filePath: path.join(app.getPath('userData'), 'session-handoffs.json'), manager: worktreeManager,
    control: (operation, request) => supervisor.credentialHost.sessionControl.request(operation, request),
    getContext: async () => { await flushComposerDraft(); return documentIntakeController.getContext(); },
    continuity: getContinuityStore, trashItem: (target) => shell.trashItem(target),
    activate: (target, sessionId) => activateWorkspace(target, sessionId),
    confirm: async ({ direction, repository, session, targetPath }) => (await dialog.showMessageBox(nativeParent(worktreesWindow), {
      title: direction === 'back' ? '返回原目录继续' : '交接到独立工作树', type: 'question',
      message: direction === 'back' ? '将当前会话和代码状态交接回原目录？' : '新建独立工作树并继续当前会话？',
      detail: `源目录：${repository.repository.root}\n目标：${targetPath || '软件管理的新工作树'}\n分支：${repository.repository.branch}\n历史事件：${session.eventCount}\n\n保留原会话、原目录和恢复点；迁移草稿、会话文档、Git 跟踪及未忽略的文件，保留暂存状态。忽略的依赖和环境文件不搬运。只复制代码状态，不自动合并提交。原目录有其他修改时拒绝返回覆盖。`,
      buttons: ['取消', '确认交接'], defaultId: 0, cancelId: 0, noLink: true
    })).response === 1
  });
  await service.init(); return service;
})();
const getWorktreeState = async () => {
  if (!worktreeManager) return unavailableWorktreeState();
  const workspacePath = getWorkspaceState().activePath, state = await worktreeManager.inspect(workspacePath);
  const handoff = await getHandoffService();
  return { ...state, handoffAvailable: await handoffAvailable(), handoffs: handoff.list(workspacePath), worktrees: state.worktrees.map((item) => ({ ...item, handoffProtected: handoff.protects(item.path), canRemove: item.canRemove && !handoff.protects(item.path) })) };
};

const performWorktreeCreate = async () => {
  if (!worktreeManager) return { ok: false, message: 'Git 工作树管理尚未初始化。', state: unavailableWorktreeState() };
  if (worktreeExternalBusy()) return { ok: false, message: '请先结束当前 Agent、插件、终端或检查点任务。', state: await getWorktreeState() };
  const workspacePath = getWorkspaceState().activePath;
  const before = await getWorktreeState();
  if (!before.available || before.status !== 'ready' || before.counts.managed >= before.limits.managed) {
    return { ok: false, message: before.message || '当前仓库不能创建更多隔离工作树。', state: before };
  }
  const confirmation = await dialog.showMessageBox(nativeParent(worktreesWindow), {
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
  const confirmation = await dialog.showMessageBox(nativeParent(worktreesWindow), {
    type: 'warning',
    title: '切换工作树',
    message: `确认切换到 ${item.branch || item.directoryName}？`,
    detail: `目录：${item.path}\n提交：${item.headShort}\n未提交修改：${item.status.changed}\n\n切换会停止当前预览并重启 Harness；当前工作树及其修改不会被删除。`,
    buttons: ['取消', '切换工作区'],
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
  const resolved = await worktreeManager.resolve({ workspacePath: getWorkspaceState().activePath, id });
  if ((await getHandoffService()).protects(resolved.item.path)) return { ok: false, message: '此目录仍有交接或恢复记录；请先返回原目录，不能直接回收。', state: await getWorktreeState() };
  let preview;
  try { preview = await worktreeManager.previewRemove({ workspacePath: getWorkspaceState().activePath, id }); } catch (error) {
    return { ok: false, message: error?.message || '工作树已变化。', state: await getWorktreeState() };
  }
  const recoveryDetail = preview.status.clean
    ? `工作树没有未提交修改；分支 ${preview.branch} 和提交 ${preview.headShort} 会保留。`
    : `检测到 ${preview.status.changed} 项未提交修改（暂存 ${preview.status.staged}、未暂存 ${preview.status.unstaged}、新文件 ${preview.status.untracked}）。软件会先建立私有恢复点；只有恢复点和最终状态复核都成功后才移除目录。`;
  const confirmation = await dialog.showMessageBox(nativeParent(worktreesWindow), {
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
  const transition = agentTransitionTracker.observe(next);
  agentDiagnostics = Object.freeze({ ...next, producedPaths: Object.freeze([...(next.producedPaths || [])]) });
  const reviewChanged = await refreshChangeReviewDiagnostics({ rebuildMenu: false });
  if (changed) updateApplicationTray();
  if (transition && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isFocused())) {
    showFixedNotification(transition);
  }
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

const trayIconPath = path.join(rootDir, 'build', 'icon.ico');

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
};

const showFixedNotification = (copy) => {
  if (!copy || typeof copy.title !== 'string' || typeof copy.body !== 'string' || !Notification.isSupported()) return false;
  const notification = new Notification({
    title: copy.title,
    body: copy.body,
    icon: trayIconPath,
    silent: false
  });
  activeNotifications.add(notification);
  notification.once('close', () => activeNotifications.delete(notification));
  const releaseReference = setTimeout(() => activeNotifications.delete(notification), 60_000);
  releaseReference.unref?.();
  notification.once('click', () => {
    showMainWindow();
    if (copy.focusAction && harnessUiReady()) {
      void invokeHarnessUiAction(mainWindow.webContents, copy.focusAction).catch(() => undefined);
    }
  });
  notification.show();
  return true;
};

const updateApplicationTray = () => {
  if (!appTray || appTray.isDestroyed()) return;
  const skipped = updatePreferenceStore?.getState().skippedVersion || '';
  appTray.setToolTip(`DSH Desktop · ${trayStatusLabel(agentDiagnostics)}`);
  appTray.setContextMenu(Menu.buildFromTemplate([
    { label: trayStatusLabel(agentDiagnostics), enabled: false },
    { type: 'separator' },
    { label: '打开 DSH Desktop', click: () => { showMainWindow(); } },
    {
      label: '定位待确认操作',
      enabled: Boolean(agentDiagnostics.canFocusPending),
      click: () => { void runHarnessUiAction('focus-pending'); }
    },
    {
      label: '停止当前生成',
      enabled: Boolean(agentDiagnostics.canStop),
      click: () => { void runHarnessUiAction('stop-agent'); }
    },
    { type: 'separator' },
    {
      label: updateCheckPromise ? '正在检查更新…' : '检查产品 Latest 更新…',
      enabled: !updateCheckPromise,
      click: () => { void checkForUpdatesFromUser(); }
    },
    { label: skipped ? `已跳过 V${skipped}` : '未跳过产品 Latest', enabled: false },
    { label: '自动下载与安装：关闭（未签名）', enabled: false },
    { type: 'separator' },
    { label: '退出 DSH Desktop', click: () => { app.quit(); } }
  ]));
};

const createApplicationTray = () => {
  if (appTray && !appTray.isDestroyed()) return true;
  if (!fs.existsSync(trayIconPath)) return false;
  appTray = new Tray(trayIconPath);
  appTray.on('click', () => { showMainWindow(); });
  appTray.on('double-click', () => { showMainWindow(); });
  updateApplicationTray();
  return true;
};

const destroyApplicationTray = () => {
  if (appTray && !appTray.isDestroyed()) appTray.destroy();
  appTray = undefined;
  activeNotifications.clear();
};

const showUpdateDialog = (options) => (
  mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options)
);

const checkForUpdatesFromUser = () => {
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = (async () => {
    updateApplicationTray();
    installApplicationMenu();
    let result;
    try {
      result = await checkForProductUpdate({
        currentVersion: app.getVersion(),
        fetchImpl: (url, options) => session.defaultSession.fetch(url, options)
      });
    } catch (error) {
      const safeError = String(error?.message || '网络请求失败。').replace(/[\r\n\u0000-\u001f]+/gu, ' ').slice(0, 240);
      await showUpdateDialog({
        type: 'warning',
        title: '更新检查失败',
        message: '暂时无法读取 DSH Desktop 的 GitHub 发布信息。',
        detail: `${safeError}\n\n不会自动下载或修改当前安装。`,
        buttons: ['确定'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return { ok: false };
    }
    if (!result.release || !result.updateAvailable) {
      await showUpdateDialog({
        type: 'info',
        title: '已是当前产品 Latest',
        message: `当前版本 V${result.currentVersion} 暂无更高的公开版本。`,
        detail: '检查更新不会自动下载或安装；V0.5.4 Stable 通道保持独立。',
        buttons: ['确定'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return { ok: true, updateAvailable: false };
    }
    const skipped = updatePreferenceStore?.getState().skippedVersion === result.release.version;
    const response = await showUpdateDialog({
      type: 'info',
      title: `发现产品 Latest V${result.release.version}`,
      message: skipped ? `V${result.release.version} 已被你跳过。` : `可以查看 V${result.release.version} 的 GitHub Pre-release。`,
      detail: '当前安装包尚未代码签名，因此软件只打开经过固定校验的 GitHub 发布页，不会自动下载、安装或覆盖现有版本。覆盖前仍需建立并验证 last-known-good 回滚点。',
      buttons: skipped ? ['取消', '打开发布页', '取消跳过'] : ['取消', '打开发布页', '跳过此版本'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (response.response === 1) await shell.openExternal(result.release.url);
    if (response.response === 2 && updatePreferenceStore) {
      if (skipped) await updatePreferenceStore.clearSkip();
      else await updatePreferenceStore.skip(result.release.version);
    }
    return { ok: true, updateAvailable: true, version: result.release.version };
  })().finally(() => {
    updateCheckPromise = null;
    updateApplicationTray();
    installApplicationMenu();
  });
  return updateCheckPromise;
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

const invokeWikiSkill = async (id) => {
  if (!harnessUiReady() || !['wiki-query', 'wiki-capture', 'wiki-update', 'wiki-history-ingest'].includes(id)) return false;
  const methods = { 'wiki-query': 'invokeWikiQuery', 'wiki-capture': 'invokeWikiCapture', 'wiki-update': 'invokeWikiUpdate', 'wiki-history-ingest': 'invokeWikiHistory' };
  const titles = { 'wiki-query': 'Wiki 知识查询', 'wiki-capture': 'Wiki 会话结论保存', 'wiki-update': 'Wiki 项目增量同步', 'wiki-history-ingest': 'DSH 历史批量导入' };
  const method = methods[id];
  const invoked = await mainWindow.webContents.executeJavaScript(`Boolean(window.__DSH_COMMAND_PALETTE__?.${method}?.())`, true).catch(() => false);
  if (invoked) return true;
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: titles[id],
    message: `在对话输入框中输入 ${id === 'wiki-history-ingest' ? '/wiki-history-ingest dsh' : `/${id}`} 后继续描述。`,
    detail: '请先从“工具 → Wiki 中心”选择并初始化知识库。基础版不要求 Git、Python、QMD 或 Obsidian。',
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
  const buttons = canOpenSettings ? ['打开模型设置', '网络与代理', '确定'] : ['网络与代理', '确定'];
  const result = await dialog.showMessageBox(mainWindow, {
    type,
    title: '模型配置诊断',
    message: credentialLabel(),
    detail: detailByStatus[credential.status] || credential.message,
    buttons,
    defaultId: canOpenSettings ? 2 : 1,
    cancelId: canOpenSettings ? 2 : 1
  });
  if (canOpenSettings && result.response === 0) await runHarnessUiAction('models-settings');
  if ((canOpenSettings && result.response === 1) || (!canOpenSettings && result.response === 0)) await openNetworkSettings();
};

const supportTimestamp = () => new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z').replace('T', '-');

const writePrivateJson = async (targetPath, value) => {
  const target = path.resolve(targetPath);
  const parent = path.dirname(target);
  const parentInfo = await fsp.lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('所选诊断报告目录不可用。');
  const existing = await fsp.lstat(target).catch((error) => (error?.code === 'ENOENT' ? null : Promise.reject(error)));
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('诊断报告目标不是安全的普通文件。');
  const temp = `${target}.${process.pid}-${randomBytes(8).toString('hex')}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(temp, target);
  } finally {
    await handle?.close().catch(() => undefined);
    await fsp.unlink(temp).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
};

const exportRedactedDiagnostics = async () => {
  try {
    const semantic = await collectSupportBackupFiles(dataRoot);
    const report = createRedactedDiagnosticReport({
      appInfo: { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged },
      runtime: { electron: process.versions.electron, node: process.versions.node, harness: HARNESS_VERSION, pnpm: '11.19.0' },
      workspace: getWorkspaceState(),
      diagnostics: { ...getDiagnosticsState(), harnessStatus: supervisor?.getState().status || 'stopped' },
      network: getNetworkState(),
      backup: { fileCount: semantic.files.length, totalBytes: semantic.totalBytes, counts: semantic.counts }
    });
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: '导出脱敏诊断报告',
      defaultPath: path.join(app.getPath('downloads'), `DSH-Desktop-Diagnostics-v${app.getVersion()}-${supportTimestamp()}.json`),
      filters: [{ name: 'JSON 诊断报告', extensions: ['json'] }]
    });
    if (selection.canceled || !selection.filePath) return { ok: false, canceled: true, message: '未导出诊断报告。' };
    await writePrivateJson(selection.filePath, report);
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '脱敏诊断已导出',
      message: '诊断报告已生成，不包含 Key、代理地址、工作区完整路径、会话正文或日志正文。',
      detail: '你可以在提交 Issue 或反馈问题时附上此 JSON 文件。',
      buttons: ['在文件夹中显示', '确定'],
      defaultId: 1,
      cancelId: 1
    });
    if (result.response === 0) shell.showItemInFolder(selection.filePath);
    return { ok: true, canceled: false, message: '脱敏诊断已导出。' };
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error', title: '诊断导出失败', message: '未能生成脱敏诊断报告。', detail: error?.message || String(error), buttons: ['确定']
    });
    return { ok: false, canceled: false, message: '诊断导出失败。' };
  }
};

const supportBackupBusyReason = () => {
  if (terminalRunner?.isActive()) return '请先停止正在运行的终端命令。';
  if (sideChatWindow && !sideChatWindow.isDestroyed()) return '请先关闭 Side Chat。';
  if (sideChatOperationPromise) return '请等待 Side Chat 操作完成。';
  if (agentDiagnostics.status === 'running' || agentDiagnostics.pendingCount > 0 || agentDiagnostics.queuedCount > 0) return '请先等待或停止当前 Agent 回合，并处理待确认与排队消息。';
  return '';
};

const runSupportBackupFromDialog = async () => {
  await refreshAgentDiagnostics({ rebuildMenu: false });
  const busyReason = supportBackupBusyReason();
  if (busyReason) {
    await dialog.showMessageBox(mainWindow, { type: 'warning', title: '暂时不能备份', message: busyReason, detail: '备份需要短暂停止 Harness，原始数据不会被删除。', buttons: ['确定'] });
    return { ok: false, canceled: false, message: busyReason };
  }
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: '选择 DSH 备份存放位置',
    properties: ['openDirectory', 'createDirectory']
  });
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true, message: '未创建备份。' };
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '创建 DSH 数据备份',
    message: '将短暂停止并重新启动 Harness，然后复制会话、工作区/Wiki 设置、插件状态和界面状态。',
    detail: '软件 Key 文件、代理设置、缓存、日志和运行时依赖不会进入备份；会话正文按原样保存，可能包含你曾输入的敏感内容。备份完成后会逐文件校验 SHA-256，请妥善保管。',
    buttons: ['取消', '开始备份'],
    defaultId: 0,
    cancelId: 0
  });
  if (confirmation.response !== 1) return { ok: false, canceled: true, message: '未创建备份。' };
  await refreshAgentDiagnostics({ rebuildMenu: false });
  const finalBusyReason = supportBackupBusyReason();
  if (finalBusyReason) {
    await dialog.showMessageBox(mainWindow, { type: 'warning', title: '备份已取消', message: finalBusyReason, detail: '等待当前操作结束后再重新创建备份。', buttons: ['确定'] });
    return { ok: false, canceled: true, message: finalBusyReason };
  }

  const restartNeeded = Boolean(supervisor?.isActive());
  let created;
  let primaryError;
  let restartResult = { ok: true };
  try {
    if (restartNeeded) {
      stopAgentPolling();
      await showStatusPage();
      await supervisor.stop();
      harnessOrigin = null;
      clearHarnessAuthentication();
    }
    await session.defaultSession.flushStorageData();
    created = await createSupportBackup({
      dataRoot,
      destinationRoot: selection.filePaths[0],
      appVersion: app.getVersion()
    });
  } catch (error) {
    primaryError = error;
  } finally {
    if (restartNeeded) restartResult = await startHarnessForWindow().catch((error) => ({ ok: false, error: error?.message || String(error) }));
  }
  if (primaryError) {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: '备份失败', message: '没有保留未完成的备份目录。', detail: primaryError?.message || String(primaryError), buttons: ['确定'] });
    return { ok: false, canceled: false, message: '备份失败。' };
  }
  const result = await dialog.showMessageBox(mainWindow, {
    type: restartResult.ok ? 'info' : 'warning',
    title: 'DSH 数据备份已完成',
    message: `已校验 ${created.fileCount} 个文件，其中 ${created.counts.sessions} 个会话文件。`,
    detail: restartResult.ok ? '软件 Key 文件和代理设置未进入备份；会话正文按原样保存。Harness 已恢复运行。' : `备份有效，但 Harness 未能自动恢复：${restartResult.error || '未知原因'}`,
    buttons: ['打开备份目录', '确定'],
    defaultId: 1,
    cancelId: 1
  });
  if (result.response === 0) shell.showItemInFolder(path.join(created.backupRoot, SUPPORT_BACKUP_MANIFEST));
  return { ok: true, canceled: false, fileCount: created.fileCount, sessionCount: created.counts.sessions, restartOk: restartResult.ok, message: 'DSH 数据备份已完成。' };
};

const createSupportBackupFromDialog = () => {
  if (supportBackupOperationPromise) {
    void dialog.showMessageBox(mainWindow, { type: 'info', title: '备份正在进行', message: '已有一个 DSH 数据备份任务正在进行。', buttons: ['确定'] });
    return Promise.resolve({ ok: false, canceled: false, message: '已有备份任务正在进行。' });
  }
  supportBackupOperationPromise = Promise.resolve()
    .then(runSupportBackupFromDialog)
    .catch(async (error) => {
      const options = { type: 'error', title: '备份失败', message: '未能启动 DSH 数据备份。', detail: error?.message || String(error), buttons: ['确定'] };
      if (mainWindow && !mainWindow.isDestroyed()) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
      return { ok: false, canceled: false, message: '备份失败。' };
    })
    .finally(() => { supportBackupOperationPromise = null; });
  return supportBackupOperationPromise;
};

const validateSupportBackupFromDialog = async () => {
  const selection = await dialog.showOpenDialog(mainWindow, { title: '选择要验证的 DSH 备份目录', properties: ['openDirectory'] });
  if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true, message: '未验证备份。' };
  try {
    const verified = await validateSupportBackup(selection.filePaths[0]);
    await dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'DSH 备份有效', message: `已逐文件验证 ${verified.fileCount} 个文件，其中 ${verified.counts.sessions} 个会话文件。`, detail: `备份版本：V${verified.appVersion || '未知'}\n软件 Key 文件：未包含\n会话正文：按原样保存，未脱敏`, buttons: ['确定']
    });
    return { ok: true, canceled: false, fileCount: verified.fileCount, sessionCount: verified.counts.sessions, message: 'DSH 备份验证通过。' };
  } catch (error) {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: 'DSH 备份无效', message: '备份文件缺失、被修改或格式不受支持。', detail: error?.message || String(error), buttons: ['确定'] });
    return { ok: false, canceled: false, message: 'DSH 备份验证失败。' };
  }
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

const activateWorkspace = async (workspacePath, preferredSessionId = '') => {
  try {
    await flushComposerDraft();
    if (sideChatOperationPromise) await sideChatOperationPromise;
    closeSideChatWindow();
    if (terminalRunner?.isActive()) await terminalRunner.stop();
    await previewManager?.stop();
    await terminalSettlePromise;
    await persistProjectPanels();
    const workspace = await workspaceStore.activate(workspacePath);
    dockLayoutStore?.activate(workspace.activePath);
    if (dockLayoutStore?.getPanels()) { await workbenchStore.applyProjectLayout(dockLayoutStore.getPanels()); applyUiZoomFactor(); }
    nativeDock?.layout();
    dshHistorySelectionCatalog.refresh([], '');
    await discardPreparedDshHistorySource();
    if (contextSourcesWindow && !contextSourcesWindow.isDestroyed()) contextSourcesWindow.close();
    if (tasksSubagentsWindow && !tasksSubagentsWindow.isDestroyed()) tasksSubagentsWindow.close();
    if (officeCenterWindow && !officeCenterWindow.isDestroyed()) officeCenterWindow.close();
    if (wikiCenterWindow && !wikiCenterWindow.isDestroyed()) wikiCenterWindow.close();
    if (gitDeliveryWindow && !gitDeliveryWindow.isDestroyed()) gitDeliveryWindow.close();
    contextSourceCatalog?.setWorkspace(workspace.activePath);
    await workspaceFiles.activate(workspace.activePath);
    await previewManager.activate(workspace.activePath);
    await changeReviewer.activate(workspace.activePath);
    gitDeliveryManager?.activate(workspace.activePath);
    checkpointDiagnostics = await checkpointManager.activate(workspace.activePath);
    changeReviewDiagnostics = emptyChangeReviewDiagnostics();
    terminalRunner?.setWorkspace(workspace.activePath);
    supervisor.setLaunchDir(workspace.activePath);
    installApplicationMenu();
    applyWindowTitle();
    const result = await startHarnessForWindow({ restart: false, preferredSessionId });
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
        {
          label: 'Git 交付中心…',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => { void openGitDeliveryWindow(); }
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
        { label: '运行中：Enter 排队；Ctrl+Enter 立即中断并发送纯文本', enabled: false },
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
          click: () => { void runVisibleDesktopAction('Office 交付中心', openOfficeCenterWindow); }
        },
        { label: 'Word / Excel / PowerPoint：可编辑文件统一入口', enabled: false },
        {
          label: 'Wiki 中心…',
          click: () => { void openWikiCenterWindow(); }
        },
        { label: 'Wiki：知识查询、会话结论、项目同步与 DSH 历史导入 · Git 可选', enabled: false },
        {
          label: '查询 Wiki 知识…',
          enabled: harnessReady,
          click: () => { void invokeWikiSkill('wiki-query'); }
        },
        {
          label: '保存会话结论到 Wiki…',
          enabled: harnessReady,
          click: () => { void invokeWikiSkill('wiki-capture'); }
        },
        {
          label: '同步当前项目知识到 Wiki…',
          enabled: harnessReady,
          click: () => { void invokeWikiSkill('wiki-update'); }
        },
        {
          label: '选择并导入 DSH 历史到 Wiki…',
          enabled: harnessReady,
          click: () => { void openWikiCenterWindow(); }
        },
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
          click: () => { void runVisibleDesktopAction('软件 Key 设置', () => runHarnessUiAction('models-settings')); }
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
          enabled: Boolean(mainWindow),
          click: () => { void runVisibleDesktopAction('网络与代理设置', openNetworkSettings); }
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
          click: () => { void runVisibleDesktopAction('命令面板', () => mainWindow?.webContents.executeJavaScript('Boolean(window.__DSH_COMMAND_PALETTE__?.open?.())', true)); }
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
          label: '导出脱敏诊断报告…',
          click: () => { void exportRedactedDiagnostics(); }
        },
        {
          label: '备份 DSH 数据…',
          click: () => { void createSupportBackupFromDialog(); }
        },
        {
          label: '验证 DSH 备份…',
          click: () => { void validateSupportBackupFromDialog(); }
        },
        { type: 'separator' },
        {
          label: updateCheckPromise ? '正在检查产品 Latest…' : '检查产品 Latest 更新…',
          enabled: !updateCheckPromise,
          click: () => { void checkForUpdatesFromUser(); }
        },
        {
          label: updatePreferenceStore?.getState().skippedVersion
            ? `已跳过 V${updatePreferenceStore.getState().skippedVersion}`
            : '未跳过产品 Latest',
          enabled: false
        },
        { label: '自动下载与安装：关闭（未签名）', enabled: false },
        { type: 'separator' },
        {
          label: `关于 DSH Desktop V${app.getVersion()}…`,
          click: () => { void dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: `关于 DSH Desktop V${app.getVersion()}`,
            message: `DSH Desktop V${app.getVersion()}`,
            detail: `Electron ${process.versions.electron} · Node ${process.versions.node}\nDeepSeek Harness ${harnessRuntimePaths?.version || '0.1.2-alpha.1'}\n\n独立社区项目，不隶属于或代表 DeepSeek。`,
            buttons: ['确定'],
            defaultId: 0,
            cancelId: 0
          }); }
        },
        { type: 'separator' },
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
  desktopIpcAllowed(event)
    ? testNetworkSettings(settings)
    : { ok: false, reason: 'untrusted', message: '代理测试请求来源未通过安全校验。' }
));
ipcMain.handle('network:save', (event, settings) => (
  desktopIpcAllowed(event)
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
ipcMain.handle('support:export-diagnostics', (event) => (
  desktopIpcAllowed(event) ? exportRedactedDiagnostics() : { ok: false, canceled: false, message: '诊断导出请求未通过安全校验。' }
));
ipcMain.handle('support:create-backup', (event) => (
  desktopIpcAllowed(event) ? createSupportBackupFromDialog() : { ok: false, canceled: false, message: '备份请求未通过安全校验。' }
));
ipcMain.handle('support:validate-backup', (event) => (
  desktopIpcAllowed(event) ? validateSupportBackupFromDialog() : { ok: false, canceled: false, message: '备份验证请求未通过安全校验。' }
));
const currentReviewScopes = () => {
  if (!changeReviewer) throw new Error('审查尚未就绪，请稍后刷新。');
  if (!reviewScopes) reviewScopes = new ReviewScopes({
    reviewer: changeReviewer,
    getContext: async () => contextKey(await documentIntakeController.getContext()),
    getLastTurn: async () => {
      const last = checkpointManager?.last;
      if (last?.source !== 'automatic' || !(await checkpointMatchesCurrentSession()).matches) return null;
      const state = await checkpointManager.captureCurrentState();
      if (checkpointManager.last !== last || !(await checkpointMatchesCurrentSession()).matches) return null;
      return { before: last.tree, after: state.tree };
    }
  });
  return reviewScopes;
};
for (const [channel, method] of Object.entries({ list: 'list', diff: 'diff', 'add-comment': 'addComment', 'remove-comment': 'removeComment', 'list-comments': 'listComments', prompt: 'prompt' })) {
  ipcMain.handle(`reviews:${channel}`, async (event, payload) => {
    if (!harnessIpcAllowed(event)) throw new Error('审查操作仅限当前受信工作区页面。');
    return currentReviewScopes()[method](payload);
  });
}
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
const runDocumentRequest = async (event, operation) => {
  if (!harnessIpcAllowed(event)) return { ok: false, available: false, message: '文件入口尚未就绪。' };
  try {
    const result = await operation();
    if (result.ok && result.context === (await documentIntakeController.getState()).context) {
      changeReviewer?.protectUserPaths(result.items.map((item) => item.relativePath));
    }
    return result;
  }
  catch { return { ok: false, available: false, message: '工作区状态已变化，请稍后重试。' }; }
};
ipcMain.handle('documents:get-state', (event) => runDocumentRequest(event, () => documentIntakeController.getState()));
ipcMain.handle('documents:choose', (event, context) => runDocumentRequest(event, () => documentIntakeController.importFiles({ expectedContext: context, choose: true })));
ipcMain.handle('documents:import', (event, paths, context) => runDocumentRequest(event, () => documentIntakeController.importFiles({ expectedContext: context, paths })));
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
ipcMain.handle('wiki-center:get-state', (event) => (
  wikiCenterIpcAllowed(event) ? getWikiCenterState() : unavailableWikiCenterState('请求来源未通过安全校验。')
));
ipcMain.handle('wiki-center:choose-vault', (event) => (
  wikiCenterIpcAllowed(event) ? chooseWikiVault() : { ok: false, message: '知识库选择请求未通过安全校验。' }
));
ipcMain.handle('wiki-center:initialize-vault', (event) => (
  wikiCenterIpcAllowed(event) ? initializeSelectedWikiVault() : { ok: false, message: '知识库初始化请求未通过安全校验。' }
));
ipcMain.handle('wiki-center:query', (event, query) => (
  wikiCenterIpcAllowed(event) ? querySelectedWiki(query) : { ok: false, message: 'Wiki 查询请求未通过安全校验。', results: [] }
));
ipcMain.handle('wiki-center:preview-project-sync', (event) => (
  wikiCenterIpcAllowed(event) ? previewCurrentProjectWikiSync() : { ok: false, message: '项目增量检查请求未通过安全校验。' }
));
ipcMain.handle('wiki-center:invoke-project-sync', (event) => (
  wikiCenterIpcAllowed(event) ? invokeCurrentProjectWikiSync() : { ok: false, message: '项目同步请求未通过安全校验。' }
));
ipcMain.handle('wiki-center:list-history-sessions', (event) => (
  wikiCenterIpcAllowed(event) ? listDshHistorySessions() : { ok: false, message: 'DSH 历史列表请求未通过安全校验。', items: [] }
));
ipcMain.handle('wiki-center:prepare-history', (event, selection) => (
  wikiCenterIpcAllowed(event) ? prepareSelectedDshHistory(selection) : { ok: false, message: 'DSH 历史准备请求未通过安全校验。' }
));
ipcMain.handle('wiki-center:invoke-history', (event) => (
  wikiCenterIpcAllowed(event) ? invokePreparedDshHistory() : { ok: false, message: 'DSH 历史导入请求未通过安全校验。' }
));
ipcMain.handle('wiki-center:get-session-candidates', (event) => (
  wikiCenterIpcAllowed(event) ? loadCurrentWikiCandidates() : { ok: false, message: '会话读取请求未通过安全校验。', items: [] }
));
ipcMain.handle('wiki-center:preview-capture', (event, capture) => (
  wikiCenterIpcAllowed(event) ? previewWikiCapture(capture) : { ok: false, message: 'Wiki 保存预览请求未通过安全校验。' }
));
ipcMain.handle('wiki-center:save-capture', (event, capture) => (
  wikiCenterIpcAllowed(event) ? saveWikiCapture(capture) : { ok: false, message: 'Wiki 保存请求未通过安全校验。' }
));
ipcMain.handle('git-delivery:get-state', (event) => (
  gitDeliveryIpcAllowed(event) ? getGitDeliveryState() : unavailableGitDeliveryState('Git 交付请求来源未通过安全校验。')
));
ipcMain.handle('git-delivery:refresh', (event, includeRemote) => (
  gitDeliveryIpcAllowed(event) && typeof includeRemote === 'boolean'
    ? publishGitDeliveryState({ includeRemote })
    : unavailableGitDeliveryState('Git 交付刷新请求未通过安全校验。')
));
ipcMain.handle('git-delivery:commit', (event, message, fingerprint) => {
  if (!gitDeliveryIpcAllowed(event) || typeof message !== 'string' || typeof fingerprint !== 'string' || !/^[0-9a-f]{64}$/u.test(fingerprint)) {
    return { ok: false, message: 'Git 提交请求未通过安全校验。' };
  }
  return queueGitDeliveryCommit(message, fingerprint);
});
ipcMain.handle('git-delivery:open-link', async (event, id) => {
  if (!gitDeliveryIpcAllowed(event) || typeof id !== 'string' || !/^[0-9a-f]{24}$/u.test(id) || !gitDeliveryManager) {
    return { ok: false, message: 'Git 交付链接请求未通过安全校验。' };
  }
  try {
    await shell.openExternal(gitDeliveryManager.openLink(id));
    return { ok: true, message: '已在默认浏览器中打开 GitHub。' };
  } catch (error) {
    return { ok: false, message: error instanceof GitDeliveryError ? error.message : '未能打开 GitHub 链接。' };
  }
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
ipcMain.handle('worktrees:handoff', async (event) => {
  if (!worktreesIpcAllowed(event)) return { ok: false, message: '会话交接来源未通过校验。' };
  if (!await handoffAvailable()) return { ok: false, message: '内核尚未确认空闲，或仓库操作未结束；请稍后刷新。' };
  return queueWorktreeOperation(async () => {
    try { const result = await (await getHandoffService()).run(); return { ...result, state: await getWorktreeState() }; }
    catch (error) { return { ok: false, message: error.message, state: await getWorktreeState() }; }
  });
});
ipcMain.handle('worktrees:open-handoff', (event, request) => {
  if (!worktreesIpcAllowed(event) || !/^[a-f0-9-]{36}$/.test(request?.id || '') || !['source', 'target'].includes(request.side)) return { ok: false, message: '恢复记录请求无效。' };
  if (worktreeMutationBusy()) return { ok: false, message: '请先结束当前运行和仓库操作。' };
  return queueWorktreeOperation(async () => {
    try {
      const service = await getHandoffService(), row = service.list(getWorkspaceState().activePath).find((item) => item.id === request.id);
      if (!row) throw new Error('记录不属于当前工作区。');
      const workspacePath = request.side === 'source' ? row.sourcePath : row.targetPath;
      const sessionId = request.side === 'source' ? row.sourceSessionId : row.targetSessionId;
      if (!workspacePath) throw new Error('目标目录尚未建立。');
      await supervisor.credentialHost.sessionControl.request('inspect', { workspacePath, sessionId });
      const result = await activateWorkspace(workspacePath, sessionId);
      return { ...result, message: result.ok ? '已打开保存的会话；未重跑交接或复制代码。' : result.error, state: await getWorktreeState() };
    } catch (error) { return { ok: false, message: error.message, state: await getWorktreeState() }; }
  });
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
ipcMain.handle('wiki-center:open-window', (event) => (
  harnessIpcAllowed(event)
    ? openWikiCenterWindow()
    : { ok: false, message: 'Wiki 中心请求未通过安全校验。' }
));
ipcMain.handle('git-delivery:open-window', (event) => (
  desktopIpcAllowed(event)
    ? openGitDeliveryWindow()
    : { ok: false, message: 'Git 交付中心请求来源未通过安全校验。' }
));
const getCurrentWorkflow = async () => {
  try {
    if (!harnessUiReady() || worktreeOperationPromise) return { available: false };
    const context = await documentIntakeController.getContext();
    const value = await supervisor.credentialHost.sessionControl.request('inspect', context);
    if (context.sessionId !== await readHarnessSessionSelection(mainWindow.webContents)) return { available: false };
    return { available: true, sessionId: value.sessionId, running: value.running, queued: value.queued, steering: value.steering,
      pending: value.pending, approvals: value.approvals, jobs: value.liveJobs, turnOpen: value.turnOpen, lastTurnReason: value.lastTurnReason };
  } catch { return { available: false }; }
};
ipcMain.handle('harness:workflow-state', (event) => harnessIpcAllowed(event) ? getCurrentWorkflow() : { available: false });
ipcMain.handle('harness:get-state', (event) => (
  desktopIpcAllowed(event) ? (supervisor?.getState() || { status: 'idle' }) : { status: 'unavailable' }
));
ipcMain.handle('harness:interrupt-queued', async (event) => {
  if (!harnessIpcAllowed(event) || !reliableInterruptController) {
    return { ok: false, accepted: false, message: '排队插话请求未通过安全校验。' };
  }
  try {
    const receipt = await reliableInterruptController.interruptQueued();
    setTimeout(() => { void refreshAgentDiagnostics(); }, 120);
    return receipt;
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      reason: error instanceof ReliableInterruptError ? error.code : 'interrupt-failed',
      message: error?.message || '排队插话失败，消息仍保留。'
    };
  }
});
ipcMain.handle('harness:interrupt-and-prompt', async (event, text) => {
  if (!harnessIpcAllowed(event) || !reliableInterruptController || typeof text !== 'string') {
    return { ok: false, accepted: false, message: '插话请求未通过安全校验。' };
  }
  try {
    const receipt = await reliableInterruptController.interruptAndPrompt(text);
    setTimeout(() => { void refreshAgentDiagnostics(); }, 120);
    return receipt;
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      reason: error instanceof ReliableInterruptError ? error.code : 'interrupt-failed',
      message: error?.message || '插话发送失败，草稿已保留。'
    };
  }
});
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
    clearHarnessAuthentication();
    supervisor.reportFailure(new Error(`Harness 页面加载失败（${code}: ${description}）。`));
    await showStatusPage();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  let closingDraft = false, draftFlushedForClose = false;
  mainWindow.on('close', (event) => {
    if (allowQuit || draftFlushedForClose) return;
    event.preventDefault();
    if (appTray && !appTray.isDestroyed() && isBackgroundSupervisionRequired(agentDiagnostics)) {
      void flushComposerDraft().catch(() => {}); mainWindow.hide();
      showFixedNotification({ title: 'DSH Desktop 仍在后台运行',
        body: agentDiagnostics.status === 'waiting' ? 'Agent 正在等待确认，可从托盘重新打开。' : 'Agent 仍在运行，可从托盘继续监督。',
        focusAction: agentDiagnostics.status === 'waiting' ? 'focus-pending' : null });
      return;
    }
    if (closingDraft) return;
    closingDraft = true;
    void (async () => {
      try { await flushComposerDraft(); }
      catch {
        const answer = await dialog.showMessageBox(mainWindow, { type: 'warning', title: '草稿尚未保存', message: '最后输入的内容未能写入本机。建议取消关闭并复制草稿。', buttons: ['取消关闭', '仍然关闭'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) return;
      }
      draftFlushedForClose = true; mainWindow?.close();
    })().finally(() => { closingDraft = false; });
  });
  mainWindow.on('closed', () => {
    nativeDock?.destroy(); nativeDock = undefined;
    stopAgentPolling();
    closeSideChatWindow();
    if (terminalWindow && !terminalWindow.isDestroyed()) terminalWindow.close();
    if (worktreesWindow && !worktreesWindow.isDestroyed()) worktreesWindow.close();
    if (tasksSubagentsWindow && !tasksSubagentsWindow.isDestroyed()) tasksSubagentsWindow.close();
    if (officeCenterWindow && !officeCenterWindow.isDestroyed()) officeCenterWindow.close();
    if (wikiCenterWindow && !wikiCenterWindow.isDestroyed()) wikiCenterWindow.close();
    mainWindow = undefined;
  });

  applyWindowTitle();
  await mainWindow.loadFile(statusPage);
  if (!isolatedSmokeTarget) await ensureNativeDock();
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

const runCommandFeedbackSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const compactSize = initialWindowSize || { width: 1220, height: 800 };
  const screenshots = {
    command: `${resolvedTarget}.command.png`,
    network: `${resolvedTarget}.network.png`,
    maximized: `${resolvedTarget}.maximized.png`
  };
  let created;
  let result;
  try {
    created = new BrowserWindow({
      width: compactSize.width,
      height: compactSize.height,
      minWidth: 820,
      minHeight: 600,
      show: false,
      backgroundColor: '#151618',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        webSecurity: true
      }
    });
    mainWindow = created;
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('will-navigate', (event, url) => {
      if (!currentUrlAllowed(url)) event.preventDefault();
    });
    await created.loadFile(statusPage);
    const commandCss = await fsp.readFile(workbenchCommandCssPath, 'utf8');
    const commandScript = await fsp.readFile(workbenchCommandScriptPath, 'utf8');
    await created.webContents.insertCSS(commandCss);
    const installed = Boolean(await created.webContents.executeJavaScript(commandScript, true));
    created.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 250));

    const command = await created.webContents.executeJavaScript(`(async () => {
      const palette = window.__DSH_COMMAND_PALETTE__;
      palette?.open?.();
      const search = document.querySelector('.dsh-command-search');
      search.value = '聚焦对话输入';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const dialog = document.querySelector('.dsh-command-dialog');
      const failure = document.querySelector('.dsh-command-failure');
      const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
        .filter((node) => !node.closest('[hidden]'));
      const initialFocus = document.activeElement?.textContent || document.activeElement?.getAttribute?.('aria-label') || '';
      const last = focusable.at(-1);
      last?.focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      document.dispatchEvent(tab);
      const forwardWrapped = tab.defaultPrevented && document.activeElement === focusable[0];
      focusable[0]?.focus();
      const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(shiftTab);
      const backwardWrapped = shiftTab.defaultPrevented && document.activeElement === last;
      const rect = dialog.getBoundingClientRect();
      return {
        installed: Boolean(palette),
        failureVisible: !failure.hidden,
        title: failure.querySelector('strong')?.textContent || '',
        detail: failure.querySelector('p')?.textContent || '',
        initialFocus,
        forwardWrapped,
        backwardWrapped,
        fits: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
      };
    })()`, true);
    const commandShot = await created.webContents.capturePage();
    await fsp.writeFile(screenshots.command, commandShot.toPNG());

    const network = await created.webContents.executeJavaScript(`(async () => {
      window.__DSH_COMMAND_PALETTE__?.close?.();
      document.querySelector('[data-open-network]')?.click();
      const networkStatus = document.querySelector('.dsh-network-status');
      const paintReady = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      for (let attempt = 0; attempt < 50 && networkStatus?.textContent === '正在读取当前设置…'; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await paintReady();
      const dialog = document.querySelector('.dsh-network-dialog');
      const backdrop = document.querySelector('.dsh-network-backdrop');
      const rect = dialog?.getBoundingClientRect();
      return {
        installed: Boolean(window.__DSH_NETWORK__),
        visible: Boolean(backdrop && !backdrop.hidden),
        title: dialog?.querySelector('h2')?.textContent || '',
        status: networkStatus?.textContent || '',
        ready: Boolean(networkStatus && networkStatus.textContent !== '正在读取当前设置…'),
        fits: Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight)
      };
    })()`, true);
    const networkShot = await created.webContents.capturePage();
    await fsp.writeFile(screenshots.network, networkShot.toPNG());

    created.maximize();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const maximized = await created.webContents.executeJavaScript(`(async () => {
      const maximizedPaintReady = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.__DSH_NETWORK__?.close?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const networkBackdrop = document.querySelector('.dsh-network-backdrop');
      window.__DSH_COMMAND_PALETTE__?.open?.();
      const search = document.querySelector('.dsh-command-search');
      search.value = '聚焦对话输入';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      await maximizedPaintReady();
      const dialog = document.querySelector('.dsh-command-dialog');
      const failure = document.querySelector('.dsh-command-failure');
      const rect = dialog?.getBoundingClientRect();
      return {
        networkHidden: Boolean(networkBackdrop?.hidden),
        failureVisible: !failure?.hidden,
        title: failure?.querySelector('strong')?.textContent || '',
        fits: Boolean(rect && rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight),
        viewport: { width: innerWidth, height: innerHeight }
      };
    })()`, true);
    const maximizedShot = await created.webContents.capturePage();
    await fsp.writeFile(screenshots.maximized, maximizedShot.toPNG());

    result = {
      ok: installed
        && command.installed
        && command.failureVisible
        && command.title === '聚焦对话输入未执行'
        && command.detail.includes('未能确认操作完整完成')
        && !command.detail.includes('没有执行任何修改')
        && command.initialFocus === '重试此命令'
        && command.forwardWrapped
        && command.backwardWrapped
        && command.fits
      && network.installed
      && network.visible
      && network.title === '网络与代理'
      && network.ready
      && network.fits
      && maximized.networkHidden
      && maximized.failureVisible
      && maximized.title === '聚焦对话输入未执行'
      && maximized.fits,
      version: app.getVersion(),
      compactSize,
      command,
      network,
      maximized,
      screenshots
    };
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error?.stack || error?.message || String(error), screenshots };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    created?.destroy();
    if (mainWindow === created) mainWindow = undefined;
  }
  if (!result.ok) process.exitCode = 1;
};

const runTraySmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  let smokeTray;
  let result;
  try {
    const tracker = new AgentTransitionTracker({ status: 'ready' });
    const started = tracker.observe({ status: 'running' });
    const waiting = tracker.observe({ status: 'waiting' });
    const repeatedWaiting = tracker.observe({ status: 'waiting' });
    const completed = tracker.observe({ status: 'ready' });
    const latest = selectLatestProductRelease([
      {
        tag_name: 'v0.9.0',
        html_url: 'https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.9.0',
        draft: false,
        prerelease: true,
        published_at: '2026-08-30T00:00:00Z'
      },
      {
        tag_name: 'v0.8.0',
        html_url: 'https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/v0.8.0',
        draft: false,
        prerelease: true,
        published_at: '2026-08-29T00:00:00Z'
      }
    ]);
    smokeTray = new Tray(trayIconPath);
    const menu = Menu.buildFromTemplate([
      { label: trayStatusLabel({ status: 'waiting' }), enabled: false },
      { label: '打开 DSH Desktop' },
      { label: '检查产品 Latest 更新…' },
      { label: '自动下载与安装：关闭（未签名）', enabled: false },
      { label: '退出 DSH Desktop' }
    ]);
    smokeTray.setToolTip('DSH Desktop · Agent：等待确认');
    smokeTray.setContextMenu(menu);
    result = {
      ok: fs.existsSync(trayIconPath)
        && started === null
        && waiting?.type === 'waiting'
        && repeatedWaiting === null
        && completed?.type === 'completed'
        && latest?.version === '0.9.0'
        && menu.items.length === 5,
      version: app.getVersion(),
      iconReady: fs.existsSync(trayIconPath),
      notificationSupported: Notification.isSupported(),
      transitionTypes: [waiting?.type, completed?.type],
      latestVersion: latest?.version || '',
      menuLabels: menu.items.map((item) => item.label)
    };
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error?.message || String(error) };
  } finally {
    smokeTray?.destroy();
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  if (!result.ok) process.exitCode = 1;
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
  let smokeHarnessWindow;
  try {
    const url = await supervisor.start();
    const authentication = await establishHarnessSession(url);
    const probe = authentication.probe;
    const smokeFetch = createAuthenticatedHarnessFetch(authentication);
    const rootResponse = await smokeFetch(authentication.origin);
    const smokeApi = (origin, method, payload, options = {}) => callHarnessApi(origin, method, payload, { ...options, fetchImpl: smokeFetch });
    const workspaceSync = await synchronizeHarnessWorkspace({
      origin: authentication.origin,
      workspacePath: supervisor.getState().workspacePath,
      fallbackTitle: 'DSH 临时工作区',
      fetchImpl: smokeFetch
    });
    const sideChat = await new SideChatController({
      getOrigin: () => authentication.origin,
      apiCall: smokeApi,
      readSelection: async () => workspaceSync.sessionId
    }).create({
      mainWebContents: {},
      workspacePath: supervisor.getState().workspacePath,
      agentState: { status: 'ready', pendingCount: 0, queuedCount: 0 }
    });
    smokeHarnessWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });
    const smokeCookie = parseHarnessCookie(authentication.cookie?.header);
    if (!smokeCookie) throw new Error('Harness smoke authentication cookie is unavailable.');
    await smokeHarnessWindow.webContents.session.cookies.set({
      url: authentication.origin,
      name: smokeCookie.name,
      value: smokeCookie.value,
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: false
    });
    await smokeHarnessWindow.loadURL(authentication.origin);
    const queueSnapshot = await readHarnessQueueSnapshotFromWebContents(
      smokeHarnessWindow.webContents,
      authentication.origin,
      workspaceSync.sessionId,
      { timeoutMs: 5000 }
    );
    const liveInventory = await callHarnessRemote(authentication.origin, 'pluginInventory', 'list', {}, { fetchImpl: smokeFetch });
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
        && Array.isArray(queueSnapshot)
        && extensionCenter.available
        && pluginSurface?.total > 0
        && skillSurface?.total > 0
        && mcpSurface?.status === 'ready'
        && mcpSurface?.total === 0
        && hookSurface?.status === 'unsupported',
      name: app.getName(),
      version: app.getVersion(),
      url: authentication.origin,
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
      reliableInterrupt: {
        controlStream: 'ready',
        queuedItems: queueSnapshot.length
      },
      extensionCenter: {
        source: extensionCenter.source,
        runtimeClosure: {
          status: runtimeState.runtime?.status || 'unknown',
          expected: runtimeState.runtime?.expected || 0,
          healthy: runtimeState.runtime?.healthy || 0,
          missing: runtimeState.runtime?.missing || 0,
          misdirected: runtimeState.runtime?.misdirected || 0
        },
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
    smokeHarnessWindow?.destroy();
    await supervisor.stop();
  }
  await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
  await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
};

const runDocumentIntakeSmoke = async (target, { review = false, dock = false, continuity = false, handoff = false } = {}) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = app.getPath('userData');
  const workspacePath = path.join(smokeRoot, 'workspace');
  const source = path.join(smokeRoot, '外部资料.csv');
  let result, submitted = '', nativeFileResult, stage = 'startup';
  const rendererErrors = [];
  try {
    await fsp.mkdir(workspacePath, { recursive: true });
    await fsp.writeFile(source, '名称,金额\n测试甲,12\n测试乙,18\n', 'utf8');
    workspaceStore = new WorkspaceStore({ filePath: path.join(smokeRoot, 'desktop-state.json'), fallbackDir: workspacePath });
    await workspaceStore.init();
    supervisor = createSupervisor(smokeRoot, workspacePath);
    const url = await supervisor.start();
    const authentication = await establishHarnessSession(url);
    harnessOrigin = authentication.origin;
    harnessFetch = createAuthenticatedHarnessFetch(authentication);
    harnessAuthCookie = authentication.cookie;
    const selected = await synchronizeHarnessWorkspace({ origin: harnessOrigin, workspacePath, fetchImpl: harnessFetch });
    mainWindow = new BrowserWindow({ width: 1280, height: 880, show: false, webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true
    } });
    await installHarnessCookie(mainWindow.webContents.session);
    await mainWindow.loadURL(harnessOrigin);
    await selectHarnessSession(mainWindow.webContents, selected.sessionId);
    await mainWindow.loadURL(harnessOrigin);
    const wc = mainWindow.webContents;
    wc.on('console-message', (details) => { if (details.level === 'error' || details.level === 3) rendererErrors.push(details.message?.slice(0, 500)); });
    const evaluate = (code) => { stage = code.slice(0, 160); return wc.executeJavaScript(`try { ${code} } catch (error) { console.error(error.stack); throw error; }`, true); };
    const waitFor = async (code) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) { if (await evaluate(code)) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
      throw new Error(`界面条件超时：${code}`);
    };
    await waitFor('Boolean(document.querySelector("[data-composer-input][contenteditable=true]"))');
    mainWindow.show(); mainWindow.focus(); wc.focus();
    await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="继续")?.click()');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="稍后配置")?.click()');
    for (const name of ['composer-text-bridge.js', 'document-intake.js']) await evaluate(await fsp.readFile(path.join(rootDir, 'assets', name), 'utf8'));
    await wc.insertCSS(await fsp.readFile(path.join(rootDir, 'assets', 'document-intake.css'), 'utf8'));
    if (continuity) {
      documentIntakeController.chooseFiles = async () => [source];
      documentIntakeController.confirmImport = async () => true;
      result = await require('./session-continuity-smoke.cjs').runContinuitySmoke({ window: mainWindow, rootDir, evaluate, waitFor, target: resolvedTarget, version: app.getVersion(), selected, origin: harnessOrigin, api: authenticatedHarnessApi });
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (dock || handoff) {
      if (handoff) await require('./session-handoff-smoke.cjs').prepareHandoffFixture(workspacePath);
      workspaceSyncDiagnostics = selected;
      workbenchStore = new WorkbenchStore({ filePath: path.join(smokeRoot, 'workbench-state.json') }); await workbenchStore.init();
      harnessRuntimePaths = resolveHarnessRuntimePaths({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
      changeReviewer = new GitChangeReviewer(); await changeReviewer.activate(workspacePath);
      workspaceFiles = new WorkspaceFiles(); await workspaceFiles.activate(workspacePath);
      previewManager = new PreviewManager(); await previewManager.activate(workspacePath);
      terminalRunner = new TerminalRunner({ workspacePath, ...resolveTerminalRuntime({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged }) });
      bindTerminalRunner(terminalRunner);
      pluginHealthCatalog = new PluginHealthCatalog({ harnessHome: path.join(smokeRoot, 'harness'), dshPackageDir: path.resolve(path.dirname(harnessRuntimePaths.dshBinPath), '..') });
      tasksSubagentsController = new TasksSubagentsController({ getOrigin: () => harnessOrigin, getWebContents: () => wc, apiCall: authenticatedHarnessApi });
      reliableInterruptController = new ReliableInterruptController({ getOrigin: () => harnessOrigin, getWebContents: () => wc,
        getWorkspacePath: () => getWorkspaceState().activePath, apiCall: authenticatedHarnessApi,
        resumeQueue: (context) => supervisor.credentialHost.sessionControl.request('resume-queue', context),
        readQueue: (origin, id, options) => readHarnessQueueSnapshotFromWebContents(wc, origin, id, options) });
      worktreeManager = new GitWorktreeManager({ managedRoot: path.join(smokeRoot, 'worktrees') });
      if (handoff) { checkpointManager = new GitCheckpointManager(); checkpointDiagnostics = await checkpointManager.activate(workspacePath); }
      wikiRuntime = require(harnessRuntimePaths.wikiToolPath); wikiSettingsStore = new wikiRuntime.WikiSettingsStore({ filePath: path.join(smokeRoot, 'wiki-settings.json') }); await wikiSettingsStore.init();
      await ensureNativeDock();
      await wc.insertCSS(await fsp.readFile(path.join(rootDir, 'assets', 'workbench-native-layout.css'), 'utf8'));
      if (!await installWorkbenchPanel()) throw new Error('完整工作台未安装。');
      await supervisor.credentialHost.verifyReady(harnessOrigin, harnessFetch);
      if (dock && process.argv.includes('--smoke-workflow')) {
        if (!process.argv.includes('--smoke-real-model')) throw new Error('Workflow acceptance requires the real model flag.');
        result = await require('./session-workflow-smoke.cjs').runWorkflowSmoke({ window: mainWindow, supervisor, selected, workspacePath, version: app.getVersion(), target: resolvedTarget, origin: harnessOrigin, api: authenticatedHarnessApi });
        if (!result.ok) process.exitCode = 1;
        return;
      }
      if (handoff) {
        documentIntakeController.chooseFiles = async () => [source]; documentIntakeController.confirmImport = async () => true;
        result = await require('./session-handoff-smoke.cjs').runHandoffSmoke({ window: mainWindow, dock: nativeDock, supervisor, selected, workspacePath, rootDir, version: app.getVersion(), target: resolvedTarget,
          origin: harnessOrigin, api: authenticatedHarnessApi, realModel: process.argv.includes('--smoke-real-model'), mount: installWorkbenchPanel });
        if (!result.ok) process.exitCode = 1;
        return;
      }
      const { runNativeDockSmoke } = require('./native-dock-ui-smoke.cjs');
      result = await runNativeDockSmoke({ window: mainWindow, dock: nativeDock, terminal: terminalRunner, broker: terminalReadBroker, version: app.getVersion(), target: resolvedTarget,
        sessionId: selected.sessionId, origin: harnessOrigin, api: authenticatedHarnessApi, realModel: process.argv.includes('--smoke-real-model') });
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (review) {
      const { prepareReviewFixture, runReviewUiSmoke } = require('./review-ui-smoke.cjs');
      await prepareReviewFixture(workspacePath);
      changeReviewer = new GitChangeReviewer(); await changeReviewer.activate(workspacePath);
      reviewScopes = null;
      workbenchStore = new WorkbenchStore({ filePath: path.join(smokeRoot, 'workbench-state.json') }); await workbenchStore.init();
      result = await runReviewUiSmoke({ window: mainWindow, rootDir, evaluate, waitFor, target: resolvedTarget, version: app.getVersion() });
      if (!result.ok) process.exitCode = 1;
      return;
    }
    documentIntakeController.chooseFiles = async () => [source];
    documentIntakeController.confirmImport = async () => true;
    await evaluate('(async()=>{await window.__DSH_COMPOSER_TEXT__.append(window.__DSH_COMPOSER_TEXT__.current(), "请汇总测试数据，保留这段草稿。"); document.querySelector(".dsh-document-actions button").click()})()');
    await waitFor('document.querySelectorAll(".dsh-document-chip").length === 1 && !window.__DSH_DOCUMENT_INTAKE__.isPending()');
    const chosen = await evaluate('window.__DSH_COMPOSER_TEXT__.read()');
    await evaluate('document.querySelector(".dsh-document-chip button").click()');
    await waitFor('!window.__DSH_COMPOSER_TEXT__.read().includes("参考资料")');
    const removed = await evaluate('window.__DSH_COMPOSER_TEXT__.read()');
    await evaluate('document.querySelector(".dsh-document-actions button").click()');
    await waitFor('document.querySelectorAll(".dsh-document-chip").length === 1 && !window.__DSH_DOCUMENT_INTAKE__.isPending()');
    // CDP supplies a real disk-backed File to the isolated preload; this is not a synthetic File constructor.
    wc.debugger.attach('1.3');
    await evaluate('var smokeInput=document.createElement("input"); smokeInput.type="file"; smokeInput.id="dsh-smoke-native-file"; smokeInput.hidden=true; document.body.append(smokeInput)');
    const dom = await wc.debugger.sendCommand('DOM.getDocument');
    const node = await wc.debugger.sendCommand('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#dsh-smoke-native-file' });
    await wc.debugger.sendCommand('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [source] });
    nativeFileResult = await evaluate('(async()=>{const state=await desktopAPI.documents.getState(); return desktopAPI.documents.importFiles(Array.from(document.getElementById("dsh-smoke-native-file").files),state.context)})()');
    await evaluate('document.querySelector(".dsh-document-chip button").click()');
    await waitFor('!window.__DSH_COMPOSER_TEXT__.read().includes("参考资料")');
    await evaluate('var dropped=new DataTransfer(); dropped.items.add(document.getElementById("dsh-smoke-native-file").files[0]); document.dispatchEvent(new DragEvent("drop",{dataTransfer:dropped,bubbles:true,cancelable:true}))');
    await waitFor('window.__DSH_COMPOSER_TEXT__.read().includes("参考资料") && !window.__DSH_DOCUMENT_INTAKE__.isPending()');
    const fake = await evaluate('(async()=>{const state=await desktopAPI.documents.getState();return desktopAPI.documents.importFiles([new File(["x"],"fake.csv")],state.context)})()');
    await wc.debugger.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*api/session/prompt', requestStage: 'Request' }] });
    await fsp.writeFile(`${resolvedTarget}.before-send.png`, (await wc.capturePage()).toPNG());
    wc.debugger.on('message', async (_event, method, params) => {
      if (method !== 'Fetch.requestPaused') return;
      submitted = params.request.postData || '';
      await wc.debugger.sendCommand('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Aborted' }).catch(() => {});
    });
    await evaluate('window.__DSH_COMPOSER_TEXT__.current().dispatchEvent(new KeyboardEvent("keydown", {key:"Enter",code:"Enter",keyCode:13,bubbles:true,cancelable:true}))');
    const deadline = Date.now() + 5000;
    while (!submitted && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    await fsp.writeFile(`${resolvedTarget}.png`, (await wc.capturePage()).toPNG());
    const originalUnchanged = await fsp.readFile(source, 'utf8') === '名称,金额\n测试甲,12\n测试乙,18\n';
    result = { ok: chosen.includes('参考资料') && chosen.includes('保留这段草稿') && !removed.includes('参考资料') && removed.includes('保留这段草稿')
      && nativeFileResult.ok && fake.ok === false && originalUnchanged && submitted.includes('dsh-attachments') && submitted.includes('保留这段草稿'),
      version: app.getVersion(), evidence: 'real Harness renderer + native disk File + intercepted upstream send; no model request',
      inputKind: 'Lexical contenteditable', chooseInserted: chosen.includes('参考资料'), removalPreservedDraft: !removed.includes('参考资料') && removed.includes('保留这段草稿'),
      nativeFileImported: Boolean(nativeFileResult.ok), syntheticFileRejected: fake.ok === false, originalUnchanged,
      nativeFileDropInserted: true,
      upstreamPayloadContainsReference: submitted.includes('dsh-attachments'), upstreamPayloadPreservesDraft: submitted.includes('保留这段草稿') };
  } catch (error) { result = { ok: false, version: app.getVersion(), error: error.message, stage, rendererErrors: rendererErrors.slice(-5) }; }
  finally {
    if (dock || handoff) { await terminalRunner?.stop(); nativeDock?.destroy(); nativeDock = undefined; }
    mainWindow?.destroy(); mainWindow = undefined;
    await supervisor?.stop(); harnessOrigin = null; clearHarnessAuthentication();
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (!result.ok) process.exitCode = 1;
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
      version: '0.1.2-alpha.1',
      dependencies: Object.fromEntries([
        ['@deepseek-ai/dsh-base', '0.1.2-alpha.1'],
        ...capabilityPackageNames.map((name) => [`@deepseek-ai/${name}`, '0.1.2-alpha.1'])
      ])
    });
    await writeSmokePackage(basePackageDir, { name: '@deepseek-ai/dsh-base', version: '0.1.2-alpha.1', dsh: { bundle: { patch: './cordis.patch.yml' } } });
    for (const name of capabilityPackageNames) {
      const packageDir = path.join(installRoot, '@deepseek-ai', name);
      await writeSmokePackage(packageDir, { name: `@deepseek-ai/${name}`, version: '0.1.2-alpha.1' });
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
      getState: () => ({ activePath: rootDir, displayName: 'Office 验证工作区', isFallback: false, recentPaths: [rootDir] })
    };
    workspaceSyncDiagnostics = Object.freeze({
      ...unavailableWorkspaceSync(),
      status: 'synced',
      workspacePath: rootDir,
      workspaceTitle: 'Office 验证工作区',
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
      appVersion: document.querySelector('#app-version')?.textContent || '',
      integrationVersion: document.querySelector('#integration-version')?.textContent || '',
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
        && rendered.appVersion === `V${app.getVersion()}`
        && rendered.integrationVersion === `V${app.getVersion()}`
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
      appVersion: rendered.appVersion,
      integrationVersion: rendered.integrationVersion,
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

const runWikiCenterSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeVault = `${resolvedTarget}.vault-${process.pid}-${Date.now()}`;
  const smokeConfig = `${resolvedTarget}.settings-${process.pid}.json`;
  let result;
  try {
    harnessRuntimePaths = resolveHarnessRuntimePaths({
      rootDir,
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged
    });
    wikiRuntime = require(harnessRuntimePaths.wikiToolPath);
    wikiSettingsStore = new wikiRuntime.WikiSettingsStore({ filePath: smokeConfig });
    await fsp.mkdir(smokeVault, { recursive: true });
    await wikiSettingsStore.init();
    await wikiSettingsStore.setVault(smokeVault);
    await wikiRuntime.initializeWikiVault(smokeVault);
    await fsp.writeFile(path.join(smokeVault, 'concepts', 'wiki-basic.md'), [
      '---',
      'title: "无 Git Wiki 基础能力"',
      'summary: "DSH Desktop 可在没有 Git 的普通目录初始化并查询 Wiki。"',
      'sources:',
      '  - "dsh-smoke:v0.6.5"',
      'lifecycle: verified',
      '---',
      '',
      '# 无 Git Wiki 基础能力',
      '',
      '知识查询必须返回页面路径和来源。',
      ''
    ].join('\n'), 'utf8');
    await createWikiCenterWindow();
    const renderedInTime = await wikiCenterWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelectorAll('.capability').length === 6 && document.querySelector('#vault-status')?.textContent === '已就绪') return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`, true);
    if (!renderedInTime) throw new Error('wiki-center-smoke-timeout');
    const queryRendered = await wikiCenterWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const input = document.querySelector('#query-input');
      input.value = '无 Git Wiki';
      document.querySelector('#query-form').requestSubmit();
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelectorAll('.result').length > 0) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`, true);
    if (!queryRendered) throw new Error('wiki-center-query-smoke-timeout');
    const rendered = await wikiCenterWindow.webContents.executeJavaScript(`({
      apiKeys: Object.keys(window.wikiCenterAPI || {}).sort(),
      title: document.querySelector('h1')?.textContent || '',
      capabilityRows: document.querySelectorAll('.capability').length,
      resultRows: document.querySelectorAll('.result').length,
      text: document.body.innerText
    })`, true);
    wikiCenterWindow.showInactive();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const screenshot = await wikiCenterWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    await wikiCenterWindow.webContents.executeJavaScript("const panel = document.querySelector('#history-title')?.closest('section'); if (panel) window.scrollTo(0, Math.max(0, panel.offsetTop - 24)); true", true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const historyScreenshot = await wikiCenterWindow.webContents.capturePage();
    const historyScreenshotPath = `${resolvedTarget}.history.png`;
    const historyScreenshotSize = historyScreenshot.getSize();
    result = {
      ok: JSON.stringify(rendered.apiKeys) === JSON.stringify(['chooseVault', 'getSessionCandidates', 'getState', 'initializeVault', 'invokeHistory', 'invokeProjectSync', 'listHistorySessions', 'prepareHistory', 'previewCapture', 'previewProjectSync', 'query', 'saveCapture'])
        && rendered.title === 'Wiki 中心'
        && rendered.capabilityRows === 6
        && rendered.resultRows >= 1
        && rendered.text.includes('无 Git Wiki 基础能力')
        && rendered.text.includes('页面：concepts/wiki-basic.md')
        && rendered.text.includes('来源：dsh-smoke:v0.6.5')
        && rendered.text.includes('无 Git、Python、QMD 或 Obsidian也可使用基础能力。'.replace('Obsidian也', 'Obsidian 也'))
        && screenshotSize.width > 0
        && screenshotSize.height > 0
        && historyScreenshotSize.width > 0
        && historyScreenshotSize.height > 0,
      version: app.getVersion(),
      apiKeys: rendered.apiKeys,
      title: rendered.title,
      capabilityRows: rendered.capabilityRows,
      resultRows: rendered.resultRows,
      vaultPath: smokeVault,
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height },
      historyScreenshot: { path: historyScreenshotPath, width: historyScreenshotSize.width, height: historyScreenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
    await fsp.writeFile(historyScreenshotPath, historyScreenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error?.stack || error?.message || String(error) };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    wikiCenterWindow?.destroy();
    wikiCenterWindow = undefined;
    wikiSettingsStore = undefined;
    wikiRuntime = undefined;
    harnessRuntimePaths = undefined;
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

const runGitDeliverySmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = path.join(path.dirname(resolvedTarget), `git-delivery-smoke-data-${process.pid}-${Date.now()}`);
  const repositoryPath = path.join(smokeRoot, 'repository with spaces');
  let result;
  try {
    await fsp.mkdir(repositoryPath, { recursive: true });
    const gitSmoke = (args) => runGitCommand('git', repositoryPath, args, {
      baseEnv: { ...process.env, DEEPSEEK_API_KEY: 'hidden-git-delivery-smoke-key' }
    });
    await gitSmoke(['init', '-b', 'main']);
    await gitSmoke(['config', 'user.name', 'DSH Git Delivery Smoke']);
    await gitSmoke(['config', 'user.email', 'git-delivery-smoke@dsh-desktop.local']);
    await fsp.writeFile(path.join(repositoryPath, 'README.md'), '# Git delivery smoke\n', 'utf8');
    await gitSmoke(['add', 'README.md']);
    await gitSmoke(['commit', '-m', 'smoke baseline']);
    gitDeliveryManager = new GitDeliveryManager();
    gitDeliveryManager.activate(repositoryPath);
    await createGitDeliveryWindow();
    const renderedInTime = await gitDeliveryWindow.webContents.executeJavaScript(`new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const check = () => {
        if (document.querySelectorAll('.summary article').length === 6 && document.querySelectorAll('.history-row').length > 0) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(check, 50);
      };
      check();
    })`, true);
    if (!renderedInTime) throw new Error('git-delivery-smoke-timeout');
    const rendered = await gitDeliveryWindow.webContents.executeJavaScript(`({
      apiKeys: Object.keys(window.gitDeliveryAPI || {}).sort(),
      title: document.querySelector('h1')?.textContent || '',
      summaryCards: document.querySelectorAll('.summary article').length,
      historyRows: document.querySelectorAll('.history-row').length,
      commitMaxLength: document.querySelector('#commit-message')?.maxLength || 0,
      commitDisabled: document.querySelector('#commit')?.disabled,
      bodyText: document.body.innerText
    })`, true);
    const screenshot = await gitDeliveryWindow.webContents.capturePage();
    const screenshotPath = `${resolvedTarget}.png`;
    const screenshotSize = screenshot.getSize();
    result = {
      ok: JSON.stringify(rendered.apiKeys) === JSON.stringify(['commit', 'getState', 'onState', 'openLink', 'refresh'])
        && rendered.title === 'Git 交付中心'
        && rendered.summaryCards === 6
        && rendered.historyRows > 0
        && rendered.commitMaxLength === 200
        && rendered.commitDisabled === true
        && rendered.bodyText.includes('只提交已经暂存的文件')
        && rendered.bodyText.includes('当前分支 PR')
        && screenshotSize.width > 0
        && screenshotSize.height > 0,
      version: app.getVersion(),
      apiKeys: rendered.apiKeys,
      title: rendered.title,
      summaryCards: rendered.summaryCards,
      historyRows: rendered.historyRows,
      screenshot: { path: screenshotPath, width: screenshotSize.width, height: screenshotSize.height }
    };
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(screenshotPath, screenshot.toPNG());
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error?.stack || error?.message || String(error) };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    gitDeliveryWindow?.destroy();
    gitDeliveryWindow = undefined;
    gitDeliveryManager = undefined;
    await fsp.rm(smokeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  if (!result.ok) process.exitCode = 1;
};

const runSupportSmoke = async (target) => {
  const resolvedTarget = path.resolve(target);
  const smokeRoot = path.join(path.dirname(resolvedTarget), `support-smoke-data-${process.pid}-${Date.now()}`);
  const supportData = path.join(smokeRoot, 'user-data');
  const backups = path.join(smokeRoot, 'backups');
  let result;
  try {
    await Promise.all([
      fsp.mkdir(path.join(supportData, 'harness', 'sessions', '中文 工作区', 'session-fixture'), { recursive: true }),
      fsp.mkdir(path.join(supportData, 'harness', 'profiles', 'web'), { recursive: true }),
      fsp.mkdir(path.join(supportData, 'Local Storage', 'leveldb'), { recursive: true }),
      fsp.mkdir(backups, { recursive: true })
    ]);
    await Promise.all([
      fsp.writeFile(path.join(supportData, 'desktop-state.json'), '{"workspace":"C:/private/repository"}\n', 'utf8'),
      fsp.writeFile(path.join(supportData, 'harness', '.credentials.yaml'), 'apiKey: sk-support-smoke-secret-123456\n', 'utf8'),
      fsp.writeFile(path.join(supportData, 'harness', 'sessions', '中文 工作区', 'session-fixture', 'session.jsonl.zstd'), 'bounded session fixture', 'utf8'),
      fsp.writeFile(path.join(supportData, 'harness', 'profiles', 'web', 'package.json'), '{"name":"web"}\n', 'utf8'),
      fsp.writeFile(path.join(supportData, 'Local Storage', 'leveldb', 'CURRENT'), 'MANIFEST-000001\n', 'utf8')
    ]);
    const created = await createSupportBackup({ dataRoot: supportData, destinationRoot: backups, appVersion: app.getVersion() });
    const verified = await validateSupportBackup(created.backupRoot);
    const report = createRedactedDiagnosticReport({
      appInfo: { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged },
      runtime: { electron: process.versions.electron, node: process.versions.node, harness: HARNESS_VERSION, pnpm: '11.19.0' },
      workspace: { displayName: '中文 工作区', activePath: 'C:/private/repository', isFallback: false },
      diagnostics: { harnessStatus: 'running', sessions: { available: true, count: 1 }, credential: { status: 'configured', value: 'sk-support-smoke-secret-123456' }, agent: { status: 'ready', pendingCount: 0, queuedCount: 0 }, workspaceSync: { status: 'synced' } },
      network: { mode: 'custom', status: 'proxied', proxyUrl: 'https://user:pass@proxy.invalid' },
      backup: { fileCount: verified.fileCount, totalBytes: verified.totalBytes, counts: verified.counts }
    });
    const reportText = JSON.stringify(report);
    const backupText = await fsp.readFile(path.join(created.backupRoot, SUPPORT_BACKUP_MANIFEST), 'utf8');
    result = {
      ok: verified.valid === true
        && verified.counts.sessions === 1
        && !backupText.includes('.credentials.yaml')
        && !backupText.includes('sk-support-smoke-secret-123456')
        && !reportText.includes('C:/private/repository')
        && !reportText.includes('user:pass')
        && !reportText.includes('sk-support-smoke-secret-123456'),
      version: app.getVersion(),
      fileCount: verified.fileCount,
      sessionCount: verified.counts.sessions,
      credentialFilesIncluded: false,
      contentRedacted: false,
      diagnosticPrivacy: report.privacy
    };
  } catch (error) {
    result = { ok: false, version: app.getVersion(), error: error?.stack || error?.message || String(error) };
  } finally {
    await fsp.mkdir(path.dirname(resolvedTarget), { recursive: true });
    await fsp.writeFile(resolvedTarget, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await fsp.rm(smokeRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  if (!result.ok) process.exitCode = 1;
};

app.whenReady().then(async () => {
  app.setAppUserModelId('com.dsh.desktop');
  configureHarnessSessionPermissions(session.defaultSession, () => mainWindow?.webContents);

  if (credentialAgentSmokeTarget) {
    const output = path.resolve(credentialAgentSmokeTarget.slice('--credential-agent-smoke-file='.length));
    const source = process.argv.find((argument) => argument.startsWith('--smoke-credential-source='))?.slice('--smoke-credential-source='.length);
    const runtime = resolveHarnessRuntimePaths({ rootDir, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
    const result = await require('./credential-agent-smoke.cjs').runCredentialAgentSmoke({ output, source, smokeRoot: app.getPath('userData'), createSupervisor, runtime, version: app.getVersion() });
    if (!result.ok) process.exitCode = 1;
    allowQuit = true; app.quit(); return;
  }

  if (dockSmokeTarget) {
    await runDocumentIntakeSmoke(dockSmokeTarget.slice('--dock-smoke-file='.length), { dock: true });
    allowQuit = true; app.quit(); return;
  }
  if (continuitySmokeTarget) {
    await runDocumentIntakeSmoke(continuitySmokeTarget.slice('--continuity-smoke-file='.length), { continuity: true });
    allowQuit = true; app.quit(); return;
  }
  if (handoffSmokeTarget) {
    await runDocumentIntakeSmoke(handoffSmokeTarget.slice('--handoff-smoke-file='.length), { handoff: true });
    allowQuit = true; app.quit(); return;
  }
  if (reviewSmokeTarget) {
    await runDocumentIntakeSmoke(reviewSmokeTarget.slice('--review-smoke-file='.length), { review: true });
    allowQuit = true; app.quit(); return;
  }
  if (documentIntakeSmokeTarget) {
    await runDocumentIntakeSmoke(documentIntakeSmokeTarget.slice('--document-intake-smoke-file='.length));
    allowQuit = true; app.quit(); return;
  }

  if (desktopSmokeTarget) {
    await runDesktopSmoke(desktopSmokeTarget.slice('--smoke-test-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (commandFeedbackSmokeTarget) {
    await runCommandFeedbackSmoke(commandFeedbackSmokeTarget.slice('--command-feedback-smoke-file='.length));
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
  if (wikiCenterSmokeTarget) {
    await runWikiCenterSmoke(wikiCenterSmokeTarget.slice('--wiki-center-smoke-file='.length));
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
  if (gitDeliverySmokeTarget) {
    await runGitDeliverySmoke(gitDeliverySmokeTarget.slice('--git-delivery-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (traySmokeTarget) {
    await runTraySmoke(traySmokeTarget.slice('--tray-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }
  if (supportSmokeTarget) {
    await runSupportSmoke(supportSmokeTarget.slice('--support-smoke-file='.length));
    allowQuit = true;
    app.quit();
    return;
  }

  dataRoot = app.getPath('userData');
  await discardPreparedDshHistorySource();
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
  updatePreferenceStore = new UpdatePreferenceStore({
    filePath: path.join(dataRoot, 'update-state.json')
  });
  await workbenchStore.init();
  await proxyStore.init();
  await updatePreferenceStore.init();
  const workspace = await workspaceStore.init();
  gitDeliveryManager = new GitDeliveryManager();
  gitDeliveryManager.activate(workspace.activePath);
  workspaceFiles = new WorkspaceFiles();
  await workspaceFiles.activate(workspace.activePath);
  contextSourceCatalog = new ContextSourceCatalog({
    workspacePath: workspace.activePath,
    harnessHome: path.join(dataRoot, 'harness')
  });
  harnessRuntimePaths = resolveHarnessRuntimePaths({
    rootDir,
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged
  });
  const harnessRuntime = harnessRuntimePaths;
  wikiRuntime = require(harnessRuntime.wikiToolPath);
  wikiSettingsStore = new wikiRuntime.WikiSettingsStore({
    filePath: path.join(dataRoot, 'wiki-settings.json')
  });
  await wikiSettingsStore.init();
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
    getWebContents: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined),
    apiCall: authenticatedHarnessApi
  });
  reliableInterruptController = new ReliableInterruptController({
    getOrigin: () => harnessOrigin,
    getWebContents: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined),
    getWorkspacePath: () => getWorkspaceState().activePath,
    resumeQueue: (context) => supervisor.credentialHost.sessionControl.request('resume-queue', context),
    apiCall: authenticatedHarnessApi,
    readQueue: (origin, sessionId, options) => readHarnessQueueSnapshotFromWebContents(
      mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined,
      origin,
      sessionId,
      options
    )
  });
  sideChatController = new SideChatController({ getOrigin: () => harnessOrigin, apiCall: authenticatedHarnessApi });
  await refreshDesktopDiagnostics({ rebuildMenu: false });
  createApplicationTray();
  installApplicationMenu();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    else showMainWindow();
  });
});

app.on('before-quit', (event) => {
  stopAgentPolling();
  stopSideChatSelectionMonitor();
  if (allowQuit || (!supportBackupOperationPromise && !gitDeliveryOperationPromise && !supervisor?.isActive() && !terminalRunner?.isActive() && !previewManager?.isActive())) {
    destroyApplicationTray();
    return;
  }
  event.preventDefault();
  const stopAfterBackup = async () => {
    await flushComposerDraft().catch(() => {});
    if (worktreeOperationPromise) await Promise.allSettled([worktreeOperationPromise]);
    if (supportBackupOperationPromise) await Promise.allSettled([supportBackupOperationPromise]);
    if (gitDeliveryOperationPromise) await Promise.allSettled([gitDeliveryOperationPromise]);
    const stops = [];
    if (terminalRunner?.isActive()) stops.push(terminalRunner.stop());
    if (previewManager?.isActive()) stops.push(previewManager.stop());
    if (supervisor?.isActive()) stops.push(supervisor.stop());
    await Promise.allSettled(stops);
    await terminalSettlePromise;
  };
  void stopAfterBackup().finally(() => {
    allowQuit = true;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (!isolatedSmokeTarget || allowQuit)) app.quit();
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
