const { randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const defaultValidator = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readValidJson = async (fsPromises, filePath, validator) => {
  try {
    const text = await fsPromises.readFile(filePath, 'utf8');
    const value = JSON.parse(text);
    return validator(value) ? { text, value } : null;
  } catch {
    return null;
  }
};

const writeSyncedFile = async (fsPromises, filePath, text) => {
  const handle = await fsPromises.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const cleanupTemp = async (fsPromises, filePath) => {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const syncParentDirectory = async (fsPromises, directory) => {
  let handle;
  try {
    handle = await fsPromises.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (!['EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
};

class AtomicJsonFile {
  constructor({ filePath, fsPromises = fsp, validator = defaultValidator }) {
    this.filePath = path.resolve(filePath);
    this.backupPath = `${this.filePath}.bak`;
    this.fs = fsPromises;
    this.validator = validator;
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
    await this.fs.mkdir(directory, { recursive: true });
    try {
      const previous = await readValidJson(this.fs, this.filePath, this.validator);
      if (previous) {
        await writeSyncedFile(this.fs, backupTemp, previous.text);
        await this.fs.rename(backupTemp, this.backupPath);
        const verifiedBackup = await readValidJson(this.fs, this.backupPath, this.validator);
        if (!verifiedBackup || verifiedBackup.text !== previous.text) {
          throw new Error('Atomic JSON backup verification failed.');
        }
      }
      await writeSyncedFile(this.fs, primaryTemp, text);
      const verifiedPending = await readValidJson(this.fs, primaryTemp, this.validator);
      if (!verifiedPending || verifiedPending.text !== text) {
        throw new Error('Atomic JSON pending-file verification failed.');
      }
      await this.fs.rename(primaryTemp, this.filePath);
      await syncParentDirectory(this.fs, directory);
    } finally {
      await cleanupTemp(this.fs, primaryTemp);
      await cleanupTemp(this.fs, backupTemp);
    }
  }
}

module.exports = { AtomicJsonFile, defaultValidator };
