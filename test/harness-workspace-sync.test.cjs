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

const createFetch = ({ selectedAvailable = true } = {}) => {
  const calls = [];
  const workspace = {
    workspaceId: WORKSPACE_ID,
    path: WORKSPACE_PATH,
    title: 'sample',
    sessionIds: [SESSION_ID],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z'
  };
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, ...request });
    if (request.method === 'workspace/create') return rpcResponse(request, { workspace, created: false });
    if (request.method === 'session/list') return rpcResponse(request, {
      items: selectedAvailable
        ? [{
            sessionId: SESSION_ID,
            cwd: WORKSPACE_PATH,
            blank: true,
            updatedAt: 10,
            projections: { asOfSeq: -1, values: {} }
          }]
        : []
    });
    if (request.method === 'session/create') return rpcResponse(request, { sessionId: NEW_SESSION_ID });
    if (request.method === 'session/page') return rpcResponse(request, { records: [], hasMore: false });
    if (request.method === 'session/prompt') return rpcResponse(request, { accepted: true });
    throw new Error(`unexpected method ${request.method}`);
  };
  return { calls, fetchImpl };
};

test('only a random IPv4 loopback origin can receive desktop workspace RPCs', async () => {
  assert.equal(isSafeHarnessOrigin('http://127.0.0.1:54321'), true);
  assert.equal(isSafeHarnessOrigin('http://127.0.0.1:54321/?token=secret'), false);
  assert.equal(isSafeHarnessOrigin('http://127.0.0.1:54321/#fragment'), false);
  assert.equal(isSafeHarnessOrigin('http://user:pass@127.0.0.1:54321/'), false);
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
    selectedSessionId: SESSION_ID,
    fetchImpl: fixture.fetchImpl
  });
  assert.equal(result.workspaceId, WORKSPACE_ID);
  assert.equal(result.sessionId, SESSION_ID);
  assert.equal(result.sessionCreated, false);
  assert.deepEqual(fixture.calls.map((call) => call.method), [
    'workspace/create',
    'session/list'
  ]);
  assert.deepEqual(fixture.calls[0].payload.args.request, { path: WORKSPACE_PATH });
  assert.deepEqual(fixture.calls[1].payload.args._request, {});
  assert.match(fixture.calls[0].url, /\/api\/workspace\/create$/);
});

test('workspace sync creates a session when the page has not selected one', async () => {
  const fixture = createFetch();
  const result = await synchronizeHarnessWorkspace({
    origin: 'http://127.0.0.1:54321',
    workspacePath: WORKSPACE_PATH,
    fetchImpl: fixture.fetchImpl
  });
  assert.equal(result.sessionId, NEW_SESSION_ID);
  assert.equal(result.sessionCreated, true);
  assert.equal(fixture.calls.at(-1).method, 'session/create');
  assert.deepEqual(fixture.calls.at(-1).payload.args.request, { workspaceId: WORKSPACE_ID });
});

test('a selected session missing from the live list is not silently reopened', async () => {
  const fixture = createFetch({ selectedAvailable: false });
  const result = await synchronizeHarnessWorkspace({
    origin: 'http://127.0.0.1:54321',
    workspacePath: WORKSPACE_PATH,
    selectedSessionId: SESSION_ID,
    fetchImpl: fixture.fetchImpl
  });
  assert.equal(result.sessionId, NEW_SESSION_ID);
  assert.equal(result.sessionCreated, true);
});

test('legacy prompt and history calls use the official Remote wire shape', async () => {
  const fixture = createFetch();
  const receipt = await callHarnessApi('http://127.0.0.1:54321', 'session.prompt', {
    sessionId: SESSION_ID,
    mode: 'queue',
    content: [{ type: 'text', text: 'hello' }]
  }, { fetchImpl: fixture.fetchImpl });
  assert.equal(receipt.accepted, true);
  const prompt = fixture.calls.at(-1);
  assert.equal(prompt.method, 'session/prompt');
  assert.equal(typeof prompt.payload.args.request.requestId, 'string');
  assert.equal(prompt.payload.args.request.sessionId, SESSION_ID);

  const history = await callHarnessApi('http://127.0.0.1:54321', 'session.history', {
    sessionId: SESSION_ID,
    maxMessages: 2
  }, { fetchImpl: fixture.fetchImpl });
  assert.deepEqual(history.events, []);
  assert.equal(history.projections.asOfSeq, -1);
  assert.deepEqual(fixture.calls.slice(-2).map((call) => call.method), ['session/list', 'session/page']);
  assert.deepEqual(fixture.calls.at(-1).payload.args.request, {
    address: { kind: 'session', sessionId: SESSION_ID },
    throughSeq: -1,
    maxMessages: 2
  });
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
