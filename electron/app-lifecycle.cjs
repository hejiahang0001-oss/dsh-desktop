const { randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');

const STATE_SCHEMA_VERSION = 1;
const MAX_VERSION_CHARS = 64;
const MAX_STEP_TIMEOUT_MS = 120_000;

const boundedVersion = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > MAX_VERSION_CHARS || /[\r\n\0]/u.test(normalized)) {
    throw new TypeError('Lifecycle version identity is invalid.');
  }
  return normalized;
};

const validTimestamp = (value) => typeof value === 'string'
  && value.length >= 20
  && value.length <= 40
  && Number.isFinite(Date.parse(value));

const validIdentity = (value) => value
  && typeof value === 'object'
  && !Array.isArray(value)
  && ['product', 'harness', 'electron', 'node'].every((key) => (
    typeof value[key] === 'string'
      && value[key].length > 0
      && value[key].length <= MAX_VERSION_CHARS
      && !/[\r\n\0]/u.test(value[key])
  ));

const validLifecycleState = (value) => value?.schemaVersion === STATE_SCHEMA_VERSION
  && ['starting', 'running', 'quitting', 'quit-failed', 'clean'].includes(value.status)
  && typeof value.runId === 'string'
  && /^[0-9a-f-]{36}$/iu.test(value.runId)
  && validTimestamp(value.startedAt)
  && (value.finishedAt === null || validTimestamp(value.finishedAt))
  && (value.cleanReason === null || ['explicit-exit', 'window-close', 'system-quit'].includes(value.cleanReason))
  && validIdentity(value.identity);

const buildVersionIdentity = ({ product, harness, electron, node }) => Object.freeze({
  product: boundedVersion(product),
  harness: boundedVersion(harness),
  electron: boundedVersion(electron),
  node: boundedVersion(node)
});

const versionIdentityLines = (identity) => [
  `产品版本：DSH Desktop V${identity.product}`,
  `Harness 内核：DeepSeek Harness ${identity.harness}`,
  `桌面运行时：Electron ${identity.electron}`,
  `Electron 内置 Node：${identity.node}`
].join('\n');

class LifecycleStateStore {
  constructor({ filePath, now = () => new Date(), createRunId = randomUUID, fsPromises = fsp } = {}) {
    if (typeof filePath !== 'string' || !filePath) throw new TypeError('Lifecycle state path is required.');
    this.fs = fsPromises;
    this.now = now;
    this.createRunId = createRunId;
    this.storage = new AtomicJsonFile({ filePath, fsPromises, validator: validLifecycleState });
    this.current = null;
  }

  async begin(identity) {
    const normalizedIdentity = buildVersionIdentity(identity);
    const loaded = await this.storage.read({ fallback: null });
    const previous = loaded.value;
    const recoveryReason = loaded.source === 'backup'
      ? 'state-recovered'
      : previous && previous.status !== 'clean'
        ? 'unclean-exit'
        : '';
    const startedAt = this.now().toISOString();
    this.current = {
      schemaVersion: STATE_SCHEMA_VERSION,
      status: 'starting',
      runId: this.createRunId(),
      startedAt,
      finishedAt: null,
      cleanReason: null,
      identity: normalizedIdentity
    };
    await this.storage.write(this.current);
    return Object.freeze({
      needed: Boolean(recoveryReason),
      reason: recoveryReason,
      source: loaded.source,
      previous: previous ? Object.freeze({
        status: previous.status,
        startedAt: previous.startedAt,
        finishedAt: previous.finishedAt,
        identity: Object.freeze({ ...previous.identity })
      }) : null
    });
  }

  getState() {
    return this.current
      ? Object.freeze({ ...this.current, identity: Object.freeze({ ...this.current.identity }) })
      : null;
  }

