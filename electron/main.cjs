const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { GitChangeReviewer } = require('./change-review.cjs');
const { getDeepSeekCredentialStatus } = require('./credential-status.cjs');
const { HarnessSupervisor, isSafeHarnessUrl, probeHarness } = require('./harness-supervisor.cjs');
const { invokeHarnessUiAction, isAgentActionSettled, readHarnessAgentState } = require('./harness-ui-actions.cjs');
const { scanSessionCatalog } = require('./session-catalog.cjs');
const { WorkspaceStore } = require('./workspace-store.cjs');

app.commandLine.appendSwitch('lang', 'zh-CN');
app.setName('DSH Desktop');

let mainWindow;
let supervisor;
let workspaceStore;
let changeReviewer;
let dataRoot;
let harnessOrigin = null;
let allowQuit = false;
let loadFailureHandled = false;
let agentPollTimer;
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
  reason
});
let changeReviewDiagnostics = emptyChangeReviewDiagnostics();
let desktopDiagnostics = Object.freeze({
  credential: Object.freeze({ status: 'missing', source: 'managed-file', reason: 'not-checked', message: '尚未检查软件模型配置。', policy: 'software-first', environmentIgnored: false }),
  sessions: Object.freeze({ available: true, count: 0, latestUpdatedAt: null, encodings: Object.freeze({ zstd: 0, jsonl: 0 }) })
});

const rootDir = path.resolve(__dirname, '..');
const statusPage = path.join(rootDir, 'harness-status.html');
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
  installApplicationMenu();
  await showStatusPage();
  try {
    const url = restart ? await supervisor.restart() : await supervisor.start();
    await probeHarness(url);
    if (!isSafeHarnessUrl(url)) throw new Error('Harness 地址未通过回环安全校验。');
    harnessOrigin = new URL(url).origin;
    await mainWindow.loadURL(url);
    void refreshDesktopDiagnostics();
    startAgentPolling();
    return { ok: true, url };
  } catch (error) {
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

const getDiagnosticsState = () => ({
  credential: { ...desktopDiagnostics.credential },
  sessions: { ...desktopDiagnostics.sessions, encodings: { ...desktopDiagnostics.sessions.encodings } },
  agent: { ...agentDiagnostics, producedPaths: [...agentDiagnostics.producedPaths] },
  changes: { ...changeReviewDiagnostics }
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
);

const refreshChangeReviewDiagnostics = async ({ rebuildMenu = true } = {}) => {
  let next = emptyChangeReviewDiagnostics();
  const latestPath = agentDiagnostics.latestProducedPath;
  if (latestPath && changeReviewer) next = await changeReviewer.inspect(latestPath);
  const changed = !sameChangeReviewDiagnostics(changeReviewDiagnostics, next);
  changeReviewDiagnostics = Object.freeze({ ...next });
  if (changed && rebuildMenu) installApplicationMenu();
  if (changed && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('diagnostics:state', getDiagnosticsState());
  }
  return changed;
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

const powerShellCompatibilityLabel = () => agentDiagnostics.powerShellCompatibility === 'sandbox-crash'
  ? 'PowerShell：受限模式不兼容（0xC0000005）'
  : 'PowerShell：尚未检测到兼容问题';

const changeStatusLabel = () => {
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

const reviewLatestChange = async (action) => {
  try {
    await refreshChangeReviewDiagnostics();
    const state = changeReviewDiagnostics;
    if (!state.path || !changeReviewer) throw new Error('尚未检测到 Harness 产物文件。');
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
        ? '这会把该文件当前内容加入 Git 暂存区，作为后续拒绝操作的恢复基线；不会提交或推送。'
        : state.untracked
          ? '这是新文件。拒绝后会移动到 Windows 回收站，仍可从回收站恢复。'
          : '这会把工作区文件恢复到当前 Git 暂存版本；已有暂存内容会保留，不会提交或推送。',
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
    const workspace = await workspaceStore.activate(workspacePath);
    await changeReviewer.activate(workspace.activePath);
    changeReviewDiagnostics = emptyChangeReviewDiagnostics();
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
  const recentItems = workspace.recentPaths.length > 0
    ? workspace.recentPaths.map((recentPath) => ({
      label: `${path.basename(recentPath) || path.parse(recentPath).root} — ${path.dirname(recentPath)}`,
      type: 'checkbox',
      checked: recentPath === workspace.activePath,
      click: () => { void activateWorkspace(recentPath); }
    }))
    : [{ label: '暂无最近仓库', enabled: false }];
  const template = [
    {
      label: '项目',
      submenu: [
        { label: '打开代码仓库…', accelerator: 'CmdOrCtrl+O', click: () => { void chooseWorkspace(); } },
        { label: '最近使用', submenu: recentItems },
        { type: 'separator' },
        { label: `当前：${workspace.displayName}`, enabled: false },
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
    result = { ok: true, name: app.getName(), version: app.getVersion(), url, ...probe };
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
  const workspace = await workspaceStore.init();
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
  if (allowQuit || !supervisor?.isActive()) return;
  event.preventDefault();
  void supervisor.stop().finally(() => {
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
