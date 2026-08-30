const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { SessionControlClient } = require('../electron/session-control-client.cjs');
test('session control serializes fixed requests, rejects unknown operations and cancels on exit', async () => {
  const client = new SessionControlClient(), child = new EventEmitter(); child.connected = true;
  let active = 0, max = 0;
  child.send = (message, callback) => { active++; max = Math.max(active, max); setImmediate(() => { active--; child.emit('message', { channel: message.channel, requestId: message.requestId, ok: true, value: { n: message.payload.n } }); callback?.(); }); };
  client.attach(child); assert.deepEqual(await Promise.all([client.request('inspect', { n: 1 }), client.request('inspect', { n: 2 })]), [{ n: 1 }, { n: 2 }]); assert.equal(max, 1);
  await assert.rejects(client.request('execute', {}), /暂不可用/);
  child.send = () => {}; const pending = client.request('fork', {}); await new Promise(setImmediate); child.emit('exit'); await assert.rejects(pending, /断开/);
});
async function sdkFixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-sdk-handoff-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), target = path.join(root, 'target'); await fsp.mkdir(source); await fsp.mkdir(target);
  const id = `session-${randomUUID()}`, events = [{ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'workspace-write' } }];
  const entries = new Map([[id, { header: { id, cwd: source, agentPreset: 'standard' }, events, cursor: 0, [Symbol.dispose]() {} }]]);
  const agents = new Map([[id, { status: 'idle', ctx: {}, inbox: { hasPending: false } }]]);
  let createOptions;
  const ctx = {
    sessions: { get: (key) => entries.get(key) },
    agents: { get: (key) => agents.get(key), create: async (options) => { createOptions = options; await options.setup({}); const session = { id: options.sessionId, header: { id: options.sessionId, ...options.meta }, events: [...structuredClone(options.seed), { type: 'session/end-seed', seq: options.seed.length, data: {} }] }; entries.set(session.id, session); return { agent: { session } }; } },
    agentPresets: { composedPreset: () => 'standard', composeFrom() {}, mount: async () => {} }, agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'model' }) },
    sessionQuery: { observeSession: async (key) => { const value = entries.get(key); if (!value) throw new Error('missing'); return value; } },
    sessionController: { control: async function* () { yield { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }; }, inspect: async (key) => ({ meta: entries.get(key).header, events: entries.get(key).events }) },
    sessionPersistence: { ensureMaterialized: async () => {} }, workspaceRegistry: { create: async () => ({ id: 'workspace', attachSession: async () => {} }) }
  };
  const { sessionControl } = await import(pathToFileURL(path.resolve('runtime/dsh-desktop-tools/session-control.mjs')).href);
  return { ctx, entries, events, agents, id, source, target, sessionControl, created: () => createOptions };
}
test('SDK handoff creates composed Agent with immutable inherited history and permits only the seed marker', async (t) => {
  const f = await sdkFixture(t), request = { sessionId: f.id, workspacePath: f.source }, original = JSON.stringify(f.events);
  const state = await f.sessionControl(f.ctx, 'inspect', request);
  const childId = `session-${randomUUID()}`; const result = await f.sessionControl(f.ctx, 'fork', { ...request, childId, targetPath: f.target, historyHash: state.historyHash });
  assert.equal(result.sessionId, childId); assert.equal(JSON.stringify(f.events), original); assert.equal(f.created().meta.cwd, f.target); assert.equal(f.created().meta.agentPreset, 'standard');
  assert.equal(f.created().meta.parentSession, f.id); assert.equal(f.created().meta.seedLength, 1);
});
test('SDK handoff rejects foreign cwd, changed history, pending and subagent ownership', async (t) => {
  const f = await sdkFixture(t), request = { sessionId: f.id, workspacePath: f.source, targetPath: f.target, childId: `session-${randomUUID()}`, historyHash: 'bad' };
  await assert.rejects(f.sessionControl(f.ctx, 'fork', request), /已变化/);
  await assert.rejects(f.sessionControl(f.ctx, 'inspect', { ...request, workspacePath: f.target }), /不属于/);
  f.agents.get(f.id).status = 'running'; await assert.rejects(f.sessionControl(f.ctx, 'fork', request), /先结束/);
  f.entries.get(f.id).header.origin = 'subagent'; await assert.rejects(f.sessionControl(f.ctx, 'inspect', request), /不属于/);
});
test('an orphan approval is no longer pending after the durable interrupted turn closes', async (t) => {
  const f = await sdkFixture(t); f.events.push({ type: 'approval/asked', seq: 1, data: { id: 'ask' } }, { type: 'turn/end', seq: 2, data: { reason: { kind: 'interrupted' } } });
  const state = await f.sessionControl(f.ctx, 'inspect', { sessionId: f.id, workspacePath: f.source }); assert.equal(state.approvals, 0); assert.equal(state.lastTurnReason, 'interrupted');
});
test('host queue resume preserves every exact message and FIFO order without creating a new identity', async (t) => {
  const f = await sdkFixture(t), agent = f.agents.get(f.id), first = { id: 'first', content: [{ type: 'text', text: 'a' }] }, last = { id: 'last', content: [{ type: 'image', data: 'retained' }] };
  agent.inbox.nextTurn = [first, last];
  agent.inbox.remove = (id) => { agent.inbox.nextTurn = agent.inbox.nextTurn.filter((m) => m.id !== id); };
  agent.followup = (message) => { agent.inbox.nextTurn.push(message); agent.status = 'running'; };
  const request = { sessionId: f.id, workspacePath: f.source, itemId: first.id };
  assert.equal((await f.sessionControl(f.ctx, 'resume-queue', request)).accepted, true);
  assert.deepEqual(agent.inbox.nextTurn, [first, last]); assert.equal(agent.inbox.nextTurn[1], last);
  await assert.rejects(f.sessionControl(f.ctx, 'resume-queue', request), /尚未停止/);
  assert.deepEqual(agent.inbox.nextTurn, [first, last]);
});
