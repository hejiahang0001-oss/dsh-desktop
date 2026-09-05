'use strict';

const { execFile, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { inspectPackagedBuild } = require('./package-build-evidence.cjs');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const packageVersion = require(path.join(root, 'package.json')).version;
const artifactsRoot = path.join(root, 'artifacts');
const executable = path.join(root, 'dist', 'win-unpacked', 'DSH Desktop.exe');
const SAFE_EXIT_CONTINUATION_TIMEOUT_MS = 180_000;
let output = '';
let ready = '';
let continuation = '';
let userData = '';
let authorization = '';
let readyState = null;
let processTree = [];
let processSnapshots = { beforeReady: [], afterReady: [], continuous: [] };
let allOwnedIdentities = [];
let managedProcessTree = [];
let portOwnersBeforeExit = [];
let capturedPortIdentities = [];
let portsOpenBeforeExit = [];
let exit = null;
let buildEvidence = null;
let buildEvidenceAfter = null;
let jobEvidence = null;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const existingPathComponents = (target) => {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  const components = [];
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    components.push(current);
  }
  return components;
};

const assertNoReparsePath = async (target) => {
  const components = existingPathComponents(target);
  for (const component of components) {
    if (fs.lstatSync(component).isSymbolicLink()) throw new Error(`Safe-exit smoke rejects linked path: ${component}`);
  }
  if (process.platform !== 'win32' || components.length === 0) return;
  const encoded = Buffer.from(JSON.stringify(components), 'utf8').toString('base64');
  const command = [
    `$paths = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json`,
    "foreach ($itemPath in $paths) { $item = Get-Item -LiteralPath $itemPath -Force; if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw ('reparse:' + $itemPath) } }"
  ].join('; ');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
};

const createExclusiveRunDirectory = async (base = artifactsRoot) => {
  await assertNoReparsePath(path.dirname(base));
  try {
    await fsp.mkdir(base, { recursive: false });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const baseStat = await fsp.lstat(base);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) throw new Error('Safe-exit artifacts root is not a plain directory.');
  await assertNoReparsePath(base);
  const runDirectory = await fsp.mkdtemp(path.join(base, `v${packageVersion}-safe-exit-`));
  await assertNoReparsePath(runDirectory);
  return runDirectory;
};

const assertSafeOutput = (runDirectory) => {
  const relative = path.relative(artifactsRoot, output);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Safe-exit smoke output must stay inside the repository artifacts directory.');
  }
  if (path.dirname(output) !== runDirectory) throw new Error('Safe-exit smoke output must stay in its exclusive run directory.');
};

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

