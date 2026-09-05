'use strict';

const MAX_CANDIDATES = 12;
const MAX_CANDIDATE_CHARS = 20000;
const MAX_CAPTURE_TITLE = 120;
const MAX_HEALTH_MESSAGE = 320;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u;

const cleanText = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maxLength);
};

const oneLine = (value, maxLength = 240) => cleanText(value, maxLength * 4)
  .replace(/\s+/g, ' ')
  .slice(0, maxLength);

const candidateTitle = (text, seq) => {
  const heading = String(text || '').match(/^\s*#{1,3}\s+(.+)$/m)?.[1];
  const firstLine = String(text || '').split('\n').map((line) => line.trim()).find(Boolean);
  return oneLine(heading || firstLine || `会话结论 ${seq}`, 72);
};

const assistantText = (entry) => {
  if (entry?.event?.type !== 'assistant/message') return '';
  const message = entry.event.data?.message;
  if (message?.role && message.role !== 'assistant') return '';
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return cleanText(blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n'), MAX_CANDIDATE_CHARS);
};

const extractWikiSessionCandidates = (history, { maxItems = MAX_CANDIDATES } = {}) => {
  const events = Array.isArray(history?.events) ? history.events.slice(-200) : [];
  const boundedItems = Math.min(MAX_CANDIDATES, Math.max(1, Number.isInteger(maxItems) ? maxItems : MAX_CANDIDATES));
  const candidates = [];
  let interrupted = false;
  for (let index = events.length - 1; index >= 0 && candidates.length < boundedItems; index -= 1) {
    const entry = events[index];
    if (entry?.event?.type === 'turn/end') {
      interrupted = entry.event.data?.reason?.kind === 'aborted';
      continue;
    }
    const text = assistantText(entry);
    if (!text) continue;
    const seq = Number.isInteger(entry.seq) && entry.seq >= 0 ? entry.seq : index;
    const sourceTime = Number.isFinite(entry.time) ? entry.time : null;
    candidates.push(Object.freeze({
      seq,
      sourceTime,
      title: candidateTitle(text, seq),
      preview: oneLine(text, 240),
      text,
      interrupted
    }));
    interrupted = false;
  }
  return Object.freeze(candidates);
};

const selectCaptureCandidate = (payload, candidates) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.some((key) => !['title', 'content', 'sourceSeq'].includes(key))) return null;
  if (!Number.isInteger(payload.sourceSeq) || payload.sourceSeq < 0) return null;
  const candidate = candidates.find((item) => item.seq === payload.sourceSeq);
  if (!candidate) return null;
  const title = cleanText(payload.title, MAX_CAPTURE_TITLE);
  const content = cleanText(payload.content, MAX_CANDIDATE_CHARS);
  if (!title || !content || String(payload.title).length > MAX_CAPTURE_TITLE || String(payload.content).length > MAX_CANDIDATE_CHARS) return null;
  return Object.freeze({ candidate, title, content });
};

const validTimestamp = (value) => {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return '';
  return Number.isFinite(Date.parse(value)) ? value : '';
};

const trustedAppVersion = (state) => {
  const value = cleanText(state?.appVersion || state?.app?.version, 64);
  return VERSION_PATTERN.test(value) ? value : '';
};

const trustedHarnessVersion = (state) => {
  const value = cleanText(state?.harness?.version, 64);
  return VERSION_PATTERN.test(value) ? value : '';
};

const normalizedFreshness = (state, sourceCheck) => {
  const declared = state?.vault?.sourceFreshness
    ?? state?.sourceFreshness
    ?? state?.project?.sourceFreshness;
  const raw = declared && typeof declared === 'object' && !Array.isArray(declared)
    ? declared
    : { status: declared };
  let status = oneLine(raw.status, 32).toLowerCase();
  let checkedAt = validTimestamp(raw.checkedAt
    || state?.vault?.sourceCheckedAt
    || state?.sourceCheckedAt
    || state?.project?.sourceCheckedAt);
  let message = oneLine(raw.message, MAX_HEALTH_MESSAGE);
  if (sourceCheck?.ok === true) {
    status = sourceCheck.unchanged ? 'fresh' : 'stale';
    checkedAt = validTimestamp(sourceCheck.generatedAt) || checkedAt;
    message = sourceCheck.unchanged
      ? '当前项目来源与最近一次同步记录一致。'
      : '当前项目来源有尚未同步的变化。';
  }
  const aliases = {
    ready: 'fresh',
    current: 'fresh',
    changed: 'stale',
    outdated: 'stale',
    error: 'unavailable'
  };
  status = aliases[status] || status;
  if (!['fresh', 'stale', 'checking', 'unavailable'].includes(status)) status = 'unknown';
  return Object.freeze({ status, checkedAt, message });
};

const buildWikiCenterDashboardState = (state = {}, { sourceCheck = null } = {}) => {
  const vault = state?.vault && typeof state.vault === 'object' ? state.vault : {};
  const status = ['ready', 'needs-init', 'recovery-required', 'unavailable', 'unconfigured'].includes(vault.status)
    ? vault.status
    : 'unconfigured';
  const configured = Boolean(vault.configured);
  const missing = Array.isArray(vault.missing)
    ? vault.missing.filter((item) => typeof item === 'string' && item.length > 0).slice(0, 32)
    : [];
  const freshness = normalizedFreshness(state, sourceCheck);
  const lastSyncAt = validTimestamp(
    vault.lastSyncAt
      || state?.lastSyncAt
      || state?.project?.lastSyncAt
  );
  const declaredRecovery = state?.recovery && typeof state.recovery === 'object'
    ? state.recovery
    : null;
  let recovery = Object.freeze({ available: false, mode: '', label: '', message: '' });
  if (declaredRecovery?.available === true) {
    recovery = Object.freeze({
      available: true,
      mode: 'ipc',
      label: oneLine(declaredRecovery.label, 60) || '运行安全恢复',
      message: oneLine(declaredRecovery.message, MAX_HEALTH_MESSAGE)
    });
  } else if (configured && status === 'unavailable') {
    recovery = Object.freeze({
      available: true,
      mode: 'choose-vault',
      label: '重新选择可用目录',
      message: '原目录当前不可访问；重新选择不会修改原目录。'
    });
  } else if (configured && status === 'needs-init') {
    recovery = Object.freeze({
      available: true,
      mode: 'initialize-vault',
      label: '补齐缺失结构',
      message: '只创建缺失项，不覆盖已有页面。'
    });
  } else if (configured && freshness.status === 'stale' && state?.project?.available) {
    recovery = Object.freeze({
      available: true,
      mode: 'refresh-source',
      label: '检查并同步来源',
      message: '先重新检查项目增量，再由你决定是否交给 Agent 同步。'
    });
  }
  return Object.freeze({
    configured,
    appVersion: trustedAppVersion(state),
    harnessVersion: trustedHarnessVersion(state),
    vaultPath: cleanText(vault.vaultPath, 1024),
    structure: Object.freeze({ status, missing: Object.freeze(missing) }),
    pages: Object.freeze({
      count: Number.isInteger(vault.pageCount) && vault.pageCount >= 0 ? vault.pageCount : 0,
      limited: vault.limited === true
    }),
    lastSyncAt,
    freshness,
    recovery
  });
};

module.exports = {
  MAX_CANDIDATES,
  MAX_CANDIDATE_CHARS,
  assistantText,
  buildWikiCenterDashboardState,
  candidateTitle,
  extractWikiSessionCandidates,
  selectCaptureCandidate,
  trustedAppVersion,
  trustedHarnessVersion
};
