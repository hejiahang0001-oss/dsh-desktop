const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { TerminalReadBroker, sanitizeOutput } = require('../electron/terminal-read-broker.cjs');
const workspacePath = path.resolve('terminal-read-fixture');
const sessionId = 'session-00000000-0000-0000-0000-000000000001';
const request = { sessionId, workspacePath, maxChars: 300 };
const setup = (overrides = {}) => new TerminalReadBroker({ getContext: async () => request, getSnapshot: () => ({ state: { cwd: workspacePath, pid: 1 }, output: 'x'.repeat(10000) }), confirm: async () => true, ...overrides });
test('terminal reader returns only bounded text after explicit confirmation', async () => {
  let preview; const broker = setup({ confirm: async (value) => { preview = value; return true; } });
  const result = await broker.read(request);
  assert.equal(preview.chars, 300); assert.ok(result.length < 500); assert.match(result, /已截断/);
});
test('terminal reader denies cancel, another session/workspace and switches during confirmation', async () => {
  await assert.rejects(setup({ confirm: async () => false }).read(request), /取消/);
  await assert.rejects(setup().read({ ...request, sessionId: sessionId.replace(/1$/, '2') }), /前台/);
  await assert.rejects(setup().read({ ...request, workspacePath: path.resolve('another') }), /前台/);
  let switched = false;
  await assert.rejects(setup({ confirm: async () => { switched = true; return true; }, getContext: async () => switched ? { ...request, sessionId: 'different' } : request }).read(request), /变化/);
});
test('terminal reader redacts known secrets and controls without reading clipboard or files', async () => {
  const broker = setup({ getSnapshot: () => ({ state: { cwd: workspacePath, pid: 1 }, output: '\u001b[31mKEY=private-value password=secret sk-abcdefghijklmnop' }), redact: (text) => text.replaceAll('private-value', '[REDACTED]') });
  const text = await broker.read(request); assert.doesNotMatch(text, /private-value|password=secret|sk-abcdef|\u001b/);
  assert.equal(sanitizeOutput('\0hello\b'), 'hello');
  assert.doesNotMatch(sanitizeOutput('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'), /abcdefghijklmnopqrstuvwxyz/);
});
test('terminal reader refuses overlapping confirmations and respects cancellation', async () => {
  let finish; const broker = setup({ confirm: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = broker.read(request); await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(broker.read(request), /等待确认/); finish(true); await pending;
  await assert.rejects(broker.read(request, AbortSignal.abort()), /abort/i);
});
