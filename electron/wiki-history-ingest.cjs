'use strict';

const { createHash, randomBytes, randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const HISTORY_SOURCE_VERSION = 1;
const HISTORY_SOURCE_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY_CATALOG = 32;
const MAX_HISTORY_SESSIONS = 8;
const MAX_HISTORY_PAGES = 8;
const MAX_HISTORY_PAGE_MESSAGES = 20;
const MAX_HISTORY_EVENTS_PER_PAGE = 2000;
const MAX_HISTORY_MESSAGES_PER_SESSION = 80;
const MAX_HISTORY_TOTAL_MESSAGES = 320;
const MAX_HISTORY_MESSAGE_CHARS = 8000;
const MAX_HISTORY_SESSION_CHARS = 160000;
const MAX_HISTORY_TOTAL_CHARS = 400000;
const MAX_HISTORY_SOURCE_BYTES = 2 * 1024 * 1024;

class DshHistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DshHistoryError';
    this.code = code;
  }
}

const cleanText = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maxLength);
};

const oneLine = (value, maxLength = 160) => cleanText(value, maxLength * 4)
  .replace(/\s+/g, ' ')
  .slice(0, maxLength);

const pathKey = (value) => path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizedTimestamp = (value) => {
  if (Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const projectedTitle = (summary) => {
  const value = summary?.projections?.values?.title;
  if (typeof value === 'string') return oneLine(value, 120);
  if (value && typeof value === 'object') return oneLine(value.title || value.currentValue || '', 120);
  return '';
};

const summaryFingerprint = (summary) => sha256(JSON.stringify({
  sessionId: summary.sessionId,
  updatedAt: normalizedTimestamp(summary.updatedAt),
  running: summary.running,
  blank: summary.blank,
  cwd: pathKey(summary.cwd),
  title: projectedTitle(summary)
}));

class DshHistorySelectionCatalog {
  constructor({ randomToken = () => randomBytes(12).toString('hex') } = {}) {
    this.randomToken = randomToken;
    this.bindings = new Map();
    this.workspacePath = '';
  }

  refresh(sessionItems, workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      this.bindings.clear();
      this.workspacePath = '';
      return Object.freeze([]);
    }
    const workspaceKey = pathKey(workspacePath);
    const eligible = (Array.isArray(sessionItems) ? sessionItems : [])
      .filter((item) => item
        && typeof item.sessionId === 'string'
        && item.sessionId.length > 0
        && item.origin !== 'subagent'
        && item.blank !== true
        && typeof item.cwd === 'string'
        && pathKey(item.cwd) === workspaceKey)
      .sort((left, right) => (normalizedTimestamp(right.updatedAt) || 0) - (normalizedTimestamp(left.updatedAt) || 0))
      .slice(0, MAX_HISTORY_CATALOG);

    this.bindings.clear();
    this.workspacePath = path.resolve(workspacePath);
    const rows = [];
    for (const summary of eligible) {
      let token = this.randomToken();
      while (!/^[a-f0-9]{24}$/u.test(token) || this.bindings.has(token)) token = this.randomToken();
      this.bindings.set(token, Object.freeze({
        sessionId: summary.sessionId,
        fingerprint: summaryFingerprint(summary)
      }));
      rows.push(Object.freeze({
        id: token,
        title: projectedTitle(summary) || '未命名 DSH 会话',
        updatedAt: normalizedTimestamp(summary.updatedAt),
        ready: summary.running !== true,
        status: summary.running === true ? 'running' : 'ready'
      }));
    }
    return Object.freeze(rows);
  }

  resolve(payload, freshItems, workspacePath) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some((key) => key !== 'ids')) {
      throw new DshHistoryError('invalid-history-selection', 'DSH 历史选择请求无效。');
    }
    if (pathKey(workspacePath) !== pathKey(this.workspacePath)) {
      throw new DshHistoryError('stale-history-selection', '工作区已变化，请重新加载 DSH 历史。');
    }
    const ids = Array.isArray(payload.ids) ? payload.ids : [];
    if (ids.length < 1 || ids.length > MAX_HISTORY_SESSIONS || new Set(ids).size !== ids.length
      || ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/u.test(id))) {
      throw new DshHistoryError('invalid-history-selection', `每次请选择 1 到 ${MAX_HISTORY_SESSIONS} 个会话。`);
    }
    const freshById = new Map((Array.isArray(freshItems) ? freshItems : []).map((item) => [item?.sessionId, item]));
    const selected = [];
    for (const id of ids) {
      const binding = this.bindings.get(id);
      const summary = binding ? freshById.get(binding.sessionId) : undefined;
      if (!binding || !summary || summaryFingerprint(summary) !== binding.fingerprint
        || summary.origin === 'subagent' || summary.blank === true || summary.running === true
        || typeof summary.cwd !== 'string' || pathKey(summary.cwd) !== pathKey(workspacePath)) {
        throw new DshHistoryError('stale-history-selection', '选中的 DSH 会话状态已变化，请刷新后重试。');
      }
      selected.push(summary);
    }
    return Object.freeze(selected);
  }
}

