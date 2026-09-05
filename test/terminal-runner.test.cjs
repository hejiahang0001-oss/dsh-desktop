const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { promisify } = require('node:util');
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

const execFileAsync = promisify(execFile);

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

const waitForFile = async (target, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(target)) {
    if (Date.now() >= deadline) throw new Error(`file did not appear: ${target}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
};

const waitForProcessExit = async (pid, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (processIsAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`process ${pid} did not exit`);
    await new Promise((resolve) => setTimeout(resolve, 50));
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
  let killedShellPid = null;
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => host,
    killTree: async (target, shellPid) => { killedPid = target.pid; killedShellPid = shellPid; target.emit('exit', null, 'SIGTERM'); }
  });
  runner.start();
  host.stdout.write(`${JSON.stringify({ type: 'ready', pid: 5678, cols: 100, rows: 30 })}\n`);
  const state = await runner.stop();
  assert.equal(killedPid, 4321);
  assert.equal(killedShellPid, 5678);
  assert.equal(state.status, 'stopped');
});

test('concurrent terminal stops share one process-tree shutdown', async () => {
  const host = createHost();
  let releaseKill;
  let kills = 0;
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => host,
    killTree: async () => {
      kills += 1;
      await new Promise((resolve) => { releaseKill = resolve; });
    }
  });
  runner.start();
  host.stdout.write(`${JSON.stringify({ type: 'ready', pid: 5678, cols: 100, rows: 30 })}\n`);

  const first = runner.stop();
  const second = runner.stop();
  assert.equal(first, second);
  assert.equal(kills, 1);
  releaseKill();
  assert.equal((await first).status, 'stopped');
  assert.equal(runner.isActive(), false);
});

test('a replacement terminal cannot start until the previous tree cleanup settles', async () => {
  const firstHost = createHost();
  const secondHost = createHost();
  secondHost.pid = 4322;
  let releaseKill;
  const hosts = [firstHost, secondHost];
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => hosts.shift(),
    killTree: async () => new Promise((resolve) => { releaseKill = resolve; })
  });
  runner.start();
  firstHost.stdout.write(`${JSON.stringify({ type: 'ready', pid: 5678, cols: 100, rows: 30 })}\n`);
  const stopping = runner.stop();
  firstHost.emit('exit', null, 'SIGTERM');
  assert.equal(runner.isActive(), false);
  assert.throws(() => runner.start(), (error) => error.code === 'TERMINAL_BUSY');

  releaseKill();
  await stopping;
  assert.equal(runner.start().status, 'starting');
});

test('protocol overflow kills the owned process tree before becoming inactive', async () => {
  const host = createHost();
  let kills = 0;
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => host,
    killTree: async () => { kills += 1; }
  });
  runner.start();
  host.stdout.write('x'.repeat(1024 * 1024 + 1));
  const state = await runner.stop();

  assert.equal(kills, 1);
  assert.equal(state.status, 'failed');
  assert.equal(runner.isActive(), false);
  assert.match(runner.getSnapshot().output, /协议超过安全上限/);
});

test('an unexpected PTY host exit still cleans the recorded shell process tree', async () => {
  const host = createHost();
  let killedHostPid = null;
  let killedShellPid = null;
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => host,
    killTree: async (target, shellPid) => {
      killedHostPid = target.pid;
      killedShellPid = shellPid;
    }
  });
  runner.start();
  host.stdout.write(`${JSON.stringify({ type: 'ready', pid: 5678, cols: 100, rows: 30 })}\n`);

  host.emit('exit', 70, null);
  const state = await runner.stop();

  assert.equal(killedHostPid, 4321);
  assert.equal(killedShellPid, 5678);
  assert.equal(state.status, 'failed');
  assert.equal(runner.isActive(), false);
  assert.match(runner.getSnapshot().output, /宿主意外退出/);
});

test('stale PTY host events cannot finish or write into a replacement run', () => {
  const firstHost = createHost();
  const secondHost = createHost();
  secondHost.pid = 4322;
  const hosts = [firstHost, secondHost];
  const runner = new TerminalRunner({
    workspacePath: path.resolve('terminal-workspace'),
    ...fakeRuntime(),
    spawnImpl: () => hosts.shift()
  });

  runner.start();
  firstHost.stdout.write(`${JSON.stringify({ type: 'exit', exitCode: 0, signal: null })}\n`);
  assert.equal(runner.getState().status, 'completed');

  runner.start();
  secondHost.stdout.write(`${JSON.stringify({ type: 'ready', pid: 6789, cols: 100, rows: 30 })}\n`);
  assert.equal(runner.getState().runId, 2);
  assert.equal(runner.getState().status, 'running');

  firstHost.stdout.write(`${JSON.stringify({ type: 'data', data: 'stale-output' })}\n`);
  firstHost.emit('exit', 1, null);

  assert.equal(runner.getState().runId, 2);
  assert.equal(runner.getState().status, 'running');
  assert.equal(runner.getState().pid, 6789);
  assert.equal(runner.isActive(), true);
  assert.doesNotMatch(runner.getSnapshot().output, /stale-output/);
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
  const hostPid = runner.child.pid;
  const running = await waitForState(runner, 'running');
  assert.ok(Number.isSafeInteger(running.pid) && running.pid > 0, 'real PTY ready must include the owned shell PID');
  runner.write("Write-Output ('cwd=' + (Get-Location).Path); Write-Output ('secret=' + [bool]$env:DEEPSEEK_API_KEY)\r");
  await new Promise((resolve) => setTimeout(resolve, 500));
  runner.write("Write-Output 'second-command'\r");
  await new Promise((resolve) => setTimeout(resolve, 300));
  runner.write('exit\r');
  await waitForState(runner, ['completed', 'failed']);
  await waitForProcessExit(hostPid);
  const output = stripAnsi(runner.getSnapshot().output);

  assert.equal(runner.getState().status, 'completed');
  assert.equal(runner.isActive(), false);
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

test('real Windows PTY shutdown removes a shell descendant instead of only the helper host', {
  skip: realPtySkip,
  timeout: 25000
}, async (context) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-tree-stop-'));
  const pidFile = path.join(workspacePath, 'descendant.pid');
  let descendantPid = 0;
  const runner = new TerminalRunner({ workspacePath, ...realPtyRuntime });
  context.after(async () => {
    if (runner.isActive()) await runner.stop().catch(() => undefined);
    if (processIsAlive(descendantPid)) {
      try { process.kill(descendantPid); } catch { /* The owned test process may already be gone. */ }
    }
    await removeTemporaryWorkspace(workspacePath);
  });

  runner.start();
  await waitForState(runner, 'running');
  const escapedPidFile = pidFile.replaceAll("'", "''");
  runner.write(`$child = Start-Process -FilePath \"$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 60') -PassThru; Set-Content -LiteralPath '${escapedPidFile}' -Value $child.Id\r`);
  await waitForFile(pidFile);
  descendantPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.equal(processIsAlive(descendantPid), true);

  const state = await runner.stop();
  await waitForProcessExit(descendantPid);
  assert.equal(state.status, 'stopped');
  assert.equal(runner.isActive(), false);
});

