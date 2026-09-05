const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'scripts', 'smoke-packaged-safe-exit.cjs');
const mainPath = path.join(root, 'electron', 'main.cjs');
const source = fs.readFileSync(scriptPath, 'utf8');
const main = fs.readFileSync(mainPath, 'utf8');
const removeTemporaryTree = (target) => fs.promises.rm(target, {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100
});
const {
  assertNoReparsePath,
  createExclusiveRunDirectory,
  descendantsOf,
  findProcessIdentity,
  launchWindowsJob,
  mergeProcessIdentities,
  terminateProcessHandle,
  writeJsonAtomically
} = require(scriptPath);

const waitForFile = async (target, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(target)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${target}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const waitForPidExit = async (pid, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try { process.kill(pid, 0); } catch { return; }
    if (Date.now() >= deadline) throw new Error(`PID ${pid} remained alive.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

test('safe-exit driver creates a fresh exclusive directory and writes authorization atomically', async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-safe-exit-security-'));
  context.after(() => removeTemporaryTree(temporary));
  const artifacts = path.join(temporary, 'artifacts');
  const first = await createExclusiveRunDirectory(artifacts);
  const marker = path.join(first, 'keep.txt');
  fs.writeFileSync(marker, 'keep');
  const second = await createExclusiveRunDirectory(artifacts);
  assert.notEqual(first, second);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep');

  const authorization = path.join(second, 'safe-exit.authorization.json');
  await writeJsonAtomically(authorization, { token: 'one-time' });
  assert.deepEqual(JSON.parse(fs.readFileSync(authorization, 'utf8')), { token: 'one-time' });
  assert.deepEqual(fs.readdirSync(second).filter((name) => name.endsWith('.tmp')), []);
  assert.doesNotMatch(source, /fsp\.rm\(/);
  assert.match(source, /fsp\.mkdtemp/);
});

test('safe-exit paths reject Windows junctions and reparse points', { skip: process.platform !== 'win32' }, async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-safe-exit-link-'));
  context.after(() => removeTemporaryTree(temporary));
  const target = path.join(temporary, 'target');
  const junction = path.join(temporary, 'junction');
  fs.mkdirSync(target);
  fs.symlinkSync(target, junction, 'junction');
  await assert.rejects(assertNoReparsePath(path.join(junction, 'result.json')), /linked path|reparse/i);
});

test('safe-exit process snapshot walks every descendant, not only named services', () => {
  const table = [
    { pid: 2, parentPid: 1, creationFileTime: '2' },
    { pid: 3, parentPid: 2, creationFileTime: '3' },
    { pid: 4, parentPid: 1, creationFileTime: '4' },
    { pid: 5, parentPid: 99, creationFileTime: '5' }
  ];
  assert.deepEqual(descendantsOf(table, 1).map((entry) => entry.pid), [2, 4, 3]);
  assert.deepEqual(mergeProcessIdentities([table[0]], [table[0], table[1]]).map((entry) => entry.pid), [2, 3]);
  assert.match(source, /tableBeforeReadyCheck/);
  assert.match(source, /tableAfterReadyCheck/);
  assert.match(source, /processSnapshots\.beforeReady/);
  assert.match(source, /processSnapshots\.afterReady/);
  assert.match(source, /startProcessSnapshotMonitor/);
  assert.match(source, /allOwnedIdentities = mergeProcessIdentities/);
  assert.match(source, /waitForProcessIdentitiesGone\(allOwnedIdentities/);
  assert.match(source, /readListeningPortOwners/);
  assert.match(source, /entry\.pid === appPid/);
  assert.match(source, /ownedPortResidueAfterExit\.length === 0/);
  assert.match(source, /reusedPortsAfterExit/);
  assert.match(source, /creationFileTime/);
  assert.match(source, /harnessAliveAfterExit/);
  assert.match(source, /terminalAliveAfterExit/);
  assert.match(source, /inspectPackagedBuild/);
  assert.match(source, /readyState\.identity\?\.product !== buildEvidence\.package\.version/);
});

test('Job guardian waits for stdio close and consumes a final unterminated frame', () => {
  assert.match(source, /guardian\.once\('close'/);
  assert.doesNotMatch(source, /guardian\.once\('exit'/);
  assert.match(source, /consumeGuardianBuffer\(true\)/);
  assert.match(source, /const line = buffer\.trim\(\)/);
  assert.match(source, /const guardianExit = await jobLaunch\.close\(\)/);
  assert.match(source, /guardianExit\.code === 0/);
  assert.match(source, /guardianExit\.signal === null/);
});

test('packaged app consumes and validates one-time authorization before selecting userData', () => {
  const authorization = main.indexOf('const safeExitSmokeAuthorization =');
  const setPath = main.indexOf("app.setPath('userData'");
  assert.ok(authorization > 0 && authorization < setPath);
  const validation = main.slice(main.indexOf('const consumeSafeExitAuthorizationSync ='), authorization);
  assert.match(validation, /fs\.renameSync\(authorizationPath, consumedPath\)/);
  assert.match(main, /timingSafeEqual/);
  assert.match(validation, /process\.kill\(authorization\.driverPid, 0\)/);
  assert.match(validation, /expiry <= now/);
  assert.match(validation, /authorization\.continuationTimeoutMs !== SAFE_EXIT_CONTINUATION_TIMEOUT_MS/);
  assert.match(validation, /continuationTimeoutMs: authorization\.continuationTimeoutMs/);
  assert.match(validation, /userDataPath/);
  assert.match(validation, /fs\.existsSync/);
  assert.match(validation, /fs\.mkdirSync\(userDataPath, \{ recursive: false \}\)/);
  assert.match(validation, /--smoke-credential-source=/);
  assert.match(validation, /fs\.unlinkSync\(consumedPath\)/);
  assert.match(main, /FileAttributes\]::ReparsePoint/);
  assert.match(main, /const SAFE_EXIT_CONTINUATION_TIMEOUT_MS = 180_000/);
  assert.match(main, /timeoutMs: safeExitSmokeAuthorization\.continuationTimeoutMs/);
  assert.doesNotMatch(main, /SAFE_EXIT_CONTINUATION_TIMEOUT_MS\s*=\s*Number\(process\.env/);
  assert.match(source, /continuationTimeoutMs: SAFE_EXIT_CONTINUATION_TIMEOUT_MS/);
  assert.match(source, /readyState\.continuationTimeoutMs !== SAFE_EXIT_CONTINUATION_TIMEOUT_MS/);
});

test('safe-exit cleanup keeps exact identity checks independent from continuation cleanup', () => {
  const cleanup = source.slice(source.indexOf('} finally {'), source.indexOf('if (require.main'));
  assert.match(cleanup, /attemptCleanup\('remove stale continuation'/);
  assert.match(cleanup, /attemptCleanup\('request normal smoke continuation'/);
  assert.match(cleanup, /attemptCleanup\('stop all exact packaged process identities'/);
  assert.doesNotMatch(source, /taskkill\.exe/);
  assert.match(source, /OpenProcess/);
  assert.match(source, /GetProcessTimes/);
  assert.match(source, /TerminateProcess/);
  assert.match(source, /creationFileTime/);
});

test('Job launch failure terminates a suspended child through its exact process handle', () => {
  const create = source.indexOf('CreateProcess($exe');
  const assign = source.indexOf('AssignProcessToJobObject($job');
  const resume = source.indexOf('ResumeThread($threadHandle)');
  const cleanup = source.indexOf('if ((-not $processResumed)');
  const close = source.indexOf('if ($processHandle -ne [IntPtr]::Zero) { [void][DshJobLauncher]::CloseHandle');
  assert.ok(create > 0 && create < assign && assign < resume && resume < cleanup && cleanup < close);
  assert.match(source.slice(cleanup, close), /TerminateProcess\(\$processHandle, 70\)/);
  assert.match(source.slice(cleanup, close), /WaitForSingleObject\(\$processHandle, 5000\)/);
});

test('exact cleanup binds a process handle and refuses a reused PID identity', { skip: process.platform !== 'win32', timeout: 20000 }, async (context) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  context.after(() => { try { child.kill(); } catch { /* Test child already exited. */ } });
  const identity = await findProcessIdentity(child.pid);
  assert.ok(identity?.creationFileTime);
  await assert.rejects(
    terminateProcessHandle({ ...identity, creationFileTime: (BigInt(identity.creationFileTime) + 1n).toString() }),
    /reused/
  );
  assert.doesNotThrow(() => process.kill(child.pid, 0));
  assert.equal(await terminateProcessHandle(identity), 'TERMINATED');
  if (child.exitCode === null) await new Promise((resolve) => child.once('exit', resolve));
});

test('suspended Job launch owns detached descendants from process creation and kills them when the guardian closes', { skip: process.platform !== 'win32', timeout: 25000 }, async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-safe-exit-job-'));
  const pidFile = path.join(temporary, 'descendant.pid');
  let job;
  let descendantPid = 0;
  context.after(async () => {
    await job?.close().catch(() => undefined);
    await removeTemporaryTree(temporary);
  });
  const childCode = [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    `const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })`,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(child.pid))`,
    'setInterval(() => {}, 1000)'
  ].join(';');
  job = await launchWindowsJob({ executablePath: process.execPath, args: ['-e', childCode], cwd: temporary });
  await waitForFile(pidFile);
  descendantPid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.doesNotThrow(() => process.kill(job.pid, 0));
  assert.doesNotThrow(() => process.kill(descendantPid, 0));
  await job.close();
  await Promise.all([waitForPidExit(job.pid), waitForPidExit(descendantPid)]);
  assert.match(source, /CreateProcess\([^\n]+0x4/);
  assert.match(source, /AssignProcessToJobObject/);
  assert.match(source, /LimitFlags = 0x2000/);
  assert.match(source, /waitForEmpty/);
});

