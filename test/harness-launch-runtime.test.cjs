const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHook } = require('node:async_hooks');
const { verifyHarnessNode, verifyHarnessLaunchRuntime } = require('../electron/harness-launch-runtime.cjs');
const { HARNESS_RUNTIME_DIRECTORY } = require('../electron/harness-desktop-runtime.cjs');
const root = path.resolve(__dirname, '..');
const runtime = { nodePath: path.join(root, 'vendor/runtime/win32-x64/node.exe'),
  dshBinPath: path.join(root, 'vendor', HARNESS_RUNTIME_DIRECTORY, 'node_modules/@deepseek-ai/dsh/lib/bin.js') };
const options = { rootDir: root, resourcesPath: root, isPackaged: false };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lulu-launch-check-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('Node trust check rejects relative paths, wrong bytes and hardlinks', async t => {
  const directory = fixture(t), file = path.join(directory, 'node.exe');
  fs.writeFileSync(file, 'not the fixed Node');
  await assert.rejects(verifyHarnessNode('node.exe'), { code: 'NODE_RUNTIME_INVALID' });
  await assert.rejects(verifyHarnessNode(file), { code: 'NODE_RUNTIME_INVALID' });
  fs.linkSync(file, path.join(directory, 'linked.exe'));
  await assert.rejects(verifyHarnessNode(file), { code: 'NODE_RUNTIME_INVALID' });
});
test('Node trust check rejects a linked parent', async t => {
  const directory = fixture(t), real = path.join(directory, 'real'), link = path.join(directory, 'link');
  fs.mkdirSync(real); fs.writeFileSync(path.join(real, 'node.exe'), 'not the fixed Node');
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyHarnessNode(path.join(link, 'node.exe')), { code: 'NODE_RUNTIME_INVALID' });
});
test('pre-cancelled runtime verification creates no Worker', async () => {
  let created = 0;
  const hook = createHook({ init(_id, type) { if (type === 'WORKER') created++; } }).enable();
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(verifyHarnessLaunchRuntime(options, runtime, controller.signal), { code: 'HARNESS_START_ABORTED' });
    assert.equal(created, 0);
  } finally { hook.disable(); }
});
test('cancelled verification waits for actual Worker exit before rejecting', async t => {
  const threads = require('node:worker_threads'), OriginalWorker = threads.Worker;
  const modulePath = require.resolve('../electron/harness-launch-runtime.cjs');
  const previousModule = require.cache[modulePath];
  let worker, exitObserved = false;
  t.mock.method(threads, 'Worker', function (...args) {
    worker = new OriginalWorker(...args);
    worker.once('exit', () => { exitObserved = true; });
    return worker;
  });
  delete require.cache[modulePath];
  const verify = require(modulePath).verifyHarnessLaunchRuntime;
  try {
    const controller = new AbortController();
    const checked = verify(options, runtime, controller.signal);
    assert.ok(worker);
    controller.abort();
    await assert.rejects(checked, { code: 'HARNESS_START_ABORTED' });
    assert.equal(exitObserved, true);
    assert.equal(worker.threadId, -1);
  } finally { require.cache[modulePath] = previousModule; }
});
test('Worker reports invalid fixed runtime without leaking a supplied path', async t => {
  const directory = fixture(t);
  await assert.rejects(verifyHarnessLaunchRuntime(options, { ...runtime, dshBinPath: path.join(directory, 'private-user-value/bin.js') }), error => {
    assert.equal(error.code, 'HARNESS_DESKTOP_RUNTIME_INVALID');
    assert.equal(error.message.includes('private-user-value'), false); return true;
  });
});
