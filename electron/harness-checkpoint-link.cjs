const path = require('node:path');
const {
  callHarnessApi,
  isSessionId,
  pathKey,
  readHarnessSessionSelection
} = require('./harness-workspace-sync.cjs');

const HISTORY_MESSAGE_LIMIT = 2;
const CHECKPOINT_LINK_TIMEOUT_MS = 2500;

class HarnessCheckpointLinkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessCheckpointLinkError';
    this.code = code;
  }
}

const completedTurnSeq = (history) => {
  const events = Array.isArray(history?.events) ? history.events : [];
  const completed = events
    .filter((entry) => entry?.event?.type === 'turn/end' && Number.isInteger(entry.event.seq) && entry.event.seq >= 0)
    .map((entry) => entry.event.seq);
  return completed.length > 0 ? Math.max(...completed) : null;
};

const findWorkspaceSession = (sessionList, sessionId, workspacePath) => {
  const items = Array.isArray(sessionList?.items) ? sessionList.items : [];
  return items.find((item) => item?.sessionId === sessionId
    && isSessionId(item.sessionId)
    && typeof item.cwd === 'string'
    && pathKey(item.cwd) === pathKey(workspacePath));
};

const captureHarnessCheckpointLink = async ({
  origin,
  webContents,
  workspacePath,
  apiCall = callHarnessApi,
  readSelection = readHarnessSessionSelection,
  timeoutMs = CHECKPOINT_LINK_TIMEOUT_MS
}) => {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
    throw new HarnessCheckpointLinkError('invalid-workspace', '检查点会话关联要求绝对工作区路径。');
  }
  const sessionId = await readSelection(webContents);
  if (!isSessionId(sessionId)) {
    throw new HarnessCheckpointLinkError('no-current-session', 'Harness 页面没有可关联的当前会话。');
  }
  const [sessionList, history] = await Promise.all([
    apiCall(origin, 'session.list', {}, { timeoutMs }),
    apiCall(origin, 'session.history', { sessionId, maxMessages: HISTORY_MESSAGE_LIMIT }, { timeoutMs })
  ]);
  const session = findWorkspaceSession(sessionList, sessionId, workspacePath);
  if (!session || session.origin === 'subagent') {
    throw new HarnessCheckpointLinkError('session-workspace-mismatch', '当前 Harness 会话不属于桌面所选工作区。');
  }
  if (session.running) {
    throw new HarnessCheckpointLinkError('session-running', '当前 Harness 会话仍在运行。');
  }
  const atSeq = completedTurnSeq(history);
  return Object.freeze({
    sessionId,
    atSeq,
    linked: true,
    forkAvailable: Number.isInteger(atSeq),
    reason: Number.isInteger(atSeq) ? 'ready' : 'no-completed-turn'
  });
};

const forkHarnessCheckpointSession = async ({
  origin,
  workspacePath,
  sessionId,
  atSeq,
  apiCall = callHarnessApi,
  timeoutMs = 8000
}) => {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
    throw new HarnessCheckpointLinkError('invalid-workspace', '会话分支要求绝对工作区路径。');
  }
  if (!isSessionId(sessionId) || !Number.isInteger(atSeq) || atSeq < 0) {
    throw new HarnessCheckpointLinkError('checkpoint-not-forkable', '所选检查点没有可分支的完整 Harness 回合。');
  }
  const before = await apiCall(origin, 'session.list', {}, { timeoutMs });
  const source = findWorkspaceSession(before, sessionId, workspacePath);
  if (!source || source.origin === 'subagent') {
    throw new HarnessCheckpointLinkError('source-session-unavailable', '检查点关联的源会话已不可用或不属于当前工作区。');
  }
  if (source.running) {
    throw new HarnessCheckpointLinkError('source-session-running', '检查点关联的源会话仍在运行。');
  }

  const forked = await apiCall(origin, 'session.fork', { sessionId, atSeq }, { timeoutMs });
  const childSessionId = forked?.sessionId;
  if (!isSessionId(childSessionId) || childSessionId === sessionId) {
    throw new HarnessCheckpointLinkError('invalid-fork-response', 'Harness 没有返回有效的新会话分支。');
  }
  const after = await apiCall(origin, 'session.list', {}, { timeoutMs });
  const child = findWorkspaceSession(after, childSessionId, workspacePath);
  if (!child || child.parentSessionId !== sessionId || child.origin === 'subagent') {
    throw new HarnessCheckpointLinkError('fork-verification-failed', 'Harness 未能确认新会话的来源和工作区。');
  }
  return Object.freeze({ sourceSessionId: sessionId, sessionId: childSessionId, atSeq });
};

module.exports = {
  CHECKPOINT_LINK_TIMEOUT_MS,
  HISTORY_MESSAGE_LIMIT,
  HarnessCheckpointLinkError,
  captureHarnessCheckpointLink,
  completedTurnSeq,
  findWorkspaceSession,
  forkHarnessCheckpointSession
};
