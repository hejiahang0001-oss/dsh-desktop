'use strict';

const { execFile, spawn } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_PROTOCOL_CHARS = 128 * 1024;
const MAX_INPUT_CHARS = 8192;
const READY_PID_TIMEOUT_MS = 5000;
const READY_PID_POLL_MS = 10;
const PROCESS_COMMAND_TIMEOUT_MS = 5000;
const FRAME_FLUSH_TIMEOUT_MS = 100;
const GUARDIAN_READY_TIMEOUT_MS = 5000;
const GUARDIAN_OUTPUT_LIMIT = 32 * 1024;
const INTERNAL_ENVIRONMENT = new Set([
  'DEEPSEEK_API_KEY',
  'DSH_PTY_MODULE',
  'DSH_PTY_SHELL',
  'DSH_PTY_COLS',
  'DSH_PTY_ROWS'
]);

let outputUnavailable = false;

const send = (message, callback) => {
  if (outputUnavailable) {
    queueMicrotask(() => callback?.(new Error('PTY output pipe is unavailable.')));
    return false;
  }
  try {
    return process.stdout.write(`${JSON.stringify(message)}\n`, callback);
  } catch (error) {
    outputUnavailable = true;
    queueMicrotask(() => callback?.(error));
    return false;
  }
};

const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const modulePath = process.env.DSH_PTY_MODULE || path.join(__dirname, 'node_modules', 'node-pty');
const shellPath = process.env.DSH_PTY_SHELL || 'powershell.exe';
const workspacePath = path.resolve(process.env.DSH_CWD || process.cwd());
const cols = boundedInteger(process.env.DSH_PTY_COLS, 100, 20, 300);
const rows = boundedInteger(process.env.DSH_PTY_ROWS, 30, 5, 120);
const childEnvironment = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', DSH_CWD: workspacePath };
for (const name of Object.keys(childEnvironment)) {
  if (INTERNAL_ENVIRONMENT.has(name.toUpperCase())) delete childEnvironment[name];
}
childEnvironment.DSH_CWD = workspacePath;

let terminal;
let protocolBuffer = '';
let exiting = false;
let stopPromise = null;
let shutdownPromise = null;
let guardian = null;

