const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');
const zlib = require('node:zlib');
const { extractFile } = require('@electron/asar');
const { inspectHarnessRuntimePayload } = require('./harness-runtime-integrity.cjs');

const execFileAsync = promisify(execFile);

const MAX_BLOCKMAP_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_BLOCKMAP_RAW_BYTES = 64 * 1024 * 1024;
const MAX_BLOCKMAP_FILES = 16;
const MAX_BLOCKMAP_CHUNKS = 200_000;
const MAX_PACKAGE_FILES = 50_000;
const REQUIRED_TERMINAL_FILES = Object.freeze([
  'package.json',
  'lib/index.js',
  'prebuilds/win32-x64/conpty.node',
  'prebuilds/win32-x64/conpty_console_list.node',
  'prebuilds/win32-x64/conpty/conpty.dll',
  'prebuilds/win32-x64/conpty/OpenConsole.exe'
]);
const REQUIRED_PNPM_FILES = Object.freeze([
  'pnpm.cmd',
  'empty.npmrc',
  'package/bin/pnpm.mjs',
  'package/dist/pnpm.mjs',
  'package/package.json',
  'package/LICENSE'
]);
const REQUIRED_WORD_SKILL_FILES = Object.freeze([
  'SKILL.md',
  'scripts/word-docx.cjs'
]);
const REQUIRED_EXCEL_SKILL_FILES = Object.freeze([
  'SKILL.md',
  'scripts/excel-xlsx.cjs'
]);
const REQUIRED_POWERPOINT_SKILL_FILES = Object.freeze([
  'SKILL.md',
  'scripts/powerpoint-pptx.cjs'
]);
const REQUIRED_WIKI_SKILL_FILES = Object.freeze([
  'llm-wiki/SKILL.md',
  'llm-wiki/scripts/wiki-basic.cjs',
  'wiki-setup/SKILL.md',
  'wiki-query/SKILL.md',
  'wiki-capture/SKILL.md',
  'wiki-update/SKILL.md',
  'wiki-history-ingest/SKILL.md'
]);
const WIKI_SKILL_IDS = new Set(['llm-wiki', 'wiki-setup', 'wiki-query', 'wiki-capture', 'wiki-update', 'wiki-history-ingest']);
const REQUIRED_PNPM_VERSION = '11.19.0';
const REQUIRED_DESKTOP_NAME = 'dsh-desktop';
const REQUIRED_DESKTOP_VERSION = '1.1.7';
const REQUIRED_HARNESS_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git';
const REQUIRED_HARNESS_TAG = 'dsh-v0.1.2-rc.1';
const REQUIRED_HARNESS_VERSION = '0.1.2-rc.1';
const REQUIRED_HARNESS_COMMIT = 'a66e4702047846cdaa10c66c9d3df3951f5ea70d';
const REQUIRED_HARNESS_PACKAGE_COUNT = 251;
const REQUIRED_HARNESS_PACKAGE_INVENTORY_SHA256 = '98c1d04821a504c85c480e563b9629b1556189cb95becf0796c2f4eccc8e62dd';
const REQUIRED_HARNESS_DSH_PACKAGE_COUNT = 242;
const REQUIRED_HARNESS_BUILD_NODE = 'v24.19.0';
const REQUIRED_HARNESS_BUILD_PNPM = '11.7.0';
const REQUIRED_HARNESS_DEPENDENCY_RESOLUTION = 'upstream-frozen-lockfile';
const REQUIRED_HARNESS_PACKAGE_PAYLOAD = 'upstream-pnpm-pack';
const REQUIRED_HARNESS_INSTALL_SCRIPTS = Object.freeze(['koffi', 'node-pty', '@deepseek-ai/dsh-subprocess-local']);
const REQUIRED_HARNESS_VENDOR_PACKAGES = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-logger-console',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/schemastery'
]);
const REQUIRED_HARNESS_AUXILIARY_PACKAGES = new Map([
  ['@deepseek-ai/node-addon-landlock-run', '0.1.1'],
  ['@deepseek-ai/node-addon-landlock-run-linux-arm64', '0.1.1'],
  ['@deepseek-ai/node-addon-landlock-run-linux-x64', '0.1.1']
]);
const REQUIRED_LEGAL_FILES = Object.freeze(['LICENSE.txt', 'THIRD_PARTY_LICENSES.md']);
const REQUIRED_LEGAL_SHA256 = new Map([
  ['LICENSE.txt', '5950dd1b2553b7797fa438d822ec55a3a5cf51f0dc75ea67ef612796d1131199'],
  ['THIRD_PARTY_LICENSES.md', 'b802f0313de7e5f81ac53be68b6bb9261d91039ac1ca7ef6d92a1f411902814e']
]);

