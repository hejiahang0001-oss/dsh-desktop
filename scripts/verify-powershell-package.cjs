'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const asar = require('@electron/asar');
const { resolvePowerShellRuntime } = require('../electron/powershell-runtime.cjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function verifyPackagedPowerShell({ appOutDir, electronPlatformName } = {}) {
  if (electronPlatformName !== 'win32') return Object.freeze({ verified: false, reason: 'non-windows' });
  if (typeof appOutDir !== 'string' || !path.isAbsolute(appOutDir)
    || path.resolve(appOutDir) === path.parse(appOutDir).root) throw new Error('PowerShell package verification requires an absolute app output directory.');
  const resourcesPath = path.join(appOutDir, 'resources');
  const archive = path.join(resourcesPath, 'app.asar');
  const stat = fs.lstatSync(archive);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Untrusted application archive.');
  // The trust anchor must be in application code, not beside writable DLLs.
  for (const relative of ['runtime/powershell/profile.json', 'electron/powershell-runtime.cjs']) {
    const packaged = asar.extractFile(archive, relative.split('/').join(path.sep));
    const original = fs.readFileSync(path.join(__dirname, '..', relative));
    if (sha256(packaged) !== sha256(original)) throw new Error(`PowerShell application binding mismatch: ${relative}`);
  }
  const runtime = resolvePowerShellRuntime({ isPackaged: true, resourcesPath });
  return Object.freeze({ verified: true, version: runtime.version, fileCount: runtime.fileCount, bytes: runtime.bytes });
}

module.exports = { verifyPackagedPowerShell };
