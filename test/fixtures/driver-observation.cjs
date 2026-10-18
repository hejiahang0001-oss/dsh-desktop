'use strict';

// Test-only diagnostics: no process creation, termination, or deadline expansion.
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const MAX_STDERR_BYTES = 32 * 1024;

const observeDriver = (child, {
  now = () => performance.now(),
  exists = fs.existsSync,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => {
  const started = now();
  let stage = 'await-driver-state';
  let stderr = Buffer.alloc(0);
  let exited = child.exitCode !== null || child.signalCode !== null
    ? { code: child.exitCode, signal: child.signalCode } : null;
  let closed = null;
  let spawnError = null;
  let disposed = false;
  const pending = new Set();
  const notify = () => { for (const check of [...pending]) check(); };
  const onExit = (code, signal) => { exited = { code, signal }; notify(); };
  const onClose = (code, signal) => { closed = { code, signal }; notify(); };
  const onError = (error) => { spawnError = error.message; notify(); };
  const onStderr = (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderr = Buffer.concat([stderr, bytes.subarray(-MAX_STDERR_BYTES)]).subarray(-MAX_STDERR_BYTES);
  };
  child.on('exit', onExit);
  child.on('close', onClose);
  child.on('error', onError);
  child.stderr?.on('data', onStderr);

  const snapshot = () => {
    let text = stderr.toString('utf8');
    // A partial UTF-8 sequence at a retained boundary may expand to U+FFFD.
    while (Buffer.byteLength(text) > MAX_STDERR_BYTES) text = text.slice(1);
    return { stage, elapsedMs: now() - started, driverPid: child.pid, exit: exited, close: closed, spawnError, stderr: text };
  };
  const withContext = (cause) => {
    if (cause.driverObservation) return cause;
    const observation = snapshot();
    const error = new Error(`${cause.message}\nDriver observation: ${JSON.stringify(observation)}`, { cause });
    error.driverObservation = observation;
    return error;
  };
  const waitForFile = (target, timeoutMs = 5000) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('Driver-state timeout must be finite and non-negative.');
    const deadline = now() + timeoutMs;
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (error) => {
        clearTimer(timer);
        pending.delete(check);
        if (error) reject(withContext(error));
        else resolve();
      };
      const check = () => {
        clearTimer(timer);
        if (disposed) return finish(new Error('Driver observation disposed before state file was ready.'));
        if (spawnError) return finish(new Error('Driver failed before state file was ready.'));
        if (exited || closed) return finish(new Error('Driver ended before state file was ready.'));
        try {
          if (exists(target)) return finish();
          if (now() >= deadline) return finish(new Error(`Timed out waiting for ${target}`));
          timer = setTimer(check, Math.min(50, deadline - now()));
        } catch (error) { finish(error); }
      };
      pending.add(check);
      check();
    });
  };
  const dispose = () => {
    disposed = true;
    notify();
    child.off('exit', onExit);
    child.off('close', onClose);
    child.off('error', onError);
    child.stderr?.off('data', onStderr);
  };
  return { snapshot, withContext, waitForFile, dispose, setStage: (value) => { stage = value; } };
};

module.exports = { observeDriver };