const normalize = (value) => value.replaceAll('\\', '/');
const HARNESS_PROCESS_HOST_RELATIVE = normalize(path.join('resources', 'harness-host', 'harness-process-host.cjs'));
const TERMINAL_PROCESS_HOST_RELATIVE = normalize(path.join('resources', 'terminal', 'terminal-pty-host.cjs'));
const NODE_RUNTIME_RELATIVE = normalize(path.join('resources', 'runtime', 'node.exe'));

const validateBlockmap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== '2') throw new Error('Blockmap invalid: unsupported root.');
  if (!Array.isArray(value.files) || value.files.length === 0 || value.files.length > MAX_BLOCKMAP_FILES) throw new Error('Blockmap invalid: file list.');
  let chunks = 0;
  for (const file of value.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('Blockmap invalid: file entry.');
    if (typeof file.name !== 'string' || file.name.length === 0 || file.name.length > 256) throw new Error('Blockmap invalid: file name.');
    if (!Number.isSafeInteger(file.offset) || file.offset < 0) throw new Error('Blockmap invalid: file offset.');
    if (!Array.isArray(file.checksums) || !Array.isArray(file.sizes) || file.checksums.length !== file.sizes.length || file.sizes.length === 0) {
      throw new Error('Blockmap invalid: chunk arrays.');
    }
    chunks += file.sizes.length;
    if (chunks > MAX_BLOCKMAP_CHUNKS) throw new Error('Blockmap invalid: too many chunks.');
    for (let index = 0; index < file.sizes.length; index += 1) {
      if (typeof file.checksums[index] !== 'string' || file.checksums[index].length === 0 || file.checksums[index].length > 128) throw new Error('Blockmap invalid: checksum.');
      if (!Number.isSafeInteger(file.sizes[index]) || file.sizes[index] <= 0 || file.sizes[index] > 64 * 1024 * 1024) throw new Error('Blockmap invalid: chunk size.');
    }
  }
  return value;
};

const decodeBlockmap = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_BLOCKMAP_COMPRESSED_BYTES) throw new Error('Blockmap compressed input is outside the allowed size.');
  let raw;
  try {
    raw = zlib.gunzipSync(buffer, { maxOutputLength: MAX_BLOCKMAP_RAW_BYTES });
  } catch (error) {
    throw new Error(`Blockmap invalid: ${error.message}`);
  }
  let value;
  try { value = JSON.parse(raw.toString('utf8')); } catch (error) {
    throw new Error(`Blockmap invalid JSON: ${error.message}`);
  }
  return validateBlockmap(value);
};

const metricsForBlockmap = (value) => {
  let bytes = 0;
  let chunks = 0;
  for (const file of value.files) {
    chunks += file.sizes.length;
    for (const size of file.sizes) bytes += size;
  }
  return { bytes, chunks };
};

const compareBlockmaps = (previousValue, currentValue) => {
  const previous = validateBlockmap(previousValue);
  const current = validateBlockmap(currentValue);
  const pool = new Map();
  for (const file of previous.files) {
    for (let index = 0; index < file.sizes.length; index += 1) {
      const key = `${file.checksums[index]}:${file.sizes[index]}`;
      pool.set(key, (pool.get(key) || 0) + 1);
    }
  }
  let reusableBytes = 0;
  let reusableChunks = 0;
  for (const file of current.files) {
    for (let index = 0; index < file.sizes.length; index += 1) {
      const key = `${file.checksums[index]}:${file.sizes[index]}`;
      const available = pool.get(key) || 0;
      if (available === 0) continue;
      pool.set(key, available - 1);
      reusableBytes += file.sizes[index];
      reusableChunks += 1;
    }
  }
  const previousMetrics = metricsForBlockmap(previous);
  const currentMetrics = metricsForBlockmap(current);
  return {
    previousBytes: previousMetrics.bytes,
    currentBytes: currentMetrics.bytes,
    previousChunks: previousMetrics.chunks,
    currentChunks: currentMetrics.chunks,
    reusableChunks,
    reusableBytes,
    downloadBytes: currentMetrics.bytes - reusableBytes,
    reuseRatio: Number((currentMetrics.bytes === 0 ? 0 : reusableBytes / currentMetrics.bytes).toFixed(6))
  };
};

