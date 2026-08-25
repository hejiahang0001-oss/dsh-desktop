const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

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

const normalize = (value) => value.replaceAll('\\', '/');

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

const inspectPackageLayout = async (rootPath) => {
  const root = path.resolve(rootPath);
  const redundantRoots = [
    normalize(path.join('resources', 'app.asar.unpacked', 'node_modules', 'node-pty')),
    normalize(path.join('resources', 'app.asar.unpacked', 'node_modules', 'node-addon-api'))
  ];
  const terminalPrefix = normalize(path.join('resources', 'terminal', 'node_modules', 'node-pty'));
  const queue = [root];
  let seen = 0;
  let reparsePoints = 0;
  const redundantAppRuntime = { files: 0, bytes: 0 };
  const terminalRuntime = { files: 0, bytes: 0, foreignPlatformFiles: 0, pdbFiles: 0 };
  const terminalPaths = new Set();
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
    }
  }
  return {
    redundantAppRuntime,
    terminalRuntime,
    requiredTerminalFilesReady: REQUIRED_TERMINAL_FILES.every((name) => terminalPaths.has(name)),
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
    && packageLayout.terminalRuntime.foreignPlatformFiles === 0
    && packageLayout.terminalRuntime.pdbFiles === 0
    && packageLayout.requiredTerminalFilesReady
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
  REQUIRED_TERMINAL_FILES,
  assessAutomaticUpdate,
  compareBlockmaps,
  decodeBlockmap,
  inspectPackageLayout,
  parsePeCertificateTable,
  validateBlockmap
};
