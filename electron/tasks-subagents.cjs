const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { callHarnessApi, isSessionId, pathKey, readHarnessSessionSelection } = require('./harness-workspace-sync.cjs');

const MAX_TREE_ENTRIES = 32;
const MAX_TREE_DEPTH = 5;
const MAX_FOLLOWUP_LENGTH = 8000;
const MAX_JOB_ENTRIES = 32;
const MAX_LABEL_LENGTH = 240;
const UI_ID_PATTERN = /^[0-9a-f]{24}$/;
const MODES = new Set(['one-shot', 'continuable']);

class TasksSubagentsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TasksSubagentsError';
    this.code = code;
  }
}

const boundedText = (value, limit = MAX_LABEL_LENGTH) => {
  const normalized = String(value || '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
};

const redactSensitiveText = (value) => boundedText(value)
  .replace(/\b(?:authorization\s*:\s*bearer|bearer)\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [已隐藏]')
  .replace(/\b(DEEPSEEK_API_KEY|API[_ -]?KEY|ACCESS[_ -]?TOKEN|PASSWORD|SECRET)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, (_match, name) => `${name}=[已隐藏]`)
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[已隐藏]');

const titleOf = (summary) => {
  const projected = summary?.projections?.values?.title;
  if (typeof projected === 'string' && projected.trim()) return boundedText(projected, 120);
  if (typeof summary?.cwd === 'string' && summary.cwd.trim()) return boundedText(path.basename(summary.cwd), 120);
  return isSessionId(summary?.sessionId) ? `会话 …${summary.sessionId.slice(-8)}` : '当前会话';
};

const unavailableState = (message = 'Harness 任务状态尚未就绪。') => Object.freeze({
  available: false,
  source: 'DeepSeek Harness',
  message,
  current: null,
  root: null,
  counts: Object.freeze({ subagents: 0, runningSubagents: 0, backgroundJobs: 0, liveJobs: 0, pending: 0, sharedWorkspaces: 0 }),
  subagents: Object.freeze([]),
  jobs: Object.freeze({ status: 'unavailable', readOnly: true, entries: Object.freeze([]) }),
  agent: Object.freeze({ status: 'unavailable', pendingCount: 0, queuedCount: 0 })
});

const normalizeAgentState = (state = {}) => Object.freeze({
  status: ['running', 'waiting', 'ready', 'unavailable'].includes(state.status) ? state.status : 'unavailable',
  pendingCount: Number.isSafeInteger(state.pendingCount) && state.pendingCount > 0 ? state.pendingCount : 0,
  queuedCount: Number.isSafeInteger(state.queuedCount) && state.queuedCount > 0 ? state.queuedCount : 0
});

const normalizeJobsSnapshot = (snapshot = {}) => {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries.slice(0, MAX_JOB_ENTRIES).map((entry) => Object.freeze({
    kind: boundedText(entry?.kind, 40) || 'task',
    label: redactSensitiveText(entry?.label) || '未命名后台任务',
    status: boundedText(entry?.status, 80) || '状态未知',
    duration: boundedText(entry?.duration, 80),
    live: entry?.live === true
  })) : [];
  return Object.freeze({
    status: ['ready', 'none', 'unavailable'].includes(snapshot.status) ? snapshot.status : 'unavailable',
    readOnly: true,
    entries: Object.freeze(entries)
  });
};

const getHarnessJobsSnapshotScript = () => `(async () => {
  const triggers = Array.from(document.querySelectorAll('button[aria-label]'));
  const trigger = triggers.find((element) => {
    const label = (element.getAttribute('aria-label') || '').trim();
    return /^\\d+\\s*个后台任务/.test(label) || /^\\d+\\s+background jobs?/.test(label);
  });
  if (!trigger) return { status: 'none', entries: [] };
  const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
  if (!wasOpen) {
    trigger.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  const list = document.querySelector('ul[aria-label="后台任务"], ul[aria-label="Background jobs"]');
  const entries = list ? Array.from(list.children).slice(0, ${MAX_JOB_ENTRIES}).map((row) => {
    const columns = Array.from(row.querySelectorAll('span')).map((node) => (node.textContent || '').trim()).filter(Boolean);
    const status = columns.at(-2) || '';
    return {
      kind: columns[0] || 'task',
      label: columns[1] || row.getAttribute('title') || 'background task',
      status,
      duration: columns.at(-1) || '',
      live: /^(?:运行中|正在停止|running|stopping)$/i.test(status)
    };
  }) : [];
  if (!wasOpen && trigger.isConnected && trigger.getAttribute('aria-expanded') === 'true') trigger.click();
  return { status: entries.length > 0 ? 'ready' : 'none', entries };
})()`;

const readHarnessJobsSnapshot = async (webContents) => {
  if (!webContents || typeof webContents.executeJavaScript !== 'function') {
    return normalizeJobsSnapshot({ status: 'unavailable', entries: [] });
  }
  try {
    return normalizeJobsSnapshot(await webContents.executeJavaScript(getHarnessJobsSnapshotScript(), true));
  } catch {
    return normalizeJobsSnapshot({ status: 'unavailable', entries: [] });
  }
};

const getHarnessSubagentSelectionScript = (address) => {
  if (!isSessionId(address?.parentSessionId) || !isSessionId(address?.childSessionId) || !MODES.has(address?.mode)) {
    throw new TasksSubagentsError('invalid-address', '子代理地址无效。');
  }
  const selection = JSON.stringify({
    sessionId: address.childSessionId,
    subagentAddress: {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      mode: address.mode
    }
  });
  return `(() => { localStorage.setItem('dsh.sessions.current', ${JSON.stringify(selection)}); return true; })()`;
};

class TasksSubagentsController {
  constructor({
    getOrigin,
    getWebContents,
    apiCall = callHarnessApi,
    readSelection = readHarnessSessionSelection,
    readJobs = readHarnessJobsSnapshot,
    mintId = () => randomBytes(12).toString('hex')
  } = {}) {
    this.getOrigin = getOrigin;
    this.getWebContents = getWebContents;
    this.apiCall = apiCall;
    this.readSelection = readSelection;
    this.readJobs = readJobs;
    this.mintId = mintId;
    this.actions = new Map();
    this.ids = new Map();
    this.scanPromise = null;
  }

  _idFor(key) {
    const existing = this.ids.get(key);
    if (existing) return existing;
    const id = this.mintId();
    if (!UI_ID_PATTERN.test(id)) throw new TasksSubagentsError('invalid-ui-id', '任务面板内部标识无效。');
    this.ids.set(key, id);
    return id;
  }

  async _call(method, payload) {
    const origin = this.getOrigin?.();
    if (typeof origin !== 'string' || !origin) throw new TasksSubagentsError('harness-unavailable', 'Harness 尚未就绪。');
    return this.apiCall(origin, method, payload, { timeoutMs: 5000 });
  }

  scan(options = {}) {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this._scan(options).finally(() => { this.scanPromise = null; });
    return this.scanPromise;
  }

  async _scan({ agentDiagnostics, workspacePath = '', workspaceName = '' } = {}) {
    const webContents = this.getWebContents?.();
    if (!webContents) return unavailableState();
    try {
      const currentSessionId = await this.readSelection(webContents);
      if (!isSessionId(currentSessionId)) return unavailableState('当前没有可读取的 Harness 会话。');
      const [sessionList, jobs] = await Promise.all([
        this._call('session.list', {}),
        this.readJobs(webContents)
      ]);
      const summaries = Array.isArray(sessionList?.items) ? sessionList.items.filter((item) => isSessionId(item?.sessionId)) : [];
      const byId = new Map(summaries.map((item) => [item.sessionId, item]));
      const currentSummary = byId.get(currentSessionId);
      if (!currentSummary) return unavailableState('当前 Harness 会话尚未进入会话目录。');

      let rootSummary = currentSummary;
      const lineageSeen = new Set();
      for (let depth = 0; depth < 16 && rootSummary?.origin === 'subagent' && isSessionId(rootSummary.parentSessionId); depth += 1) {
        if (lineageSeen.has(rootSummary.sessionId)) break;
        lineageSeen.add(rootSummary.sessionId);
        const parent = byId.get(rootSummary.parentSessionId);
        if (!parent) break;
        rootSummary = parent;
      }

      const activeWorkspaceKey = typeof workspacePath === 'string' && path.isAbsolute(workspacePath) ? pathKey(workspacePath) : '';
      const runningCwdCounts = new Map();
      for (const summary of summaries) {
        if (summary.running !== true || typeof summary.cwd !== 'string' || !path.isAbsolute(summary.cwd)) continue;
        const key = pathKey(summary.cwd);
        runningCwdCounts.set(key, (runningCwdCounts.get(key) || 0) + 1);
      }

      const actions = new Map();
      const usedKeys = new Set();
      const rows = [];
      const queue = [{ parentSessionId: rootSummary.sessionId, depth: 0 }];
      const scannedParents = new Set();
      while (queue.length > 0 && rows.length < MAX_TREE_ENTRIES) {
        const next = queue.shift();
        if (!next || scannedParents.has(next.parentSessionId) || next.depth >= MAX_TREE_DEPTH) continue;
        scannedParents.add(next.parentSessionId);
        let catalog;
        try {
          catalog = await this._call('subagent.list', { parentSessionId: next.parentSessionId });
        } catch (error) {
          const diagnosticKey = `catalog:${next.parentSessionId}`;
          usedKeys.add(diagnosticKey);
          rows.push(Object.freeze({
            id: this._idFor(diagnosticKey),
            kind: 'diagnostic',
            depth: next.depth,
            label: boundedText(error?.message, 120) || '子代理目录暂时不可用',
            reason: 'unavailable',
            current: false
          }));
          continue;
        }
        const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
        for (const entry of entries) {
          if (rows.length >= MAX_TREE_ENTRIES) break;
          const actionKey = entry?.kind === 'child' && isSessionId(entry.id) && MODES.has(entry.mode)
            ? `child:${next.parentSessionId}:${entry.id}:${entry.mode}`
            : `diagnostic:${next.parentSessionId}:${String(entry?.id || rows.length)}`;
          usedKeys.add(actionKey);
          const id = this._idFor(actionKey);
          if (entry?.kind !== 'child' || !isSessionId(entry.id) || !MODES.has(entry.mode)) {
            rows.push(Object.freeze({
              id,
              kind: 'diagnostic',
              depth: next.depth,
              label: `目录诊断 …${String(entry?.id || '').slice(-8) || 'unknown'}`,
              reason: ['corrupt', 'unsupported', 'unavailable'].includes(entry?.reason) ? entry.reason : 'unavailable',
              current: false
            }));
            continue;
          }
          const record = Object.freeze({
            parentSessionId: next.parentSessionId,
            childSessionId: entry.id,
            mode: entry.mode
          });
          actions.set(id, record);
          const summary = byId.get(entry.id);
          const label = boundedText(entry.label, 120) || titleOf(summary) || `子代理 …${entry.id.slice(-8)}`;
          const cwdKey = typeof summary?.cwd === 'string' && path.isAbsolute(summary.cwd) ? pathKey(summary.cwd) : '';
          const workspace = !cwdKey ? 'unknown' : activeWorkspaceKey && cwdKey === activeWorkspaceKey ? 'current' : 'other';
          const row = Object.freeze({
            id,
            kind: 'child',
            depth: next.depth,
            label,
            sessionSuffix: entry.id.slice(-8),
            mode: entry.mode,
            activity: entry.activity === 'running' ? 'running' : 'inactive',
            hasChildren: entry.hasChildren === true,
            current: entry.id === currentSessionId,
            workspace,
            workspaceLabel: workspace === 'current'
              ? boundedText(workspaceName, 80) || path.basename(summary.cwd)
              : workspace === 'other' ? boundedText(path.basename(summary.cwd), 80) : '未记录工作目录',
            workspaceShared: entry.activity === 'running' && Boolean(cwdKey) && (runningCwdCounts.get(cwdKey) || 0) > 1,
            canOpen: true,
            canPrompt: entry.mode === 'continuable' && catalog?.parentAvailable === true,
            canInterrupt: entry.mode === 'continuable' && entry.activity === 'running'
          });
          rows.push(row);
          if (row.hasChildren && next.depth + 1 < MAX_TREE_DEPTH) {
            queue.push({ parentSessionId: entry.id, depth: next.depth + 1 });
          }
        }
      }
      for (const key of this.ids.keys()) if (!usedKeys.has(key)) this.ids.delete(key);
      this.actions = actions;
      const agent = normalizeAgentState(agentDiagnostics);
      const normalizedJobs = normalizeJobsSnapshot(jobs);
      return Object.freeze({
        available: true,
        source: 'DeepSeek Harness',
        message: rows.length >= MAX_TREE_ENTRIES ? `仅显示前 ${MAX_TREE_ENTRIES} 个子代理。` : '',
        current: Object.freeze({
          title: titleOf(currentSummary),
          sessionSuffix: currentSessionId.slice(-8),
          kind: currentSummary.origin === 'subagent' ? 'subagent' : 'session',
          running: currentSummary.running === true
        }),
        root: Object.freeze({
          title: titleOf(rootSummary),
          sessionSuffix: rootSummary.sessionId.slice(-8)
        }),
        counts: Object.freeze({
          subagents: rows.filter((item) => item.kind === 'child').length,
          runningSubagents: rows.filter((item) => item.kind === 'child' && item.activity === 'running').length,
          backgroundJobs: normalizedJobs.entries.length,
          liveJobs: normalizedJobs.entries.filter((item) => item.live).length,
          pending: agent.pendingCount,
          sharedWorkspaces: rows.filter((item) => item.kind === 'child' && item.workspaceShared).length
        }),
        subagents: Object.freeze(rows),
        jobs: normalizedJobs,
        agent
      });
    } catch (error) {
      this.actions.clear();
      return unavailableState(error?.message || 'Harness 任务状态读取失败。');
    }
  }

  async _resolve(id, { requireContinuable = false, requireParent = false, requireRunning = false } = {}) {
    if (typeof id !== 'string' || !UI_ID_PATTERN.test(id)) throw new TasksSubagentsError('invalid-id', '子代理标识无效。');
    const record = this.actions.get(id);
    if (!record) throw new TasksSubagentsError('stale-id', '子代理目录已变化，请刷新后重试。');
    const catalog = await this._call('subagent.list', { parentSessionId: record.parentSessionId });
    const entry = Array.isArray(catalog?.entries)
      ? catalog.entries.find((item) => item?.kind === 'child' && item.id === record.childSessionId && item.mode === record.mode)
      : null;
    if (!entry) throw new TasksSubagentsError('stale-entry', '子代理目录已变化，请刷新后重试。');
    if (requireContinuable && entry.mode !== 'continuable') throw new TasksSubagentsError('not-continuable', '一次性子代理不接受补充消息或中断。');
    if (requireParent && catalog.parentAvailable !== true) throw new TasksSubagentsError('parent-unavailable', '直接父任务当前不可用，无法接收补充消息。');
    if (requireRunning && entry.activity !== 'running') throw new TasksSubagentsError('not-running', '子代理当前轮次已经结束，无需再发送中断请求。');
    return Object.freeze({ record, entry, parentAvailable: catalog.parentAvailable === true });
  }

  async address(id) {
    const { record } = await this._resolve(id);
    return record;
  }

  async prompt(id, text) {
    const content = typeof text === 'string' ? text.trim() : '';
    if (!content || content.length > MAX_FOLLOWUP_LENGTH || content.includes('\0')) {
      throw new TasksSubagentsError('invalid-message', `补充消息必须为 1–${MAX_FOLLOWUP_LENGTH} 个字符。`);
    }
    const { record } = await this._resolve(id, { requireContinuable: true, requireParent: true });
    const receipt = await this._call('subagent.prompt', {
      parentSessionId: record.parentSessionId,
      childSessionId: record.childSessionId,
      mode: 'continuable',
      content: [{ type: 'text', text: content }]
    });
    if (typeof receipt?.messageId !== 'string' || !receipt.messageId) {
      throw new TasksSubagentsError('invalid-receipt', 'Harness 未确认补充消息进入队列。');
    }
    return Object.freeze({ ok: true, accepted: true, message: '补充消息已进入子代理队列；这不代表任务已经完成。' });
  }

  async interrupt(id) {
    const { record } = await this._resolve(id, { requireContinuable: true, requireRunning: true });
    const receipt = await this._call('subagent.interrupt', {
      parentSessionId: record.parentSessionId,
      childSessionId: record.childSessionId,
      mode: 'continuable'
    });
    if (receipt?.accepted !== true) throw new TasksSubagentsError('invalid-receipt', 'Harness 未确认中断请求。');
    return Object.freeze({ ok: true, accepted: true, message: '中断请求已受理；子代理可能短暂仍显示为运行中。' });
  }
}

module.exports = {
  MAX_FOLLOWUP_LENGTH,
  MAX_JOB_ENTRIES,
  MAX_TREE_DEPTH,
  MAX_TREE_ENTRIES,
  TasksSubagentsController,
  TasksSubagentsError,
  getHarnessJobsSnapshotScript,
  getHarnessSubagentSelectionScript,
  normalizeJobsSnapshot,
  redactSensitiveText,
  readHarnessJobsSnapshot,
  unavailableState
};