test('real Windows PTY guardian removes detached descendants when only the helper host is killed', {
  skip: realPtySkip,
  timeout: 25000
}, async (context) => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-guardian-'));
  const pidFile = path.join(workspacePath, 'descendant.pid');
  let descendantPid = 0;
  let shellPid = 0;
  let hostPid = 0;
  const runner = new TerminalRunner({ workspacePath, ...realPtyRuntime });
  context.after(async () => {
    for (const pid of [hostPid, shellPid, descendantPid]) {
      if (!processIsAlive(pid)) continue;
      await execFileAsync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined);
    }
    await removeTemporaryWorkspace(workspacePath);
  });

  runner.start();
  const running = await waitForState(runner, 'running');
  shellPid = running.pid;
  hostPid = runner.child.pid;
  const escapedPidFile = pidFile.replaceAll("'", "''");
  runner.write(`$child = Start-Process -FilePath \"$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 60') -PassThru; Set-Content -LiteralPath '${escapedPidFile}' -Value $child.Id\r`);
  await waitForFile(pidFile);
  descendantPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.equal(processIsAlive(descendantPid), true);

  await execFileAsync('taskkill.exe', ['/pid', String(hostPid), '/F'], { windowsHide: true });
  await waitForState(runner, 'failed');
  await runner.stop();
  await Promise.all([waitForProcessExit(shellPid), waitForProcessExit(descendantPid)]);
  assert.equal(runner.isActive(), false);
});
