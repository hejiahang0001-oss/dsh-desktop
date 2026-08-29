'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DshHistorySelectionCatalog,
  extractHistoryMessages,
  loadSessionHistory,
  normalizedTimestamp,
  prepareDshHistorySource,
  redactSensitiveText
} = require('../electron/wiki-history-ingest.cjs');

const summary = (overrides = {}) => ({
  sessionId: 'session-a',
  updatedAt: 100,
  running: false,
  blank: false,
  cwd: 'C:\\repo',
  projections: { values: { title: '历史导入设计' } },
  ...overrides
});

const message = (seq, role, text) => ({
  event: {
    type: `${role}/message`,
    seq,
    time: seq * 10,
    data: { message: { role, content: [{ type: 'text', text }, { type: 'thinking', thinking: 'hidden' }] } }
  }
});

test('history selection exposes opaque ids and rejects stale or running sessions', () => {
  let counter = 0;
  const catalog = new DshHistorySelectionCatalog({ randomToken: () => (++counter).toString(16).padStart(24, '0') });
  const rows = catalog.refresh([
    summary(),
    summary({ sessionId: 'sub', origin: 'subagent' }),
    summary({ sessionId: 'other', cwd: 'C:\\other' }),
    summary({ sessionId: 'running', running: true, updatedAt: 200 })
  ], 'C:\\repo');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'running');
  assert.equal(rows.every((row) => !row.id.includes('session')), true);
  assert.deepEqual(catalog.resolve({ ids: [rows[1].id] }, [summary(), summary({ sessionId: 'running', running: true, updatedAt: 200 })], 'C:\\repo').map((item) => item.sessionId), ['session-a']);
  assert.throws(() => catalog.resolve({ ids: [rows[0].id] }, [summary(), summary({ sessionId: 'running', running: true, updatedAt: 200 })], 'C:\\repo'), /状态已变化/);
  assert.throws(() => catalog.resolve({ ids: [rows[1].id] }, [summary({ updatedAt: 101 })], 'C:\\repo'), /状态已变化/);
});

test('history selection normalizes numeric and ISO Harness timestamps consistently', () => {
  assert.equal(normalizedTimestamp(100), 100);
  assert.equal(normalizedTimestamp('2026-08-30T12:00:00.000Z'), Date.parse('2026-08-30T12:00:00.000Z'));
  let counter = 0;
  const catalog = new DshHistorySelectionCatalog({ randomToken: () => (++counter).toString(16).padStart(24, '0') });
  const fresh = [
    summary({ sessionId: 'older', updatedAt: '2026-08-29T12:00:00.000Z' }),
    summary({ sessionId: 'newer', updatedAt: '2026-08-30T12:00:00.000Z' })
  ];
  const rows = catalog.refresh(fresh, 'C:\\repo');
  assert.equal(rows[0].updatedAt, Date.parse('2026-08-30T12:00:00.000Z'));
  assert.equal(catalog.resolve({ ids: [rows[0].id] }, fresh, 'C:\\repo')[0].sessionId, 'newer');
});

test('history extraction keeps only user and assistant text and redacts fixed credentials', () => {
  const extracted = extractHistoryMessages([
    message(1, 'user', 'DEEPSEEK_API_KEY=super-secret-value'),
    { event: { type: 'tool/result', seq: 2, time: 20, data: { output: 'sk-tool-secret-1234567890' } } },
    message(3, 'assistant', 'Use Bearer abcdefghijklmnopqrstuvwxyz and sk-realistic-example-123456.'),
    { event: { type: 'assistant/message', seq: 4, time: 40, data: { message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private chain' }] } } } }
  ]);
  assert.equal(extracted.messages.length, 2);
  assert.equal(extracted.messages.some((item) => item.text.includes('super-secret-value')), false);
  assert.equal(extracted.messages.some((item) => item.text.includes('abcdefghijklmnopqrstuvwxyz')), false);
  assert.equal(extracted.messages.some((item) => item.text.includes('private chain')), false);
  assert.deepEqual(extracted.redactions.map((item) => item.id).sort(), ['api-key', 'bearer', 'credential-value']);
  assert.doesNotMatch(extracted.messages.map((item) => item.text).join('\n'), /\[已遮蔽凭据\]\s+(?:API Key|Token)\]/);
  const direct = redactSensitiveText('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
  assert.equal(direct.text, '[已遮蔽私钥]');
});

test('session history paginates backwards without duplicating events', async () => {
  const calls = [];
  const apiCall = async (_origin, method, payload) => {
    calls.push({ method, payload });
    if (payload.beforeSeq === undefined) return { events: [message(4, 'user', '四'), message(5, 'assistant', '五')], hasMore: true };
    return { events: [message(1, 'user', '一'), message(4, 'user', '四')], hasMore: false };
  };
  const result = await loadSessionHistory(apiCall, 'http://127.0.0.1:1234', summary());
  assert.deepEqual(result.messages.map((item) => item.seq), [1, 4, 5]);
  assert.equal(calls[1].payload.beforeSeq, 4);
  assert.equal(calls.every((call) => call.method === 'session.history'), true);
});

test('prepared history source is bounded, redacted, and contains no raw session id', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-history-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'source.json');
  const apiCall = async () => ({
    events: [message(1, 'user', '问题 TOKEN=abcdef123456'), message(2, 'assistant', '可复用结论')],
    hasMore: false
  });
  const result = await prepareDshHistorySource({
    apiCall,
    origin: 'http://127.0.0.1:1234',
    summaries: [summary({ projections: { values: { title: 'Key sk-title-secret-1234567890' } } })],
    workspacePath: root,
    sourcePath,
    clock: () => new Date('2026-08-30T00:00:00.000Z')
  });
  const text = await fs.readFile(sourcePath, 'utf8');
  const source = JSON.parse(text);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.totalMessages, 2);
  assert.equal(text.includes('session-a'), false);
  assert.equal(text.includes('abcdef123456'), false);
  assert.equal(text.includes('sk-title-secret-1234567890'), false);
  assert.equal(source.sessions[0].title.includes('[已遮蔽 API Key]'), true);
  assert.equal(source.sessions[0].messages[0].text.includes('[已遮蔽凭据]'), true);
  assert.equal(source.sourceToken, result.sourceToken);
  assert.equal(new Date(source.expiresAt).getTime() - new Date(source.createdAt).getTime(), 30 * 60 * 1000);
});
