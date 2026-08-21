const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HarnessWorkspaceSyncError,
  callHarnessApi,
  getHarnessSessionSelectionReadScript,
  getHarnessSessionSelectionScript,
  isSafeHarnessOrigin,
  readHarnessSessionSelection,
  selectHarnessSession,
  synchronizeHarnessWorkspace,
  waitForHarnessSessionSelection
} = require('../electron/harness-workspace-sync.cjs');

const WORKSPACE_ID = '9452114e-d724-4707-bcf0-bdb681148d39';
const SESSION_ID = 'session-9e2dd069-ce45-4ae2-b29c-d8a3b5588f95';
const NEW_SESSION_ID = 'session-c4611a12-c7e6-4c39-a81f-3af6e154bdef';
const WORKSPACE_PATH = process.platform === 'win32' ? 'C:\\code\\sample' : '/code/sample';

const rpcResponse = (request, value) => new Response(JSON.stringify({
  type: 'server-response',
  rpcId: request.rpcId,
  result: { ok: true, value }
}), { status: 200, headers: { 'content-type': 'application/json' } });

const createFetch = ({ blank = true, archived = false } = {}) => {
  const calls = [];
  const workspace = {
    workspaceId: WORKSPACE_ID,
    path: WORKSPACE_PATH,
    title: 'sample',
    sessionIds: [SESSION_ID],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  };
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request);
    if (request.method === 'workspace.create') return rpcResponse(request, { workspace, created: false });
    if (request.method === 'workspace.list') return rpcResponse(request, {
      items: [workspace],
      archivedSessionIds: archived ? [SESSION_ID] : []
    });
    if (request.method === 'session.list') return rpcResponse(request, {
      items: [{ sessionId: SESSION_ID, cwd: WORKSPACE_PATH, blank, updatedAt: 10 }]
    });
    if (request.method === 'session.create') return rpcResponse(request, { sessionId: NEW_SESSION_ID });
    throw new Error(`unexpected method ${request.method}`);
  };
  return { calls, fetchImpl };
};

test('only a random IPv4 loopback origin can receive desktop workspace RPCs', async () => {
  assert.equal(isSafeHarnessOrigin('http://127.0.0.1:54321'), true);
  assert.equal(isSafeHarnessOrigin('http://localhost:54321'), false);
  assert.equal(isSafeHarnessOrigin('https://127.0.0.1:54321'), false);
  await assert.rejects(
    callHarnessApi('https://example.com', 'workspace.list', {}, { fetchImpl: async () => new Response() }),
    (error) => error instanceof HarnessWorkspaceSyncError && error.code === 'unsafe-origin'
  );
});

test('workspace sync adopts the official Workspace and reuses its blank session', async () => {
  const fixture = createFetch();
  const result = await synchronizeHarnessWorkspace({
    origin: 'http://127.0.0.1:54321',
    workspacePath: WORKSPACE_PATH,
    fetchImpl: fixture.fetchImpl
  });
  assert.equal(result.workspaceId, WORKSPACE_ID);
  assert.equal(result.sessionId, SESSION_ID);
  assert.equal(result.sessionCreated, false);
  assert.deepEqual(fixture.calls.map((call) => call.method), [
    'workspace.create',
    'workspace.list',
    'session.list'
  ]);
});

test('workspace sync creates a session when no reusable blank session is available', async () => {
  const fixture = createFetch({ blank: false });
  const result = await synchronizeHarnessWorkspace({
    origin: 'http://127.0.0.1:54321',
    workspacePath: WORKSPACE_PATH,
    fetchImpl: fixture.fetchImpl
  });
  assert.equal(result.sessionId, NEW_SESSION_ID);
  assert.equal(result.sessionCreated, true);
  assert.equal(fixture.calls.at(-1).method, 'session.create');
  assert.deepEqual(fixture.calls.at(-1).payload, { workspaceId: WORKSPACE_ID });
});

test('archived blank sessions are not silently reopened', async () => {
  const fixture = createFetch({ archived: true });
  const result = await synchronizeHarnessWorkspace({
    origin: 'http://127.0.0.1:54321',
    workspacePath: WORKSPACE_PATH,
    fetchImpl: fixture.fetchImpl
  });
  assert.equal(result.sessionId, NEW_SESSION_ID);
  assert.equal(result.sessionCreated, true);
});

test('session selection is a fixed localStorage write with a validated id', async () => {
  const scripts = [];
  const webContents = {
    executeJavaScript: async (script, userGesture) => {
      scripts.push({ script, userGesture });
      return { changed: true, sessionId: SESSION_ID };
    }
  };
  assert.deepEqual(await selectHarnessSession(webContents, SESSION_ID), { changed: true, sessionId: SESSION_ID });
  assert.equal(scripts[0].userGesture, true);
  assert.match(scripts[0].script, /dsh\.sessions\.current/);
  assert.match(getHarnessSessionSelectionScript(SESSION_ID), /localStorage\.setItem/);
  assert.throws(() => getHarnessSessionSelectionScript("session-x'; alert(1); //"), /会话标识无效/);
});

test('session selection verification waits through the official startup persistence gap', async () => {
  const values = ['', '', SESSION_ID];
  const scripts = [];
  const webContents = {
    executeJavaScript: async (script, userGesture) => {
      scripts.push({ script, userGesture });
      return { sessionId: values.shift() || '' };
    }
  };
  const result = await waitForHarnessSessionSelection(webContents, SESSION_ID, {
    timeoutMs: 1000,
    intervalMs: 0,
    delayImpl: async () => {}
  });
  assert.equal(result.sessionId, SESSION_ID);
  assert.equal(result.attempts, 3);
  assert.equal(scripts.every((entry) => entry.userGesture === true), true);
  assert.match(getHarnessSessionSelectionReadScript(), /localStorage\.getItem/);
  assert.equal(await readHarnessSessionSelection({
    executeJavaScript: async () => ({ sessionId: 'not-a-session' })
  }), '');
});