const SENSITIVE_REPLACEMENTS = Object.freeze([
  Object.freeze({ id: 'private-key', label: '疑似私钥', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/giu, replacement: '[已遮蔽私钥]' }),
  Object.freeze({ id: 'api-key', label: '疑似 API Key', pattern: /\b(?:sk|ds)-[A-Za-z0-9_-]{16,}\b/gu, replacement: '[已遮蔽 API Key]' }),
  Object.freeze({ id: 'bearer', label: '疑似 Bearer Token', pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/giu, replacement: 'Bearer [已遮蔽 Token]' }),
  Object.freeze({ id: 'credential-value', label: '疑似凭据字段', pattern: /\b(DEEPSEEK_API_KEY|API_KEY|PASSWORD|SECRET|TOKEN)\b\s*([:=])\s*(?:"[^"\n]{1,512}"|'[^'\n]{1,512}'|[^\r\n,;]{4,512})/giu, replacement: (_match, name, separator) => `${name}${separator}[已遮蔽凭据]` })
]);

const redactSensitiveText = (value) => {
  let text = cleanText(value, MAX_HISTORY_MESSAGE_CHARS);
  const findings = [];
  for (const rule of SENSITIVE_REPLACEMENTS) {
    let count = 0;
    text = text.replace(rule.pattern, (...args) => {
      count += 1;
      return typeof rule.replacement === 'function' ? rule.replacement(...args) : rule.replacement;
    });
    if (count > 0) findings.push({ id: rule.id, label: rule.label, count });
  }
  return Object.freeze({ text, findings: Object.freeze(findings) });
};

const messageText = (entry) => {
  const type = entry?.event?.type;
  if (type !== 'user/message' && type !== 'assistant/message') return null;
  const expectedRole = type === 'user/message' ? 'user' : 'assistant';
  const message = entry.event.data?.message;
  if (message?.role && message.role !== expectedRole) return null;
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const text = blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n');
  if (!cleanText(text, MAX_HISTORY_MESSAGE_CHARS)) return null;
  return { role: expectedRole, text };
};

const extractHistoryMessages = (entries) => {
  const messages = [];
  const redactions = new Map();
  for (const entry of entries) {
    const source = messageText(entry);
    if (!source) continue;
    const redacted = redactSensitiveText(source.text);
    if (!redacted.text) continue;
    for (const finding of redacted.findings) {
      const current = redactions.get(finding.id) || { id: finding.id, label: finding.label, count: 0 };
      current.count += finding.count;
      redactions.set(finding.id, current);
    }
    messages.push(Object.freeze({
      seq: Number.isInteger(entry.event.seq) && entry.event.seq >= 0 ? entry.event.seq : messages.length,
      time: Number.isFinite(entry.event.time) ? entry.event.time : null,
      role: source.role,
      text: redacted.text
    }));
  }
  messages.sort((left, right) => left.seq - right.seq);
  let selected = messages.slice(-MAX_HISTORY_MESSAGES_PER_SESSION);
  let chars = selected.reduce((sum, message) => sum + message.text.length, 0);
  let limited = selected.length !== messages.length;
  while (selected.length > 0 && chars > MAX_HISTORY_SESSION_CHARS) {
    chars -= selected[0].text.length;
    selected = selected.slice(1);
    limited = true;
  }
  return Object.freeze({ messages: Object.freeze(selected), redactions: Object.freeze([...redactions.values()]), chars, limited });
};

const loadSessionHistory = async (apiCall, origin, summary) => {
  const entries = new Map();
  let beforeSeq;
  let hasMore = false;
  let pages = 0;
  do {
    const payload = { sessionId: summary.sessionId, maxMessages: MAX_HISTORY_PAGE_MESSAGES };
    if (beforeSeq !== undefined) payload.beforeSeq = beforeSeq;
    const result = await apiCall(origin, 'session.history', payload, { timeoutMs: 10000 });
    const page = Array.isArray(result?.events) ? result.events : [];
    if (page.length > MAX_HISTORY_EVENTS_PER_PAGE) throw new DshHistoryError('history-page-too-large', 'DSH 历史分页事件数超出安全上限。');
    let minimumSeq = Number.POSITIVE_INFINITY;
    for (const entry of page) {
      const seq = entry?.event?.seq;
      if (!Number.isInteger(seq) || seq < 0) continue;
      minimumSeq = Math.min(minimumSeq, seq);
      entries.set(seq, entry);
    }
    pages += 1;
    hasMore = result?.hasMore === true;
    if (!hasMore) break;
    if (!Number.isFinite(minimumSeq) || minimumSeq <= 0 || minimumSeq === beforeSeq) {
      throw new DshHistoryError('invalid-history-pagination', 'DSH 历史分页没有继续向前移动。');
    }
    beforeSeq = minimumSeq;
  } while (pages < MAX_HISTORY_PAGES);

  const extracted = extractHistoryMessages([...entries.values()]);
  return Object.freeze({ ...extracted, limited: extracted.limited || hasMore, pages });
};

const assertPlainParent = async (filePath) => {
  const parent = path.dirname(path.resolve(filePath));
  await fsp.mkdir(parent, { recursive: true });
  const info = await fsp.lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new DshHistoryError('unsafe-history-source-directory', 'DSH 历史导入源目录不安全。');
};

const atomicWritePrivateJson = async (filePath, value) => {
  const resolved = path.resolve(filePath);
  await assertPlainParent(resolved);
  try {
    if ((await fsp.lstat(resolved)).isSymbolicLink()) throw new DshHistoryError('unsafe-history-source', 'DSH 历史导入源不能是符号链接。');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX_HISTORY_SOURCE_BYTES) throw new DshHistoryError('history-source-too-large', 'DSH 历史导入源超出安全上限。');
  const temp = `${resolved}.${process.pid}-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temp, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(temp, resolved);
  } finally {
    await handle?.close().catch(() => undefined);
    await fsp.unlink(temp).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
};

const prepareDshHistorySource = async ({ apiCall, origin, summaries, workspacePath, sourcePath, clock = () => new Date() }) => {
  if (typeof apiCall !== 'function' || typeof origin !== 'string') throw new DshHistoryError('history-api-unavailable', 'Harness 历史接口不可用。');
  if (!Array.isArray(summaries) || summaries.length < 1 || summaries.length > MAX_HISTORY_SESSIONS) {
    throw new DshHistoryError('invalid-history-selection', `每次请选择 1 到 ${MAX_HISTORY_SESSIONS} 个会话。`);
  }
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) throw new DshHistoryError('invalid-history-workspace', '当前工作区路径不可用。');
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new DshHistoryError('invalid-history-source', 'DSH 历史导入源路径无效。');

  const sessions = [];
  let totalMessages = 0;
  let totalChars = 0;
  let limited = false;
  const aggregate = new Map();
  for (const summary of summaries) {
    const loaded = await loadSessionHistory(apiCall, origin, summary);
    const redactedTitle = redactSensitiveText(projectedTitle(summary) || '未命名 DSH 会话');
    const sessionRedactions = new Map();
    for (const finding of [...loaded.redactions, ...redactedTitle.findings]) {
      const current = sessionRedactions.get(finding.id) || { id: finding.id, label: finding.label, count: 0 };
      current.count += finding.count;
      sessionRedactions.set(finding.id, current);
    }
    let messages = [...loaded.messages];
    while (messages.length > 0 && (totalMessages + messages.length > MAX_HISTORY_TOTAL_MESSAGES || totalChars + messages.reduce((sum, message) => sum + message.text.length, 0) > MAX_HISTORY_TOTAL_CHARS)) {
      messages = messages.slice(1);
      limited = true;
    }
    if (messages.length === 0) continue;
    const chars = messages.reduce((sum, message) => sum + message.text.length, 0);
    totalMessages += messages.length;
    totalChars += chars;
    for (const finding of sessionRedactions.values()) {
      const current = aggregate.get(finding.id) || { id: finding.id, label: finding.label, count: 0 };
      current.count += finding.count;
      aggregate.set(finding.id, current);
    }
    const sourceId = sha256(summary.sessionId).slice(0, 24);
    const lastSeq = messages[messages.length - 1].seq;
    const updatedAt = normalizedTimestamp(summary.updatedAt);
    const fingerprint = sha256(JSON.stringify({ sourceId, updatedAt, messages }));
    sessions.push(Object.freeze({
      sourceId,
      title: redactedTitle.text || '未命名 DSH 会话',
      updatedAt,
      lastSeq,
      fingerprint,
      messages: Object.freeze(messages),
      redactions: Object.freeze([...sessionRedactions.values()]),
      limited: loaded.limited || messages.length !== loaded.messages.length
    }));
    limited = limited || loaded.limited || messages.length !== loaded.messages.length;
  }
  if (sessions.length === 0) throw new DshHistoryError('history-empty', '选中的 DSH 会话没有可导入的用户或助手文本。');

  const createdAt = clock();
  const bundle = Object.freeze({
    version: HISTORY_SOURCE_VERSION,
    sourceToken: randomBytes(16).toString('hex'),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + HISTORY_SOURCE_TTL_MS).toISOString(),
    workspacePath: path.resolve(workspacePath),
    workspaceName: path.basename(path.resolve(workspacePath)),
    limited,
    totalMessages,
    totalChars,
    redactions: Object.freeze([...aggregate.values()]),
    sessions: Object.freeze(sessions)
  });
  await atomicWritePrivateJson(sourcePath, bundle);
  return Object.freeze({
    ok: true,
    sourceToken: bundle.sourceToken,
    expiresAt: bundle.expiresAt,
    sessionCount: sessions.length,
    totalMessages,
    totalChars,
    limited,
    redactions: bundle.redactions,
    sessions: Object.freeze(sessions.map((session) => Object.freeze({
      sourceId: session.sourceId,
      title: session.title,
      messageCount: session.messages.length,
      limited: session.limited
    })))
  });
};

module.exports = {
  DshHistoryError,
  DshHistorySelectionCatalog,
  HISTORY_SOURCE_TTL_MS,
  HISTORY_SOURCE_VERSION,
  MAX_HISTORY_CATALOG,
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES_PER_SESSION,
  MAX_HISTORY_SESSIONS,
  MAX_HISTORY_SOURCE_BYTES,
  MAX_HISTORY_TOTAL_CHARS,
  MAX_HISTORY_TOTAL_MESSAGES,
  extractHistoryMessages,
  loadSessionHistory,
  normalizedTimestamp,
  prepareDshHistorySource,
  projectedTitle,
  redactSensitiveText,
  summaryFingerprint
};
