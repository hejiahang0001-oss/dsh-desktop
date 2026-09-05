const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveHarnessSessionContext } = require('../electron/harness-session-context.cjs');
const { DocumentIntakeController, contextKey } = require('../electron/document-intake-controller.cjs');
const id = 'session-11111111-1111-4111-8111-111111111111';
const other = 'session-22222222-2222-4222-8222-222222222222';
const a = path.resolve('launch-A'), b = path.resolve('sidebar-B');
function fixture(overrides = {}) {
  return { origin: 'http://127.0.0.1:19999', webContents: {}, fallbackWorkspacePath: a,
    readSelection: async () => id,
    apiCall: async (_origin, method) => { assert.equal(method, 'session.list'); return { items: [{ sessionId: id, cwd: b, origin: 'local' }] }; },
    stat: async () => ({ isDirectory: () => true }), ...overrides };
}
test('selected chat identity uses authoritative cwd B without changing native launch workspace A', async () => {
  const options = fixture();
  assert.deepEqual(await resolveHarnessSessionContext(options), { sessionId: id, workspacePath: b });
  assert.equal(options.fallbackWorkspacePath, a);
});
test('removed, subagent, relative and non-directory sessions fail closed', async () => {
  for (const summary of [null, { sessionId: id, cwd: b, origin: 'subagent' }, { sessionId: id, cwd: 'relative' }]) {
    await assert.rejects(resolveHarnessSessionContext(fixture({ apiCall: async () => ({ items: summary ? [summary] : [] }) })));
  }
  await assert.rejects(resolveHarnessSessionContext(fixture({ stat: async () => ({ isDirectory: () => false }) })), /不是目录/);
});
test('selection changes while metadata is read cannot produce a stale context', async () => {
  let selected = id;
  await assert.rejects(resolveHarnessSessionContext(fixture({ readSelection: async () => selected,
    stat: async () => { selected = other; return { isDirectory: () => true }; } })), /会话已切换/);
});
test('a genuinely unselected composer retains the validated native fallback', async () => {
  assert.deepEqual(await resolveHarnessSessionContext(fixture({ readSelection: async () => '',
    apiCall: async () => { throw new Error('No selected session needs a catalog query'); } })), { sessionId: '', workspacePath: a });
});
test('document import is pinned to the sidebar context and never to the stale launch directory', async () => {
  let received;
  const options = fixture();
  const getContext = () => resolveHarnessSessionContext(options);
  const controller = new DocumentIntakeController({ getContext, chooseFiles: async () => [path.join(a, 'source.csv')], confirmImport: async () => true,
    intake: { importFiles: async (request) => { await request.assertCurrent(); received = request.workspacePath; return { items: [], rejected: [] }; } } });
  const state = await controller.getState();
  assert.equal(state.context, contextKey({ sessionId: id, workspacePath: b }));
  await controller.importFiles({ choose: true, expectedContext: state.context });
  assert.equal(received, b);
  assert.equal(options.fallbackWorkspacePath, a);
});
