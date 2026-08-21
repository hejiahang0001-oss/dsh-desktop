const { randomUUID } = require('node:crypto');
const path = require('node:path');

const SESSION_SELECTION_KEY = 'dsh.sessions.current';
const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HarnessWorkspaceSyncError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HarnessWorkspaceSyncError';
    this.code = code;
    this.details = details;
  }
}

const isSafeHarnessOrigin = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port) && url.pathname === '/';
  } catch {
    return false;
  }
};

const pathKey = (value) => {
  const normalized = path.normalize(String(value || '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
};

const isSessionId = (value) => typeof value === 'string' && SESSION_ID_PATTERN.test(value);

const callHarnessApi = async (origin, method, payload, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000
} = {}) => {
  if (!isSafeHarnessOrigin(origin)) {
    throw new HarnessWorkspaceSyncError('unsafe-origin', 'Harness 工作区同步地址不是受信任的随机回环地址。');
  }
  if (typeof method !== 'string' || !/^[A-Za-z][A-Za-z0-9.]*$/.test(method)) {
    throw new HarnessWorkspaceSyncError('invalid-method', 'Harness 工作区同步方法无效。');
  }
  if (typeof fetchImpl !== 'function') {
    throw new HarnessWorkspaceSyncError('fetch-unavailable', '当前运行时无法访问 Harness 工作区接口。');
  }

  const rpcId = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(`${origin}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: controller.signal
    });
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Harness 工作区同步超时。'
      : `Harness 工作区同步请求失败：${error?.message || String(error)}`;
    throw new HarnessWorkspaceSyncError('transport-failed', message);
  } finally {
    clearTimeout(timer);
  }

  if (!response?.ok) {
    throw new HarnessWorkspaceSyncError('http-failed', `Harness 工作区接口返回 HTTP ${response?.status || 'unknown'}。`);
  }

  let message;
  try {
    message = await response.json();
  } catch {
    throw new HarnessWorkspaceSyncError('invalid-response', 'Harness 工作区接口返回了无效 JSON。');
  }
  if (message?.type !== 'server-response' || message.rpcId !== rpcId || typeof message.result?.ok !== 'boolean') {
    throw new HarnessWorkspaceSyncError('invalid-response', 'Harness 工作区接口返回了不匹配的响应。');
  }
  if (!message.result.ok) {
    const error = message.result.error || {};
    throw new HarnessWorkspaceSyncError(
      typeof error.code === 'string' ? error.code : 'harness-rejected',
      typeof error.message === 'string' ? error.message : 'Harness 拒绝了工作区同步请求。',
      error.details && typeof error.details === 'object' ? error.details : {}
    );
  }
  return message.result.value;
};

const synchronizeHarnessWorkspace = async ({
  origin,
  workspacePath,
  fallbackTitle,
  fetchImpl = globalThis.fetch
}) => {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
    throw new HarnessWorkspaceSyncError('invalid-workspace', 'Harness 工作区必须是本机绝对目录。');
  }

  const created = await callHarnessApi(origin, 'workspace.create', { path: workspacePath }, { fetchImpl });
  let workspace = created?.workspace;
  if (!workspace?.workspaceId || pathKey(workspace.path) !== pathKey(workspacePath)) {
    throw new HarnessWorkspaceSyncError('workspace-mismatch', 'Harness 返回的工作区与桌面所选目录不一致。');
  }

  if (created.created === true && typeof fallbackTitle === 'string' && fallbackTitle.trim()) {
    try {
      const renamed = await callHarnessApi(origin, 'workspace.rename', {
        workspaceId: workspace.workspaceId,
        title: fallbackTitle.trim()
      }, { fetchImpl });
      if (renamed?.workspace?.workspaceId === workspace.workspaceId) workspace = renamed.workspace;
    } catch {
      // A friendly fallback title is cosmetic; path/session alignment remains the safety boundary.
    }
  }

  const [workspaceList, sessionList] = await Promise.all([
    callHarnessApi(origin, 'workspace.list', {}, { fetchImpl }),
    callHarnessApi(origin, 'session.list', {}, { fetchImpl })
  ]);
  const registered = Array.isArray(workspaceList?.items)
    ? workspaceList.items.find((item) => item?.workspaceId === workspace.workspaceId && pathKey(item.path) === pathKey(workspacePath))
    : undefined;
  if (!registered) {
    throw new HarnessWorkspaceSyncError('workspace-not-registered', 'Harness 没有在工作区注册表中确认桌面所选目录。');
  }

  const archived = new Set(Array.isArray(workspaceList.archivedSessionIds) ? workspaceList.archivedSessionIds : []);
  const memberIds = new Set(Array.isArray(registered.sessionIds) ? registered.sessionIds : []);
  const sessions = Array.isArray(sessionList?.items) ? sessionList.items : [];
  const reusable = sessions
    .filter((item) => item?.blank === true
      && isSessionId(item.sessionId)
      && memberIds.has(item.sessionId)
      && !archived.has(item.sessionId)
      && pathKey(item.cwd) === pathKey(workspacePath))
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];

  let sessionId = reusable?.sessionId;
  let sessionCreated = false;
  if (!sessionId) {
    const session = await callHarnessApi(origin, 'session.create', { workspaceId: workspace.workspaceId }, { fetchImpl });
    sessionId = session?.sessionId;
    sessionCreated = true;
  }
  if (!isSessionId(sessionId)) {
    throw new HarnessWorkspaceSyncError('invalid-session', 'Harness 没有返回可用于目标工作区的有效会话。');
  }

  return Object.freeze({
    status: 'synced',
    workspacePath,
    workspaceId: workspace.workspaceId,
    workspaceTitle: workspace.title,
    workspaceCreated: created.created === true,
    sessionId,
    sessionCreated
  });
};

const getHarnessSessionSelectionScript = (sessionId) => {
  if (!isSessionId(sessionId)) throw new HarnessWorkspaceSyncError('invalid-session', 'Harness 会话标识无效。');
  const key = JSON.stringify(SESSION_SELECTION_KEY);
  const id = JSON.stringify(sessionId);
  return `(() => {
    const key = ${key};
    const sessionId = ${id};
    let current;
    try { current = JSON.parse(localStorage.getItem(key) || '{}').sessionId; } catch { current = undefined; }
    if (current === sessionId) return { changed: false, sessionId };
    localStorage.setItem(key, JSON.stringify({ sessionId }));
    return { changed: true, sessionId };
  })()`;
};

const getHarnessSessionSelectionReadScript = () => `(() => {
  try {
    const value = JSON.parse(localStorage.getItem(${JSON.stringify(SESSION_SELECTION_KEY)}) || '{}');
    return { sessionId: typeof value.sessionId === 'string' ? value.sessionId : '' };
  } catch {
    return { sessionId: '' };
  }
})()`;

const selectHarnessSession = async (webContents, sessionId) => {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') {
    throw new HarnessWorkspaceSyncError('web-contents-unavailable', 'Harness 页面尚未准备好接收工作区会话。');
  }
  const result = await webContents.executeJavaScript(getHarnessSessionSelectionScript(sessionId), true);
  if (result?.sessionId !== sessionId || typeof result.changed !== 'boolean') {
    throw new HarnessWorkspaceSyncError('selection-failed', 'Harness 页面没有确认目标工作区会话。');
  }
  return result;
};

const readHarnessSessionSelection = async (webContents) => {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') {
    throw new HarnessWorkspaceSyncError('web-contents-unavailable', 'Harness 页面尚未准备好读取工作区会话。');
  }
  const result = await webContents.executeJavaScript(getHarnessSessionSelectionReadScript(), true);
  return isSessionId(result?.sessionId) ? result.sessionId : '';
};

const waitForHarnessSessionSelection = async (webContents, sessionId, {
  timeoutMs = 8000,
  intervalMs = 100,
  delayImpl = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
} = {}) => {
  if (!isSessionId(sessionId)) throw new HarnessWorkspaceSyncError('invalid-session', 'Harness 会话标识无效。');
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  do {
    attempts += 1;
    const current = await readHarnessSessionSelection(webContents);
    if (current === sessionId) return Object.freeze({ sessionId, attempts });
    if (Date.now() >= deadline) break;
    await delayImpl(intervalMs);
  } while (true);
  throw new HarnessWorkspaceSyncError('selection-timeout', 'Harness 工作区会话未能在启动后稳定切换。');
};

module.exports = {
  HarnessWorkspaceSyncError,
  SESSION_SELECTION_KEY,
  callHarnessApi,
  getHarnessSessionSelectionReadScript,
  getHarnessSessionSelectionScript,
  isSafeHarnessOrigin,
  isSessionId,
  pathKey,
  readHarnessSessionSelection,
  selectHarnessSession,
  synchronizeHarnessWorkspace,
  waitForHarnessSessionSelection
};
