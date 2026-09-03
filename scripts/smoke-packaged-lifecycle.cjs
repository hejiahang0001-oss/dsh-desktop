const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'dist', 'win-unpacked', 'DSH Desktop.exe');
const output = path.resolve(process.argv[2] || path.join(root, 'artifacts', `v1.1.7-lifecycle-${Date.now()}`, 'lifecycle.json'));
const ready = `${output}.ready.json`;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForFile = async (filePath, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  do {
    if (fs.existsSync(filePath)) return;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${filePath}`);
    await delay(100);
  } while (true);
};

const waitForExit = (child, timeoutMs) => new Promise((resolve, reject) => {
  if (child.exitCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
  const timer = setTimeout(() => reject(new Error(`Process ${child.pid} did not exit in time.`)), timeoutMs);
  child.once('exit', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal });
  });
});

const stopOwnedChild = async (child) => {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  } else {
    try { child.kill('SIGKILL'); } catch { /* The owned test process already exited. */ }
  }
};

const run = async () => {
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);
  await fsp.mkdir(path.dirname(output), { recursive: true });
  await Promise.all([
    fsp.unlink(output).catch((error) => { if (error.code !== 'ENOENT') throw error; }),
    fsp.unlink(ready).catch((error) => { if (error.code !== 'ENOENT') throw error; })
  ]);
  const argument = `--lifecycle-smoke-file=${output}`;
  const primary = spawn(executable, [argument], { stdio: 'ignore' });
  let secondary;
  try {
    await waitForFile(ready, 30_000);
    const readyState = JSON.parse(await fsp.readFile(ready, 'utf8'));
    if (!readyState.ready || readyState.pid !== primary.pid) throw new Error('Primary lifecycle smoke readiness identity is invalid.');
    secondary = spawn(executable, [argument], { stdio: 'ignore' });
    const secondaryExit = await waitForExit(secondary, 15_000);
    await waitForFile(output, 25_000);
    const primaryExit = await waitForExit(primary, 15_000);
    const result = JSON.parse(await fsp.readFile(output, 'utf8'));
    const accepted = result.ok === true
      && result.secondInstanceReceived === true
      && result.windowVisible === true
      && result.windowMinimized === false
      && result.singleInstanceLockAcquired === true
      && secondaryExit.code === 0
      && primaryExit.code === 0;
    process.stdout.write(`${JSON.stringify({ ...result, accepted, primaryPid: primary.pid, secondaryPid: secondary.pid, primaryExit, secondaryExit })}\n`);
    if (!accepted) process.exitCode = 1;
  } finally {
    await Promise.all([stopOwnedChild(secondary), stopOwnedChild(primary)]);
  }
};

void run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
