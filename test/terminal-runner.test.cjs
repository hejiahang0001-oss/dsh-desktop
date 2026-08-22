const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const {
  MAX_COMMAND_CHARS,
  TerminalRunner,
  TerminalRunnerError,
  buildTerminalEnvironment,
  normalizeTerminalCommand,
  sanitizeTerminalOutput
} = require('../electron/terminal-runner.cjs');

const createChild = () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
};

test('terminal commands are single-line and bounded', () => {
  assert.equal(normalizeTerminalCommand('  git status  '), 'git status');
  assert.throws(() => normalizeTerminalCommand(''), TerminalRunnerError);
  assert.throws(() => normalizeTerminalCommand('first\nsecond'), TerminalRunnerError);
  assert.throws(() => normalizeTerminalCommand('x'.repeat(MAX_COMMAND_CHARS + 1)), TerminalRunnerError);
});

test('terminal environment keeps the workspace and removes software-managed DeepSeek keys', () => {
  const environment = buildTerminalEnvironment({
    baseEnv: { Path: 'safe', DeepSeek_Api_Key: 'secret', KEEP_ME: 'yes' },
    workspacePath: 'C:\\repo'
  });
  assert.equal(environment.Path, 'safe');
  assert.equal(environment.KEEP_ME, 'yes');
  assert.equal(environment.DSH_CWD, 'C:\\repo');
  assert.equal(environment.NO_COLOR, '1');
  assert.equal(Object.keys(environment).some((name) => name.toUpperCase() === 'DEEPSEEK_API_KEY'), false);
});

test('terminal runner launches PowerShell without a command shell in the active workspace', () => {
  const calls = [];
  const child = createChild();
  const workspacePath = path.resolve('terminal-workspace');
  const runner = new TerminalRunner({
    workspacePath,
    shellPath: 'powershell.exe',
    spawnImpl: (file, args, options) => { calls.push({ file, args, options }); return child; },
    baseEnv: { DEEPSEEK_API_KEY: 'secret', Path: 'safe' }
  });

  const state = runner.start('Write-Output ready');
  assert.equal(state.status, 'running');
  assert.equal(calls[0].file, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(calls[0].options.cwd, workspacePath);
  assert.equal(calls[0].options.shell, false);
  assert.equal(Object.hasOwn(calls[0].options.env, 'DEEPSEEK_API_KEY'), false);
  child.emit('exit', 0, null);
  assert.equal(runner.getState().status, 'completed');
  assert.equal(runner.getState().exitCode, 0);
});

test('terminal output is sanitized, bounded, and can be stopped as a process tree', async () => {
  const child = createChild();
  let killedPid = null;
  const outputs = [];
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    shellPath: 'powershell.exe',
    spawnImpl: () => child,
    killTree: async (target) => { killedPid = target.pid; target.emit('exit', null, 'SIGTERM'); },
    maxOutputChars: 12,
    timeoutMs: 60000
  });
  runner.on('output', (event) => outputs.push(event));
  runner.start('Write-Output ready');
  child.stdout.write('\u001b[31mabcdefghijklmnop\u001b[0m');
  await runner.stop();

  assert.equal(killedPid, 4321);
  assert.equal(runner.getState().status, 'stopped');
  assert.equal(runner.getState().truncated, true);
  assert.match(outputs.map((event) => event.text).join(''), /abcdefghijkl/);
  assert.doesNotMatch(sanitizeTerminalOutput('\u001b[31mred\u001b[0m'), /\u001b/);
});

test('terminal runner reports a synchronous launch failure without staying busy', () => {
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    shellPath: 'powershell.exe',
    spawnImpl: () => { throw new Error('blocked'); }
  });
  assert.throws(() => runner.start('Get-Location'), (error) => error.code === 'TERMINAL_START_FAILED');
  assert.equal(runner.isActive(), false);
  assert.equal(runner.getState().status, 'failed');
});

test('real Windows PowerShell runs in the workspace without the managed API key', {
  skip: process.platform !== 'win32'
}, async (context) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-real-'));
  context.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
  const output = [];
  const runner = new TerminalRunner({
    workspacePath,
    baseEnv: { ...process.env, DEEPSEEK_API_KEY: 'must-not-leak' }
  });
  runner.on('output', (event) => output.push(event.text));
  const finished = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('real terminal test timed out')), 15000);
    runner.on('state', (state) => {
      if (['completed', 'failed', 'stopped'].includes(state.status)) {
        clearTimeout(timeout);
        resolve(state);
      }
    });
  });
  runner.start("Write-Output ('cwd=' + (Get-Location).Path); Write-Output ('secret=' + [bool]$env:DEEPSEEK_API_KEY)");
  const state = await finished;
  const combined = output.join('');

  assert.equal(state.status, 'completed');
  assert.match(combined, /cwd=/);
  assert.match(combined, /secret=False/i);
  assert.doesNotMatch(combined, /must-not-leak/);
});

test('real Windows PowerShell process tree stops before a long command completes', {
  skip: process.platform !== 'win32'
}, async (context) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-terminal-stop-'));
  context.after(() => fs.rmSync(workspacePath, { recursive: true, force: true }));
  const output = [];
  const runner = new TerminalRunner({ workspacePath });
  runner.on('output', (event) => output.push(event.text));
  runner.start("Start-Sleep -Seconds 30; Write-Output 'should-not-complete'");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const state = await runner.stop();

  assert.equal(state.status, 'stopped');
  assert.doesNotMatch(output.join(''), /should-not-complete/);
});
