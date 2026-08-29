'use strict';

const MAX_CANDIDATES = 12;
const MAX_CANDIDATE_CHARS = 20000;
const MAX_CAPTURE_TITLE = 120;

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

module.exports = {
  MAX_CANDIDATES,
  MAX_CANDIDATE_CHARS,
  assistantText,
  candidateTitle,
  extractWikiSessionCandidates,
  selectCaptureCandidate
};