const GUARDIAN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DshTerminalJob {
  [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  public static void ThrowLast(string operation) { throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
}
'@
$job = [DshTerminalJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { [DshTerminalJob]::ThrowLast('CreateJobObject') }
$processHandle = [IntPtr]::Zero
try {
  $info = New-Object DshTerminalJob+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  $basic = New-Object DshTerminalJob+JOBOBJECT_BASIC_LIMIT_INFORMATION
  $basic.LimitFlags = 0x2000
  $info.BasicLimitInformation = $basic
  if (-not [DshTerminalJob]::SetInformationJobObject($job, 9, [ref]$info, [Runtime.InteropServices.Marshal]::SizeOf($info))) { [DshTerminalJob]::ThrowLast('SetInformationJobObject') }
  $processHandle = [DshTerminalJob]::OpenProcess(0x101, $false, [uint32]$env:DSH_TERMINAL_GUARD_PID)
  if ($processHandle -eq [IntPtr]::Zero) { [DshTerminalJob]::ThrowLast('OpenProcess') }
  if (-not [DshTerminalJob]::AssignProcessToJobObject($job, $processHandle)) { [DshTerminalJob]::ThrowLast('AssignProcessToJobObject') }
  [Console]::Out.WriteLine('READY')
  [Console]::Out.Flush()
  [Console]::In.ReadToEnd() | Out-Null
} finally {
  if ($processHandle -ne [IntPtr]::Zero) { [void][DshTerminalJob]::CloseHandle($processHandle) }
  if ($job -ne [IntPtr]::Zero) { [void][DshTerminalJob]::CloseHandle($job) }
}
`;

const startGuardian = (pid) => {
  if (process.platform !== 'win32') return Promise.resolve();
  const encoded = Buffer.from(GUARDIAN_SCRIPT, 'utf16le').toString('base64');
  const child = spawn(shellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    cwd: workspacePath,
    env: { ...childEnvironment, DSH_TERMINAL_GUARD_PID: String(pid) },
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  guardian = child;
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('PTY process guardian did not become ready in time.')), GUARDIAN_READY_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-GUARDIAN_OUTPUT_LIMIT);
      if (stdout.split(/\r?\n/).some((line) => line.trim() === 'READY')) finish();
    });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-GUARDIAN_OUTPUT_LIMIT); });
    child.stdin.on('error', () => {});
    child.once('error', finish);
    child.once('exit', (code, signal) => {
      const error = new Error(`PTY process guardian exited (${code ?? signal ?? 'unknown'}): ${stderr.trim()}`);
      if (!settled) finish(error);
      else if (!exiting) fail('PTY_GUARDIAN_EXITED', error);
    });
  });
};

const processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
};

const waitForTerminalPid = async () => {
  const deadline = Date.now() + READY_PID_TIMEOUT_MS;
  while (!exiting) {
    const pid = Number(terminal?.pid);
    if (Number.isSafeInteger(pid) && pid > 0) return pid;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, READY_PID_POLL_MS));
  }
  throw new Error(`PTY shell PID was not available within ${READY_PID_TIMEOUT_MS} milliseconds.`);
};

const stopTerminal = () => {
  if (stopPromise) return stopPromise;
  const target = terminal;
  if (!target) return Promise.resolve();
  stopPromise = (async () => {
    const pid = Number(target.pid);
    if (process.platform === 'win32' && Number.isSafeInteger(pid) && pid > 0) {
      try {
        await execFileAsync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          timeout: PROCESS_COMMAND_TIMEOUT_MS
        });
      } catch (error) {
        if (processIsAlive(pid)) throw error;
      }
      return;
    }
    try {
      target.kill();
    } catch {
      // The shell may already have exited.
    }
  })();
  return stopPromise;
};

const sendBounded = (message) => new Promise((resolve) => {
  if (outputUnavailable) return resolve(false);
  let settled = false;
  const finish = (written) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(written);
  };
  const timer = setTimeout(() => finish(false), FRAME_FLUSH_TIMEOUT_MS);
  send(message, (error) => finish(!error));
});

const shutdownHost = (code, error, { report = false, exitCode = 0 } = {}) => {
  if (shutdownPromise) return shutdownPromise;
  exiting = true;
  let finalError = error;
  shutdownPromise = stopTerminal()
    .catch((stopError) => {
      finalError = stopError;
      exitCode = 70;
    })
    .then(() => (!report || outputUnavailable
      ? undefined
      : sendBounded({ type: 'error', code, message: finalError?.message || String(finalError) })))
    .finally(() => process.exit(exitCode));
  return shutdownPromise;
};

const completeTerminalExit = (exitCode, signal) => {
  if (shutdownPromise) return shutdownPromise;
  exiting = true;
  shutdownPromise = sendBounded({ type: 'exit', exitCode, signal })
    .finally(() => process.exit(0));
  return shutdownPromise;
};

const fail = (code, error) => {
  void shutdownHost(code, error, { report: true, exitCode: 1 });
};

const handleMessage = (message) => {
  if (!terminal || !message || typeof message !== 'object') return;
  if (message.type === 'input') {
    if (typeof message.data !== 'string' || message.data.length > MAX_INPUT_CHARS || message.data.includes('\0')) return;
    terminal.write(message.data);
    return;
  }
  if (message.type === 'resize') {
    const nextCols = boundedInteger(message.cols, 0, 20, 300);
    const nextRows = boundedInteger(message.rows, 0, 5, 120);
    if (nextCols && nextRows) terminal.resize(nextCols, nextRows);
    return;
  }
  if (message.type === 'stop') {
    void shutdownHost('PTY_STOP_REQUESTED', new Error('PTY stop requested.'), { report: false, exitCode: 0 });
  }
};

const handleProtocolData = (chunk) => {
  protocolBuffer += chunk;
  if (protocolBuffer.length > MAX_PROTOCOL_CHARS) {
    fail('PTY_PROTOCOL_OVERFLOW', new Error('PTY 输入协议超过安全上限。'));
    return;
  }
  let newline = protocolBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = protocolBuffer.slice(0, newline).trim();
    protocolBuffer = protocolBuffer.slice(newline + 1);
    if (line) {
      try {
        handleMessage(JSON.parse(line));
      } catch {
        // Ignore malformed renderer input instead of forwarding it to the shell.
      }
    }
    newline = protocolBuffer.indexOf('\n');
  }
};

process.stdout.on('error', (error) => {
  outputUnavailable = true;
  void shutdownHost('PTY_OUTPUT_FAILED', error, { report: false, exitCode: 70 });
});
process.stderr.on('error', (error) => {
  void shutdownHost('PTY_ERROR_OUTPUT_FAILED', error, { report: false, exitCode: 70 });
});
process.on('uncaughtException', (error) => fail('PTY_HOST_CRASH', error));
process.on('unhandledRejection', (error) => fail('PTY_HOST_REJECTION', error));
process.on('SIGTERM', () => { void shutdownHost('PTY_HOST_SIGTERM', new Error('PTY host received SIGTERM.'), { report: false, exitCode: 0 }); });
process.on('SIGINT', () => { void shutdownHost('PTY_HOST_SIGINT', new Error('PTY host received SIGINT.'), { report: false, exitCode: 0 }); });

const start = async () => {
  await startGuardian(process.pid);
  if (exiting) return;
  const pty = require(modulePath);
  terminal = pty.spawn(shellPath, ['-NoLogo', '-NoProfile'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workspacePath,
    env: childEnvironment
  });
  terminal.onData((data) => send({ type: 'data', data }));
  terminal.onExit(({ exitCode, signal }) => {
    if (!exiting) void completeTerminalExit(exitCode, signal);
  });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleProtocolData);
  process.stdin.on('end', () => { void shutdownHost('PTY_PARENT_CLOSED', new Error('PTY parent input ended.'), { report: false, exitCode: 0 }); });
  process.stdin.on('close', () => { void shutdownHost('PTY_PARENT_CLOSED', new Error('PTY parent input closed.'), { report: false, exitCode: 0 }); });
  process.stdin.on('error', (error) => { void shutdownHost('PTY_PARENT_FAILED', error, { report: false, exitCode: 70 }); });
  const pid = await waitForTerminalPid();
  if (!exiting) send({ type: 'ready', pid, cols, rows });
};

void start().catch((error) => fail('PTY_START_FAILED', error));
