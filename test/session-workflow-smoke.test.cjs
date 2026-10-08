const assert = require('node:assert/strict');
const test = require('node:test');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { promptTurn, userStoppedPrompt, readSmokeHistory, officialActionExpression } = require('../electron/session-workflow-contract.cjs');
const { createApprovalFixture, validateApprovalFixture, matchingApproval, approvalGateResult, runApprovalSmoke } = require('../electron/session-approval-smoke.cjs');
const turn = (requestId, reason = { kind: 'completed' }, start = 1) => [
  { seq: start, type: 'turn/start', data: { turn: start } },
  { seq: start + 1, type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } },
  { seq: start + 2, type: 'turn/end', data: { turn: start, reason } }
];

test('Stop requires a durable user-caused abort of its exact submitted prompt', () => {
  const acceptedOnly = { events: [] };
  assert.equal(userStoppedPrompt(acceptedOnly, 'target'), false);
  for (const reason of [{ kind: 'completed' }, { kind: 'error' }, { kind: 'aborted', reason: { kind: 'disposed' } }, { kind: 'aborted', reason: { kind: 'parent' } }]) {
    assert.equal(userStoppedPrompt({ events: turn('target', reason) }, 'target'), false);
  }
  const stopped = turn('target', { kind: 'aborted', reason: { kind: 'user' } });
  assert.equal(userStoppedPrompt({ events: stopped }, 'target'), true);
  assert.equal(userStoppedPrompt({ events: [...stopped, ...turn('next', { kind: 'completed' }, 4)] }, 'target'), true);
  assert.equal(userStoppedPrompt({ events: stopped }, 'unrelated'), false);
  assert.equal(userStoppedPrompt({ events: stopped.slice(0, -1) }, 'target'), false);
  assert.equal(promptTurn(stopped, 'target').endSeq, 3);
});

test('history acceptance pins its cut and reconstructs backwards pages without activating another source', async () => {
  const expected = [...turn('a'), ...turn('b', { kind: 'completed' }, 4)];
  const requests = [];
  const api = async (origin, method, payload) => {
    requests.push({ origin, method, payload });
    return { throughSeq: 6, hasMore: payload.beforeSeq === undefined,
      events: (payload.beforeSeq === undefined ? expected.slice(3) : expected.slice(0, 3)).map(event => ({ event })) };
  };
  assert.deepEqual((await readSmokeHistory(api, 'http://127.0.0.1:42', 'fixture')).events, expected);
  assert.equal(requests[1].payload.throughSeq, 6);
  assert.equal(requests[1].payload.beforeSeq, 4);
  assert.ok(requests.every(row => row.method === 'session.history' && row.payload.sessionId === 'fixture'));
});

test('history acceptance refuses moving cuts, repeated pages and empty nonterminal pages', async () => {
  let count = 0;
  await assert.rejects(readSmokeHistory(async () => ({ throughSeq: ++count, hasMore: true, events: [{ event: { seq: 0 } }] }), '', ''), /cut changed/);
  await assert.rejects(readSmokeHistory(async () => ({ throughSeq: 3, hasMore: true, events: [{ event: { seq: 1 } }] }), '', ''), /order/);
  await assert.rejects(readSmokeHistory(async () => ({ throughSeq: 3, hasMore: true, events: [] }), '', ''), /no progress/);
});

test('official action cannot click hidden, inert, occluded or ambiguous controls', () => {
  let clicks = 0;
  const button = { hidden: false, inert: false, disabled: false, textContent: '停止生成', parentElement: null,
    getAttribute: () => null, getBoundingClientRect: () => ({ width: 40, height: 40, left: 20, top: 20, right: 60, bottom: 60 }), contains: () => false, click: () => { clicks++; } };
  let buttons = [button], hit = button, root = { inert: false };
  const context = { innerWidth: 1280, innerHeight: 880, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { querySelectorAll: () => buttons, getElementById: () => root, elementFromPoint: () => hit } };
  const run = () => vm.runInNewContext(officialActionExpression(['停止生成'], true), context);
  assert.equal(run(), true); assert.equal(clicks, 1);
  button.hidden = true; assert.equal(run(), false); button.hidden = false;
  root.inert = true; assert.equal(run(), false); root.inert = false;
  hit = {}; assert.equal(run(), false); hit = button;
  buttons = [button, button]; assert.equal(run(), false); assert.equal(clicks, 1);
});