const parsePeCertificateTable = (buffer, fileBytes = buffer?.length || 0) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 256 || buffer.readUInt16LE(0) !== 0x5a4d) throw new Error('PE invalid: DOS header.');
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset < 64 || peOffset + 160 > buffer.length || buffer.readUInt32LE(peOffset) !== 0x00004550) throw new Error('PE invalid: signature.');
  const optionalOffset = peOffset + 24;
  const magic = buffer.readUInt16LE(optionalOffset);
  const dataDirectoryOffset = magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0;
  if (!dataDirectoryOffset || optionalOffset + dataDirectoryOffset + 40 > buffer.length) throw new Error('PE invalid: optional header.');
  const securityOffset = optionalOffset + dataDirectoryOffset + (4 * 8);
  const certificateOffset = buffer.readUInt32LE(securityOffset);
  const certificateBytes = buffer.readUInt32LE(securityOffset + 4);
  if (certificateOffset === 0 && certificateBytes === 0) return { status: 'unsigned', certificateBytes: 0 };
  if (certificateOffset === 0 || certificateBytes < 8 || certificateOffset + certificateBytes > fileBytes) throw new Error('PE certificate table is outside the file.');
  return { status: 'embedded', certificateBytes };
};

const assessAutomaticUpdate = ({
  signatureStatus,
  verifyUpdateCodeSignature,
  trustedSignatureVerified = false,
  expectedPublisherVerified = false,
  updateFeedsSeparated = false
}) => {
  const blockers = [];
  if (signatureStatus !== 'embedded') blockers.push('unsigned-installer');
  if (verifyUpdateCodeSignature !== true) blockers.push('signature-verification-disabled');
  if (trustedSignatureVerified !== true) blockers.push('signature-trust-not-verified');
  if (expectedPublisherVerified !== true) blockers.push('expected-publisher-not-verified');
  if (updateFeedsSeparated !== true) blockers.push('update-feeds-not-separated');
  return {
    trustedSignatureVerified: trustedSignatureVerified === true,
    expectedPublisherVerified: expectedPublisherVerified === true,
    updateFeedsSeparated: updateFeedsSeparated === true,
    automaticUpdateReady: blockers.length === 0,
    blockers
  };
};

const inspectPeFile = async (filePath) => {
  const handle = await fsp.open(filePath, 'r');
  try {
    const info = await handle.stat();
    const header = Buffer.alloc(Math.min(info.size, 4096));
    await handle.read(header, 0, header.length, 0);
    return { bytes: info.size, ...parsePeCertificateTable(header, info.size) };
  } finally {
    await handle.close();
  }
};

const parseVersionInfoReport = (value) => {
  const lines = String(value || '').replace(/^\uFEFF/u, '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch { /* Continue to an earlier output line. */ }
  }
  return null;
};

const inspectWindowsExecutableIdentity = async (root) => {
  const executablePath = path.join(root, 'DSH Desktop.exe');
  const info = await fsp.lstat(executablePath).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size <= 0) {
    return { ok: false, present: false, error: 'DSH Desktop.exe is missing or unsafe.' };
  }
  const scriptPath = path.resolve(__dirname, 'verify-windows-version-info.ps1');
  try {
    const result = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      '-ExecutablePath', executablePath,
      '-ExpectedVersion', REQUIRED_DESKTOP_VERSION
    ], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
    return { ...(parseVersionInfoReport(result.stdout) || {}), ok: true, present: true };
  } catch (error) {
    const report = parseVersionInfoReport(error?.stdout);
    return { ...(report || {}), ok: false, present: true, error: report ? 'Executable identity did not match.' : (error?.message || String(error)) };
  }
};