  async transition(status) {
    if (!this.current) throw new Error('Lifecycle state has not started.');
    if (!['running', 'quitting', 'quit-failed'].includes(status)) throw new TypeError('Lifecycle transition is invalid.');
    const next = { ...this.current, status, finishedAt: null, cleanReason: null };
    await this.storage.write(next);
    this.current = next;
    return Object.freeze({ ...next, identity: Object.freeze({ ...next.identity }) });
  }

  async markClean(cleanReason = 'explicit-exit') {
    if (!this.current) throw new Error('Lifecycle state has not started.');
    const next = {
      ...this.current,
      status: 'clean',
      finishedAt: this.now().toISOString(),
      cleanReason
    };
    // Two identical durable writes keep both primary and last-known-good backup clean.
    await this.storage.write(next);
    await this.storage.write(next);
    this.current = next;
    return Object.freeze({ ...next, identity: Object.freeze({ ...next.identity }) });
  }
}

class LifecycleTimeoutError extends Error {
  constructor(name, timeoutMs) {
    super(`${name} 在 ${Math.ceil(timeoutMs / 1000)} 秒内没有结束。`);
    this.name = 'LifecycleTimeoutError';
    this.code = 'LIFECYCLE_STEP_TIMEOUT';
  }
}

class ApplicationClosingError extends Error {
  constructor() {
    super('DSH Desktop 正在安全退出。');
    this.name = 'ApplicationClosingError';
    this.code = 'APP_QUITTING';
  }
}

class LifecycleGate {
  constructor() {
    this.closing = false;
  }

  beginClosing() {
    if (this.closing) return false;
    this.closing = true;
    return true;
  }

  reopen() {
    this.closing = false;
  }

  isClosing() {
    return this.closing;
  }

  assertOpen() {
    if (this.closing) throw new ApplicationClosingError();
  }
}

const withTimeout = (operation, { name = '操作', timeoutMs = 15_000 } = {}) => {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_STEP_TIMEOUT_MS) {
    throw new TypeError('Lifecycle timeout is invalid.');
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new LifecycleTimeoutError(name, timeoutMs)), timeoutMs);
  });
  return Promise.race([Promise.resolve(operation), timeout]).finally(() => clearTimeout(timer));
};

const settleLifecycleSteps = async (steps, { timeoutMs = 15_000 } = {}) => {
  if (!Array.isArray(steps)) throw new TypeError('Lifecycle steps must be an array.');
  const results = await Promise.all(steps.map(async (step) => {
    const name = typeof step?.name === 'string' && step.name ? step.name : '未命名操作';
    try {
      if (typeof step?.run !== 'function') throw new TypeError(`${name} 缺少停止操作。`);
      await withTimeout(Promise.resolve().then(step.run), { name, timeoutMs: step.timeoutMs || timeoutMs });
      if (typeof step.verify === 'function' && !await Promise.resolve().then(step.verify)) {
        throw new Error(`${name} 结束后仍报告为运行中。`);
      }
      return Object.freeze({ name, ok: true, error: '', code: '' });
    } catch (error) {
      return Object.freeze({
        name,
        ok: false,
        error: error?.message || String(error),
        code: error?.code || 'LIFECYCLE_STEP_FAILED'
      });
    }
  }));
  const failures = results.filter((entry) => !entry.ok);
  return Object.freeze({ ok: failures.length === 0, results: Object.freeze(results), failures: Object.freeze(failures) });
};

const restoreAndFocusWindow = (window) => {
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) return false;
  if (typeof window.isMinimized === 'function' && window.isMinimized()) window.restore();
  if (typeof window.show === 'function') window.show();
  if (typeof window.focus === 'function') window.focus();
  return true;
};

module.exports = {
  ApplicationClosingError,
  LifecycleGate,
  LifecycleStateStore,
  LifecycleTimeoutError,
  buildVersionIdentity,
  restoreAndFocusWindow,
  settleLifecycleSteps,
  validLifecycleState,
  versionIdentityLines,
  withTimeout
};
