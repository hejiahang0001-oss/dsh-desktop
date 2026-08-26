const {
  callHarnessApi,
  isSafeHarnessOrigin,
  isSessionId,
  pathKey,
  readHarnessSessionSelection
} = require('./harness-workspace-sync.cjs');

const MAX_INTERRUPT_PROMPT_LENGTH = 8000;
const DEFAULT_IDLE_CHECKS = 40;
const IDLE_CHECK_DELAY_MS = 100;
const MAX_QUEUE_ITEMS = 512;

class ReliableInterruptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReliableInterruptError';
    this.code = code;
  }
}

const normalizedPrompt = (value) => {
  if (typeof value !== 'string' || value.includes('\0')) return '';
  const prompt = value.trim();
  return prompt.length <= MAX_INTERRUPT_PROMPT_LENGTH ? prompt : '';
};

const readHarnessQueueSnapshot = async (origin, sessionId, {
  webSocketImpl = globalThis.WebSocket,
  timeoutMs = 2500
} = {}) => {
  if (!isSafeHarnessOrigin(origin) || !isSessionId(sessionId) || typeof webSocketImpl !== 'function') {
    throw new ReliableInterruptError('queue-unavailable', 'Harness 排队消息地址未通过安全校验。');
  }
  const socketUrl = `${origin.replace(/^http:/, 'ws:')}/api/events.mux`;
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    const finish = (error, items) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch { /* The one-shot downlink is already closed. */ }
      if (error) reject(error);
      else resolve(items);
    };
    const timer = setTimeout(() => {
      finish(new ReliableInterruptError('queue-timeout', '读取 Harness 排队消息超时。'));
    }, timeoutMs);
    timer.unref?.();
    try {
      socket = new webSocketImpl(socketUrl);
    } catch {
      finish(new ReliableInterruptError('queue-unavailable', '无法建立 Harness 排队消息通道。'));
      return;
    }
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      const payload = frame?.payload;
      if (payload?.type === 'session/queue' && payload.sessionId === sessionId) {
        finish(null, Array.isArray(payload.items) ? payload.items.slice(0, MAX_QUEUE_ITEMS) : []);
      }
    });
    socket.addEventListener('error', () => {
      finish(new ReliableInterruptError('queue-unavailable', '读取 Harness 排队消息失败。'));
    });
    socket.addEventListener('close', () => {
      finish(new ReliableInterruptError('queue-unavailable', 'Harness 排队消息通道提前关闭。'));
    });
  });
};

class ReliableInterruptController {
  constructor({
    getOrigin,
    getWebContents,
    getWorkspacePath,
    apiCall = callHarnessApi,
    readQueue = readHarnessQueueSnapshot,
    readSelection = readHarnessSessionSelection,
    wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
  } = {}) {
    this.getOrigin = getOrigin;
    this.getWebContents = getWebContents;
    this.getWorkspacePath = getWorkspacePath;
    this.apiCall = apiCall;
    this.readQueue = readQueue;
    this.readSelection = readSelection;
    this.wait = wait;
  }

  async _call(method, payload, timeoutMs = 8000) {
    const origin = this.getOrigin?.();
    if (typeof origin !== 'string' || !origin) {
      throw new ReliableInterruptError('harness-unavailable', 'Harness 尚未就绪。');
    }
    return this.apiCall(origin, method, payload, { timeoutMs });
  }

  async _selectedSession() {
    const webContents = this.getWebContents?.();
    if (!webContents) throw new ReliableInterruptError('window-unavailable', 'Harness 窗口尚未就绪。');
    const sessionId = await this.readSelection(webContents);
    if (!isSessionId(sessionId)) throw new ReliableInterruptError('session-unavailable', '当前没有可接收插话的 Harness 会话。');
    return sessionId;
  }

  async _summary(sessionId) {
    const catalog = await this._call('session.list', {});
    const summary = Array.isArray(catalog?.items)
      ? catalog.items.find((item) => item?.sessionId === sessionId)
      : undefined;
    if (!summary) throw new ReliableInterruptError('session-unavailable', '当前 Harness 会话尚未进入会话目录。');
    if (summary.origin === 'subagent') {
      throw new ReliableInterruptError('subagent-session', '子代理请在任务面板中使用补充消息或中断。');
    }
    const workspacePath = this.getWorkspacePath?.();
    if (typeof workspacePath !== 'string' || !workspacePath || typeof summary.cwd !== 'string'
      || pathKey(summary.cwd) !== pathKey(workspacePath)) {
      throw new ReliableInterruptError('workspace-mismatch', '当前会话与桌面工作区不一致，请刷新后重试。');
    }
    return summary;
  }

