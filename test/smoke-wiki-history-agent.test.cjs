const assert = require('node:assert/strict');
const test = require('node:test');
const { assistantTexts, toolCallsOf, createSyntheticHistory } = require('../scripts/smoke-wiki-history-agent.cjs');
const { extractHistoryMessages } = require('../electron/wiki-history-ingest.cjs');

test('V2 smoke tool argument inspection parses the durable JSON string before detecting early history-save', () => {
  const raw = JSON.stringify({ command: '& $env:DSH_DESKTOP_NODE $env:DSH_DESKTOP_WIKI_TOOL history-save --confirm token' });
  const calls = toolCallsOf({ events: [{ type: 'event', event: { type: 'tool/call', data: { name: 'pwsh', arguments: raw } } }] });
  assert.equal(calls[0].arguments, raw);
  assert.equal(calls.some((call) => call.name === 'pwsh' && /(?:^|\s)history-save(?:\s|$)/u.test(call.rawArguments.command)), true);
  for (const bad of [{ command: 'history-save' }, '{bad', 'null', '[]']) {
    assert.throws(() => toolCallsOf({ events: [{ event: { type: 'tool/call', data: { name: 'pwsh', arguments: bad } } }] }), /arguments/);
  }
});

test('V2 smoke keeps final assistant text, ignores failed attempts and keeps the synthetic user prompt redacted', () => {
  const history = createSyntheticHistory('synthetic-placeholder-12345', 123456);
  history.events.push({ type: 'event', event: { type: 'assistant/attempt', data: { stream: [{ type: 'text-chunks', texts: ['failed attempt'] }] } } });
  assert.deepEqual(assistantTexts(history), ['历史导入必须保持原始会话只读，并先预览再确认。']);
  const extracted = extractHistoryMessages(history.events);
  assert.deepEqual(extracted.messages.map((message) => message.role), ['user', 'assistant']);
  assert.match(extracted.messages[0].text, /DSH_HISTORY_REAL_VERIFIED/);
  assert.doesNotMatch(extracted.messages[0].text, /synthetic-placeholder-12345/);
  assert.equal(extracted.messages[0].time, 122456);
});
