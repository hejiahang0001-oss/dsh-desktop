const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');
const { AtomicJsonFile, atomicJsonDiagnostic } = require('../electron/atomic-json-store.cjs');

const tempRoot = (context, prefix) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('atomic JSON writes retain one verified last-known-good backup and no temp files', async (context) => {
  const root = tempRoot(context, 'dsh-atomic-json-');
  const filePath = path.join(root, 'state.json');
  const store = new AtomicJsonFile({ filePath });
  await store.write({ version: 1, value: 'first' });
  await store.write({ version: 1, value: 'second' });
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { version: 1, value: 'second' });
  assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`, 'utf8')), { version: 1, value: 'first' });
  assert.equal((await fsp.readdir(root)).some((name) => name.endsWith('.tmp')), false);
});

test('atomic JSON reads recover from a valid backup without trusting a corrupt primary', async (context) => {
  const root = tempRoot(context, 'dsh-json-recovery-');
  const filePath = path.join(root, 'state.json');
  const store = new AtomicJsonFile({ filePath });
  await store.write({ value: 'last-good' });
  await store.write({ value: 'newer' });
  await fsp.writeFile(filePath, '{ interrupted');
  const recovered = await store.read({ fallback: { value: 'fallback' } });
  assert.equal(recovered.source, 'backup');
  assert.deepEqual(recovered.value, { value: 'last-good' });
  await store.write(recovered.value);
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { value: 'last-good' });
  assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`, 'utf8')), { value: 'last-good' });
});

test('failed replacement preserves the primary and cleans the pending temp file', async (context) => {
  const root = tempRoot(context, 'dsh-json-failure-');
  const filePath = path.join(root, 'state.json');
  const stable = new AtomicJsonFile({ filePath });
  await stable.write({ value: 'stable' });
  const failingFs = {
    ...fsp,
    rename: async (from, to) => {
      if (to === filePath) throw Object.assign(new Error('simulated replace failure'), { code: 'EACCES' });
      return fsp.rename(from, to);
    }
  };
  const failing = new AtomicJsonFile({ filePath, fsPromises: failingFs });
  await assert.rejects(failing.write({ value: 'partial' }), error => {
    assert.equal(error.code, 'ATOMIC_JSON_WRITE_FAILED'); assert.equal(error.phase, 'primary-replace'); assert.equal(error.fsCode, 'EACCES');
    assert.ok(!error.message.includes('simulated replace failure')); return true;
  });
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { value: 'stable' });
  assert.equal((await fsp.readdir(root)).some((name) => name.endsWith('.tmp')), false);
});

