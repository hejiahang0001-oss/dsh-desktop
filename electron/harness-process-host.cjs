const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dshBinPath = process.argv[2];
const dshArgs = process.argv.slice(3);
const hasParentIpc = typeof process.send === 'function';
let child = null;
let shutdownPromise = null;

const writeFailure = (message) => {
  try {
    process.stderr.write(`[dsh-process-host] ${message}\n`);
  } catch {
    // The parent pipe may already be unavailable.
  }
};

const hasExited = (target) => Boolean(target) && (
  (target.exitCode !== null && target.exitCode !== undefined)
  || (target.signalCode !== null && target.signalCode !== undefined)
);

const runTaskkill = (pid, timeoutMs = 5000) => new Promise((resolve, reject) => {
  let command;
  let timer = null;
  let settled = false;
  const finish = (error) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (command) {
      command.off('error', onError);
      command.off('exit', onExit);
    }
    if (error) reject(error);
    else resolve();
  };
  const onError = (error) => finish(error);
  const onExit = (code, signal) => {
    if (code === 0) finish();
    else finish(new Error(`taskkill code=${code ?? 'null'}, signal=${signal || 'none'}`));
  };
  try {
    command = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore'
    });
    command.once('error', onError);
    command.once('exit', onExit);
    timer = setTimeout(() => {
      try {
        command.kill();
      } catch {
        // The helper may already be gone.
      }
      finish(new Error('taskkill timeout'));
    }, timeoutMs);
  } catch (error) {
    onError(error);
  }
});

const waitForExit = (target, timeoutMs) => {
  if (hasExited(target)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer = null;
    const finish = (exited) => {
      if (timer) clearTimeout(timer);
      target.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    target.once('exit', onExit);
    timer = setTimeout(() => finish(hasExited(target)), timeoutMs);
  });
};

const stopOwnedChild = async () => {
  const ownedChild = child;
  if (!ownedChild || hasExited(ownedChild)) return;
  if (process.platform === 'win32') {
    await runTaskkill(ownedChild.pid);
  } else {
    ownedChild.kill('SIGTERM');
    if (!await waitForExit(ownedChild, 5000)) ownedChild.kill('SIGKILL');
  }
  if (!await waitForExit(ownedChild, 5000)) throw new Error('owned Harness process tree did not exit');
};

const requestShutdown = (reason, exitCode = 0) => {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = stopOwnedChild()
    .catch((error) => {
      exitCode = 70;
      writeFailure(`${reason}: ${error?.message || error}`);
    })
    .finally(() => process.exit(exitCode));
  return shutdownPromise;
};

if (typeof dshBinPath !== 'string' || !path.isAbsolute(dshBinPath) || !fs.existsSync(dshBinPath)) {
  writeFailure('fixed Harness entrypoint is missing or invalid');
  process.exit(64);
}

try {
  child = spawn(process.execPath, [dshBinPath, ...dshArgs], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
    shell: false,
    stdio: hasParentIpc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe']
  });
} catch (error) {
  writeFailure(error?.message || error);
  process.exit(70);
}

child.stdout.pipe(process.stdout, { end: false });
child.stderr.pipe(process.stderr, { end: false });
child.stdout.on('error', (error) => { void requestShutdown(`Harness stdout failed: ${error?.message || error}`, 70); });
child.stderr.on('error', (error) => { void requestShutdown(`Harness stderr failed: ${error?.message || error}`, 70); });
process.stdout.on('error', (error) => { void requestShutdown(`desktop stdout closed: ${error?.message || error}`, 70); });
process.stderr.on('error', (error) => { void requestShutdown(`desktop stderr closed: ${error?.message || error}`, 70); });

if (hasParentIpc) {
  process.on('message', (message) => {
    if (!child?.connected) return;
    try {
      child.send(message, () => undefined);
    } catch {
      // The Harness IPC channel may have closed between the check and send.
    }
  });
  child.on('message', (message) => {
    if (!process.connected || typeof process.send !== 'function') return;
    try {
      process.send(message, () => undefined);
    } catch {
      // The desktop IPC channel may already be gone.
    }
  });
}

child.once('error', (error) => {
  if (shutdownPromise) return;
  void requestShutdown(`Harness process failed: ${error?.message || error}`, 70);
});

child.once('exit', (code, signal) => {
  if (shutdownPromise) return;
  child = null;
  process.exit(code === 0 && !signal ? 0 : 1);
});

process.stdin.on('end', () => { void requestShutdown('desktop stdin closed'); });
process.stdin.on('close', () => { void requestShutdown('desktop stdin closed'); });
process.stdin.on('error', (error) => { void requestShutdown(`desktop stdin failed: ${error?.message || error}`); });
process.stdin.resume();

process.once('SIGTERM', () => { void requestShutdown('host received SIGTERM'); });
process.once('SIGINT', () => { void requestShutdown('host received SIGINT'); });
process.once('uncaughtException', (error) => { void requestShutdown(`host crashed: ${error?.message || error}`, 70); });
process.once('unhandledRejection', (error) => { void requestShutdown(`host rejected: ${error?.message || error}`, 70); });