test('driver termination makes the guardian close its Job and every detached descendant', { skip: process.platform !== 'win32', timeout: 25000 }, async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-safe-exit-driver-'));
  const childStateFile = path.join(temporary, 'child-state.json');
  const driverStateFile = path.join(temporary, 'driver-state.json');
  const modulePath = path.resolve(__dirname, '..', 'scripts', 'smoke-packaged-safe-exit.cjs');
  const childCode = [
    "const { spawn } = require('node:child_process')",
    "const fs = require('node:fs')",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })",
    `fs.writeFileSync(${JSON.stringify(childStateFile)}, JSON.stringify({ rootPid: process.pid, descendantPid: child.pid }))`,
    'setInterval(() => {}, 1000)'
  ].join(';');
  const driverCode = [
    `const { launchWindowsJob } = require(${JSON.stringify(modulePath)})`,
    "const fs = require('node:fs')",
    "const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))",
    '(async () => {',
    `const job = await launchWindowsJob({ executablePath: process.execPath, args: ['-e', ${JSON.stringify(childCode)}], cwd: ${JSON.stringify(temporary)} })`,
    `while (!fs.existsSync(${JSON.stringify(childStateFile)})) await delay(25)`,
    `const state = JSON.parse(fs.readFileSync(${JSON.stringify(childStateFile)}, 'utf8'))`,
    `fs.writeFileSync(${JSON.stringify(driverStateFile)}, JSON.stringify({ ...state, guardianPid: job.guardian.pid }))`,
    'setInterval(() => {}, 1000)',
    '})().catch((error) => { console.error(error); process.exit(1) })'
  ].join(';');
  const driver = spawn(process.execPath, ['-e', driverCode], { cwd: temporary, stdio: 'ignore', windowsHide: true });
  const captured = [];
  context.after(async () => {
    for (const identity of captured.reverse()) await terminateProcessHandle(identity).catch(() => undefined);
    try { driver.kill(); } catch { /* The driver already exited. */ }
    await removeTemporaryTree(temporary);
  });
  await waitForFile(driverStateFile);
  const state = JSON.parse(fs.readFileSync(driverStateFile, 'utf8'));
  for (const pid of [driver.pid, state.guardianPid, state.rootPid, state.descendantPid]) {
    const identity = await findProcessIdentity(pid);
    assert.ok(identity, `process ${pid} must be alive before the driver exits`);
    captured.push(identity);
  }
  driver.kill();
  if (driver.exitCode === null) await new Promise((resolve) => driver.once('exit', resolve));
  await Promise.all([
    waitForPidExit(state.guardianPid),
    waitForPidExit(state.rootPid),
    waitForPidExit(state.descendantPid)
  ]);
});

test('Job guardian reports the root exit and proves the complete Job became empty', { skip: process.platform !== 'win32', timeout: 20000 }, async (context) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-safe-exit-job-empty-'));
  let job;
  context.after(async () => {
    await job?.close().catch(() => undefined);
    await removeTemporaryTree(temporary);
  });
  job = await launchWindowsJob({
    executablePath: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 150)'],
    cwd: temporary
  });
  const rootExit = await job.waitForRootExit();
  const empty = await job.waitForEmpty();
  assert.equal(rootExit.code, 0);
  assert.equal(empty.activeProcesses, 0);
  assert.equal((await job.close()).code, 0);
});
