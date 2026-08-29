const ACTIVE_STATES = new Set(['running', 'waiting']);
const SAFE_STATES = new Set(['unavailable', 'ready', 'running', 'waiting']);

const safeCount = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

const normalizeAgentSnapshot = (value = {}) => Object.freeze({
  status: SAFE_STATES.has(value.status) ? value.status : 'unavailable',
  failedToolCount: safeCount(value.failedToolCount),
  stoppedToolCount: safeCount(value.stoppedToolCount),
  latestToolState: ['none', 'running', 'ok', 'error', 'stopped'].includes(value.latestToolState)
    ? value.latestToolState
    : 'none',
  latestTestState: ['none', 'running', 'passed', 'failed', 'stopped'].includes(value.latestTestState)
    ? value.latestTestState
    : 'none'
});

const notificationCopy = (type) => {
  const copies = {
    waiting: Object.freeze({ title: 'DSH Desktop 需要确认', body: 'Agent 正在等待你的确认。', focusAction: 'focus-pending' }),
    completed: Object.freeze({ title: 'DSH Desktop 任务已完成', body: 'Agent 已结束本轮工作。', focusAction: 'focus-agent-input' }),
    failed: Object.freeze({ title: 'DSH Desktop 任务存在失败', body: '检测到失败的工具或测试，请打开 DSH 查看详情。', focusAction: 'focus-latest-tool' }),
    stopped: Object.freeze({ title: 'DSH Desktop 任务已停止', body: '本轮 Agent 工作已停止。', focusAction: 'focus-agent-input' }),
    disconnected: Object.freeze({ title: 'DSH Desktop 连接中断', body: 'Agent 运行期间 Harness 变为不可用，请打开 DSH 检查。', focusAction: null })
  };
  return copies[type] || null;
};

class AgentTransitionTracker {
  constructor(initial = {}) {
    this.last = normalizeAgentSnapshot(initial);
    this.activeBaseline = null;
    this.waitingNotified = false;
  }

  observe(value = {}) {
    const next = normalizeAgentSnapshot(value);
    const wasActive = ACTIVE_STATES.has(this.last.status);
    const isActive = ACTIVE_STATES.has(next.status);
    let type = null;

    if (!wasActive && isActive) {
      this.activeBaseline = Object.freeze({
        failedToolCount: next.failedToolCount,
        stoppedToolCount: next.stoppedToolCount
      });
      this.waitingNotified = false;
      if (next.status === 'waiting') {
        type = 'waiting';
        this.waitingNotified = true;
      }
    } else if (wasActive && isActive && next.status === 'waiting' && !this.waitingNotified) {
      type = 'waiting';
      this.waitingNotified = true;
    } else if (wasActive && !isActive) {
      const baseline = this.activeBaseline || this.last;
      if (next.status === 'ready') {
        const failed = next.failedToolCount > baseline.failedToolCount
          || next.latestToolState === 'error'
          || next.latestTestState === 'failed';
        const stopped = !failed && (next.stoppedToolCount > baseline.stoppedToolCount
          || next.latestToolState === 'stopped'
          || next.latestTestState === 'stopped');
        type = failed ? 'failed' : stopped ? 'stopped' : 'completed';
      } else if (next.status === 'unavailable') {
        type = 'disconnected';
      }
      this.activeBaseline = null;
      this.waitingNotified = false;
    }

    this.last = next;
    const copy = notificationCopy(type);
    return copy ? Object.freeze({ type, ...copy }) : null;
  }
}

const trayStatusLabel = (value = {}) => {
  const state = normalizeAgentSnapshot(value);
  if (state.status === 'running') return 'Agent：正在运行';
  if (state.status === 'waiting') return 'Agent：等待确认';
  if (state.status === 'ready') return 'Agent：可以开始';
  return 'Agent：暂不可用';
};

const isBackgroundSupervisionRequired = (value = {}) => ACTIVE_STATES.has(normalizeAgentSnapshot(value).status);

module.exports = {
  AgentTransitionTracker,
  isBackgroundSupervisionRequired,
  normalizeAgentSnapshot,
  notificationCopy,
  trayStatusLabel
};