const JOB_LAUNCHER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class DshJobLauncher {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct STARTUPINFO {
    public int cb; public string lpReserved, lpDesktop, lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId;
  }
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
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, uint length, IntPtr returnedLength);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  public static void ThrowLast(string operation) { throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
}
'@
function Send-Frame($frame) { [Console]::Out.WriteLine(($frame | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
function Decode-Value($name) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Environment]::GetEnvironmentVariable($name))) }
$exe = Decode-Value 'DSH_JOB_EXE_B64'; $command = Decode-Value 'DSH_JOB_COMMAND_B64'; $cwd = Decode-Value 'DSH_JOB_CWD_B64'
[uint32]$driverPid = [uint32]([Environment]::GetEnvironmentVariable('DSH_JOB_DRIVER_PID'))
[Environment]::SetEnvironmentVariable('DSH_JOB_EXE_B64', $null, 'Process')
[Environment]::SetEnvironmentVariable('DSH_JOB_COMMAND_B64', $null, 'Process')
[Environment]::SetEnvironmentVariable('DSH_JOB_CWD_B64', $null, 'Process')
[Environment]::SetEnvironmentVariable('DSH_JOB_DRIVER_PID', $null, 'Process')
$job = [IntPtr]::Zero; $processHandle = [IntPtr]::Zero; $threadHandle = [IntPtr]::Zero; $driverHandle = [IntPtr]::Zero; $exitStatus = 0; $processResumed = $false
try {
  $driverHandle = [DshJobLauncher]::OpenProcess(0x00100000, $false, $driverPid)
  if ($driverHandle -eq [IntPtr]::Zero) { [DshJobLauncher]::ThrowLast('OpenProcess(driver)') }
  $job = [DshJobLauncher]::CreateJobObject([IntPtr]::Zero, $null)
  if ($job -eq [IntPtr]::Zero) { [DshJobLauncher]::ThrowLast('CreateJobObject') }
  $limits = New-Object DshJobLauncher+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
  $basic = New-Object DshJobLauncher+JOBOBJECT_BASIC_LIMIT_INFORMATION
  $basic.LimitFlags = 0x2000; $limits.BasicLimitInformation = $basic
  if (-not [DshJobLauncher]::SetInformationJobObject($job, 9, [ref]$limits, [Runtime.InteropServices.Marshal]::SizeOf($limits))) { [DshJobLauncher]::ThrowLast('SetInformationJobObject') }
  $startup = New-Object DshJobLauncher+STARTUPINFO; $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
  $processInfo = New-Object DshJobLauncher+PROCESS_INFORMATION
  $commandBuffer = New-Object Text.StringBuilder($command)
  if (-not [DshJobLauncher]::CreateProcess($exe, $commandBuffer, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0x4, [IntPtr]::Zero, $cwd, [ref]$startup, [ref]$processInfo)) { [DshJobLauncher]::ThrowLast('CreateProcess') }
  $processHandle = $processInfo.hProcess; $threadHandle = $processInfo.hThread
  if (-not [DshJobLauncher]::AssignProcessToJobObject($job, $processHandle)) { [DshJobLauncher]::ThrowLast('AssignProcessToJobObject') }
  [long]$created = 0; [long]$exited = 0; [long]$kernel = 0; [long]$user = 0
  if (-not [DshJobLauncher]::GetProcessTimes($processHandle, [ref]$created, [ref]$exited, [ref]$kernel, [ref]$user)) { [DshJobLauncher]::ThrowLast('GetProcessTimes') }
  if ([DshJobLauncher]::ResumeThread($threadHandle) -eq 0xffffffff) { [DshJobLauncher]::ThrowLast('ResumeThread') }
  $processResumed = $true
  [void][DshJobLauncher]::CloseHandle($threadHandle); $threadHandle = [IntPtr]::Zero
  Send-Frame ([ordered]@{ type='ready'; pid=[int]$processInfo.dwProcessId; creationFileTime=$created.ToString() })
  $rootReported = $false; $lastActiveProcesses = [uint32]::MaxValue
  while ($true) {
    if ([DshJobLauncher]::WaitForSingleObject($driverHandle, 0) -eq 0) { Send-Frame ([ordered]@{ type='driver-exit' }); break }
    $accounting = New-Object DshJobLauncher+JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    if (-not [DshJobLauncher]::QueryInformationJobObject($job, 1, [ref]$accounting, [Runtime.InteropServices.Marshal]::SizeOf($accounting), [IntPtr]::Zero)) { [DshJobLauncher]::ThrowLast('QueryInformationJobObject') }
    if ($accounting.ActiveProcesses -ne $lastActiveProcesses) {
      Send-Frame ([ordered]@{ type='job-state'; activeProcesses=[uint32]$accounting.ActiveProcesses; totalProcesses=[uint32]$accounting.TotalProcesses })
      $lastActiveProcesses = [uint32]$accounting.ActiveProcesses
    }
    if ((-not $rootReported) -and ([DshJobLauncher]::WaitForSingleObject($processHandle, 0) -eq 0)) {
      [uint32]$rootCode = 0; if (-not [DshJobLauncher]::GetExitCodeProcess($processHandle, [ref]$rootCode)) { [DshJobLauncher]::ThrowLast('GetExitCodeProcess') }
      Send-Frame ([ordered]@{ type='root-exit'; code=[uint32]$rootCode; activeProcesses=[uint32]$accounting.ActiveProcesses }); $rootReported = $true
    }
    if ($accounting.ActiveProcesses -eq 0) { Send-Frame ([ordered]@{ type='empty'; activeProcesses=0; totalProcesses=[uint32]$accounting.TotalProcesses }); break }
    Start-Sleep -Milliseconds 100
  }
} catch {
  $failure = $_.Exception
  if ((-not $processResumed) -and ($processHandle -ne [IntPtr]::Zero)) {
    try {
      if ((-not [DshJobLauncher]::TerminateProcess($processHandle, 70)) -and ([DshJobLauncher]::WaitForSingleObject($processHandle, 0) -ne 0)) { [DshJobLauncher]::ThrowLast('TerminateProcess') }
      if ([DshJobLauncher]::WaitForSingleObject($processHandle, 5000) -ne 0) { throw 'Suspended child cleanup timed out.' }
    } catch { $failure = [AggregateException]::new('Job launch failed and the suspended child could not be verified stopped.', @($failure, $_.Exception)) }
  }
  $exitStatus = 1
  try { Send-Frame ([ordered]@{ type='error'; message=$failure.Message }) } catch {}
}
finally {
  if ($threadHandle -ne [IntPtr]::Zero) { [void][DshJobLauncher]::CloseHandle($threadHandle) }
  if ($processHandle -ne [IntPtr]::Zero) { [void][DshJobLauncher]::CloseHandle($processHandle) }
  if ($job -ne [IntPtr]::Zero) { [void][DshJobLauncher]::CloseHandle($job) }
  if ($driverHandle -ne [IntPtr]::Zero) { [void][DshJobLauncher]::CloseHandle($driverHandle) }
}
exit $exitStatus
`;

const quoteWindowsArgument = (value) => {
  const text = String(value);
  if (text && !/[\s"]/u.test(text)) return text;
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
};

const waitBounded = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

const launchWindowsJob = async ({ executablePath, args = [], cwd, timeoutMs = 15_000 }) => {
  const commandLine = [executablePath, ...args].map(quoteWindowsArgument).join(' ');
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.toUpperCase() === 'DEEPSEEK_API_KEY') delete environment[name];
  }
  environment.DSH_JOB_EXE_B64 = Buffer.from(executablePath, 'utf8').toString('base64');
  environment.DSH_JOB_COMMAND_B64 = Buffer.from(commandLine, 'utf8').toString('base64');
  environment.DSH_JOB_CWD_B64 = Buffer.from(cwd, 'utf8').toString('base64');
  environment.DSH_JOB_DRIVER_PID = String(process.pid);
  const encoded = Buffer.from(JOB_LAUNCHER_SCRIPT, 'utf16le').toString('base64');
  const guardian = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    cwd,
    env: environment,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  let stderr = '';
  const frames = [];
  const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
    return { promise, resolve, reject, settled: false };
  };
  const readyFrame = deferred();
  const rootExitFrame = deferred();
  const emptyFrame = deferred();
  const guardianExit = deferred();
  let closing = false;
  const settle = (target, method, value) => {
    if (target.settled) return;
    target.settled = true;
    target[method](value);
  };
  const failPending = (error) => {
    for (const target of [readyFrame, rootExitFrame, emptyFrame]) settle(target, 'reject', error);
  };
  guardian.stdout.setEncoding('utf8');
  guardian.stderr.setEncoding('utf8');
  guardian.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-32 * 1024); });
  guardian.stdin.on('error', () => {});
  const consumeGuardianLine = (line) => {
    if (!line) return;
    try {
      const frame = JSON.parse(line);
      frames.push(frame);
      if (frame.type === 'ready') settle(readyFrame, 'resolve', frame);
      else if (frame.type === 'root-exit') settle(rootExitFrame, 'resolve', frame);
      else if (frame.type === 'empty') settle(emptyFrame, 'resolve', frame);
      else if (frame.type === 'error') failPending(new Error(`Packaged Job guardian failed: ${frame.message}`));
    } catch (error) {
      failPending(new Error(`Invalid packaged Job guardian frame: ${error.message}`));
    }
  };
  const consumeGuardianBuffer = (final = false) => {
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      consumeGuardianLine(line);
      newline = buffer.indexOf('\n');
    }
    if (final) {
      const line = buffer.trim();
      buffer = '';
      consumeGuardianLine(line);
    }
  };
  guardian.stdout.on('data', (chunk) => {
    buffer += chunk;
    consumeGuardianBuffer();
  });
  guardian.once('error', failPending);
  guardian.once('close', (code, signal) => {
    consumeGuardianBuffer(true);
    const result = { code, signal, stderr };
    settle(guardianExit, 'resolve', result);
    if (!closing && (code !== 0 || !readyFrame.settled || !rootExitFrame.settled || !emptyFrame.settled)) {
      failPending(new Error(`Packaged Job guardian exited ${code ?? signal}: ${stderr}`));
    }
  });
  let readyState;
  try {
    readyState = await waitBounded(readyFrame.promise, timeoutMs, 'Packaged Job guardian did not launch the app in time.');
  } catch (error) {
    try { guardian.stdin.end(); } catch { /* The guardian may already have exited. */ }
    await waitBounded(guardianExit.promise, 10_000, 'Failed packaged Job guardian did not close.').catch(() => undefined);
    throw error;
  }
  if (!Number.isSafeInteger(readyState.pid) || readyState.pid <= 0 || !/^\d+$/.test(readyState.creationFileTime)) {
    throw new Error('Packaged Job guardian returned an invalid app identity.');
  }
  return {
    guardian,
    frames,
    pid: readyState.pid,
    creationFileTime: readyState.creationFileTime,
    waitForRootExit: (limit = 45_000) => waitBounded(rootExitFrame.promise, limit, 'Packaged app did not exit in time.'),
    waitForEmpty: (limit = 15_000) => waitBounded(emptyFrame.promise, limit, 'Packaged Job did not become empty in time.'),
    close: async () => {
      closing = true;
      if (guardian.exitCode !== null || guardian.signalCode !== null) return guardianExit.promise;
      if (emptyFrame.settled) {
        const gracefulExit = await waitBounded(guardianExit.promise, 2_000, 'Packaged Job guardian is still closing.').catch(() => null);
        if (gracefulExit) return gracefulExit;
      }
      try { guardian.kill(); } catch { /* Terminating the guardian closes the Job Object handle. */ }
      return waitBounded(guardianExit.promise, 10_000, 'Packaged Job guardian did not close in time.');
    }
  };
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

const waitForProcessIdentitiesGone = async (identities, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  do {
    const current = await readProcessTable();
    const alive = identities.filter((expected) => current.some((entry) => sameProcessIdentity(entry, expected)));
    if (alive.length === 0) return [];
    if (Date.now() >= deadline) return alive;
    await delay(250);
  } while (true);
};

const canConnect = (port, timeoutMs = 1000) => new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  let settled = false;
  const finish = (connected) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(connected);
  };
  socket.setTimeout(timeoutMs, () => finish(false));
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
});

const readProcessTable = async () => {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$starts = @{}; Get-Process | ForEach-Object { try { $starts[[int]$_.Id] = $_.StartTime.ToUniversalTime() } catch {} }",
    "Get-CimInstance Win32_Process | ForEach-Object { $cim = $_; try { $created = $starts[[int]$cim.ProcessId]; if ($null -eq $created) { return }; $cimFileTime = $cim.CreationDate.ToUniversalTime().ToFileTimeUtc(); $exactFileTime = $created.ToFileTimeUtc(); if ([Math]::Abs($exactFileTime - $cimFileTime) -ge 10) { return }; [pscustomobject]@{ ProcessId = $cim.ProcessId; ParentProcessId = $cim.ParentProcessId; Name = $cim.Name; CreationDate = $created.ToString('o'); CreationFileTime = $exactFileTime.ToString() } } catch {} } | ConvertTo-Json -Compress"
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command
  ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const parsed = JSON.parse(stdout.trim() || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
    pid: Number(entry.ProcessId),
    parentPid: Number(entry.ParentProcessId),
    name: String(entry.Name || ''),
    creationDate: String(entry.CreationDate || ''),
    creationFileTime: String(entry.CreationFileTime || '')
  })).filter((entry) => Number.isSafeInteger(entry.pid) && entry.pid > 0 && /^\d+$/.test(entry.creationFileTime));
};

const descendantsOf = (table, rootPid) => {
  const pending = [rootPid];
  const found = new Map();
  while (pending.length > 0) {
    const parentPid = pending.shift();
    for (const entry of table) {
      if (entry.parentPid !== parentPid || found.has(entry.pid)) continue;
      found.set(entry.pid, entry);
      pending.push(entry.pid);
    }
  }
  return [...found.values()];
};

const sameProcessIdentity = (left, right) => Boolean(left && right
  && left.pid === right.pid
  && /^\d+$/.test(left.creationFileTime)
  && left.creationFileTime === right.creationFileTime);

const mergeProcessIdentities = (...groups) => groups.flat().filter((entry, index, entries) => (
  entries.findIndex((candidate) => sameProcessIdentity(candidate, entry)) === index
));

const startProcessSnapshotMonitor = (rootIdentity) => {
  let pending = Promise.resolve();
  let sampling = false;
  const errors = [];
  const runSample = () => {
    if (sampling) return pending;
    sampling = true;
    pending = (async () => {
      try {
        const table = await readProcessTable();
        if (!table.some((entry) => sameProcessIdentity(entry, rootIdentity))) return;
        const descendants = descendantsOf(table, rootIdentity.pid);
        processSnapshots.continuous = mergeProcessIdentities(processSnapshots.continuous, descendants);
        processTree = mergeProcessIdentities(processTree, descendants);
        allOwnedIdentities = mergeProcessIdentities(allOwnedIdentities, [rootIdentity], processTree);
      } catch (error) {
        errors.push(error);
      } finally {
        sampling = false;
      }
    })();
    return pending;
  };
  const timer = setInterval(() => { void runSample(); }, 1000);
  timer.unref?.();
  return {
    sample: async () => {
      await pending;
      await runSample();
      if (errors.length > 0) throw new AggregateError(errors, 'Continuous process snapshot failed.');
    },
    stop: async () => {
      clearInterval(timer);
      await pending;
      if (errors.length > 0) throw new AggregateError(errors, 'Continuous process snapshot failed.');
    }
  };
};

const readListeningPortOwners = async () => {
  const command = [
    "$ErrorActionPreference='Stop'",
    "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress"
  ].join('; ');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', command
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const parsed = JSON.parse(stdout.trim() || '[]');
  return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
    address: String(entry.LocalAddress || ''),
    port: Number(entry.LocalPort),
    pid: Number(entry.OwningProcess)
  })).filter((entry) => Number.isSafeInteger(entry.port) && Number.isSafeInteger(entry.pid));
};

const findProcessIdentity = async (pid, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  do {
    const identity = (await readProcessTable()).find((entry) => entry.pid === pid);
    if (identity) return identity;
    if (Date.now() >= deadline) return null;
    await delay(50);
  } while (true);
};

const terminateProcessHandle = async (identity) => {
  if (!identity || !Number.isSafeInteger(identity.pid) || !/^\d+$/.test(identity.creationFileTime)) {
    throw new Error('Exact process identity is incomplete; cleanup refused to kill by PID alone.');
  }
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class DshExactProcess {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  public static int LastError() { return Marshal.GetLastWin32Error(); }
  public static void ThrowLast(string operation) { throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
}
'@
$handle = [DshExactProcess]::OpenProcess(0x00101001, $false, [uint32]${identity.pid})
if ($handle -eq [IntPtr]::Zero) {
  if ([DshExactProcess]::LastError() -eq 87) { [Console]::Out.WriteLine('ABSENT'); exit 0 }
  [DshExactProcess]::ThrowLast('OpenProcess')
}
try {
  [long]$created = 0; [long]$exited = 0; [long]$kernel = 0; [long]$user = 0
  if (-not [DshExactProcess]::GetProcessTimes($handle, [ref]$created, [ref]$exited, [ref]$kernel, [ref]$user)) { [DshExactProcess]::ThrowLast('GetProcessTimes') }
  if ($created.ToString() -ne '${identity.creationFileTime}') { [Console]::Out.WriteLine('MISMATCH') }
  elseif ([DshExactProcess]::WaitForSingleObject($handle, 0) -eq 0) { [Console]::Out.WriteLine('EXITED') }
  else {
    if (-not [DshExactProcess]::TerminateProcess($handle, 70)) {
      if ([DshExactProcess]::WaitForSingleObject($handle, 0) -ne 0) { [DshExactProcess]::ThrowLast('TerminateProcess') }
    }
    if ([DshExactProcess]::WaitForSingleObject($handle, 5000) -ne 0) { throw 'WaitForSingleObject timed out.' }
    [Console]::Out.WriteLine('TERMINATED')
  }
} finally { [void][DshExactProcess]::CloseHandle($handle) }
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });
  const disposition = stdout.trim().split(/\r?\n/).at(-1);
  if (disposition === 'MISMATCH') {
    throw new Error(`PID ${identity.pid} was reused; cleanup refused to terminate the new process.`);
  }
  if (!['ABSENT', 'EXITED', 'TERMINATED'].includes(disposition)) {
    throw new Error(`Exact process cleanup returned an unknown disposition for PID ${identity.pid}.`);
  }
  return disposition;
};

const stopExactProcessIdentity = async (identity) => {
  if (!identity) return [];
  const current = await readProcessTable();
  if (!current.some((entry) => sameProcessIdentity(entry, identity))) return [];
  await terminateProcessHandle(identity);
  const alive = await waitForProcessIdentitiesGone([identity], 5000);
  if (alive.length > 0) throw new Error(`Exact safe-exit process identity remained alive after cleanup: ${identity.pid}/${identity.creationFileTime}`);
  return alive;
};

const processIdentityIsAlive = async (identity) => {
  if (!identity) return false;
  return (await readProcessTable()).some((entry) => sameProcessIdentity(entry, identity));
};

const stopOwnedIdentities = async (identities) => {
  const errors = [];
  for (const identity of mergeProcessIdentities(identities).reverse()) {
    try { await stopExactProcessIdentity(identity); } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'One or more exact safe-exit process identities remained alive.');
};

const readJson = async (filePath) => JSON.parse(await fsp.readFile(filePath, 'utf8'));
const validTimestamp = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const sameIdentity = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const writeJsonAtomically = async (filePath, value) => {
  const pending = `${filePath}.${process.pid}-${Date.now()}.tmp`;
  try {
    await fsp.writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fsp.rename(pending, filePath);
  } finally {
    await fsp.unlink(pending).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
};

const run = async () => {
  if (process.platform !== 'win32') throw new Error('Packaged safe-exit smoke is Windows-only.');
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);
  if (process.argv[2]) throw new Error('Safe-exit smoke always creates a new exclusive artifacts run directory; custom output paths are not accepted.');
  const runDirectory = await createExclusiveRunDirectory();
  output = path.join(runDirectory, 'safe-exit.json');
  ready = `${output}.ready.json`;
  continuation = `${output}.continue`;
  userData = `${output}.user-data`;
  authorization = path.join(runDirectory, 'safe-exit.authorization.json');
  assertSafeOutput(runDirectory);
  await assertNoReparsePath(output);
  buildEvidence = await inspectPackagedBuild({
    workspaceRoot: root,
    executablePath: executable,
    asarPath: path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar')
  });
  if (!buildEvidence.accepted) {
    throw new Error('Packaged safe-exit smoke refused a stale or source-mismatched build.');
  }
  const token = randomBytes(32).toString('hex');
  await writeJsonAtomically(authorization, {
    schemaVersion: 1,
    token,
    driverPid: process.pid,
    output,
    continuationTimeoutMs: SAFE_EXIT_CONTINUATION_TIMEOUT_MS,
    expiry: new Date(Date.now() + 120_000).toISOString()
  });

  const appArguments = [
    `--safe-exit-smoke-file=${output}`,
    `--safe-exit-smoke-auth=${authorization}`,
    `--safe-exit-smoke-token=${token}`
  ];
  let jobLaunch = null;
  let appPid = 0;
  let childIdentity = null;
  let snapshotMonitor = null;
  try {
    jobLaunch = await launchWindowsJob({ executablePath: executable, args: appArguments, cwd: path.dirname(executable) });
    appPid = jobLaunch.pid;
    jobEvidence = {
      guardianPid: jobLaunch.guardian.pid,
      rootPid: appPid,
      creationFileTime: jobLaunch.creationFileTime,
      frames: jobLaunch.frames
    };
    childIdentity = await findProcessIdentity(appPid);
    if (!childIdentity) throw new Error('Could not capture the packaged application process identity.');
    if (childIdentity.creationFileTime !== jobLaunch.creationFileTime) throw new Error('Packaged Job root identity does not match the process table.');
    snapshotMonitor = startProcessSnapshotMonitor(childIdentity);
    await snapshotMonitor.sample();
    const tableBeforeReady = await readProcessTable();
    processSnapshots.beforeReady = descendantsOf(tableBeforeReady, appPid);
    processTree = mergeProcessIdentities(processSnapshots.beforeReady);
    allOwnedIdentities = mergeProcessIdentities([childIdentity], processTree);
    await waitForFile(ready, 90_000);
    readyState = await readJson(ready);
    if (!readyState.ready) throw new Error(readyState.error || 'Packaged application did not prepare safe-exit resources.');
    if (readyState.appPid !== appPid) throw new Error('Safe-exit application PID does not match the launched process.');
    if (readyState.version !== buildEvidence.package.version
      || readyState.identity?.product !== buildEvidence.package.version) {
      throw new Error('Packaged application runtime identity does not match this source version.');
    }
    if (readyState.packaged !== true || readyState.singleInstanceLockAcquired !== true) {
      throw new Error('Safe-exit application did not use the packaged single-instance lifecycle.');
    }
    if (readyState.continuationTimeoutMs !== SAFE_EXIT_CONTINUATION_TIMEOUT_MS) {
      throw new Error('Safe-exit application did not preserve the bounded continuation timeout.');
    }
    if (readyState.quitBypassActive !== false
      || readyState.lifecycleStatus !== 'running'
      || readyState.resources?.harness !== 'running'
      || readyState.resources?.terminal !== 'running'
      || readyState.resources?.preview !== 'ready') {
      throw new Error('Safe-exit resources were not recorded from the normal running lifecycle.');
    }
    const ports = [readyState.harnessPort, readyState.previewPort];
    if (!ports.every((port) => Number.isSafeInteger(port) && port > 0 && port <= 65535)
      || new Set(ports).size !== ports.length) {
      throw new Error('Managed loopback port identities are invalid or overlap.');
    }

    const knownPids = [readyState.harnessHostPid, readyState.terminalHostPid, readyState.terminalShellPid];
    if (!knownPids.every(processIsAlive)) throw new Error('A managed process was not alive before the exit request.');
    const tableBeforeReadyCheck = await readProcessTable();
    const processTreeBeforeReadyCheck = descendantsOf(tableBeforeReadyCheck, appPid);
    processSnapshots.afterReady = processTreeBeforeReadyCheck;
    processTree = mergeProcessIdentities(processTree, processTreeBeforeReadyCheck);
    allOwnedIdentities = mergeProcessIdentities([childIdentity], processTree);
    const processTreeIds = new Set(processTreeBeforeReadyCheck.map((entry) => entry.pid));
    if (!knownPids.every((pid) => processTreeIds.has(pid))) {
      throw new Error('A managed process is not owned by the packaged application process tree.');
    }
    const appIdentity = tableBeforeReadyCheck.find((entry) => entry.pid === appPid);
    const harnessHostIdentity = tableBeforeReadyCheck.find((entry) => entry.pid === readyState.harnessHostPid);
    const terminalHostIdentity = tableBeforeReadyCheck.find((entry) => entry.pid === readyState.terminalHostPid);
    const harnessDescendantsBefore = descendantsOf(tableBeforeReadyCheck, readyState.harnessHostPid);
    const terminalDescendantsBefore = descendantsOf(tableBeforeReadyCheck, readyState.terminalHostPid);
    if (!appIdentity || !sameProcessIdentity(appIdentity, childIdentity)
      || !harnessHostIdentity || !terminalHostIdentity || harnessDescendantsBefore.length < 1) {
      throw new Error('The live Harness process host did not own a real Harness child process.');
    }
    if (!terminalDescendantsBefore.some((entry) => entry.pid === readyState.terminalShellPid)) {
      throw new Error('The live terminal host did not own the reported PowerShell process.');
    }

    for (const port of ports) {
      if (await canConnect(port)) portsOpenBeforeExit.push(port);
    }
    if (portsOpenBeforeExit.length !== ports.length) throw new Error('A managed loopback port was not reachable before exit.');
    portOwnersBeforeExit = (await readListeningPortOwners()).filter((entry) => ports.includes(entry.port));
    const isLoopbackOwner = (entry) => entry.address === '127.0.0.1' || entry.address === '::1';
    const harnessOwnerPids = new Set([harnessHostIdentity, ...harnessDescendantsBefore].map((entry) => entry.pid));
    const harnessPortOwned = portOwnersBeforeExit.some((entry) => (
      entry.port === readyState.harnessPort && harnessOwnerPids.has(entry.pid) && isLoopbackOwner(entry)
    ));
    const previewPortOwned = portOwnersBeforeExit.some((entry) => (
      entry.port === readyState.previewPort && entry.pid === appPid && isLoopbackOwner(entry)
    ));
    if (!harnessPortOwned || !previewPortOwned) throw new Error('Managed loopback port ownership does not match Harness and Preview processes.');
    capturedPortIdentities = portOwnersBeforeExit.map((owner) => {
      const identity = tableBeforeReadyCheck.find((entry) => entry.pid === owner.pid);
      if (!identity) throw new Error(`Could not capture listener process identity for port ${owner.port}.`);
      return { ...owner, creationDate: identity.creationDate, creationFileTime: identity.creationFileTime };
    });

    const tableAfterReadyCheck = await readProcessTable();
    const appIdentityAfter = tableAfterReadyCheck.find((entry) => sameProcessIdentity(entry, childIdentity));
    if (!appIdentityAfter) throw new Error('Packaged application identity changed during readiness validation.');
    const processTreeAfterReadyCheck = descendantsOf(tableAfterReadyCheck, appPid);
    processTree = mergeProcessIdentities(processTree, processTreeBeforeReadyCheck, processTreeAfterReadyCheck);
    allOwnedIdentities = mergeProcessIdentities([appIdentity], processTree);
    const harnessDescendants = mergeProcessIdentities(
      harnessDescendantsBefore,
      descendantsOf(tableAfterReadyCheck, readyState.harnessHostPid)
    );
    const terminalDescendants = mergeProcessIdentities(
      terminalDescendantsBefore,
      descendantsOf(tableAfterReadyCheck, readyState.terminalHostPid)
    );
    managedProcessTree = mergeProcessIdentities(
      [harnessHostIdentity], harnessDescendants, [terminalHostIdentity], terminalDescendants
    );
    await snapshotMonitor.sample();

    await writeJsonAtomically(continuation, { schemaVersion: 1, nonce: readyState.nonce });
    const rootExit = await jobLaunch.waitForRootExit(45_000);
    exit = { code: Number(rootExit.code), signal: null };
    jobEvidence.rootExit = rootExit;
    await snapshotMonitor.stop();
    snapshotMonitor = null;

    const [aliveAfterExit, emptyJob] = await Promise.all([
      waitForProcessIdentitiesGone(allOwnedIdentities, 15_000),
      jobLaunch.waitForEmpty(15_000)
    ]);
    jobEvidence.empty = emptyJob;
    const guardianExit = await jobLaunch.close();
    jobEvidence.guardianExit = guardianExit;
    const harnessIdentitySet = new Set([harnessHostIdentity, ...harnessDescendants]
      .map((entry) => `${entry.pid}/${entry.creationFileTime}`));
    const harnessAliveAfterExit = aliveAfterExit.filter((entry) => harnessIdentitySet.has(`${entry.pid}/${entry.creationFileTime}`));
    const terminalIdentitySet = new Set([terminalHostIdentity, ...terminalDescendants]
      .map((entry) => `${entry.pid}/${entry.creationFileTime}`));
    const terminalAliveAfterExit = aliveAfterExit.filter((entry) => terminalIdentitySet.has(`${entry.pid}/${entry.creationFileTime}`));
    const [listenersAfterExit, tableAfterExit] = await Promise.all([
      readListeningPortOwners(),
      readProcessTable()
    ]);
    const relevantListenersAfterExit = listenersAfterExit.filter((entry) => ports.includes(entry.port));
    const ownedPortResidueAfterExit = relevantListenersAfterExit.filter((listener) => {
      const currentIdentity = tableAfterExit.find((entry) => entry.pid === listener.pid);
      return capturedPortIdentities.some((captured) => (
        captured.port === listener.port && sameProcessIdentity(captured, currentIdentity)
      ));
    });
    const reusedPortsAfterExit = relevantListenersAfterExit.filter((listener) => (
      !ownedPortResidueAfterExit.some((owned) => owned.port === listener.port && owned.pid === listener.pid)
    ));
    const openPortsAfterExit = relevantListenersAfterExit.map((entry) => entry.port);
    const lifecyclePath = path.join(userData, 'lifecycle-state.json');
    const lifecycleBackupPath = `${lifecyclePath}.bak`;
    const [lifecycle, lifecycleBackup] = await Promise.all([
      readJson(lifecyclePath),
      readJson(lifecycleBackupPath)
    ]);
    const temporaryLifecycleFiles = (await fsp.readdir(userData))
      .filter((name) => name.startsWith('lifecycle-state.json.') && name.endsWith('.tmp'));
    buildEvidenceAfter = await inspectPackagedBuild({
      workspaceRoot: root,
      executablePath: executable,
      asarPath: path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar')
    });

    const accepted = exit.code === 0
      && guardianExit.code === 0
      && guardianExit.signal === null
      && aliveAfterExit.length === 0
      && emptyJob.activeProcesses === 0
      && ownedPortResidueAfterExit.length === 0
      && buildEvidenceAfter.accepted === true
      && buildEvidenceAfter.fingerprint === buildEvidence.fingerprint
      && lifecycle.status === 'clean'
      && lifecycle.cleanReason === 'explicit-exit'
      && lifecycle.runId === readyState.lifecycleRunId
      && validTimestamp(lifecycle.finishedAt)
      && sameIdentity(lifecycle.identity, readyState.identity)
      && lifecycleBackup.status === 'clean'
      && lifecycleBackup.runId === lifecycle.runId
      && lifecycleBackup.cleanReason === 'explicit-exit'
      && validTimestamp(lifecycleBackup.finishedAt)
      && sameIdentity(lifecycleBackup.identity, readyState.identity)
      && temporaryLifecycleFiles.length === 0;
    const report = {
      schemaVersion: 1,
      accepted,
      buildEvidence,
      buildEvidenceAfter,
      jobEvidence,
      ready: readyState,
      processTree,
      processSnapshots,
      allOwnedIdentities,
      managedProcessTree,
      portsOpenBeforeExit,
      portOwnersBeforeExit,
      capturedPortIdentities,
      exit,
      aliveAfterExit,
      harnessAliveAfterExit,
      terminalAliveAfterExit,
      openPortsAfterExit,
      ownedPortResidueAfterExit,
      reusedPortsAfterExit,
      lifecycle,
      lifecycleBackupClean: lifecycleBackup.status === 'clean' && lifecycleBackup.runId === lifecycle.runId,
      temporaryLifecycleFiles
    };
    await writeJsonAtomically(output, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!accepted) process.exitCode = 1;
  } finally {
    const cleanupErrors = [];
    const attemptCleanup = async (label, operation) => {
      try { await operation(); } catch (error) { cleanupErrors.push(new Error(`${label}: ${error?.message || error}`)); }
    };
    await attemptCleanup('stop continuous process snapshot', async () => {
      if (snapshotMonitor) await snapshotMonitor.stop();
      snapshotMonitor = null;
    });
    if (readyState?.nonce) {
      await attemptCleanup('remove stale continuation', async () => {
        await fsp.unlink(continuation).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
      });
      await attemptCleanup('request normal smoke continuation', async () => {
        if (await processIdentityIsAlive(childIdentity)) {
          await writeJsonAtomically(continuation, { schemaVersion: 1, nonce: readyState.nonce });
        }
      });
    }
    await attemptCleanup('capture cleanup process identity', async () => {
      if (!childIdentity && appPid > 0) childIdentity = await findProcessIdentity(appPid, 1000);
    });
    await attemptCleanup('capture final cleanup descendants', async () => {
      if (!childIdentity) return;
      const current = await readProcessTable();
      if (current.some((entry) => sameProcessIdentity(entry, childIdentity))) {
        processTree = mergeProcessIdentities(processTree, descendantsOf(current, childIdentity.pid));
        allOwnedIdentities = mergeProcessIdentities(allOwnedIdentities, [childIdentity], processTree);
      }
    });
    await attemptCleanup('close packaged Job Object', async () => {
      if (!jobLaunch) return;
      const guardianExit = await jobLaunch.close();
      jobEvidence = { ...(jobEvidence || {}), guardianExit };
    });
    await attemptCleanup('stop all exact packaged process identities', () => stopOwnedIdentities(
      mergeProcessIdentities(allOwnedIdentities, childIdentity ? [childIdentity] : [], processTree, managedProcessTree)
    ));
    await attemptCleanup('remove continuation after process cleanup', async () => {
      await fsp.unlink(continuation).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
    });
    await attemptCleanup('remove unused authorization files', async () => {
      for (const target of [authorization, path.join(path.dirname(output), 'safe-exit.authorization.consumed.json')]) {
        await fsp.unlink(target).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
      }
    });
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Safe-exit cleanup did not complete cleanly.');
  }
};

if (require.main === module) void run().catch(async (error) => {
  if (output) await fsp.writeFile(output, `${JSON.stringify({
    schemaVersion: 1,
    accepted: false,
    buildEvidence,
    buildEvidenceAfter,
    jobEvidence,
    ready: readyState,
    processTree,
    processSnapshots,
    managedProcessTree,
    portsOpenBeforeExit,
    portOwnersBeforeExit,
    capturedPortIdentities,
    exit,
    error: error?.stack || error?.message || String(error)
  }, null, 2)}\n`, 'utf8').catch(() => {});
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = {
  assertNoReparsePath,
  createExclusiveRunDirectory,
  descendantsOf,
  existingPathComponents,
  findProcessIdentity,
  launchWindowsJob,
  mergeProcessIdentities,
  sameProcessIdentity,
  terminateProcessHandle,
  writeJsonAtomically
};
