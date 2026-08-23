const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const {
  MAX_INPUT_CHARS,
  TerminalRunner,
  TerminalRunnerError,
  boundedPtySize,
  buildTerminalEnvironment,
  normalizePtyInput,
  resolveTerminalRuntime,
  sanitizePtyOutput
} = require('../electron/terminal-runner.cjs');

const createHost = () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
};

const fakeRuntime = () => ({
  nodePath: process.execPath,
  helperScriptPath: __filename,
  ptyModulePath: __dirname,
  shellPath: 'powershell.exe'
});

const realPtyRuntime = resolveTerminalRuntime({ rootDir: path.resolve(__dirname, '..') });
const realPtySkip = process.platform !== 'win32'
  ? 'requires Windows ConPTY'
  : Object.values(realPtyRuntime).some((target) => !fs.existsSync(target))
    ? 'requires the bundled development Node and node-pty runtime'
    : false;

const waitForState = (runner, statuses, timeoutMs = 15000) => new Promise((resolve, reject) => {
  const accepted = new Set(Array.isArray(statuses) ? statuses : [statuses]);
  const current = runner.getState();
  if (accepted.has(current.status)) return resolve(current);
  const timer = setTimeout(() => {
    runner.off('state', onState);
    reject(new Error(`terminal state timed out: ${[...accepted].join(', ')}`));
  }, timeoutMs);
  const onState = (state) => {
    if (!accepted.has(state.status)) return;
    clearTimeout(timer);
    runner.off('state', onState);
    resolve(state);
  };
  runner.on('state', onState);
});

const stripAnsi = (value) => String(value || '')
  .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
  .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
  .replaceAll('\r', '');

const removeTemporaryWorkspace = async (target) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code) || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
};

test('PTY input and terminal dimensions are bounded without blocking interactive control keys', () => {
  assert.equal(normalizePtyInput('git status\r'), 'git status\r');
  assert.equal(normalizePtyInput('\u0003'), '\u0003');
  assert.throws(() => normalizePtyInput('x'.repeat(MAX_INPUT_CHARS + 1)), TerminalRunnerError);
  assert.throws(() => normalizePtyInput('bad\0input'), TerminalRunnerError);
  assert.deepEqual(boundedPtySize(1, 999), { cols: 20, rows: 120 });
  assert.deepEqual(boundedPtySize(120, 40), { cols: 120, rows: 40 });
});

test('PTY environment keeps the workspace and removes software-managed DeepSeek keys', () => {
  const environment = buildTerminalEnvironment({
    baseEnv: { Path: 'safe', DeepSeek_Api_Key: 'secret', KEEP_ME: 'yes' },
    workspacePath: 'C:\\repo',
    ptyModulePath: 'C:\\pty',
    shellPath: 'powershell.exe',
    cols: 120,
    rows: 40
  });
  assert.equal(environment.Path, 'safe');
  assert.equal(environment.KEEP_ME, 'yes');
  assert.equal(environment.DSH_CWD, 'C:\\repo');
  assert.equal(environment.DSH_PTY_MODULE, 'C:\\pty');
  assert.equal(environment.DSH_PTY_COLS, '120');
  assert.equal(environment.DSH_PTY_ROWS, '40');
  assert.equal(environment.TERM, 'xterm-256color');
  assert.equal(Object.keys(environment).some((name) => name.toUpperCase() === 'DEEPSEEK_API_KEY'), false);
});

test('packaged PTY runtime resolves outside app.asar', () => {
  const runtime = resolveTerminalRuntime({ rootDir: 'C:\\app\\app.asar', resourcesPath: 'C:\\app', isPackaged: true });
  assert.equal(runtime.nodePath, path.join('C:\\app', 'runtime', 'node.exe'));
  assert.equal(runtime.helperScriptPath, path.join('C:\\app', 'terminal', 'terminal-pty-host.cjs'));
  assert.equal(runtime.ptyModulePath, path.join('C:\\app', 'terminal', 'node_modules', 'node-pty'));
});