test('concurrent writes serialize in call order and leave the latest complete state', async (context) => {
  const root = tempRoot(context, 'dsh-json-queue-');
  const filePath = path.join(root, 'state.json');
  const store = new AtomicJsonFile({ filePath });
  await Promise.all([store.write({ value: 1 }), store.write({ value: 2 }), store.write({ value: 3 })]);
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath, 'utf8')), { value: 3 });
  assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`, 'utf8')), { value: 2 });
});

const diagnosticFailure = (phase, fsCode) => error => {
  assert.equal(error.code, 'ATOMIC_JSON_WRITE_FAILED'); assert.equal(error.phase, phase); assert.equal(error.fsCode, fsCode);
  assert.ok(!JSON.stringify(error).includes('SYNTHETIC_PRIVATE')); assert.ok(!error.message.includes('SYNTHETIC_PRIVATE'));
  return true;
};
test('backup and pending verification retain safe read codes without exposing source errors', async context => {
  for (const stage of ['backup', 'pending']) {
    const directory = tempRoot(context, `dsh-atomic-${stage}-`), filePath = path.join(directory, 'state.json');
    await new AtomicJsonFile({ filePath }).write({ value: 'original' });
    const injected = { ...fsp, readFile: async (file, ...args) => {
      if (stage === 'backup' ? file === `${filePath}.bak` : file.startsWith(`${filePath}.`) && file.endsWith('.tmp') && !file.startsWith(`${filePath}.bak.`)) {
        throw Object.assign(new Error('SYNTHETIC_PRIVATE read error'), { code: 'EACCES', path: 'SYNTHETIC_PRIVATE' });
      }
      return fsp.readFile(file, ...args);
    } };
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 'next' }), diagnosticFailure(`${stage}-verify-read`, 'EACCES'));
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'original' });
  }
});
test('pending parse and validator failures are distinct from filesystem codes', async context => {
  for (const stage of ['parse', 'validate']) {
    const directory = tempRoot(context, 'dsh-atomic-invalid-'), filePath = path.join(directory, 'state.json');
    const injected = { ...fsp, readFile: async (file, ...args) => file.endsWith('.tmp')
      ? stage === 'parse' ? '{ SYNTHETIC_PRIVATE' : '{"invalid":true}' : fsp.readFile(file, ...args) };
    const validator = value => { if (value.invalid) throw new Error('SYNTHETIC_PRIVATE validator'); return true; };
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, validator }).write({ value: 1 }), diagnosticFailure(`pending-verify-${stage}`, 'UNKNOWN'));
  }
});
test('cleanup cannot replace the first write failure and both temporary paths are attempted', async context => {
  const directory = tempRoot(context, 'dsh-atomic-cleanup-'), filePath = path.join(directory, 'state.json');
  await new AtomicJsonFile({ filePath }).write({ value: 'original' });
  const cleaned = [], cleanupChecks = []; let primaryRejected = false;
  const injected = { ...fsp, rename: async (from, to) => {
    if (to === filePath) { primaryRejected = true; throw Object.assign(new Error('SYNTHETIC_PRIVATE rename'), { code: 'EACCES' }); }
    return fsp.rename(from, to);
  }, lstat: file => { if (primaryRejected) cleanupChecks.push(file); return fsp.lstat(file); },
  unlink: async file => { cleaned.push(file); throw Object.assign(new Error('SYNTHETIC_PRIVATE cleanup'), { code: 'EBUSY' }); } };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 'next' }), diagnosticFailure('primary-replace', 'EACCES'));
  assert.equal(cleaned.length, 1); assert.ok(cleanupChecks.some(file => file.startsWith(`${filePath}.bak.`)));
  assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'original' });
});
test('file write failure survives close failure and a later queued write has no stale diagnostic', async context => {
  const directory = tempRoot(context, 'dsh-atomic-close-'), filePath = path.join(directory, 'state.json'); let inject = true;
  const injected = { ...fsp, open: async (file, ...args) => {
    const handle = await fsp.open(file, ...args);
    if (!inject || !file.endsWith('.tmp')) return handle;
    return { stat: () => handle.stat(), writeFile: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE write'), { code: 'EIO' }); },
      sync: () => handle.sync(), close: async () => { await handle.close(); throw Object.assign(new Error('SYNTHETIC_PRIVATE close'), { code: 'EBUSY' }); } };
  } };
  const store = new AtomicJsonFile({ filePath, fsPromises: injected });
  await assert.rejects(store.write({ value: 1 }), diagnosticFailure('pending-write', 'EIO'));
  inject = false; await store.write({ value: 2 }); assert.deepEqual((await store.read()).value, { value: 2 });
});
test('cleanup ownership-check failure still rejects after a committed primary without deleting an uncertain path', async context => {
  const directory = tempRoot(context, 'dsh-atomic-only-cleanup-'), filePath = path.join(directory, 'state.json'); let committed = false, unlinks = 0;
  const injected = { ...fsp, rename: async (from, to) => { await fsp.rename(from, to); committed = true; },
    lstat: file => { if (committed && file.endsWith('.tmp')) throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: 'EPERM' }); return fsp.lstat(file); },
    unlink: file => { unlinks++; return fsp.unlink(file); } };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 1 }), diagnosticFailure('cleanup-primary', 'EPERM'));
  assert.equal(unlinks, 0); assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 1 });
});
test('unknown filesystem codes cannot masquerade as diagnostics and directory allowed errors remain tolerated', async context => {
  const directory = tempRoot(context, 'dsh-atomic-codes-'), filePath = path.join(directory, 'state.json');
  const unknown = { ...fsp, mkdir: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: 'SYNTHETIC_PRIVATE' }); } };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: unknown }).write({ value: 1 }), diagnosticFailure('mkdir', 'UNKNOWN'));
  const directoryDenied = { ...fsp, open: async (file, ...args) => {
    if (file === directory) throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: 'EPERM' });
    return fsp.open(file, ...args);
  } };
  const store = new AtomicJsonFile({ filePath, fsPromises: directoryDenied }); await store.write({ value: 1 });
  assert.deepEqual((await store.read()).value, { value: 1 });
});
test('open, sync, close, backup replacement and second-cleanup failures retain their exact controlled stage', async context => {
  for (const stage of ['backup-open', 'backup-write', 'backup-sync', 'backup-close', 'backup-replace',
    'pending-open', 'pending-sync', 'pending-close', 'directory-open', 'directory-sync', 'directory-close', 'cleanup-backup']) {
    const directory = tempRoot(context, 'dsh-atomic-stages-'), filePath = path.join(directory, 'state.json');
    await new AtomicJsonFile({ filePath }).write({ value: 'original' });
    const injectedFailure = () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: 'EIO' }); }; let committed = false;
    const injected = { ...fsp, open: async (file, ...args) => {
      if (file === directory) {
        if (stage === 'directory-open') injectedFailure();
        if (stage.startsWith('directory-')) return { sync: async () => { if (stage === 'directory-sync') injectedFailure(); },
          close: async () => { if (stage === 'directory-close') injectedFailure(); } };
      }
      const role = file.startsWith(`${filePath}.bak.`) ? 'backup' : 'pending';
      if (file.endsWith('.tmp') && stage === `${role}-open`) injectedFailure();
      const handle = await fsp.open(file, ...args);
      if (!file.endsWith('.tmp')) return handle;
      return { stat: () => handle.stat(), writeFile: (...parameters) => stage === `${role}-write` ? injectedFailure() : handle.writeFile(...parameters),
        sync: () => stage === `${role}-sync` ? injectedFailure() : handle.sync(),
        close: async () => { await handle.close(); if (stage === `${role}-close`) injectedFailure(); } };
    }, rename: async (from, to) => { if (stage === 'backup-replace' && to === `${filePath}.bak`) injectedFailure(); await fsp.rename(from, to); if (to === filePath) committed = true; },
    lstat: file => stage === 'cleanup-backup' && committed && file.startsWith(`${filePath}.bak.`) ? injectedFailure() : fsp.lstat(file) };
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 'next' }), diagnosticFailure(stage, 'EIO'));
    const expectedCommitted = stage.startsWith('directory-') || stage === 'cleanup-backup';
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: expectedCommitted ? 'next' : 'original' });
  }
});
test('parse, validator and content mismatches cannot adopt attacker-controlled filesystem codes', async context => {
  for (const role of ['backup', 'pending']) for (const kind of ['parse', 'validate', 'content']) {
    const directory = tempRoot(context, 'dsh-atomic-verify-'), filePath = path.join(directory, 'state.json');
    await new AtomicJsonFile({ filePath }).write({ value: 'original' });
    const injected = { ...fsp, readFile: (file, ...args) => {
      const target = role === 'backup' ? file === `${filePath}.bak` : file.endsWith('.tmp') && !file.startsWith(`${filePath}.bak.`);
      return target ? Promise.resolve(kind === 'parse' ? '{ SYNTHETIC_PRIVATE' : JSON.stringify({ invalid: kind === 'validate', value: 'different' })) : fsp.readFile(file, ...args);
    } };
    const validator = value => { if (value.invalid) throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: 'EACCES' }); return true; };
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, validator }).write({ value: 'next' }), diagnosticFailure(`${role}-verify-${kind}`, 'UNKNOWN'));
  }
});
test('diagnostic extraction refuses forged errors, unknown phases, and unknown uppercase codes', async context => {
  assert.equal(atomicJsonDiagnostic({ code: 'ATOMIC_JSON_WRITE_FAILED', phase: 'mkdir', fsCode: 'EACCES' }), null);
  const directory = tempRoot(context, 'dsh-atomic-safe-metadata-'), filePath = path.join(directory, 'state.json'); let failure;
  try { await new AtomicJsonFile({ filePath, fsPromises: { mkdir: async () => { throw { code: 'SYNTHETIC_PRIVATE' }; } } }).write({ value: 1 }); }
  catch (error) { failure = error; }
  assert.deepEqual(atomicJsonDiagnostic(failure), { phase: 'mkdir', code: 'UNKNOWN' });
  failure.fsCode = 'SYNTHETIC_PRIVATE'; assert.deepEqual(atomicJsonDiagnostic(failure), { phase: 'mkdir', code: 'UNKNOWN' });
  failure.phase = 'SYNTHETIC_PRIVATE'; assert.equal(atomicJsonDiagnostic(failure), null);
});
test('directory sync error remains primary even when directory close also fails', async context => {
  const directory = tempRoot(context, 'dsh-atomic-directory-close-'), filePath = path.join(directory, 'state.json'); let closed = 0;
  const injected = { ...fsp, open: (file, ...args) => file === directory ? Promise.resolve({
    sync: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE sync'), { code: 'EIO' }); },
    close: async () => { closed++; throw Object.assign(new Error('SYNTHETIC_PRIVATE close'), { code: 'EBUSY' }); }
  }) : fsp.open(file, ...args) };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 1 }), diagnosticFailure('directory-sync', 'EIO'));
  assert.equal(closed, 1); assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 1 });
});

const holdWindowsDeleteShare = async filePath => {
  const encodedPath = Buffer.from(filePath, 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); $h=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try {[Console]::WriteLine('LOCK_READY'); [Console]::Out.Flush(); $read=[Console]::In.ReadLineAsync(); $null=$read.Wait(10000)} finally {$h.Dispose(); [Console]::WriteLine('LOCK_RELEASED')}`;
  const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|TEMP|TMP)$/i.test(name)));
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', finished = false;
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => { finished = true; code === 0 ? resolve() : reject(new Error('synthetic-lock-helper-failed')); });
  });
  completion.catch(() => {});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('synthetic-lock-ready-timeout')); }, 5000);
    child.stdout.on('data', bytes => { output += bytes.toString(); if (output.includes('LOCK_READY')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); if (!output.includes('LOCK_READY')) reject(new Error('synthetic-lock-not-acquired')); });
  });
  return { async release() { if (!finished) child.stdin.end('release\n'); await completion; } };
};
test('Windows short deny-delete lock releases and the same pending file replaces primary without replaying the transaction', { skip: process.platform !== 'win32' }, async context => {
  const directory = tempRoot(context, 'dsh-atomic-short-lock-'), filePath = path.join(directory, 'state.json');
  await new AtomicJsonFile({ filePath }).write({ value: 'original' });
  const lock = await holdWindowsDeleteShare(filePath), attempts = []; let firstCode, backupReplacements = 0, pendingOpens = 0;
  const injected = { ...fsp, open: (file, ...args) => { if (file.endsWith('.tmp') && !file.startsWith(`${filePath}.bak.`)) pendingOpens++; return fsp.open(file, ...args); },
    rename: async (from, to) => {
      if (to === `${filePath}.bak`) backupReplacements++;
      if (to !== filePath) return fsp.rename(from, to);
      attempts.push(from);
      try { return await fsp.rename(from, to); } catch (error) { if (!firstCode) { firstCode = error.code; await lock.release(); } throw error; }
    } };
  try {
    await new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 'next' });
    assert.equal(firstCode, 'EPERM'); assert.ok(attempts.length >= 2); assert.equal(new Set(attempts).size, 1);
    assert.equal(backupReplacements, 1); assert.equal(pendingOpens, 1);
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'next' });
    assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`)), { value: 'original' });
    assert.ok(!(await fsp.readdir(directory)).some(name => name.endsWith('.tmp')));
  } finally { await lock.release(); }
});
test('Windows lock held through the retry bound still rejects and preserves original and verified backup', { skip: process.platform !== 'win32' }, async context => {
  const directory = tempRoot(context, 'dsh-atomic-long-lock-'), filePath = path.join(directory, 'state.json');
  await new AtomicJsonFile({ filePath }).write({ value: 'original' });
  const lock = await holdWindowsDeleteShare(filePath), attempts = []; const started = performance.now();
  const injected = { ...fsp, rename: (from, to) => { if (to === filePath) attempts.push(from); return fsp.rename(from, to); } };
  try {
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 'next' }), diagnosticFailure('primary-replace', 'EPERM'));
    assert.ok(attempts.length >= 2 && attempts.length <= 7); assert.equal(new Set(attempts).size, 1);
    assert.ok(performance.now() - started < 1500, 'retry budget plus test filesystem work must remain bounded');
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'original' });
    assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`)), { value: 'original' });
    assert.ok(!(await fsp.readdir(directory)).some(name => name.endsWith('.tmp')));
  } finally { await lock.release(); }
});
test('Windows short lock on backup replacement retains the previous primary as backup', { skip: process.platform !== 'win32' }, async context => {
  const directory = tempRoot(context, 'dsh-atomic-backup-lock-'), filePath = path.join(directory, 'state.json'), stable = new AtomicJsonFile({ filePath });
  await stable.write({ value: 'first' }); await stable.write({ value: 'second' });
  const lock = await holdWindowsDeleteShare(`${filePath}.bak`), attempts = []; let firstCode, primaryReplacements = 0;
  const injected = { ...fsp, rename: async (from, to) => {
    if (to === filePath) primaryReplacements++;
    if (to !== `${filePath}.bak`) return fsp.rename(from, to);
    attempts.push(from);
    try { return await fsp.rename(from, to); } catch (error) { if (!firstCode) { firstCode = error.code; await lock.release(); } throw error; }
  } };
  try {
    await new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 'third' });
    assert.equal(firstCode, 'EPERM'); assert.ok(attempts.length >= 2); assert.equal(new Set(attempts).size, 1); assert.equal(primaryReplacements, 1);
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'third' });
    assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`)), { value: 'second' });
  } finally { await lock.release(); }
});
test('nonretryable rename errors and non-Windows platforms never retry', async context => {
  for (const [platform, code] of [['win32', 'EIO'], ['win32', 'ENOENT'], ['linux', 'EPERM'], ['darwin', 'EBUSY']]) {
    const directory = tempRoot(context, 'dsh-atomic-no-retry-'), filePath = path.join(directory, 'state.json'); let attempts = 0;
    const injected = { ...fsp, rename: async () => { attempts++; throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code }); } };
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, platform }).write({ value: 1 }), diagnosticFailure('primary-replace', code));
    assert.equal(attempts, 1);
  }
});
test('retry exhaustion keeps the first rename failure despite later retryable errors and cleanup failures', async context => {
  const directory = tempRoot(context, 'dsh-atomic-retry-cleanup-'), filePath = path.join(directory, 'state.json'); let attempts = 0, cleanups = 0;
  const injected = { ...fsp, rename: async () => { attempts++; throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: attempts === 1 ? 'EPERM' : 'EACCES' }); },
    unlink: async () => { cleanups++; throw Object.assign(new Error('SYNTHETIC_PRIVATE cleanup'), { code: 'EIO' }); } };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, platform: 'win32' }).write({ value: 1 }), diagnosticFailure('primary-replace', 'EPERM'));
  assert.ok(attempts >= 2 && attempts <= 7); assert.equal(cleanups, 1); // The never-created backup temp is not ours to unlink.
});
test('only allowlisted transient Windows replacement codes retry, and a later nonretryable error stops immediately', async context => {
  for (const code of ['EACCES', 'EBUSY']) {
    const directory = tempRoot(context, 'dsh-atomic-transient-'), filePath = path.join(directory, 'state.json'); let attempts = 0;
    const injected = { ...fsp, rename: async (from, to) => {
      if (++attempts === 1) throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code });
      return fsp.rename(from, to);
    } };
    await new AtomicJsonFile({ filePath, fsPromises: injected, platform: 'win32' }).write({ value: 1 });
    assert.equal(attempts, 2); assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 1 });
  }
  const directory = tempRoot(context, 'dsh-atomic-transition-'), filePath = path.join(directory, 'state.json'); let attempts = 0;
  const injected = { ...fsp, rename: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: ++attempts === 1 ? 'EPERM' : 'EIO' }); } };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, platform: 'win32' }).write({ value: 1 }), diagnosticFailure('primary-replace', 'EIO'));
  assert.equal(attempts, 2);
});
test('EPERM outside rename is never retried', async context => {
  const directory = tempRoot(context, 'dsh-atomic-open-no-retry-'), filePath = path.join(directory, 'state.json'); let opens = 0;
  const injected = { ...fsp, open: async () => { opens++; throw Object.assign(new Error('SYNTHETIC_PRIVATE'), { code: 'EPERM' }); } };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, platform: 'win32' }).write({ value: 1 }), diagnosticFailure('pending-open', 'EPERM'));
  assert.equal(opens, 1);
});
test('Windows persistent backup lock does not replace either original primary or older backup', { skip: process.platform !== 'win32' }, async context => {
  const directory = tempRoot(context, 'dsh-atomic-backup-held-'), filePath = path.join(directory, 'state.json'), stable = new AtomicJsonFile({ filePath });
  await stable.write({ value: 'first' }); await stable.write({ value: 'second' });
  const lock = await holdWindowsDeleteShare(`${filePath}.bak`); let attempts = 0, primaryReplacements = 0;
  const injected = { ...fsp, rename: (from, to) => { if (to === `${filePath}.bak`) attempts++; if (to === filePath) primaryReplacements++; return fsp.rename(from, to); } };
  try {
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected }).write({ value: 'third' }), diagnosticFailure('backup-replace', 'EPERM'));
    assert.ok(attempts >= 2 && attempts <= 7); assert.equal(primaryReplacements, 0);
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'second' });
    assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`)), { value: 'first' });
  } finally { await lock.release(); }
});
test('a rename that completed but returned EPERM is not retried or treated as confirmed success', async context => {
  const directory = tempRoot(context, 'dsh-atomic-ambiguous-'), filePath = path.join(directory, 'state.json');
  await new AtomicJsonFile({ filePath }).write({ value: 'original' }); let attempts = 0;
  const injected = { ...fsp, rename: async (from, to) => {
    await fsp.rename(from, to);
    if (to === filePath) { attempts++; throw Object.assign(new Error('SYNTHETIC_PRIVATE ambiguous'), { code: 'EPERM' }); }
  } };
  await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, platform: 'win32' }).write({ value: 'next' }), diagnosticFailure('primary-replace', 'EPERM'));
  assert.equal(attempts, 1); assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'next' });
  assert.deepEqual(JSON.parse(await fsp.readFile(`${filePath}.bak`)), { value: 'original' });
});
test('replaced or changed pending objects are neither retried into the target nor deleted during cleanup', async context => {
  for (const kind of ['replaced', 'changed', 'changed-during-wait']) {
    const directory = tempRoot(context, 'dsh-atomic-unowned-'), filePath = path.join(directory, 'state.json');
    await new AtomicJsonFile({ filePath }).write({ value: 'original' }); let attempts = 0, pending, mutation;
    const injected = { ...fsp, rename: async (from, to) => {
      if (to !== filePath) return fsp.rename(from, to);
      attempts++; pending = from;
      if (attempts === 1) {
        if (kind === 'replaced') { await fsp.rename(from, `${from}.owned-original`); await fsp.writeFile(from, 'SYNTHETIC_THIRD_PARTY', { flag: 'wx' }); }
        else if (kind === 'changed') await fsp.appendFile(from, 'SYNTHETIC_THIRD_PARTY');
        else mutation = new Promise(resolve => setTimeout(() => { fs.appendFileSync(from, 'SYNTHETIC_THIRD_PARTY'); resolve(); }, 1));
        throw Object.assign(new Error('SYNTHETIC_PRIVATE replace failure'), { code: 'EPERM' });
      }
      return fsp.rename(from, to);
    } };
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, platform: 'win32' }).write({ value: 'next' }), diagnosticFailure('primary-replace', 'EPERM'));
    await mutation; assert.equal(attempts, 1);
    assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'original' });
    assert.ok((await fsp.readFile(pending, 'utf8')).includes('SYNTHETIC_THIRD_PARTY'));
  }
});

