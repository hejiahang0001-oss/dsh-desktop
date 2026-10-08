const { randomUUID, createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const defaultValidator = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const SAFE_FS_CODES = new Set(['EACCES', 'EBUSY', 'EDQUOT', 'EEXIST', 'EFBIG', 'EINTR', 'EINVAL', 'EIO', 'EISDIR',
  'ELOOP', 'EMFILE', 'ENAMETOOLONG', 'ENFILE', 'ENOENT', 'ENOSPC', 'ENOSYS', 'ENOTDIR', 'ENOTEMPTY', 'ENOTSUP', 'EPERM', 'EROFS', 'EXDEV', 'UNKNOWN']);
const SAFE_PHASES = new Set(['mkdir', 'backup-open', 'backup-write', 'backup-sync', 'backup-close', 'backup-replace',
  'backup-verify-read', 'backup-verify-parse', 'backup-verify-validate', 'backup-verify-content',
  'pending-open', 'pending-write', 'pending-sync', 'pending-close',
  'pending-verify-read', 'pending-verify-parse', 'pending-verify-validate', 'pending-verify-content',
  'primary-replace', 'directory-open', 'directory-sync', 'directory-close', 'cleanup-primary', 'cleanup-backup']);
const diagnosticErrors = new WeakSet();
const writeError = (phase, error) => {
  const failure = new Error('Atomic JSON write failed.');
  failure.code = 'ATOMIC_JSON_WRITE_FAILED'; failure.phase = phase;
  failure.fsCode = SAFE_FS_CODES.has(error?.code) ? error.code : 'UNKNOWN';
  diagnosticErrors.add(failure); return failure;
};
const atomicJsonDiagnostic = (error) => {
  if (!error || !diagnosticErrors.has(error) || !SAFE_PHASES.has(error.phase)) return null;
  return Object.freeze({ phase: error.phase, code: SAFE_FS_CODES.has(error.fsCode) ? error.fsCode : 'UNKNOWN' });
};
const filesystemStep = async (phase, operation) => {
  try { return await operation(); } catch (error) { throw writeError(phase, error); }
};
const WINDOWS_REPLACE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const WINDOWS_REPLACE_DELAYS_MS = Object.freeze([10, 25, 50, 100, 200, 250]);
const WINDOWS_REPLACE_BUDGET_MS = 900;
const sameTempIdentity = (owned, stat) => stat.isFile() && !stat.isSymbolicLink()
  && stat.dev === owned.dev && stat.ino === owned.ino && stat.nlink === owned.nlink;
const inspectOwnedTemp = async (fsPromises, filePath, owned) => {
  if (!owned) return { state: 'unowned' };
  try {
    const before = await fsPromises.lstat(filePath);
    if (!sameTempIdentity(owned, before)) return { state: 'changed' };
    if (owned.text !== null && await fsPromises.readFile(filePath, 'utf8') !== owned.text) return { state: 'changed' };
    const after = await fsPromises.lstat(filePath);
    if (!sameTempIdentity(owned, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return { state: 'changed' };
    return { state: 'owned' };
  } catch (error) { return { state: error?.code === 'ENOENT' ? 'missing' : 'unknown', error }; }
};
const inspectTarget = async (fsPromises, filePath) => {
  let before;
  try { before = await fsPromises.lstat(filePath); }
  catch (error) { return { state: error?.code === 'ENOENT' ? 'missing' : 'unknown', error }; }
  try {
    if (!before.isFile() || before.isSymbolicLink()) return { state: 'unknown' };
    const hash = createHash('sha256').update(await fsPromises.readFile(filePath)).digest('hex');
    const after = await fsPromises.lstat(filePath);
    if (!sameTempIdentity(before, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return { state: 'unknown' };
    return { state: 'file', dev: after.dev, ino: after.ino, nlink: after.nlink,
      size: after.size, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, hash };
  } catch (error) { return { state: 'unknown', error }; }
};
const sameTarget = (before, after) => before.state === after.state && (before.state === 'missing'
  || before.state === 'file' && ['dev', 'ino', 'nlink', 'size', 'mtimeMs', 'ctimeMs', 'hash'].every(key => before[key] === after[key]));
const replaceFile = async (fsPromises, from, to, phase, platform, owned) => {
  const started = performance.now(); let firstError;
  const target = await inspectTarget(fsPromises, to);
  if (target.state === 'unknown') throw writeError(phase, target.error);
  for (let attempt = 0; ; attempt++) {
    const pending = await inspectOwnedTemp(fsPromises, from, owned);
    if (pending.state !== 'owned') throw writeError(phase, firstError || pending.error);
    if (!sameTarget(target, await inspectTarget(fsPromises, to))) throw writeError(phase, firstError);
    try { await fsPromises.rename(from, to); return; }
    catch (error) {
      firstError ||= error;
      // An error may follow a completed rename. A missing/replaced/changed source
      // is ambiguous: fail conservatively, never retry or undo the destination.
      if ((await inspectOwnedTemp(fsPromises, from, owned)).state !== 'owned') throw writeError(phase, error);
      // A retry must not replace another writer's newer destination, including a
      // newly created target. Changes are a conflict, never a rollback request.
      if (!sameTarget(target, await inspectTarget(fsPromises, to))) throw writeError(phase, error);
      // Only a Windows replacement may wait. Reuse the same synced, verified temp;
      // never unlink the destination or replay the surrounding write transaction.
      if (platform !== 'win32' || !WINDOWS_REPLACE_CODES.has(error?.code)) throw writeError(phase, error);
      const delay = WINDOWS_REPLACE_DELAYS_MS[attempt];
      if (delay === undefined || performance.now() - started + delay >= WINDOWS_REPLACE_BUDGET_MS) throw writeError(phase, firstError);
      await new Promise(resolve => setTimeout(resolve, delay));
      if (performance.now() - started >= WINDOWS_REPLACE_BUDGET_MS) throw writeError(phase, firstError);
    }
  }
};

const readValidJson = async (fsPromises, filePath, validator, phase) => {
  let text, value, valid;
  try { text = await fsPromises.readFile(filePath, 'utf8'); }
  catch (error) { if (phase) throw writeError(`${phase}-read`, error); return null; }
  try { value = JSON.parse(text); }
  catch { if (phase) throw writeError(`${phase}-parse`); return null; }
  try { valid = validator(value); }
  catch { if (phase) throw writeError(`${phase}-validate`); return null; }
  if (!valid && phase) throw writeError(`${phase}-validate`);
  return valid ? { text, value } : null;
};

const writeSyncedFile = async (fsPromises, filePath, text, phase, ownedTemps) => {
  const handle = await filesystemStep(`${phase}-open`, () => fsPromises.open(filePath, 'wx', 0o600));
  let failure;
  try {
    const stat = await filesystemStep(`${phase}-open`, () => handle.stat());
    if (!stat.isFile() || stat.nlink !== 1) throw writeError(`${phase}-open`);
    ownedTemps.set(filePath, { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, text: null });
    await filesystemStep(`${phase}-write`, () => handle.writeFile(text, 'utf8'));
    await filesystemStep(`${phase}-sync`, () => handle.sync());
    ownedTemps.get(filePath).text = text;
  } catch (error) { failure = error; }
  try { await filesystemStep(`${phase}-close`, () => handle.close()); }
  catch (error) { failure ||= error; }
  if (failure) throw failure;
};

const cleanupTemp = async (fsPromises, filePath, phase, owned) => {
  const pending = await inspectOwnedTemp(fsPromises, filePath, owned);
  if (pending.state === 'missing' || pending.state === 'unowned') return;
  if (pending.state !== 'owned') throw writeError(phase, pending.error);
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw writeError(phase, error);
  }
};

const syncParentDirectory = async (fsPromises, directory) => {
  let handle, failure;
  try {
    handle = await filesystemStep('directory-open', () => fsPromises.open(directory, 'r'));
    await filesystemStep('directory-sync', () => handle.sync());
  } catch (error) {
    if (!['EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(error.fsCode)) failure = error;
  }
  if (handle) try { await filesystemStep('directory-close', () => handle.close()); }
  catch (error) { failure ||= error; }
  if (failure) throw failure;
};

class AtomicJsonFile {
  constructor({ filePath, fsPromises = fsp, validator = defaultValidator, platform = process.platform }) {
    this.filePath = path.resolve(filePath);
    this.backupPath = `${this.filePath}.bak`;
    this.fs = fsPromises;
    this.validator = validator;
    this.platform = platform;
    this.queue = Promise.resolve();
  }

  async read({ fallback = {} } = {}) {
    await this.queue;
    const primary = await readValidJson(this.fs, this.filePath, this.validator);
    if (primary) return Object.freeze({ value: primary.value, source: 'primary' });
    const backup = await readValidJson(this.fs, this.backupPath, this.validator);
    if (backup) return Object.freeze({ value: backup.value, source: 'backup' });
    return Object.freeze({ value: fallback, source: 'fallback' });
  }

  write(value) {
    if (!this.validator(value)) return Promise.reject(new TypeError('Atomic JSON state must pass validation.'));
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const operation = this.queue.then(() => this._write(text));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async _write(text) {
    const directory = path.dirname(this.filePath);
    const token = `${process.pid}-${randomUUID()}`;
    const primaryTemp = `${this.filePath}.${token}.tmp`;
    const backupTemp = `${this.backupPath}.${token}.tmp`;
    const ownedTemps = new Map();
    await filesystemStep('mkdir', () => this.fs.mkdir(directory, { recursive: true }));
    let failure;
    try {
      const previous = await readValidJson(this.fs, this.filePath, this.validator);
      if (previous) {
        await writeSyncedFile(this.fs, backupTemp, previous.text, 'backup', ownedTemps);
        await replaceFile(this.fs, backupTemp, this.backupPath, 'backup-replace', this.platform, ownedTemps.get(backupTemp));
        const verifiedBackup = await readValidJson(this.fs, this.backupPath, this.validator, 'backup-verify');
        if (!verifiedBackup || verifiedBackup.text !== previous.text) {
          throw writeError('backup-verify-content');
        }
      }
      await writeSyncedFile(this.fs, primaryTemp, text, 'pending', ownedTemps);
      const verifiedPending = await readValidJson(this.fs, primaryTemp, this.validator, 'pending-verify');
      if (!verifiedPending || verifiedPending.text !== text) {
        throw writeError('pending-verify-content');
      }
      await replaceFile(this.fs, primaryTemp, this.filePath, 'primary-replace', this.platform, ownedTemps.get(primaryTemp));
      await syncParentDirectory(this.fs, directory);
    } catch (error) { failure = error; }
    // Always try both owned temporary paths, without replacing the first operation failure.
    for (const [file, phase] of [[primaryTemp, 'cleanup-primary'], [backupTemp, 'cleanup-backup']]) {
      try { await cleanupTemp(this.fs, file, phase, ownedTemps.get(file)); }
      catch (error) { failure ||= error; }
    }
    if (failure) throw failure;
  }
}

module.exports = { AtomicJsonFile, defaultValidator, atomicJsonDiagnostic };
