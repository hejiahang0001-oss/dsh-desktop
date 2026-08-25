const assert = require('node:assert/strict');
const test = require('node:test');

const { SideChatController, SideChatError, protectedMainState } = require('../electron/side-chat.cjs');

const MAIN = 'session-11111111-1111-4111-8111-111111111111';
const SIDE = 'session-22222222-2222-4222-8222-222222222222';
const WORKSPACE = 'workspace-11111111-1111-4111-8111-111111111111';

const fixture = ({
  blank = false,
  running = false,
  origin,
  mutateMain = false,
  permission = 'workspace-write',
  permissionDelay = 0,
  commandReceipt = true
} = {}) => {
  const calls = [];
  let sideCreated = false;
  let mainHistoryReads = 0;
  let sideHistoryReads = 0;
  const apiCall = async (_origin, method, payload) => {
    calls.push({ method, payload });
    if (method === 'session.list') {
      return { items: [
        { sessionId: MAIN, cwd: 'C:\\repo', blank, running, origin, projections: { values: { title: '主线发布' } } },
        ...(sideCreated ? [{ sessionId: SIDE, cwd: 'C:\\repo', blank: false, running: false, parentSessionId: blank ? undefined : MAIN }] : [])
      ] };
    }
    if (method === 'session.history' && payload.sessionId === MAIN) {
      mainHistoryReads += 1;
      return { events: [], projections: { values: {
        plan: { mode: mutateMain && mainHistoryReads > 1 ? 'plan' : 'default' },
        permissions: { currentValue: 'workspace-write' }
      } } };
    }
    if (method === 'session.history' && payload.sessionId === SIDE) {
      sideHistoryReads += 1;
      const currentValue = sideHistoryReads <= permissionDelay ? 'danger-full-access' : permission;
      return { events: [], projections: { values: { permissions: { currentValue } } } };
    }
    if (method === 'session.fork') {
      sideCreated = true;
      return { sessionId: SIDE };
    }
    if (method === 'workspace.create') return { workspace: { workspaceId: WORKSPACE, path: 'C:\\repo' }, created: false };
    if (method === 'session.create') {
      sideCreated = true;
      return { sessionId: SIDE };
    }
    if (method === 'session.prompt') return commandReceipt
      ? { accepted: true, command: { kind: 'success', text: 'preset workspace-write' } }
      : { accepted: true };
    if (method === 'session.rename') return { title: payload.title, seq: 3 };
    throw new Error(`unexpected ${method}`);
  };
  return {
    calls,
    controller: new SideChatController({
      getOrigin: () => 'http://127.0.0.1:18888',
      apiCall,
      readSelection: async () => MAIN,
      permissionAttempts: 2,
      permissionIntervalMs: 0,
      delay: async () => {}
    })
  };
};

test('Side Chat forks the completed main session and proves independent permission state', async () => {
  const { controller, calls } = fixture();
  const created = await controller.create({
    mainWebContents: {},
    workspacePath: 'C:\\repo',
    agentState: { status: 'ready', pendingCount: 0, queuedCount: 0 }
  });
  assert.equal(created.kind, 'fork');
  assert.equal(created.permission, 'workspace-write');
  assert.deepEqual(calls.find((entry) => entry.method === 'session.fork').payload, { sessionId: MAIN });
  assert.deepEqual(calls.find((entry) => entry.method === 'session.prompt').payload, {
    sessionId: SIDE,
    mode: 'queue',
    content: [{ type: 'text', text: '/permission workspace-write' }]
  });
  assert.equal(calls.some((entry) => entry.method === 'session.create'), false);
});

test('a blank main session creates a fresh workspace member instead of inventing a fork boundary', async () => {
  const { controller, calls } = fixture({ blank: true });
  const created = await controller.create({ mainWebContents: {}, workspacePath: 'C:\\repo', agentState: { status: 'ready' } });
  assert.equal(created.kind, 'fresh');
  assert.equal(calls.some((entry) => entry.method === 'session.fork'), false);
  assert.deepEqual(calls.find((entry) => entry.method === 'session.create').payload, { workspaceId: WORKSPACE });
});

test('permission confirmation follows the durable projection when the accepted command receipt is asynchronous', async () => {
  const { controller } = fixture({ commandReceipt: false, permissionDelay: 1 });
  const created = await controller.create({ mainWebContents: {}, workspacePath: 'C:\\repo', agentState: { status: 'ready' } });
  assert.equal(created.permission, 'workspace-write');
});

test('busy, subagent, and mismatched-workspace sources fail closed before session creation', async () => {
  await assert.rejects(
    fixture().controller.create({ mainWebContents: {}, workspacePath: 'C:\\repo', agentState: { status: 'running' } }),
    (error) => error instanceof SideChatError && error.code === 'main-busy'
  );
  await assert.rejects(
    fixture({ origin: 'subagent' }).controller.create({ mainWebContents: {}, workspacePath: 'C:\\repo', agentState: { status: 'ready' } }),
    (error) => error instanceof SideChatError && error.code === 'subagent-selected'
  );
  await assert.rejects(
    fixture().controller.create({ mainWebContents: {}, workspacePath: 'C:\\other', agentState: { status: 'ready' } }),
    (error) => error instanceof SideChatError && error.code === 'workspace-mismatch'
  );
});

test('main projection races and unverified side permissions are rejected', async () => {
  await assert.rejects(
    fixture({ mutateMain: true }).controller.create({ mainWebContents: {}, workspacePath: 'C:\\repo', agentState: { status: 'ready' } }),
    (error) => error instanceof SideChatError && error.code === 'main-state-changed'
  );
  await assert.rejects(
    fixture({ permission: 'danger-full-access' }).controller.create({ mainWebContents: {}, workspacePath: 'C:\\repo', agentState: { status: 'ready' } }),
    (error) => error instanceof SideChatError && error.code === 'permission-unverified'
  );
  assert.notEqual(protectedMainState({ projections: { values: { plan: { mode: 'a' } } } }), protectedMainState({ projections: { values: { plan: { mode: 'b' } } } }));
});