test('terminal runner starts a PTY host, streams ANSI, writes input, resizes, and retains recovery output', () => {
  const calls = [];
  const host = createHost();
  const stdin = [];
  host.stdin.on('data', (chunk) => stdin.push(chunk.toString('utf8')));
  const workspacePath = path.resolve('terminal-workspace');
  const runner = new TerminalRunner({
    workspacePath,
    ...fakeRuntime(),
    spawnImpl: (file, args, options) => { calls.push({ file, args, options }); return host; },
    baseEnv: { DEEPSEEK_API_KEY: 'secret', Path: 'safe' }
  });

  const state = runner.start({ cols: 90, rows: 28 });
  assert.equal(state.status, 'starting');
  assert.equal(calls[0].file, process.execPath);
  assert.deepEqual(calls[0].args, [__filename]);
  assert.equal(calls[0].options.cwd, workspacePath);
  assert.equal(calls[0].options.shell, false);
  assert.equal(Object.hasOwn(calls[0].options.env, 'DEEPSEEK_API_KEY'), false);

  host.stdout.write(`${JSON.stringify({ type: 'ready', pid: 5678, cols: 90, rows: 28 })}\n`);
  assert.equal(runner.getState().status, 'running');
  assert.equal(runner.getState().pid, 5678);
  assert.equal(runner.write('Get-Location\r'), true);
  runner.resize(110, 36);
  assert.match(stdin.join(''), /"type":"input"/);
  assert.match(stdin.join(''), /"type":"resize"/);

  const visible = '\u001b[31mready\u001b[0m';
  host.stdout.write(`${JSON.stringify({ type: 'data', data: visible })}\n`);
  assert.equal(runner.getSnapshot().output, visible);
  assert.equal(runner.getSnapshot().state.recoverable, true);
  host.stdout.write(`${JSON.stringify({ type: 'exit', exitCode: 0, signal: null })}\n`);
  assert.equal(runner.getState().status, 'completed');
});

test('terminal output removes OSC clipboard writes and keeps ANSI color sequences', () => {
  const value = '\u001b]52;c;hidden\u0007\u001b[31mred\u001b[0m';
  const sanitized = sanitizePtyOutput(value);
  assert.doesNotMatch(sanitized, /hidden/);
  assert.match(sanitized, /\u001b\[31mred/);
});

test('terminal runner stops the complete PTY helper process tree', async () => {
  const host = createHost();
  let killedPid = null;
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => host,
    killTree: async (target) => { killedPid = target.pid; target.emit('exit', null, 'SIGTERM'); }
  });
  runner.start();
  host.stdout.write(`${JSON.stringify({ type: 'ready', pid: 5678, cols: 100, rows: 30 })}\n`);
  const state = await runner.stop();
  assert.equal(killedPid, 4321);
  assert.equal(state.status, 'stopped');
});

test('terminal runner reports a synchronous PTY host launch failure without staying busy', () => {
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => { throw new Error('blocked'); }
  });
  assert.throws(() => runner.start(), (error) => error.code === 'TERMINAL_START_FAILED');
  assert.equal(runner.isActive(), false);
  assert.equal(runner.getState().status, 'failed');
});

test('real Windows PTY persists across commands in the workspace without the managed API key', {
  skip: realPtySkip,
  timeout: 25000
}, async (context) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-real-'));
  context.after(() => removeTemporaryWorkspace(workspacePath));
  const runner = new TerminalRunner({
    workspacePath,
    ...realPtyRuntime,
    baseEnv: { ...process.env, DEEPSEEK_API_KEY: 'must-not-leak' }
  });
  context.after(async () => { if (runner.isActive()) await runner.stop(); });
  runner.start({ cols: 100, rows: 30 });
  await waitForState(runner, 'running');
  runner.write("Write-Output ('cwd=' + (Get-Location).Path); Write-Output ('secret=' + [bool]$env:DEEPSEEK_API_KEY)\r");
  await new Promise((resolve) => setTimeout(resolve, 500));
  runner.write("Write-Output 'second-command'\r");
  await new Promise((resolve) => setTimeout(resolve, 300));
  runner.write('exit\r');
  await waitForState(runner, ['completed', 'failed']);
  const output = stripAnsi(runner.getSnapshot().output);

  assert.equal(runner.getState().status, 'completed');
  assert.match(output, /cwd=/);
  assert.match(output, /secret=False/i);
  assert.match(output, /second-command/);
  assert.doesNotMatch(output, /must-not-leak/);
});

test('real Windows PTY process tree stops before a long interactive command completes', {
  skip: realPtySkip,
  timeout: 20000
}, async (context) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-stop-'));
  context.after(() => removeTemporaryWorkspace(workspacePath));
  const runner = new TerminalRunner({ workspacePath, ...realPtyRuntime });
  context.after(async () => { if (runner.isActive()) await runner.stop(); });
  runner.start();
  await waitForState(runner, 'running');
  runner.write('Start-Sleep -Seconds 30\r');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const state = await runner.stop();
  assert.equal(state.status, 'stopped');
  assert.equal(runner.isActive(), false);
});
