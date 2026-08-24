const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  captureHarnessCheckpointLink,
  completedTurnSeq,
  forkHarnessCheckpointSession
} = require('../electron/harness-checkpoint-link.cjs');

const SOURCE_ID = 'session-11111111-1111-4111-8111-111111111111';
const CHILD_ID = 'session-22222222-2222-4222-8222-222222222222';
const WORKSPACE = path.resolve('C:\\work\\project');
const ORIGIN = 'http://127.0.0.1:43125';

test('checkpoint link captures the selected ordinary session and latest completed turn', async () => {
  const calls = [];
  const apiCall = async (_origin, method, payload, options) => {
    calls.push({ method, payload, timeoutMs: options.timeoutMs });
    if (method === 'session.list') return {
      items: [{ sessionId: SOURCE_ID, cwd: WORKSPACE, running: false, blank: false }]
    };
    if (method === 'session.history') return {
      events: [
        { event: { type: 'turn/end', seq: 8 } },
        { event: { type: 'session/title', seq: 9 } },
        { event: { type: 'turn/end', seq: 14 } }
      ]
    };
    throw new Error(`unexpected ${method}`);
  };
  const link = await captureHarnessCheckpointLink({
    origin: ORIGIN,
    webContents: {},
    workspacePath: WORKSPACE,
    apiCall,
    readSelection: async () => SOURCE_ID
  });
  assert.deepEqual(link, {
    sessionId: SOURCE_ID,
    atSeq: 14,
    linked: true,
    forkAvailable: true,
    reason: 'ready'
  });
  assert.deepEqual(calls.map(({ method }) => method).sort(), ['session.history', 'session.list']);
  assert.deepEqual(calls.find(({ method }) => method === 'session.history').payload, {
    sessionId: SOURCE_ID,
    maxMessages: 2
  });
});

test('checkpoint link keeps a valid session association without inventing a completed turn', async () => {
  const link = await captureHarnessCheckpointLink({
    origin: ORIGIN,
    webContents: {},
    workspacePath: WORKSPACE,
    apiCall: async (_origin, method) => method === 'session.list'
      ? { items: [{ sessionId: SOURCE_ID, cwd: WORKSPACE, running: false, blank: true }] }
      : { events: [{ event: { type: 'session/title', seq: 2 } }] },
    readSelection: async () => SOURCE_ID
  });
  assert.equal(link.linked, true);
  assert.equal(link.forkAvailable, false);
  assert.equal(link.atSeq, null);
  assert.equal(link.reason, 'no-completed-turn');
  assert.equal(completedTurnSeq({ events: [{ event: { type: 'turn/start', seq: 3 } }] }), null);
});

test('checkpoint link refuses a session from another workspace or a subagent', async () => {
  await assert.rejects(captureHarnessCheckpointLink({
    origin: ORIGIN,
    webContents: {},
    workspacePath: WORKSPACE,
    apiCall: async (_origin, method) => method === 'session.list'
      ? { items: [{ sessionId: SOURCE_ID, cwd: path.resolve('C:\\work\\other'), running: false }] }
      : { events: [] },
    readSelection: async () => SOURCE_ID
  }), (error) => error?.code === 'session-workspace-mismatch');
});

test('session fork uses the exact stored boundary and verifies child lineage without changing code', async () => {
  const calls = [];
  let listCount = 0;
  const apiCall = async (_origin, method, payload) => {
    calls.push({ method, payload });
    if (method === 'session.list') {
      listCount += 1;
      return listCount === 1
        ? { items: [{ sessionId: SOURCE_ID, cwd: WORKSPACE, running: false }] }
        : { items: [
          { sessionId: SOURCE_ID, cwd: WORKSPACE, running: false },
          { sessionId: CHILD_ID, parentSessionId: SOURCE_ID, cwd: WORKSPACE, running: false }
        ] };
    }
    if (method === 'session.fork') return { sessionId: CHILD_ID };
    throw new Error(`unexpected ${method}`);
  };
  const result = await forkHarnessCheckpointSession({
    origin: ORIGIN,
    workspacePath: WORKSPACE,
    sessionId: SOURCE_ID,
    atSeq: 14,
    apiCall
  });
  assert.deepEqual(result, { sourceSessionId: SOURCE_ID, sessionId: CHILD_ID, atSeq: 14 });
  assert.deepEqual(calls.map(({ method }) => method), ['session.list', 'session.fork', 'session.list']);
  assert.deepEqual(calls[1].payload, { sessionId: SOURCE_ID, atSeq: 14 });
});

test('session fork fails closed for missing boundaries and unverified children', async () => {
  await assert.rejects(forkHarnessCheckpointSession({
    origin: ORIGIN,
    workspacePath: WORKSPACE,
    sessionId: SOURCE_ID,
    atSeq: null,
    apiCall: async () => ({})
  }), (error) => error?.code === 'checkpoint-not-forkable');

  let listCount = 0;
  await assert.rejects(forkHarnessCheckpointSession({
    origin: ORIGIN,
    workspacePath: WORKSPACE,
    sessionId: SOURCE_ID,
    atSeq: 14,
    apiCall: async (_origin, method) => {
      if (method === 'session.fork') return { sessionId: CHILD_ID };
      listCount += 1;
      return listCount === 1
        ? { items: [{ sessionId: SOURCE_ID, cwd: WORKSPACE, running: false }] }
        : { items: [{ sessionId: CHILD_ID, parentSessionId: CHILD_ID, cwd: WORKSPACE, running: false }] };
    }
  }), (error) => error?.code === 'fork-verification-failed');
});
