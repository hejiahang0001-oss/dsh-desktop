const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  LifecycleGate,
  LifecycleStateStore,
  buildVersionIdentity,
  restoreAndFocusWindow,
  settleLifecycleSteps,
  versionIdentityLines
} = require('../electron/app-lifecycle.cjs');

const identity = () => buildVersionIdentity({
  product: '1.1.7',
  harness: '0.1.2-rc.1',
  electron: '43.4.1',
  node: '24.14.0'
});

const fixture = async (context) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-lifecycle-'));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  return path.join(root, 'lifecycle-state.json');
};

test('lifecycle state detects an unfinished run without storing paths or content', async (context) => {
  const filePath = await fixture(context);
  let tick = 0;
  const times = ['2026-09-04T00:00:00.000Z', '2026-09-04T00:01:00.000Z'];
  const first = new LifecycleStateStore({
    filePath,
    now: () => new Date(times[tick++]),
    createRunId: () => '11111111-1111-4111-8111-111111111111'
  });
  assert.equal((await first.begin(identity())).needed, false);

  const second = new LifecycleStateStore({
    filePath,
    now: () => new Date(times[tick++]),
    createRunId: () => '22222222-2222-4222-8222-222222222222'
  });
  const recovery = await second.begin(identity());
  assert.equal(recovery.needed, true);
  assert.equal(recovery.reason, 'unclean-exit');
  const text = await fsp.readFile(filePath, 'utf8');
  assert.doesNotMatch(text, /workspace|prompt|credential|key|path/iu);
});

test('a clean explicit exit is not reported as an abnormal exit', async (context) => {
  const filePath = await fixture(context);
  let time = 0;
  const now = () => new Date(1_780_000_000_000 + time++ * 1000);
  const first = new LifecycleStateStore({ filePath, now, createRunId: () => '33333333-3333-4333-8333-333333333333' });
  await first.begin(identity());
  await first.transition('running');
  await first.transition('quitting');
  const clean = await first.markClean('explicit-exit');
  assert.equal(clean.status, 'clean');

  const second = new LifecycleStateStore({ filePath, now, createRunId: () => '44444444-4444-4444-8444-444444444444' });
  assert.equal((await second.begin(identity())).needed, false);
  assert.equal(JSON.parse(await fsp.readFile(`${filePath}.bak`, 'utf8')).status, 'clean');
});

test('corrupt primary state is reported as uncertain recovery rather than a confirmed crash', async (context) => {
  const filePath = await fixture(context);
  const first = new LifecycleStateStore({ filePath, createRunId: () => '55555555-5555-4555-8555-555555555555' });
  await first.begin(identity());
  await first.transition('running');
  await fsp.writeFile(filePath, '{broken', 'utf8');
  const second = new LifecycleStateStore({ filePath, createRunId: () => '66666666-6666-4666-8666-666666666666' });
  const recovery = await second.begin(identity());
  assert.equal(recovery.needed, true);
  assert.equal(recovery.reason, 'state-recovered');
});

test('a missing primary with a valid backup is reported as uncertain recovery', async (context) => {
  const filePath = await fixture(context);
  const first = new LifecycleStateStore({ filePath, createRunId: () => '77777777-7777-4777-8777-777777777777' });
  await first.begin(identity());
  await first.transition('running');
  await fsp.unlink(filePath);

  const second = new LifecycleStateStore({ filePath, createRunId: () => '88888888-8888-4888-8888-888888888888' });
  const recovery = await second.begin(identity());
  assert.equal(recovery.needed, true);
  assert.equal(recovery.reason, 'state-recovered');
  assert.equal(recovery.source, 'backup');
});

test('lifecycle shutdown attempts every owned step and reports timeout or active residue', async () => {
  const visited = [];
  const outcome = await settleLifecycleSteps([
    { name: 'Harness', run: async () => { visited.push('harness'); } },
    { name: '终端', run: async () => { visited.push('terminal'); throw new Error('stop failed'); } },
    { name: '预览', run: async () => { visited.push('preview'); }, verify: () => false }
  ], { timeoutMs: 100 });
  assert.deepEqual(visited.sort(), ['harness', 'preview', 'terminal']);
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.failures.map((entry) => entry.name).sort(), ['终端', '预览']);
});

test('lifecycle shutdown fails closed when an operation does not settle', async () => {
  const outcome = await settleLifecycleSteps([
    { name: '悬挂操作', run: () => new Promise(() => {}) }
  ], { timeoutMs: 20 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failures[0].code, 'LIFECYCLE_STEP_TIMEOUT');
});

test('lifecycle gate blocks a deferred mutation after shutdown begins and can reopen', async () => {
  const gate = new LifecycleGate();
  let release;
  const confirmation = new Promise((resolve) => { release = resolve; });
  let mutations = 0;
  const pendingMutation = (async () => {
    await confirmation;
    gate.assertOpen();
    mutations += 1;
  })();

  assert.equal(gate.beginClosing(), true);
  assert.equal(gate.beginClosing(), false);
  release();
  await assert.rejects(pendingMutation, { code: 'APP_QUITTING' });
  assert.equal(mutations, 0);

  gate.reopen();
  assert.doesNotThrow(() => gate.assertOpen());
});

test('version identity and repeated-launch focus stay product-specific', () => {
  assert.equal(versionIdentityLines(identity()), [
    '产品版本：DSH Desktop V1.1.7',
    'Harness 内核：DeepSeek Harness 0.1.2-rc.1',
    '桌面运行时：Electron 43.4.1',
    'Electron 内置 Node：24.14.0'
  ].join('\n'));
  const calls = [];
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus')
  };
  assert.equal(restoreAndFocusWindow(window), true);
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
  assert.equal(restoreAndFocusWindow(null), false);
});