  async interruptAndPrompt(value, { maxIdleChecks = DEFAULT_IDLE_CHECKS } = {}) {
    const prompt = normalizedPrompt(value);
    if (!prompt) {
      throw new ReliableInterruptError('invalid-message', `插话内容必须为 1–${MAX_INTERRUPT_PROMPT_LENGTH} 个字符。`);
    }
    const sessionId = await this._selectedSession();
    const initial = await this._summary(sessionId);
    let interrupted = false;
    let idleConfirmed = initial.running !== true;

    if (!idleConfirmed) {
      const cancellation = await this._call('session.cancel', { sessionId });
      if (cancellation?.accepted !== true) {
        throw new ReliableInterruptError('cancel-unconfirmed', 'Harness 未确认当前回合已收到中断请求。');
      }
      interrupted = true;
      const checks = Number.isSafeInteger(maxIdleChecks) && maxIdleChecks > 0
        ? Math.min(maxIdleChecks, DEFAULT_IDLE_CHECKS)
        : DEFAULT_IDLE_CHECKS;
      for (let attempt = 0; attempt < checks; attempt += 1) {
        const current = await this._summary(sessionId);
        if (current.running !== true) {
          idleConfirmed = true;
          break;
        }
        if (attempt + 1 < checks) await this.wait(IDLE_CHECK_DELAY_MS);
      }
    }

    if (await this._selectedSession() !== sessionId) {
      throw new ReliableInterruptError('session-changed', '处理插话期间会话已经切换，消息未发送。');
    }

    const mode = interrupted && idleConfirmed ? 'steer' : 'queue';
    const receipt = await this._call('session.prompt', {
      sessionId,
      mode,
      content: [{ type: 'text', text: prompt }]
    });
    if (receipt?.accepted !== true) {
      throw new ReliableInterruptError('prompt-unconfirmed', 'Harness 未确认插话消息已进入会话。');
    }

    return Object.freeze({
      ok: true,
      accepted: true,
      interrupted,
      delivery: interrupted && !idleConfirmed ? 'queued-after-cancel' : 'started',
      message: interrupted
        ? idleConfirmed
          ? '已中断当前回合，插话已开始处理。'
          : '中断请求已受理，插话已可靠排队；当前操作结束后会继续处理。'
        : '当前回合已结束，补充消息已开始处理。'
    });
  }

  async interruptQueued({ maxIdleChecks = DEFAULT_IDLE_CHECKS } = {}) {
    const sessionId = await this._selectedSession();
    const initial = await this._summary(sessionId);
    if (initial.running !== true) {
      throw new ReliableInterruptError('turn-ended', '当前回合已经结束，排队消息会按顺序继续处理。');
    }
    const origin = this.getOrigin?.();
    const queue = await this.readQueue(origin, sessionId);
    const item = Array.isArray(queue) ? queue.find((entry) => entry?.placement === 'queued') : undefined;
    const blocks = Array.isArray(item?.message?.content) ? item.message.content : [];
    const prompt = blocks.length > 0 && blocks.every((block) => block?.type === 'text')
      ? normalizedPrompt(blocks.map((block) => block.text).join(''))
      : '';
    if (!item || typeof item.id !== 'string' || item.id.length > 160 || !prompt) {
      throw new ReliableInterruptError('unsupported-queued-message', '这条排队消息含附件或内容过长，请等待当前回合结束后再发送。');
    }

    try {
      await this._call('session.updateQueue', {
        sessionId,
        itemId: item.id,
        action: { kind: 'remove' }
      });
    } catch (error) {
      if (error?.code === 'queue-item-not-found') {
        throw new ReliableInterruptError('queue-race', '排队消息已经被当前回合接收，请等待回复。');
      }
      throw error;
    }

    const cancellation = await this._call('session.cancel', { sessionId });
    if (cancellation?.accepted !== true) {
      await this._call('session.prompt', {
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }]
      });
      throw new ReliableInterruptError('cancel-unconfirmed', '未确认中断；消息已恢复到 Harness 队列。');
    }

    const checks = Number.isSafeInteger(maxIdleChecks) && maxIdleChecks > 0
      ? Math.min(maxIdleChecks, DEFAULT_IDLE_CHECKS)
      : DEFAULT_IDLE_CHECKS;
    let idleConfirmed = false;
    for (let attempt = 0; attempt < checks; attempt += 1) {
      const current = await this._summary(sessionId);
      if (current.running !== true) {
        idleConfirmed = true;
        break;
      }
      if (attempt + 1 < checks) await this.wait(IDLE_CHECK_DELAY_MS);
    }
    if (await this._selectedSession() !== sessionId) {
      await this._call('session.prompt', {
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }]
      });
      throw new ReliableInterruptError('session-changed', '处理插话期间会话已经切换；消息已保留在原会话。');
    }
    const receipt = await this._call('session.prompt', {
      sessionId,
      mode: idleConfirmed ? 'steer' : 'queue',
      content: [{ type: 'text', text: prompt }]
    });
    if (receipt?.accepted !== true) {
      throw new ReliableInterruptError('prompt-unconfirmed', 'Harness 未确认排队消息已重新发送。');
    }
    return Object.freeze({
      ok: true,
      accepted: true,
      interrupted: true,
      delivery: idleConfirmed ? 'started' : 'queued-after-cancel',
      message: idleConfirmed
        ? '已中断当前回合，排队消息已开始处理。'
        : '中断请求已受理，排队消息已保留并会继续处理。'
    });
  }
}

module.exports = {
  DEFAULT_IDLE_CHECKS,
  IDLE_CHECK_DELAY_MS,
  MAX_INTERRUPT_PROMPT_LENGTH,
  MAX_QUEUE_ITEMS,
  ReliableInterruptController,
  ReliableInterruptError,
  normalizedPrompt,
  readHarnessQueueSnapshot
};
