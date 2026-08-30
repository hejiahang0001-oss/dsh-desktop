const { randomUUID } = require('node:crypto');
const CHANNEL = 'dsh-session-control-v1';
class SessionControlClient {
  constructor() { this.child = null; this.pending = new Map(); this.queue = Promise.resolve(); this.queued = 0; }
  attach(child) {
    this.close(); this.child = child;
    const listener = (response) => {
      if (response?.channel !== CHANNEL) return;
      const entry = this.pending.get(response.requestId); if (!entry) return;
      entry.finish(response.ok ? null : new Error(response.error || '会话状态检查失败。'), response.value);
    };
    const close = () => { child.off('message', listener); child.off('exit', close); if (this.child === child) this.close(); };
    child.on('message', listener); child.once('exit', close); return close;
  }
  close() { this.child = null; for (const entry of [...this.pending.values()]) entry.finish(new Error('Harness 已断开；未自动重试会话变更。')); }
  request(operation, payload) {
    if (this.queued >= 8) return Promise.reject(new Error('会话控制请求过多，请稍后重试。'));
    const child = this.child; this.queued++;
    const task = this.queue.then(() => { if (this.child !== child) throw new Error('Harness 已变化，未自动重试会话操作。'); return this.send(operation, payload); });
    this.queue = task.catch(() => {});
    return task.finally(() => { this.queued--; });
  }
  send(operation, payload) {
    if (!['inspect', 'fork', 'resume-queue'].includes(operation) || !this.child?.connected || this.pending.size >= 4) return Promise.reject(new Error('会话控制暂不可用，请稍后重试。'));
    const child = this.child, requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('会话控制超时；请查看交接记录，勿重复提交。')), 60000);
      const finish = (error, value) => { clearTimeout(timer); this.pending.delete(requestId); error ? reject(error) : resolve(value); };
      this.pending.set(requestId, { finish });
      child.send({ channel: CHANNEL, requestId, operation, payload }, (error) => { if (error) finish(new Error('会话控制连接已断开。')); });
    });
  }
}
module.exports = { SessionControlClient };
