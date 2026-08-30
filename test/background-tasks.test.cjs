const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { BackgroundTasks, nextDue, scheduleValid } = require('../electron/background-tasks.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-background-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  let clock = +new Date(2026, 7, 31, 9), online = true, failPrompt = false;
  const records = new Map(), statuses = new Map(), prompts = [], notices = [];
  const repository = { root, head: 'a'.repeat(40), branch: 'main' };
  const manager = {
    inspect: async () => ({ available: true, status: 'ready', repository }),
    create: async () => { const id = randomBytes(12).toString('hex'), item = { id, path: path.join(root, id), managed: true, pathSafe: true, branch: `dsh/worktree-${id}`, head: repository.head }; records.set(id, item); return { createdId: id, branch: item.branch, path: item.path }; },
    resolve: async ({ id }) => { if (!records.has(id)) throw new Error('missing worktree'); return { item: records.get(id) }; }
  };
  const options = { filePath: path.join(root, 'tasks.json'), manager, now: () => clock, ready: () => online, notify: (n) => notices.push(n),
    control: async (op, request) => { if (op === 'task-create') { statuses.set(request.sessionId, { running: true, pending: 0, approvals: 0, liveJobs: 0, outcome: null }); return { sessionId: request.sessionId }; } return statuses.get(request.sessionId) || { running: false, pending: 0, approvals: 0, liveJobs: 0, outcome: null }; },
    prompt: async (request) => {
      const disk = JSON.parse(await fs.readFile(path.join(root, 'tasks.json'), 'utf8'));
      assert.ok(disk.runs.some((r) => r.sessionId === request.sessionId && r.requestId === request.requestId && r.status === 'submitting'));
      prompts.push(request); if (failPrompt) throw new Error('uncertain transport'); return { accepted: true };
    }, cancel: async (request) => { statuses.set(request.sessionId, { running: false, pending: 0, outcome: 'aborted' }); return { accepted: true }; }
  };
  const service = new BackgroundTasks(options); await service.init();
  const create = async (schedule = { kind: 'manual' }, dailyLimit = 3) => (await service.create({ name: '验收任务', prompt: '只检查本任务目录', schedule, dailyLimit }, root, async () => true)).task;
  return { service, create, options, root, records, statuses, prompts, notices, advance: (ms) => { clock += ms; }, offline: () => { online = false; }, fail: () => { failPrompt = true; } };
}
test('schedules are bounded and daily execution uses the next local wall-clock occurrence', () => {
  assert.equal(scheduleValid({ kind: 'interval', minutes: 1 }), false); assert.equal(scheduleValid({ kind: 'daily', time: '25:00' }), false);
  assert.equal(nextDue({ kind: 'manual' }, 0), null);
  const start = +new Date(2026, 7, 31, 10); assert.equal(nextDue({ kind: 'daily', time: '09:30' }, start), +new Date(2026, 8, 1, 9, 30));
});
test('distinct tasks own different worktrees; runs record identity before admission and reject overlap', async (t) => {
  const f = await fixture(t), a = await f.create(), b = await f.create(); assert.notEqual(a.workspacePath, b.workspacePath);
  await f.service.run(a.id); await assert.rejects(f.service.run(a.id), /不能重复/); await f.service.run(b.id);
  assert.equal(f.prompts.length, 2); assert.notEqual(f.prompts[0].sessionId, f.prompts[1].sessionId);
  assert.equal(f.service.snapshot().active, 2); assert.equal(f.service.protects(a.workspacePath), true);
  const c = await f.create(); await assert.rejects(f.service.run(c.id), /两项/); assert.equal(f.prompts.length, 2);
});
test('one-shot schedule runs once; stop pauses it and shutdown never admits another task', async (t) => {
  const f = await fixture(t), task = await f.create({ kind: 'once', at: +new Date(2026, 7, 31, 9, 1) });
  f.advance(60001); await f.service.tick(); assert.equal(f.prompts.length, 1); assert.equal(f.service.task(task.id).enabled, false);
  const run = f.service.state.runs[0]; await f.service.cancelRun(run.id); assert.equal(f.service.state.runs[0].status, 'stopping');
  await f.service.tick(); assert.equal(f.service.state.runs[0].status, 'canceled');
  await f.service.stop(); await assert.rejects(f.service.run(task.id), /尚未就绪/); await f.service.tick(); assert.equal(f.prompts.length, 1);
});
test('late timers coalesce to one run and completion notifications are emitted once', async (t) => {
  const f = await fixture(t), task = await f.create({ kind: 'interval', minutes: 15 }); f.advance(3 * 3600000);
  await Promise.all([f.service.tick(), f.service.tick()]); assert.equal(f.prompts.length, 1);
  const run = f.service.state.runs[0]; f.statuses.set(run.sessionId, { running: false, pending: 0, outcome: 'completed' });
  await f.service.tick(); await f.service.tick(); assert.equal(f.service.state.runs[0].status, 'completed'); assert.equal(f.notices.length, 1);
  assert.equal(f.prompts.length, 1);
});
test('uncertain admission pauses scheduling and restart reconciles without submitting a duplicate', async (t) => {
  const f = await fixture(t), task = await f.create({ kind: 'interval', minutes: 15 }); f.fail(); await assert.rejects(f.service.run(task.id), /uncertain/);
  assert.equal(f.service.state.runs[0].status, 'review'); assert.equal(f.service.task(task.id).enabled, false);
  const restored = new BackgroundTasks(f.options); await restored.init(); await restored.tick(); assert.equal(f.prompts.length, 1);
  await assert.rejects(restored.run(task.id), /不能重复/);
  f.statuses.set(restored.state.runs[0].sessionId, { running: false, pending: 0, outcome: 'completed' }); await restored.tick();
  assert.equal(restored.state.runs[0].status, 'completed'); assert.equal(restored.task(task.id).enabled, false);
});
test('an orphan pending run becomes review-required; approval waiting never grants permission', async (t) => {
  const f = await fixture(t), task = await f.create(); await f.service.run(task.id); const run = f.service.state.runs[0];
  f.statuses.set(run.sessionId, { running: true, pending: 0, approvals: 1 }); await f.service.tick();
  assert.equal(f.service.state.runs[0].status, 'waiting'); assert.equal(f.notices.length, 1);
  f.statuses.set(run.sessionId, { running: false, pending: 0 }); const restored = new BackgroundTasks(f.options); await restored.init(); await restored.tick();
  assert.equal(restored.state.runs[0].status, 'review'); assert.equal(f.prompts.length, 1);
  await restored.acknowledge(run.id); assert.equal(restored.state.runs[0].status, 'reviewed');
});
test('archiving preserves daily usage caps and release retains the directory ownership record', async (t) => {
  const f = await fixture(t), task = await f.create({ kind: 'manual' }, 1); await f.service.run(task.id);
  f.statuses.set(f.service.state.runs[0].sessionId, { running: false, pending: 0, outcome: 'completed' }); await f.service.tick();
  assert.equal(await f.service.archiveCompleted(), 1); await assert.rejects(f.service.run(task.id), /今天的运行上限/);
  const result = await f.service.release(task.id); assert.equal(result.retained, true); assert.equal(f.records.has(task.worktreeId), true);
  assert.equal(f.service.protects(task.workspacePath), false); assert.equal((await fs.readdir(path.join(f.root, 'task-archives'))).length, 2);
});
test('changed directory identity blocks execution and a recovered backup never restarts a schedule', async (t) => {
  const f = await fixture(t), task = await f.create({ kind: 'interval', minutes: 15 });
  f.records.get(task.worktreeId).branch = 'foreign'; await assert.rejects(f.service.run(task.id), /分支已变化/); assert.equal(f.prompts.length, 0);
  await f.service.edit(() => {}); await fs.writeFile(f.options.filePath, 'damaged');
  const restored = new BackgroundTasks(f.options); await restored.init(); assert.equal(restored.task(task.id).enabled, false); assert.match(restored.warning, /暂停/);
  assert.equal((await fs.readdir(path.join(f.root, 'task-archives'))).length, 1);
});
test('late polling does not revive a manually reconciled or archived run', async (t) => {
  const f = await fixture(t), task = await f.create(); await f.service.run(task.id); const run = f.service.state.runs[0];
  await f.service.patchRun(run.id, { status: 'review' }); await f.service.acknowledge(run.id);
  assert.equal(await f.service.patchRun(run.id, { status: 'running' }, 'review'), false);
  assert.equal(f.service.state.runs[0].status, 'reviewed'); await f.service.archiveCompleted();
  assert.equal(await f.service.patchRun(run.id, { status: 'running' }), false);
  assert.equal(f.service.state.runs.length, 0);
});
