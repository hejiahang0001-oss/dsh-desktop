const { randomUUID } = require('node:crypto');
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
  const socketUrl = `${origin.replace(/^http:/, 'ws:')}/api/remote.mux`;
  const streamId = `dsh-queue-${randomUUID()}`;
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
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        type: 'open',
        streamId,
        endpoint: 'session/control',
        payload: { args: {} }
      }));
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      if (frame?.streamId !== streamId) return;
      if (frame.type === 'error' || frame.type === 'end') {
        finish(new ReliableInterruptError('queue-unavailable', 'Harness 排队消息通道没有返回状态。'));
        return;
      }
      const value = frame?.value;
      if (frame.type === 'item' && value?.type === 'baseline') {
        const items = value.value?.queues?.[sessionId];
        finish(null, Array.isArray(items) ? items.slice(0, MAX_QUEUE_ITEMS) : []);
      } else if (frame.type === 'item' && value?.type === 'queue' && value.sessionId === sessionId) {
        finish(null, Array.isArray(value.items) ? value.items.slice(0, MAX_QUEUE_ITEMS) : []);
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

const readHarnessQueueSnapshotFromWebContents = async (webContents, origin, sessionId, {
  timeoutMs = 2500
} = {}) => {
  if (!webContents || typeof webContents.executeJavaScript !== 'function'
    || !isSafeHarnessOrigin(origin) || !isSessionId(sessionId)) {
    throw new ReliableInterruptError('queue-unavailable', 'Harness 排队消息地址未通过安全校验。');
  }
  const boundedTimeout = Math.min(8000, Math.max(250, Number(timeoutMs) || 2500));
  const socketUrl = `${origin.replace(/^http:/, 'ws:')}/api/remote.mux`;
  const streamId = `dsh-queue-${randomUUID()}`;
  const script = `(() => new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), ${boundedTimeout});
    try { socket = new WebSocket(${JSON.stringify(socketUrl)}); }
    catch { finish({ ok: false, error: 'unavailable' }); return; }
    socket.addEventListener('open', () => socket.send(JSON.stringify({
      type: 'open',
      streamId: ${JSON.stringify(streamId)},
      endpoint: 'session/control',
      payload: { args: {} }
    })));
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame?.streamId !== ${JSON.stringify(streamId)}) return;
      if (frame.type === 'error' || frame.type === 'end') {
        finish({ ok: false, error: 'unavailable' });
        return;
      }
      const value = frame?.value;
      if (frame.type === 'item' && value?.type === 'baseline') {
        const items = value.value?.queues?.[${JSON.stringify(sessionId)}];
        finish({ ok: true, items: Array.isArray(items) ? items.slice(0, ${MAX_QUEUE_ITEMS}) : [] });
      } else if (frame.type === 'item' && value?.type === 'queue' && value.sessionId === ${JSON.stringify(sessionId)}) {
        finish({ ok: true, items: Array.isArray(value.items) ? value.items.slice(0, ${MAX_QUEUE_ITEMS}) : [] });
      }
    });
    socket.addEventListener('error', () => finish({ ok: false, error: 'unavailable' }));
    socket.addEventListener('close', () => finish({ ok: false, error: 'closed' }));
  }))()`;
  let result;
  try {
    result = await webContents.executeJavaScript(script, true);
  } catch {
    throw new ReliableInterruptError('queue-unavailable', '读取 Harness 排队消息失败。');
  }
  if (!result?.ok || !Array.isArray(result.items)) {
    throw new ReliableInterruptError(result?.error === 'timeout' ? 'queue-timeout' : 'queue-unavailable',
      result?.error === 'timeout' ? '读取 Harness 排队消息超时。' : '读取 Harness 排队消息失败。');
  }
  const items = result.items.slice(0, MAX_QUEUE_ITEMS);
  if (JSON.stringify(items).length > 1024 * 1024) {
    throw new ReliableInterruptError('queue-unavailable', 'Harness 排队消息响应过大。');
  }
  return items;
};

class ReliableInterruptController {
  constructor({
    getOrigin,
    getWebContents,
    getWorkspacePath,
    resolveContext,
    resumeQueue,
    apiCall = callHarnessApi,
    readQueue = readHarnessQueueSnapshot,
    readSelection = readHarnessSessionSelection,
    wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
  } = {}) {
    this.getOrigin = getOrigin;
    this.getWebContents = getWebContents;
    this.getWorkspacePath = getWorkspacePath;
    this.resolveContext = resolveContext;
    this.resumeQueue = resumeQueue;
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
    const context = this.resolveContext ? await this.resolveContext() : null;
    if (context && context.sessionId !== sessionId) {
      throw new ReliableInterruptError('session-changed', '当前会话已切换，插话未发送。');
    }
    const workspacePath = context ? context.workspacePath : this.getWorkspacePath?.();
    if (typeof workspacePath !== 'string' || !workspacePath || typeof summary.cwd !== 'string'
      || pathKey(summary.cwd) !== pathKey(workspacePath)) {
      throw new ReliableInterruptError('workspace-mismatch', '当前会话与桌面工作区不一致，请刷新后重试。');
    }
    return summary;
  }

  async _assertContext(sessionId, workspacePath) {
    const context = this.resolveContext ? await this.resolveContext()
      : { sessionId, workspacePath: this.getWorkspacePath?.() };
    if (context?.sessionId !== sessionId || pathKey(context.workspacePath) !== pathKey(workspacePath)) {
      throw new ReliableInterruptError('session-changed', '会话或工作区已切换，未继续插话；原消息保留。');
    }
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
    await this._assertContext(sessionId, initial.cwd);

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
    const origin = this.getOrigin?.();
    const queue = await this.readQueue(origin, sessionId);
    const item = Array.isArray(queue) ? queue.find((entry) => entry?.placement === 'queued') : undefined;
    if (!item || typeof item.id !== 'string' || item.id.length > 160) {
      throw new ReliableInterruptError('queue-empty', '当前没有可继续的排队消息，请刷新状态。');
    }
    await this._assertContext(sessionId, initial.cwd);
    let idleConfirmed = initial.running !== true;
    if (!idleConfirmed) {
      const cancellation = await this._call('session.cancel', { sessionId });
      if (cancellation?.accepted !== true) throw new ReliableInterruptError('cancel-unconfirmed', '未确认中断；原排队消息未修改。');
      const checks = Number.isSafeInteger(maxIdleChecks) && maxIdleChecks > 0 ? Math.min(maxIdleChecks, DEFAULT_IDLE_CHECKS) : DEFAULT_IDLE_CHECKS;
      for (let attempt = 0; attempt < checks; attempt += 1) {
        if ((await this._summary(sessionId)).running !== true) { idleConfirmed = true; break; }
        if (attempt + 1 < checks) await this.wait(IDLE_CHECK_DELAY_MS);
      }
    }
    if (await this._selectedSession() !== sessionId) {
      throw new ReliableInterruptError('session-changed', '处理插话期间会话已经切换；消息已保留在原会话。');
    }
    await this._assertContext(sessionId, initial.cwd);
    // Promote the exact pending item atomically inside Harness. Never remove
    // then resubmit content: a transport failure in between could lose a task.
    try {
      if (!idleConfirmed) throw new ReliableInterruptError('cancel-pending', '当前回合尚未停止；原队列保留，请稍后继续。');
      if (!this.resumeQueue) throw new ReliableInterruptError('queue-unavailable', '桌面队列恢复组件尚未就绪。');
      const receipt = await this.resumeQueue({ sessionId, workspacePath: initial.cwd, itemId: item.id });
      if (receipt?.accepted !== true) throw new ReliableInterruptError('queue-unconfirmed', '未确认排队消息已受理，请刷新状态；未重复发送。');
    } catch (error) {
      if (['session/queue-item-not-found', 'queue-item-not-found'].includes(error?.code)) {
        throw new ReliableInterruptError('queue-race', '排队消息已离开队列，请查看回复；未重复发送。');
      }
      throw error;
    }
    return Object.freeze({
      ok: true,
      accepted: true,
      interrupted: initial.running === true,
      delivery: idleConfirmed ? 'started' : 'queued-after-cancel',
      message: '继续处理原排队消息的请求已受理；未重复发送，请以实际回复为准。'
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
  readHarnessQueueSnapshot,
  readHarnessQueueSnapshotFromWebContents
};
