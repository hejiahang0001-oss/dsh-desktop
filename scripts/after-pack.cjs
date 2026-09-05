'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_APP_RELATIVE = path.join('resources', 'default_app.asar');
const EXPECTED_DEFAULT_APP_BYTES = 111_073;
const EXPECTED_DEFAULT_APP_SHA256 = '06d4a28be095a80eff94dbd18edcfac5b5805e1b5538e0fb7cee7c7ae81db76a';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const removeDefaultElectronApp = async (
  { appOutDir, electronPlatformName } = {},
  {
    expectedBytes = EXPECTED_DEFAULT_APP_BYTES,
    expectedSha256 = EXPECTED_DEFAULT_APP_SHA256
  } = {}
) => {
  if (electronPlatformName !== 'win32') return Object.freeze({ removed: false, reason: 'non-windows' });
  if (typeof appOutDir !== 'string' || !path.isAbsolute(appOutDir)) {
    throw new Error('after-pack requires an absolute Windows app output directory.');
  }
  const root = path.resolve(appOutDir);
  if (root === path.parse(root).root) throw new Error('after-pack refuses a filesystem root.');
  const target = path.resolve(root, DEFAULT_APP_RELATIVE);
  const relative = path.relative(root, target);
  if (relative !== DEFAULT_APP_RELATIVE || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`)) {
    throw new Error('after-pack default application path escaped the package root.');
  }

  let info;
  try {
    info = await fs.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ removed: false, reason: 'absent' });
    throw error;
  }
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error('after-pack expected default application identity is invalid.');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expectedBytes) {
    throw new Error('Unexpected Electron default_app.asar identity; package cleanup stopped.');
  }
  const bytes = await fs.readFile(target);
  if (sha256(bytes) !== expectedSha256) {
    throw new Error('Unexpected Electron default_app.asar digest; package cleanup stopped.');
  }
  await fs.unlink(target);
  return Object.freeze({ removed: true, reason: 'verified-electron-default-app' });
};

const afterPack = async (context) => removeDefaultElectronApp(context);

module.exports = afterPack;
module.exports.DEFAULT_APP_RELATIVE = DEFAULT_APP_RELATIVE;
module.exports.EXPECTED_DEFAULT_APP_BYTES = EXPECTED_DEFAULT_APP_BYTES;
module.exports.EXPECTED_DEFAULT_APP_SHA256 = EXPECTED_DEFAULT_APP_SHA256;
module.exports.removeDefaultElectronApp = removeDefaultElectronApp;
