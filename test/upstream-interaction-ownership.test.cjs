const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { HARNESS_RUNTIME_DIRECTORY, HARNESS_VERSION, readHarnessDesktopRuntime } = require('../electron/harness-desktop-runtime.cjs');

const read = (file) => fs.readFileSync(file, 'utf8');
const projectRoot = path.resolve(__dirname, '..');

test('official product bundle owns submission, FIFO steer and stop contracts', async context => {
  const runtimeRoot = path.join(projectRoot, 'vendor', HARNESS_RUNTIME_DIRECTORY);
  if (!fs.existsSync(runtimeRoot)) {
    context.skip('Run pnpm runtime:deploy for the current product pin; no legacy source checkout is used.');
    return;
  }
  const runtime = readHarnessDesktopRuntime(runtimeRoot);
  const relative = 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js';
  const expected = runtime.descriptor.files.find(entry => entry.path === relative);
  assert.ok(expected);
  const bytes = fs.readFileSync(path.join(runtimeRoot, relative));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256);
  const consumer = JSON.parse(read(path.join(runtime.nodeModulesPath, '@deepseek-ai/dsh-client-ui-conversation/package.json')));
  assert.equal(consumer.version, HARNESS_VERSION);
  const bundle = bytes.toString('utf8');
  // Evaluate exact functions from the descriptor-bound shipped bundle with narrow
  // service seams. This is a behavior contract test, not a rendered UI smoke.
  const block = (header, indentation) => {
    const start = bundle.indexOf(header);
    assert.ok(start >= 0, `Missing official contract ${header}`);
    const end = bundle.indexOf(`\n${indentation}}`, start);
    assert.ok(end > start);
    return bundle.slice(start, end + indentation.length + 2);
  };
  const resolveSubmitMode = vm.runInNewContext(`(${block('function resolveSubmitMode(', '\t\t')})`);
  for (const preferred of ['queue', 'steer']) {
    assert.equal(resolveSubmitMode(preferred, false, 'accelerated', true), 'queue');
    assert.equal(resolveSubmitMode(preferred, true, 'enter', false), 'queue');
    assert.equal(resolveSubmitMode(preferred, true, 'enter', true), preferred);
    assert.equal(resolveSubmitMode(preferred, true, 'accelerated', true), preferred === 'queue' ? 'steer' : 'queue');
  }
  let handlers;
  const dispose = () => {};
  const installDraftKeymap = vm.runInNewContext(`(${block('function installDraftKeymap(', '\t\t')})`, {
    resolveSubmitMode,
    registerComposerKeymap: (_editor, commands) => { handlers = commands; return dispose; }
  });
  const commands = [];
  const keyboard = { steerQueue: () => commands.push('steerQueue'), submit: (...args) => commands.push(args) };
  const gate = { current: { locked: false, machineBusy: false, canSteerQueue: true, uploadsPending: false,
    busyEnter: 'queue', running: true, steeringAvailable: true,
    t: value => value, showToast: value => commands.push(value) } };
  assert.equal(installDraftKeymap({}, keyboard, gate), dispose);
  assert.equal(handlers.canSubmit(), true);
  handlers.submit(true);
  assert.deepEqual(commands.splice(0), ['steerQueue']);
  gate.current.canSteerQueue = false;
  handlers.submit(true); handlers.submit(false);
  assert.deepEqual(commands.splice(0), [['steer', 'enter'], ['queue', 'enter']]);
  gate.current.uploadsPending = true;
  handlers.submit(false);
  assert.deepEqual(commands.splice(0), ['file.stillUploading']);
  gate.current.locked = true;
  assert.equal(handlers.canSubmit(), false);
  gate.current.locked = false; gate.current.machineBusy = true;
  assert.equal(handlers.canSubmit(), false);

  const method = block('async steerQueue(session, shell)', '\t\t\t');
  const steerQueue = vm.runInNewContext(`(async function ${method.slice('async '.length)})`);
  const queueCalls = [], notices = [];
  let releaseFirst;
  const session = {
    projections: { faceOf: name => { assert.equal(name, 'inbox'); return { getSnapshot: () => ({ 'next-turn': [{ id: 'one' }, { id: 'two' }] }) }; } },
    updateQueue: async (id, action) => {
      queueCalls.push([id, structuredClone(action)]);
      if (id === 'one') await new Promise(resolve => { releaseFirst = resolve; });
      return { ok: true };
    }
  };
  const shell = { notify: (...args) => notices.push(args) };
  const owner = { t: value => value };
  const steering = steerQueue.call(owner, session, shell);
  assert.deepEqual(queueCalls, [['one', { kind: 'steer' }]]);
  releaseFirst(); await steering;
  assert.deepEqual(queueCalls, [['one', { kind: 'steer' }], ['two', { kind: 'steer' }]]);
  for (const code of ['session/steer-unavailable', 'session/queue-item-not-found', 'unexpected']) {
    queueCalls.length = 0; notices.length = 0;
    session.updateQueue = async id => { queueCalls.push(id); return { ok: false, error: { code } }; };
    await steerQueue.call(owner, session, shell);
    assert.deepEqual(queueCalls, ['one']);
    assert.deepEqual(notices, code === 'unexpected' ? [['error', 'queue.steerFailed']] : []);
  }
  let stopped = 0;
  const primarySource = block('const onPrimary = () => {', '\t\t\t').slice('const onPrimary = '.length);
  const primary = vm.runInNewContext(`(${primarySource})`, { primaryStops: true, stop: () => { stopped += 1; } });
  primary();
  assert.equal(stopped, 1);
  assert.match(bundle, /onClick: stop/);
});

test('desktop does not intercept or reimplement official queue and steer controls', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const manifest = read('package.json');
  const client = read('electron/session-control-client.cjs');
  const host = read('runtime/dsh-desktop-tools/session-control.mjs');
  const smoke = read('electron/session-workflow-smoke.cjs');
  const smokeContract = read('electron/session-workflow-contract.cjs');

  assert.equal(fs.existsSync('electron/harness-reliable-interrupt.cjs'), false);
  assert.equal(fs.existsSync('assets/harness-reliable-interrupt.js'), false);
  assert.equal(fs.existsSync('assets/session-workflow.js'), false);
  for (const source of [main, preload, manifest]) {
    assert.doesNotMatch(source, /harness-reliable-interrupt|interrupt-and-prompt|interrupt-queued/);
  }
  assert.doesNotMatch(manifest, /assets\/session-workflow\.js/);
  assert.doesNotMatch(client, /resume-queue/);
  assert.doesNotMatch(host, /resume-queue/);

  assert.match(smoke, /Steer queued message/);
  // DOM selection lives in the shared visibility-checked smoke helper; verify
  // the import/click path rather than requiring its implementation inline.
  assert.match(smoke, /\{[^}]*officialActionExpression[^}]*\}\s*=\s*require\('\.\/session-workflow-contract\.cjs'\)/);
  assert.match(smoke, /evaluate\(officialActionExpression\(labels, true\)\)/);
  assert.match(smokeContract, /querySelectorAll\('button'\)/);
  assert.match(smokeContract, /if \(click\) buttons\[0\]\.click\(\)/);
  assert.match(smoke, /pressEnter\(true\)/);
  assert.match(smoke, /Stop generating/);
  for (const source of [smoke, smokeContract]) {
    assert.doesNotMatch(source, /__DSH_WORKFLOW__|dsh-session-workflow|reliable interrupt/i);
  }
});