async function fixture(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-approval-contract-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'smoke.json'), workspace = `${target}.user-data/workspace`;
  await fsp.mkdir(workspace, { recursive: true });
  return createApprovalFixture(target, path.resolve(workspace));
}

test('approval fixtures bind a generated random ID, exact sibling path and immutable command', async t => {
  const value = await fixture(t);
  await validateApprovalFixture(value);
  assert.ok(Object.isFrozen(value));
  assert.ok(value.command.includes(value.marker) && value.command.includes(value.file));
  await assert.rejects(validateApprovalFixture({ ...value }), /not minted/);
  await assert.rejects(createApprovalFixture(path.join(os.tmpdir(), 'not-this-run.json'), value.workspacePath), /isolated smoke/);
  await fsp.writeFile(value.file, 'unexpected');
  await assert.rejects(validateApprovalFixture(value), /absent/);
});

test('Ask matches only the exact admitted request, tool call, random fixture command and decision', async t => {
  const value = await fixture(t);
  const events = [
    ...turn('request').slice(0, 2),
    { seq: 3, type: 'tool/call', data: { callId: 'call', name: 'pwsh', arguments: JSON.stringify({ command: value.command, sandbox_permissions: 'danger-full-access', justification: value.marker }) } },
    { seq: 4, type: 'approval/asked', data: { id: 'approval', callId: 'call', toolName: 'pwsh' } }
  ];
  assert.deepEqual(matchingApproval(events, 'request', value), { id: 'approval', callId: 'call', outcome: null });
  assert.equal(matchingApproval(events, 'another-request', value), null);
  const wrong = structuredClone(events); wrong[2].data.arguments = JSON.stringify({ command: value.command + '; Get-Content secret', sandbox_permissions: 'danger-full-access', justification: value.marker });
  assert.equal(matchingApproval(wrong, 'request', value), null);
  const wrongCall = structuredClone(events); wrongCall[3].data.callId = 'other'; assert.equal(matchingApproval(wrongCall, 'request', value), null);
  events.push({ seq: 5, type: 'approval/decided', data: { id: 'approval', outcome: 'rejected' } });
  assert.equal(matchingApproval(events, 'request', value).outcome, 'rejected');
});

test('approval refuses a replaced fixture directory even when its pathname is unchanged', async t => {
  const value = await fixture(t);
  await fsp.rename(value.directory, `${value.directory}-retained`);
  await fsp.mkdir(value.directory);
  await assert.rejects(validateApprovalFixture(value), /identity changed/);
});

test('unapproved allow-once coverage stays pending, never becomes pass', () => {
  assert.equal(approvalGateResult({ denied: true, allowed: true }).status, 'pending-authorization');
  assert.equal(approvalGateResult({ denied: true, allowed: true }).ok, false);
  assert.equal(approvalGateResult({ denied: true, allowed: false, allowOneFixtureApprovalExplicitlyAuthorized: true }).ok, false);
  assert.equal(approvalGateResult({ denied: true, allowed: true, allowOneFixtureApprovalExplicitlyAuthorized: true }).ok, true);
});

test('Ask refuses a pre-widened permission preset before any model or UI request', async () => {
  await assert.rejects(runApprovalSmoke({ selected: { sessionId: 'fixture' }, api: async (_origin, method) => {
    assert.equal(method, 'session.history'); return { projections: { values: { permissions: { currentValue: 'danger-full-access' } } } };
  } }), /default permission preset/);
});
