const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TasksSubagentsController,
  TasksSubagentsError,
  getHarnessJobsSnapshotScript,
  getHarnessSubagentSelectionScript,
  normalizeJobsSnapshot,
  redactSensitiveText
} = require('../electron/tasks-subagents.cjs');

const ROOT = 'session-11111111-1111-4111-8111-111111111111';
const CHILD = 'session-22222222-2222-4222-8222-222222222222';
const ONE_SHOT = 'session-33333333-3333-4333-8333-333333333333';
const ORDINARY_FORK = 'session-44444444-4444-4444-8444-444444444444';

const ids = () => {
  let value = 0;
  return () => (++value).toString(16).padStart(24, '0');
};

const fixture = ({ parentAvailable = true, childActivity = 'running' } = {}) => {
  const calls = [];
  const apiCall = async (_origin, method, payload) => {
    calls.push({ method, payload });
    if (method === 'session.list') {
      return {
        items: [
          { sessionId: ROOT, updatedAt: 1, running: true, blank: false, cwd: 'C:\\repo', projections: { values: { title: '主任务' } } },
          { sessionId: CHILD, updatedAt: 2, running: true, blank: false, cwd: 'C:\\repo', parentSessionId: ROOT, origin: 'subagent' },
          { sessionId: ONE_SHOT, updatedAt: 3, running: false, blank: false, cwd: 'C:\\repo', parentSessionId: ROOT, origin: 'subagent' },
          { sessionId: ORDINARY_FORK, updatedAt: 4, running: false, blank: false, cwd: 'C:\\repo', parentSessionId: ROOT }
        ]
      };
    }
    if (method === 'subagent.list') {
      assert.equal(payload.parentSessionId, ROOT);
      return {
        parentAvailable,
        entries: [
          { kind: 'child', id: CHILD, mode: 'continuable', label: '持续审核', activity: childActivity, hasChildren: false },
          { kind: 'child', id: ONE_SHOT, mode: 'one-shot', activity: 'inactive', hasChildren: false }
        ]
      };
    }
    if (method === 'subagent.prompt') return { messageId: 'message-accepted' };
    if (method === 'subagent.interrupt') return { accepted: true };
    throw new Error(`unexpected ${method}`);
  };
  const controller = new TasksSubagentsController({
    getOrigin: () => 'http://127.0.0.1:18888',
    getWebContents: () => ({}),
    apiCall,
    readSelection: async () => ROOT,
    readJobs: async () => ({ status: 'ready', entries: [{ kind: 'pwsh', label: 'pnpm test', status: '运行中', duration: '2 秒', live: true }] }),
    mintId: ids()
  });
  return { controller, calls };
};

test('task catalog uses Harness subagent membership and excludes ordinary forks', async () => {
  const { controller } = fixture();
  const state = await controller.scan({ agentDiagnostics: { status: 'waiting', pendingCount: 2, queuedCount: 1 } });
  assert.equal(state.available, true);
  assert.equal(state.current.title, '主任务');
  assert.equal(state.root.title, '主任务');
  assert.equal(state.subagents.length, 2);
  assert.equal(state.subagents.some((entry) => entry.sessionSuffix === ORDINARY_FORK.slice(-8)), false);
  assert.equal(state.counts.runningSubagents, 1);
  assert.equal(state.counts.backgroundJobs, 1);
  assert.equal(state.counts.pending, 2);
  assert.equal(state.subagents[0].canPrompt, true);
  assert.equal(state.subagents[0].canInterrupt, true);
  assert.equal(state.subagents[1].canPrompt, false);
});

