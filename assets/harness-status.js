const elements = {
  version: document.querySelector('[data-app-version]'),
  runtimeStatus: document.querySelector('[data-runtime-status]'),
  workspacePath: document.querySelector('[data-workspace-path]'),
  sessionCount: document.querySelector('[data-session-count]'),
  credentialStatus: document.querySelector('[data-credential-status]'),
  visual: document.querySelector('[data-state-visual]'),
  label: document.querySelector('[data-status-label]'),
  title: document.querySelector('[data-status-title]'),
  description: document.querySelector('[data-status-description]'),
  error: document.querySelector('[data-error-detail]'),
  retry: document.querySelector('[data-retry]'),
  chooseWorkspace: document.querySelector('[data-choose-workspace]'),
  openLog: document.querySelector('[data-open-log]'),
  openNetwork: document.querySelector('[data-open-network]'),
  live: document.querySelector('[data-live-status]')
};

const copy = {
  idle: ['准备启动', '正在准备 DeepSeek Harness', '桌面宿主正在创建隔离的本地运行环境。'],
  starting: ['正在启动', '正在连接 DeepSeek Harness', '首次启动需要初始化本地 Profile，请稍候。'],
  running: ['已连接', 'DeepSeek Harness 已就绪', '正在打开本地工作台。'],
  stopping: ['正在停止', '正在安全停止 Harness', '应用正在保存状态并清理本地进程。'],
  stopped: ['已停止', 'DeepSeek Harness 已停止', '可以重新启动本地工作台。'],
  failed: ['启动失败', '无法启动 DeepSeek Harness', '运行时未能完成启动。可以查看日志后重试。']
};

const statusNames = { idle: '排队中', starting: '启动中', running: '运行中', stopping: '停止中', stopped: '已停止', failed: '已失败' };
const credentialNames = { configured: '已配置', invalid: '格式无效', missing: '未配置', unavailable: '不可用' };

const renderDiagnostics = (diagnostics = {}) => {
  const sessions = diagnostics.sessions || {};
  const credential = diagnostics.credential || {};
  elements.sessionCount.textContent = sessions.available === false ? '不可用' : String(sessions.count || 0);
  elements.credentialStatus.textContent = credentialNames[credential.status] || '检查中';
  elements.credentialStatus.title = credential.message || '';
};

const render = (state = { status: 'idle' }) => {
  const status = copy[state.status] ? state.status : 'idle';
  const [label, title, description] = copy[status];
  elements.visual.dataset.state = status;
  elements.label.textContent = label;
  elements.title.textContent = title;
  elements.description.textContent = description;
  elements.runtimeStatus.textContent = statusNames[status];
  elements.error.hidden = status !== 'failed';
  elements.error.textContent = state.error || '';
  elements.retry.hidden = !['failed', 'stopped'].includes(status);
  elements.retry.disabled = status === 'starting' || status === 'stopping';
  elements.live.textContent = status === 'failed'
    ? 'Harness 未连接；本地项目和会话数据不会被删除。'
    : '应用仅连接随机的 127.0.0.1 本机端口。';
};

const init = async () => {
  const [info, state, workspace, diagnostics] = await Promise.all([
    window.desktopAPI.app.getInfo(),
    window.desktopAPI.harness.getState(),
    window.desktopAPI.workspace.getState(),
    window.desktopAPI.diagnostics.getState()
  ]);
  elements.version.textContent = `V${info.version}`;
  elements.workspacePath.textContent = workspace.displayName;
  elements.workspacePath.title = workspace.activePath;
  renderDiagnostics(diagnostics);
  render(state);
  window.desktopAPI.harness.onState(render);
  window.desktopAPI.diagnostics.onState(renderDiagnostics);
};

elements.retry.addEventListener('click', async () => {
  elements.retry.disabled = true;
  elements.live.textContent = '正在重新启动 Harness…';
  const result = await window.desktopAPI.harness.restart();
  if (!result.ok) {
    elements.retry.disabled = false;
    elements.live.textContent = result.error || '重新启动失败。';
  }
});

elements.openLog.addEventListener('click', () => window.desktopAPI.harness.openLog());
elements.openNetwork.addEventListener('click', () => {
  const opened = window.__DSH_NETWORK__?.open?.();
  if (opened === false || opened == null) elements.live.textContent = '网络与代理入口暂不可用，请稍后重试。';
});

elements.chooseWorkspace.addEventListener('click', async () => {
  elements.chooseWorkspace.disabled = true;
  elements.live.textContent = '请选择一个本地代码仓库…';
  const result = await window.desktopAPI.workspace.choose();
  if (result?.canceled) {
    elements.chooseWorkspace.disabled = false;
    elements.live.textContent = '未更改当前仓库。';
  } else if (!result?.ok) {
    elements.chooseWorkspace.disabled = false;
    elements.live.textContent = result?.error || '无法打开所选仓库。';
  }
});

void init();