const inspectPackageLayout = async (rootPath) => {
  const root = path.resolve(rootPath);
  const redundantRoots = [
    normalize(path.join('resources', 'app.asar.unpacked', 'node_modules', 'node-pty')),
    normalize(path.join('resources', 'app.asar.unpacked', 'node_modules', 'node-addon-api'))
  ];
  const terminalPrefix = normalize(path.join('resources', 'terminal', 'node_modules', 'node-pty'));
  const pnpmPrefix = normalize(path.join('resources', 'pnpm'));
  const wordSkillPrefix = normalize(path.join('resources', 'skills', 'word-docx'));
  const excelSkillPrefix = normalize(path.join('resources', 'skills', 'excel-xlsx'));
  const powerpointSkillPrefix = normalize(path.join('resources', 'skills', 'powerpoint-pptx'));
  const bundledSkillsPrefix = normalize(path.join('resources', 'skills'));
  const harnessPrefix = normalize(path.join('resources', 'harness'));
  const legalPrefix = normalize(path.join('resources', 'legal'));
  const queue = [root];
  let seen = 0;
  let reparsePoints = 0;
  const redundantAppRuntime = { files: 0, bytes: 0 };
  const terminalRuntime = { files: 0, bytes: 0, foreignPlatformFiles: 0, pdbFiles: 0 };
  const terminalPaths = new Set();
  const pnpmRuntime = { files: 0, bytes: 0, version: '', wrapperValid: false };
  const pnpmPaths = new Set();
  const wordSkillRuntime = { files: 0, bytes: 0 };
  const wordSkillPaths = new Set();
  const excelSkillRuntime = { files: 0, bytes: 0 };
  const excelSkillPaths = new Set();
  const powerpointSkillRuntime = { files: 0, bytes: 0 };
  const powerpointSkillPaths = new Set();
  const wikiSkillRuntime = { files: 0, bytes: 0 };
  const wikiSkillPaths = new Set();
  const legalPaths = new Set();
  const legalSha256 = {};
  const harnessRuntime = {
    files: 0,
    bytes: 0,
    version: '',
    repository: '',
    tag: '',
    packageCount: 0,
    packageInventorySha256: '',
    provenancePackageInventorySha256: '',
    commit: '',
    provenanceVersion: 0,
    buildNode: '',
    buildPnpm: '',
    dependencyResolution: '',
    packagePayload: '',
    installScripts: [],
    runtimePayload: null,
    actualRuntimePayload: null,
    dshPackageCount: 0,
    vendorPackageCount: 0,
    vendorPackagesMissing: [],
    auxiliaryPackageCount: 0,
    auxiliaryPackagesMissing: [],
    unexpectedDeepSeekPackages: [],
    mismatchedPackages: []
  };
  const harnessProcessHost = { present: false, bytes: 0, sha256: '', expectedSha256: '' };
  const terminalProcessHost = { present: false, bytes: 0, sha256: '', expectedSha256: '' };
  const nodeRuntime = { present: false, bytes: 0, sha256: '', expectedSha256: '' };
  const harnessVendorPackages = new Set();
  const harnessAuxiliaryPackages = new Set();
  const harnessReleasePackages = [];
  while (queue.length > 0) {
    const directory = queue.shift();
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      seen += 1;
      if (seen > MAX_PACKAGE_FILES) throw new Error(`Package governance exceeded ${MAX_PACKAGE_FILES} entries.`);
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        reparsePoints += 1;
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await fsp.lstat(target);
      const relative = normalize(path.relative(root, target));
      if (redundantRoots.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`))) {
        redundantAppRuntime.files += 1;
        redundantAppRuntime.bytes += info.size;
      }
      if (relative === terminalPrefix || relative.startsWith(`${terminalPrefix}/`)) {
        const terminalRelative = relative.slice(terminalPrefix.length + 1);
        terminalPaths.add(terminalRelative);
        terminalRuntime.files += 1;
        terminalRuntime.bytes += info.size;
        if (/^prebuilds\/(?!win32-x64(?:\/|$))/i.test(terminalRelative) || /^third_party\//i.test(terminalRelative)) terminalRuntime.foreignPlatformFiles += 1;
        if (/\.pdb$/i.test(terminalRelative)) terminalRuntime.pdbFiles += 1;
      }
      if (relative === pnpmPrefix || relative.startsWith(`${pnpmPrefix}/`)) {
        const pnpmRelative = relative.slice(pnpmPrefix.length + 1);
        pnpmPaths.add(pnpmRelative);
        pnpmRuntime.files += 1;
        pnpmRuntime.bytes += info.size;
      }
      if (relative === wordSkillPrefix || relative.startsWith(`${wordSkillPrefix}/`)) {
        const wordRelative = relative.slice(wordSkillPrefix.length + 1);
        wordSkillPaths.add(wordRelative);
        wordSkillRuntime.files += 1;
        wordSkillRuntime.bytes += info.size;
      }
      if (relative === excelSkillPrefix || relative.startsWith(`${excelSkillPrefix}/`)) {
        const excelRelative = relative.slice(excelSkillPrefix.length + 1);
        excelSkillPaths.add(excelRelative);
        excelSkillRuntime.files += 1;
        excelSkillRuntime.bytes += info.size;
      }
      if (relative === powerpointSkillPrefix || relative.startsWith(`${powerpointSkillPrefix}/`)) {
        const powerpointRelative = relative.slice(powerpointSkillPrefix.length + 1);
        powerpointSkillPaths.add(powerpointRelative);
        powerpointSkillRuntime.files += 1;
        powerpointSkillRuntime.bytes += info.size;
      }
      if (relative.startsWith(`${bundledSkillsPrefix}/`)) {
        const skillRelative = relative.slice(bundledSkillsPrefix.length + 1);
        const skillId = skillRelative.split('/')[0];
        if (WIKI_SKILL_IDS.has(skillId)) {
          wikiSkillPaths.add(skillRelative);
          wikiSkillRuntime.files += 1;
          wikiSkillRuntime.bytes += info.size;
        }
      }
      if (relative === harnessPrefix || relative.startsWith(`${harnessPrefix}/`)) {
        harnessRuntime.files += 1;
        harnessRuntime.bytes += info.size;
      }
      if (relative === HARNESS_PROCESS_HOST_RELATIVE) {
        harnessProcessHost.present = true;
        harnessProcessHost.bytes = info.size;
        harnessProcessHost.sha256 = createHash('sha256').update(await fsp.readFile(target)).digest('hex');
      }
      if (relative === TERMINAL_PROCESS_HOST_RELATIVE) {
        terminalProcessHost.present = true;
        terminalProcessHost.bytes = info.size;
        terminalProcessHost.sha256 = createHash('sha256').update(await fsp.readFile(target)).digest('hex');
      }
      if (relative === NODE_RUNTIME_RELATIVE) {
        nodeRuntime.present = true;
        nodeRuntime.bytes = info.size;
        nodeRuntime.sha256 = createHash('sha256').update(await fsp.readFile(target)).digest('hex');
      }
      if (relative.startsWith(`${legalPrefix}/`)) {
        const legalRelative = relative.slice(legalPrefix.length + 1);
        legalPaths.add(legalRelative);
        if (REQUIRED_LEGAL_SHA256.has(legalRelative)) {
          legalSha256[legalRelative] = createHash('sha256').update(await fsp.readFile(target)).digest('hex');
        }
      }
      const harnessPackageMatch = relative.match(/^resources\/harness\/node_modules\/@deepseek-ai\/([^/]+)\/package\.json$/);
      if (harnessPackageMatch) {
        const expectedName = `@deepseek-ai/${harnessPackageMatch[1]}`;
        try {
          const manifest = JSON.parse(await fsp.readFile(target, 'utf8'));
          if (manifest.name !== expectedName) {
            harnessRuntime.mismatchedPackages.push(`${expectedName}@invalid-name`);
          } else if (manifest.name === '@deepseek-ai/dsh' || manifest.name.startsWith('@deepseek-ai/dsh-')) {
            harnessRuntime.dshPackageCount += 1;
            harnessReleasePackages.push(`${manifest.name}@${manifest.version || 'missing'}`);
            if (manifest.version !== REQUIRED_HARNESS_VERSION) harnessRuntime.mismatchedPackages.push(`${manifest.name}@${manifest.version || 'missing'}`);
          } else if (REQUIRED_HARNESS_VENDOR_PACKAGES.has(manifest.name)) {
            harnessRuntime.vendorPackageCount += 1;
            harnessVendorPackages.add(manifest.name);
            harnessReleasePackages.push(`${manifest.name}@${manifest.version || 'missing'}`);
          } else if (REQUIRED_HARNESS_AUXILIARY_PACKAGES.has(manifest.name)) {
            harnessRuntime.auxiliaryPackageCount += 1;
            harnessAuxiliaryPackages.add(manifest.name);
            if (manifest.version !== REQUIRED_HARNESS_AUXILIARY_PACKAGES.get(manifest.name)) {
              harnessRuntime.mismatchedPackages.push(`${manifest.name}@${manifest.version || 'missing'}`);
            }
          } else {
            harnessRuntime.unexpectedDeepSeekPackages.push(`${manifest.name}@${manifest.version || 'missing'}`);
          }
        } catch {
          harnessRuntime.mismatchedPackages.push(`${expectedName}@invalid-manifest`);
        }
      }
    }
  }
  const pnpmManifestPath = path.join(root, 'resources', 'pnpm', 'package', 'package.json');
  try {
    harnessProcessHost.expectedSha256 = createHash('sha256')
      .update(await fsp.readFile(path.resolve(__dirname, '..', 'electron', 'harness-process-host.cjs')))
      .digest('hex');
  } catch {
    harnessProcessHost.expectedSha256 = '';
  }
  try {
    terminalProcessHost.expectedSha256 = createHash('sha256')
      .update(await fsp.readFile(path.resolve(__dirname, '..', 'electron', 'terminal-pty-host.cjs')))
      .digest('hex');
  } catch {
    terminalProcessHost.expectedSha256 = '';
  }
  try {
    nodeRuntime.expectedSha256 = createHash('sha256')
      .update(await fsp.readFile(path.resolve(__dirname, '..', 'vendor', 'runtime', 'win32-x64', 'node.exe')))
      .digest('hex');
  } catch {
    nodeRuntime.expectedSha256 = '';
  }
  const packagedApp = { name: '', version: '' };
  try {
    const packagedManifestBytes = extractFile(path.join(root, 'resources', 'app.asar'), 'package.json');
    if (packagedManifestBytes.length === 0 || packagedManifestBytes.length > 1024 * 1024) throw new Error('Packaged manifest size is invalid.');
    const packagedManifest = JSON.parse(packagedManifestBytes.toString('utf8'));
    packagedApp.name = typeof packagedManifest.name === 'string' ? packagedManifest.name : '';
    packagedApp.version = typeof packagedManifest.version === 'string' ? packagedManifest.version : '';
  } catch {
    packagedApp.name = '';
    packagedApp.version = '';
  }
  if (pnpmPaths.has('package/package.json')) {
    try {
      const manifest = JSON.parse(await fsp.readFile(pnpmManifestPath, 'utf8'));
      if (manifest.name === 'pnpm' && typeof manifest.version === 'string') pnpmRuntime.version = manifest.version;
    } catch {
      pnpmRuntime.version = '';
    }
  }
  if (pnpmPaths.has('pnpm.cmd')) {
    const wrapper = await fsp.readFile(path.join(root, 'resources', 'pnpm', 'pnpm.cmd'), 'utf8');
    pnpmRuntime.wrapperValid = /\.\.\\runtime\\node\.exe/i.test(wrapper)
      && /package\\bin\\pnpm\.mjs/i.test(wrapper)
      && !/\b(?:curl|powershell|cmd\s+\/c|npm|npx)\b/i.test(wrapper);
  }
  try {
    const dshManifest = JSON.parse(await fsp.readFile(path.join(root, 'resources', 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'));
    if (dshManifest.name === '@deepseek-ai/dsh' && typeof dshManifest.version === 'string') harnessRuntime.version = dshManifest.version;
    const provenance = JSON.parse(await fsp.readFile(path.join(root, 'resources', 'harness', 'harness-runtime.json'), 'utf8'));
    harnessRuntime.repository = typeof provenance?.harness?.repository === 'string' ? provenance.harness.repository : '';
    harnessRuntime.tag = typeof provenance?.harness?.tag === 'string' ? provenance.harness.tag : '';
    harnessRuntime.packageCount = Number.isSafeInteger(provenance?.build?.packageCount) ? provenance.build.packageCount : 0;
    harnessRuntime.provenancePackageInventorySha256 = typeof provenance?.build?.packageInventorySha256 === 'string'
      ? provenance.build.packageInventorySha256
      : '';
    harnessRuntime.commit = typeof provenance?.harness?.commit === 'string' ? provenance.harness.commit : '';
    harnessRuntime.provenanceVersion = Number.isSafeInteger(provenance?.version) ? provenance.version : 0;
    harnessRuntime.buildNode = typeof provenance?.build?.node === 'string' ? provenance.build.node : '';
    harnessRuntime.buildPnpm = typeof provenance?.build?.pnpm === 'string' ? provenance.build.pnpm : '';
    harnessRuntime.dependencyResolution = typeof provenance?.build?.dependencyResolution === 'string' ? provenance.build.dependencyResolution : '';
    harnessRuntime.packagePayload = typeof provenance?.build?.packagePayload === 'string' ? provenance.build.packagePayload : '';
    harnessRuntime.installScripts = Array.isArray(provenance?.build?.installScripts)
      ? provenance.build.installScripts.filter((value) => typeof value === 'string')
      : [];
    harnessRuntime.runtimePayload = provenance?.build?.runtimePayload && typeof provenance.build.runtimePayload === 'object'
      ? provenance.build.runtimePayload
      : null;
    if (provenance?.harness?.name !== '@deepseek-ai/dsh' || provenance?.harness?.version !== harnessRuntime.version) {
      harnessRuntime.version = '';
    }
  } catch {
    harnessRuntime.version = '';
  }
  harnessRuntime.vendorPackagesMissing = [...REQUIRED_HARNESS_VENDOR_PACKAGES]
    .filter((name) => !harnessVendorPackages.has(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  harnessRuntime.auxiliaryPackagesMissing = [...REQUIRED_HARNESS_AUXILIARY_PACKAGES.keys()]
    .filter((name) => !harnessAuxiliaryPackages.has(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  harnessRuntime.mismatchedPackages.sort((left, right) => left.localeCompare(right, 'en'));
  harnessRuntime.unexpectedDeepSeekPackages.sort((left, right) => left.localeCompare(right, 'en'));
  harnessRuntime.packageInventorySha256 = createHash('sha256')
    .update(`${harnessReleasePackages.sort((left, right) => left.localeCompare(right, 'en')).join('\n')}\n`)
    .digest('hex');
  try {
    harnessRuntime.actualRuntimePayload = inspectHarnessRuntimePayload(path.join(root, 'resources', 'harness', 'node_modules'));
  } catch {
    harnessRuntime.actualRuntimePayload = null;
  }
  const requiredHarnessRuntimeReady = harnessRuntime.version === REQUIRED_HARNESS_VERSION
    && harnessRuntime.repository === REQUIRED_HARNESS_REPOSITORY
    && harnessRuntime.tag === REQUIRED_HARNESS_TAG
    && harnessRuntime.commit === REQUIRED_HARNESS_COMMIT
    && harnessRuntime.packageCount === REQUIRED_HARNESS_PACKAGE_COUNT
    && harnessRuntime.packageInventorySha256 === REQUIRED_HARNESS_PACKAGE_INVENTORY_SHA256
    && harnessRuntime.provenancePackageInventorySha256 === REQUIRED_HARNESS_PACKAGE_INVENTORY_SHA256
    && harnessRuntime.provenanceVersion === 1
    && harnessRuntime.buildNode === REQUIRED_HARNESS_BUILD_NODE
    && harnessRuntime.buildPnpm === REQUIRED_HARNESS_BUILD_PNPM
    && harnessRuntime.dependencyResolution === REQUIRED_HARNESS_DEPENDENCY_RESOLUTION
    && harnessRuntime.packagePayload === REQUIRED_HARNESS_PACKAGE_PAYLOAD
    && JSON.stringify(harnessRuntime.installScripts) === JSON.stringify(REQUIRED_HARNESS_INSTALL_SCRIPTS)
    && harnessRuntime.dshPackageCount === REQUIRED_HARNESS_DSH_PACKAGE_COUNT
    && harnessRuntime.vendorPackageCount === REQUIRED_HARNESS_VENDOR_PACKAGES.size
    && harnessRuntime.vendorPackagesMissing.length === 0
    && harnessRuntime.auxiliaryPackageCount === REQUIRED_HARNESS_AUXILIARY_PACKAGES.size
    && harnessRuntime.auxiliaryPackagesMissing.length === 0
    && harnessRuntime.unexpectedDeepSeekPackages.length === 0
    && JSON.stringify(harnessRuntime.runtimePayload) === JSON.stringify(harnessRuntime.actualRuntimePayload)
    && harnessRuntime.mismatchedPackages.length === 0;
  const requiredDesktopPlugins = ['dsh-desktop-shell-env/index.mjs', 'dsh-desktop-shell-env/package.json',
    'dsh-desktop-credentials/index.mjs', 'dsh-desktop-credentials/package.json',
    'dsh-desktop-tools/index.mjs', 'dsh-desktop-tools/session-control.mjs', 'dsh-desktop-tools/package.json'];
  const desktopPluginsMissing = [];
  for (const relative of requiredDesktopPlugins) {
    const info = await fsp.lstat(path.join(root, 'resources', 'harness-plugins', relative)).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink()) desktopPluginsMissing.push(relative);
  }
  const executableIdentity = await inspectWindowsExecutableIdentity(root);
  return {
    packagedApp,
    executableIdentity,
    requiredPackagedAppReady: packagedApp.name === REQUIRED_DESKTOP_NAME && packagedApp.version === REQUIRED_DESKTOP_VERSION,
    requiredExecutableIdentityReady: executableIdentity.ok === true,
    requiredDesktopPluginsReady: desktopPluginsMissing.length === 0,
    desktopPluginsMissing,
    harnessProcessHost,
    requiredHarnessProcessHostReady: harnessProcessHost.present
      && harnessProcessHost.bytes > 0
      && harnessProcessHost.sha256 === harnessProcessHost.expectedSha256,
    terminalProcessHost,
    requiredTerminalProcessHostReady: terminalProcessHost.present
      && terminalProcessHost.bytes > 0
      && terminalProcessHost.sha256 === terminalProcessHost.expectedSha256,
    nodeRuntime,
    requiredNodeRuntimeReady: nodeRuntime.present
      && nodeRuntime.bytes > 0
      && nodeRuntime.sha256 === nodeRuntime.expectedSha256,
    redundantAppRuntime,
    terminalRuntime,
    requiredTerminalFilesReady: REQUIRED_TERMINAL_FILES.every((name) => terminalPaths.has(name)),
    pnpmRuntime,
    requiredPnpmFilesReady: REQUIRED_PNPM_FILES.every((name) => pnpmPaths.has(name)),
    requiredPnpmVersionReady: pnpmRuntime.version === REQUIRED_PNPM_VERSION,
    wordSkillRuntime,
    requiredWordSkillFilesReady: REQUIRED_WORD_SKILL_FILES.every((name) => wordSkillPaths.has(name)),
    excelSkillRuntime,
    requiredExcelSkillFilesReady: REQUIRED_EXCEL_SKILL_FILES.every((name) => excelSkillPaths.has(name)),
    powerpointSkillRuntime,
    requiredPowerpointSkillFilesReady: REQUIRED_POWERPOINT_SKILL_FILES.every((name) => powerpointSkillPaths.has(name)),
    wikiSkillRuntime,
    requiredWikiSkillFilesReady: REQUIRED_WIKI_SKILL_FILES.every((name) => wikiSkillPaths.has(name)),
    legalSha256,
    requiredLegalNoticesReady: REQUIRED_LEGAL_FILES.every((name) => (
      legalPaths.has(name) && legalSha256[name] === REQUIRED_LEGAL_SHA256.get(name)
    )),
    harnessRuntime,
    requiredHarnessRuntimeReady,
    reparsePoints
  };
};

const readArgument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

const main = async () => {
  const previousBlockmapPath = readArgument('previous-blockmap');
  const currentBlockmapPath = readArgument('current-blockmap');
  const installerPath = readArgument('installer');
  const unpackedRoot = readArgument('unpacked-root');
  const outputPath = readArgument('output');
  if (!previousBlockmapPath || !currentBlockmapPath || !installerPath || !unpackedRoot || !outputPath) {
    throw new Error('Usage: node scripts/release-governance.cjs --previous-blockmap=<file> --current-blockmap=<file> --installer=<exe> --unpacked-root=<dir> --output=<json>');
  }
  const [previousBuffer, currentBuffer, signature, packageLayout] = await Promise.all([
    fsp.readFile(path.resolve(previousBlockmapPath)),
    fsp.readFile(path.resolve(currentBlockmapPath)),
    inspectPeFile(path.resolve(installerPath)),
    inspectPackageLayout(path.resolve(unpackedRoot))
  ]);
  const differential = compareBlockmaps(decodeBlockmap(previousBuffer), decodeBlockmap(currentBuffer));
  if (differential.currentBytes !== signature.bytes) throw new Error('Current blockmap size does not match the installer.');
  const manifest = JSON.parse(await fsp.readFile(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const verifyUpdateCodeSignature = manifest.build?.win?.verifyUpdateCodeSignature === true;
  const updateReadiness = assessAutomaticUpdate({
    signatureStatus: signature.status,
    verifyUpdateCodeSignature
  });
  const packageReady = packageLayout.redundantAppRuntime.files === 0
    && packageLayout.requiredPackagedAppReady
    && packageLayout.requiredExecutableIdentityReady
    && packageLayout.terminalRuntime.foreignPlatformFiles === 0
    && packageLayout.terminalRuntime.pdbFiles === 0
    && packageLayout.requiredTerminalFilesReady
    && packageLayout.requiredTerminalProcessHostReady
    && packageLayout.requiredNodeRuntimeReady
    && packageLayout.requiredPnpmFilesReady
    && packageLayout.requiredPnpmVersionReady
    && packageLayout.pnpmRuntime.wrapperValid
    && packageLayout.requiredWordSkillFilesReady
    && packageLayout.requiredExcelSkillFilesReady
    && packageLayout.requiredPowerpointSkillFilesReady
    && packageLayout.requiredWikiSkillFilesReady
    && packageLayout.requiredLegalNoticesReady
    && packageLayout.requiredHarnessRuntimeReady
    && packageLayout.requiredHarnessProcessHostReady
    && packageLayout.requiredDesktopPluginsReady
    && packageLayout.reparsePoints === 0;
  const report = {
    version: 1,
    packageVersion: manifest.version,
    packageReady,
    packageLayout,
    differential: {
      ...differential,
      eligible: differential.reuseRatio >= 0.8
    },
    signature: {
      ...signature,
      verifyUpdateCodeSignature,
      ...updateReadiness
    }
  };
  await fsp.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fsp.writeFile(path.resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!packageReady) process.exitCode = 1;
};

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_BLOCKMAP_CHUNKS,
  MAX_BLOCKMAP_COMPRESSED_BYTES,
  MAX_BLOCKMAP_RAW_BYTES,
  MAX_PACKAGE_FILES,
  NODE_RUNTIME_RELATIVE,
  REQUIRED_PNPM_FILES,
  REQUIRED_PNPM_VERSION,
  REQUIRED_DESKTOP_VERSION,
  REQUIRED_HARNESS_COMMIT,
  REQUIRED_HARNESS_BUILD_NODE,
  REQUIRED_HARNESS_BUILD_PNPM,
  REQUIRED_HARNESS_DSH_PACKAGE_COUNT,
  REQUIRED_HARNESS_INSTALL_SCRIPTS,
  REQUIRED_HARNESS_PACKAGE_COUNT,
  REQUIRED_HARNESS_PACKAGE_INVENTORY_SHA256,
  REQUIRED_HARNESS_VERSION,
  REQUIRED_TERMINAL_FILES,
  TERMINAL_PROCESS_HOST_RELATIVE,
  REQUIRED_WIKI_SKILL_FILES,
  REQUIRED_EXCEL_SKILL_FILES,
  REQUIRED_WORD_SKILL_FILES,
  assessAutomaticUpdate,
  compareBlockmaps,
  decodeBlockmap,
  inspectPackageLayout,
  inspectWindowsExecutableIdentity,
  parsePeCertificateTable,
  validateBlockmap
};