test('follow-up and interrupt revalidate the exact durable address and preserve acknowledgement semantics', async () => {
  const { controller, calls } = fixture();
  const state = await controller.scan();
  const child = state.subagents.find((entry) => entry.mode === 'continuable');
  const prompt = await controller.prompt(child.id, '继续核对发布资产');
  const interrupt = await controller.interrupt(child.id);
  assert.equal(prompt.accepted, true);
  assert.match(prompt.message, /不代表任务已经完成/);
  assert.equal(interrupt.accepted, true);
  assert.match(interrupt.message, /可能短暂仍显示为运行中/);
  const promptCall = calls.find((entry) => entry.method === 'subagent.prompt');
  assert.deepEqual(promptCall.payload, {
    parentSessionId: ROOT,
    childSessionId: CHILD,
    mode: 'continuable',
    content: [{ type: 'text', text: '继续核对发布资产' }]
  });
  const interruptCall = calls.find((entry) => entry.method === 'subagent.interrupt');
  assert.deepEqual(interruptCall.payload, { parentSessionId: ROOT, childSessionId: CHILD, mode: 'continuable' });
});

test('one-shot and unavailable-parent entries fail closed for supplemental messages', async () => {
  const unavailable = fixture({ parentAvailable: false });
  const unavailableState = await unavailable.controller.scan();
  const continuable = unavailableState.subagents.find((entry) => entry.mode === 'continuable');
  assert.equal(continuable.canPrompt, false);
  await assert.rejects(unavailable.controller.prompt(continuable.id, 'message'), (error) => (
    error instanceof TasksSubagentsError && error.code === 'parent-unavailable'
  ));

  const normal = fixture();
  const state = await normal.controller.scan();
  const oneShot = state.subagents.find((entry) => entry.mode === 'one-shot');
  await assert.rejects(normal.controller.prompt(oneShot.id, 'message'), (error) => (
    error instanceof TasksSubagentsError && error.code === 'not-continuable'
  ));
  await assert.rejects(normal.controller.prompt('not-an-id', 'message'), (error) => (
    error instanceof TasksSubagentsError && error.code === 'invalid-id'
  ));
});

test('interrupt refuses a child whose running state changed before confirmation', async () => {
  const stopped = fixture({ childActivity: 'inactive' });
  const state = await stopped.controller.scan();
  const continuable = state.subagents.find((entry) => entry.mode === 'continuable');
  assert.equal(continuable.canInterrupt, false);
  await assert.rejects(stopped.controller.interrupt(continuable.id), (error) => (
    error instanceof TasksSubagentsError && error.code === 'not-running'
  ));
  assert.equal(stopped.calls.some((entry) => entry.method === 'subagent.interrupt'), false);
});

test('jobs are bounded, read-only, and redact credential-shaped command text', () => {
  const value = normalizeJobsSnapshot({
    status: 'ready',
    entries: [{ kind: 'pwsh', label: 'DEEPSEEK_API_KEY=secret-value pnpm test sk-abcdefghijk', status: 'running', duration: '1s', live: true }]
  });
  assert.equal(value.readOnly, true);
  assert.equal(value.entries.length, 1);
  assert.doesNotMatch(value.entries[0].label, /secret-value|sk-abcdefghijk/);
  assert.match(value.entries[0].label, /已隐藏/);
  assert.doesNotMatch(redactSensitiveText('Authorization: Bearer abcdefghijklmnop'), /abcdefghijklmnop/);
  assert.doesNotMatch(redactSensitiveText('DEEPSEEK_API_KEY="quoted secret value" pnpm test'), /quoted secret value/);
});

test('official jobs script and subagent selection stay on pinned Harness seams', () => {
  const jobs = getHarnessJobsSnapshotScript();
  assert.match(jobs, /后台任务/);
  assert.match(jobs, /Background jobs/);
  assert.match(jobs, /aria-expanded/);
  assert.match(jobs, /requestAnimationFrame/);
  const selection = getHarnessSubagentSelectionScript({ parentSessionId: ROOT, childSessionId: CHILD, mode: 'continuable' });
  assert.match(selection, /dsh\.sessions\.current/);
  assert.match(selection, /subagentAddress/);
  assert.match(selection, new RegExp(CHILD));
  assert.throws(() => getHarnessSubagentSelectionScript({ parentSessionId: ROOT, childSessionId: 'bad', mode: 'continuable' }));
});
