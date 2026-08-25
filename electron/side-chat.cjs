const path = require('node:path');
const {
  callHarnessApi,
  isSessionId,
  pathKey,
  readHarnessSessionSelection
} = require('./harness-workspace-sync.cjs');

const SIDE_CHAT_PERMISSION = 'workspace-write';
const SIDE_CHAT_TITLE_LIMIT = 96;

class SideChatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SideChatError';
    this.code = code;
  }
}

const boundedTitle = (value) => {
  const normalized = String(value || '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  return normalized.length <= SIDE_CHAT_TITLE_LIMIT
    ? normalized
    : `${normalized.slice(0, SIDE_CHAT_TITLE_LIMIT - 1)}…`;
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};

const protectedMainState = (history) => {
  return JSON.stringify(stableValue(history?.projections?.values ?? null));
};

const titleOf = (summary) => {
  const projected = summary?.projections?.values?.title;
  if (typeof projected === 'string' && projected.trim()) return boundedTitle(projected);
  if (typeof summary?.cwd === 'string' && summary.cwd.trim()) return boundedTitle(path.basename(summary.cwd));
  return '主会话';
};

class SideChatController {
  constructor({
    getOrigin,
    apiCall = callHarnessApi,
    readSelection = readHarnessSessionSelection,
    permissionAttempts = 24,
    permissionIntervalMs = 100,
    delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {
    this.getOrigin = getOrigin;
    this.apiCall = apiCall;
    this.readSelection = readSelection;
    this.permissionAttempts = Number.isInteger(permissionAttempts)
      ? Math.min(40, Math.max(1, permissionAttempts))
      : 24;
    this.permissionIntervalMs = Number.isFinite(permissionIntervalMs)
      ? Math.min(500, Math.max(0, permissionIntervalMs))
      : 100;
    this.delay = delay;
  }

  async _call(method, payload) {
    const origin = this.getOrigin?.();
    if (typeof origin !== 'string' || !origin) throw new SideChatError('harness-unavailable', 'Harness 尚未就绪。');
    return this.apiCall(origin, method, payload, { timeoutMs: 8000 });
  }

  async _waitForPermission(sessionId) {
    for (let attempt = 1; attempt <= this.permissionAttempts; attempt += 1) {
      const history = await this._call('session.history', { sessionId, maxMessages: 1 });
      if (history?.projections?.values?.permissions?.currentValue === SIDE_CHAT_PERMISSION) return history;
      if (attempt < this.permissionAttempts) await this.delay(this.permissionIntervalMs);
    }
    throw new SideChatError('permission-unverified', 'Side Chat 权限投影未确认 Workspace Write / Ask。');
  }

  async create({ mainWebContents, workspacePath, agentState = {} } = {}) {
    if (!mainWebContents) throw new SideChatError('main-window-unavailable', '主会话窗口尚未就绪。');
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new SideChatError('workspace-unavailable', '当前工作区不是可用的本机目录。');
    }
    if (agentState.status !== 'ready'
      || Number(agentState.pendingCount || 0) > 0
      || Number(agentState.queuedCount || 0) > 0) {
      throw new SideChatError('main-busy', '请等待主会话完成当前轮次和确认，再打开 Side Chat。');
    }

    const sourceSessionId = await this.readSelection(mainWebContents);
    if (!isSessionId(sourceSessionId)) throw new SideChatError('session-unavailable', '当前没有可分支的 Harness 主会话。');
    const beforeList = await this._call('session.list', {});
    const beforeItems = Array.isArray(beforeList?.items) ? beforeList.items : [];
    const source = beforeItems.find((item) => item?.sessionId === sourceSessionId);
    if (!source) throw new SideChatError('session-unavailable', '当前主会话尚未进入 Harness 会话目录。');
    if (source.origin === 'subagent') throw new SideChatError('subagent-selected', '请先在主窗口切回普通会话，再打开 Side Chat。');
    if (source.running === true) throw new SideChatError('main-busy', '主会话仍在运行，请等待当前轮次结束。');
    if (typeof source.cwd !== 'string' || !path.isAbsolute(source.cwd) || pathKey(source.cwd) !== pathKey(workspacePath)) {
      throw new SideChatError('workspace-mismatch', '主会话工作目录与当前 DSH 工作区不一致。');
    }

    const beforeHistory = await this._call('session.history', { sessionId: sourceSessionId, maxMessages: 1 });
    const mainFingerprint = protectedMainState(beforeHistory);
    let sideSessionId;
    let kind;
    if (source.blank === true) {
      const workspaceResult = await this._call('workspace.create', { path: workspacePath });
      const workspace = workspaceResult?.workspace;
      if (!workspace?.workspaceId || pathKey(workspace.path) !== pathKey(workspacePath)) {
        throw new SideChatError('workspace-mismatch', 'Harness 未确认 Side Chat 的目标工作区。');
      }
      const created = await this._call('session.create', { workspaceId: workspace.workspaceId });
      sideSessionId = created?.sessionId;
      kind = 'fresh';
    } else {
      const forked = await this._call('session.fork', { sessionId: sourceSessionId });
      sideSessionId = forked?.sessionId;
      kind = 'fork';
    }
    if (!isSessionId(sideSessionId) || sideSessionId === sourceSessionId) {
      throw new SideChatError('invalid-side-session', 'Harness 没有返回独立的 Side Chat 会话。');
    }

    const permission = await this._call('session.prompt', {
      sessionId: sideSessionId,
      mode: 'queue',
      content: [{ type: 'text', text: `/permission ${SIDE_CHAT_PERMISSION}` }]
    });
    if (permission?.accepted !== true) {
      throw new SideChatError('permission-unverified', 'Harness 未确认 Side Chat 使用 Workspace Write / Ask。');
    }
    await this._waitForPermission(sideSessionId);

    const sideTitle = boundedTitle(`Side Chat · ${titleOf(source)}`);
    const renamed = await this._call('session.rename', { sessionId: sideSessionId, title: sideTitle });
    if (renamed?.title !== sideTitle) throw new SideChatError('rename-unverified', 'Harness 未确认 Side Chat 会话名称。');

    const [afterList, sideHistory, afterMainHistory] = await Promise.all([
      this._call('session.list', {}),
      this._call('session.history', { sessionId: sideSessionId, maxMessages: 1 }),
      this._call('session.history', { sessionId: sourceSessionId, maxMessages: 1 })
    ]);
    const afterItems = Array.isArray(afterList?.items) ? afterList.items : [];
    const side = afterItems.find((item) => item?.sessionId === sideSessionId);
    const sourceAfter = afterItems.find((item) => item?.sessionId === sourceSessionId);
    if (!side || typeof side.cwd !== 'string' || pathKey(side.cwd) !== pathKey(workspacePath) || side.origin === 'subagent') {
      throw new SideChatError('side-session-mismatch', 'Side Chat 会话没有保持主工作区的普通会话边界。');
    }
    if (kind === 'fork' && side.parentSessionId !== sourceSessionId) {
      throw new SideChatError('lineage-mismatch', 'Side Chat 分支没有保留主会话来源。');
    }
    const permissionProjection = sideHistory?.projections?.values?.permissions;
    if (permissionProjection?.currentValue !== SIDE_CHAT_PERMISSION) {
      throw new SideChatError('permission-unverified', 'Side Chat 权限投影未确认 Workspace Write / Ask。');
    }
    if (!sourceAfter
      || sourceAfter.origin === 'subagent'
      || sourceAfter.running === true
      || typeof sourceAfter.cwd !== 'string'
      || pathKey(sourceAfter.cwd) !== pathKey(workspacePath)
      || protectedMainState(afterMainHistory) !== mainFingerprint) {
      throw new SideChatError('main-state-changed', '主会话状态在 Side Chat 建立期间发生变化，请重新打开。');
    }

    return Object.freeze({
      kind,
      sourceSessionId,
      sideSessionId,
      sourceTitle: titleOf(source),
      sideTitle,
      workspacePath,
      permission: SIDE_CHAT_PERMISSION
    });
  }
}

module.exports = {
  SIDE_CHAT_PERMISSION,
  SideChatController,
  SideChatError,
  boundedTitle,
  protectedMainState
};