for (const role of ['primary', 'backup']) for (const kind of ['replaced', 'changed', 'created', 'changed-during-wait']) {
  test(`a ${role} target ${kind} during a failed replacement is preserved without another rename`, async context => {
    const directory = tempRoot(context, 'dsh-atomic-target-'), filePath = path.join(directory, 'state.json');
    const target = role === 'primary' ? filePath : `${filePath}.bak`;
    if (role === 'backup' || kind !== 'created') await fsp.writeFile(filePath, JSON.stringify({ value: 'original' }));
    if (role === 'backup' && kind !== 'created') await fsp.writeFile(target, JSON.stringify({ value: 'older' }));
    let attempts = 0, mutation;
    const injected = { ...fsp, rename: async (from, to) => {
      if (to !== target) return fsp.rename(from, to);
      attempts++;
      if (attempts === 1) {
        if (kind === 'replaced') { await fsp.rename(to, `${to}.displaced`); await fsp.writeFile(to, 'SYNTHETIC_THIRD_PARTY', { flag: 'wx' }); }
        else if (kind === 'changed') await fsp.appendFile(to, 'SYNTHETIC_THIRD_PARTY');
        else if (kind === 'created') await fsp.writeFile(to, 'SYNTHETIC_THIRD_PARTY', { flag: 'wx' });
        else mutation = new Promise(resolve => setTimeout(() => { fs.appendFileSync(to, 'SYNTHETIC_THIRD_PARTY'); resolve(); }, 1));
        throw Object.assign(new Error('SYNTHETIC_PRIVATE target changed'), { code: 'EPERM' });
      }
      return fsp.rename(from, to);
    } };
    await assert.rejects(new AtomicJsonFile({ filePath, fsPromises: injected, platform: 'win32' }).write({ value: 'next' }),
      diagnosticFailure(`${role}-replace`, 'EPERM'));
    await mutation; assert.equal(attempts, 1);
    assert.ok((await fsp.readFile(target, 'utf8')).includes('SYNTHETIC_THIRD_PARTY'));
    assert.ok(!(await fsp.readdir(directory)).some(name => name.endsWith('.tmp')));
    if (role === 'backup') assert.deepEqual(JSON.parse(await fsp.readFile(filePath)), { value: 'original' });
  });
}
