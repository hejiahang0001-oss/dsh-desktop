'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.resolve(__dirname, '../scripts/smoke-packaged-safe-exit.cjs');
const source = fs.readFileSync(scriptPath, 'utf8');
const load = createRequire(scriptPath);

test('guardian does not finish on transient empty accounting before the root handle signals', () => {
  // Real Windows evidence: Job accounting reached zero before the exact root
  // handle became signalled. Empty alone must not discard its exit-code proof.
  assert.match(source, /if \(\(\$accounting\.ActiveProcesses -eq 0\) -and \$rootReported\)/);
  assert.doesNotMatch(source, /if \(\$accounting\.ActiveProcesses -eq 0\) \{ Send-Frame/);
});

// No operating-system process is created. Existing Windows integration tests
// separately verify that closing the real guardian removes its complete Job.
const createLauncher = (context, scenario) => {
  const guardian = new EventEmitter();
  Object.assign(guardian, {
    pid: 123,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    killCalls: 0,
    closed: false,
    activeProcesses: 1
  });
  const timers = new Set();
  const schedule = (action, delay) => {
    const timer = setTimeout(() => { timers.delete(timer); action(); }, delay);
    timers.add(timer);
    return timer;
  };
  const close = (code = 0, signal = null) => {
    if (guardian.closed) return;
    guardian.closed = true;
    guardian.activeProcesses = 0;
    guardian.exitCode = code;
    guardian.signalCode = signal;
    guardian.emit('close', code, signal);
  };
  guardian.kill = () => {
    guardian.killCalls += 1;
    schedule(() => close(null, 'SIGTERM'), 20);
    return true;
  };
  const frame = (value) => guardian.stdout.write(`${JSON.stringify(value)}\n`);
  const module = { exports: {} };
  vm.runInNewContext(source, {
    require: (name) => name === 'node:child_process' ? {
      ...load(name),
      spawn: (executable, args, options) => {
        assert.equal(executable, 'powershell.exe');
        assert.equal(options.shell, false);
        assert.equal(options.windowsHide, true);
        queueMicrotask(() => {
          if (scenario === 'error') guardian.emit('error', new Error('mock guardian spawn failed'));
          if (scenario === 'invalid') frame({ type: 'ready', pid: 0, creationFileTime: '123' });
          if (scenario === 'normal') {
            frame({ type: 'ready', pid: 456, creationFileTime: '789' });
            schedule(() => {
              frame({ type: 'root-exit', code: 0, activeProcesses: 0 });
              frame({ type: 'empty', activeProcesses: 0 });
              close();
            }, 20);
          }
        });
        return guardian;
      }
    } : load(name),
    module,
    __dirname: path.dirname(scriptPath),
    Buffer,
    process,
    // Bound the old broken cleanup wait during the red regression run.
    setTimeout: (action, delay) => schedule(action, Math.min(delay, 100)),
    clearTimeout
  }, { filename: scriptPath });
  context.after(() => {
    for (const timer of timers) clearTimeout(timer);
    close();
    for (const stream of [guardian.stdin, guardian.stdout, guardian.stderr]) stream.destroy();
  });
  return {
    guardian,
    launch: () => module.exports.launchWindowsJob({ executablePath: process.execPath, cwd: __dirname, timeoutMs: 20 })
  };
};

for (const [scenario, expected] of [
  ['timeout', /did not launch the app in time/],
  ['invalid', /invalid app identity/],
  ['error', /mock guardian spawn failed/]
]) {
  test(`Job launch ${scenario} rejects only after its owned guardian closes`, { timeout: 1000 }, async (context) => {
    const { guardian, launch } = createLauncher(context, scenario);
    await assert.rejects(launch(), expected);
    assert.equal(guardian.killCalls, 1);
    assert.equal(guardian.closed, true);
    assert.equal(guardian.activeProcesses, 0);
    // Let any unobserved root/empty rejection reach the test runner.
    await new Promise((resolve) => setImmediate(resolve));
  });
}

test('Job launch preserves normal root-exit, empty and guardian-close results', { timeout: 1000 }, async (context) => {
  const { guardian, launch } = createLauncher(context, 'normal');
  const job = await launch();
  assert.equal(job.pid, 456);
  assert.equal(job.creationFileTime, '789');
  assert.equal((await job.waitForRootExit()).code, 0);
  assert.equal((await job.waitForEmpty()).activeProcesses, 0);
  assert.equal((await job.close()).code, 0);
  assert.equal(guardian.closed, true);
  assert.equal(guardian.activeProcesses, 0);
  assert.equal(guardian.killCalls, 0);
});
