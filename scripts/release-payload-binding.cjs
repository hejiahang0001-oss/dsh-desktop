const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { path7za } = require('7zip-bin');
const sevenZipManifest = require('7zip-bin/package.json');

const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ARCHIVE_LISTING_BYTES = 32 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PAYLOAD_FILES = 100_000;
const MAX_STDERR_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 300_000;
const TREE_HASH_CONCURRENCY = 8;
const TEMP_DIRECTORY_PREFIX = 'dsh-release-payload-';
const FIXED_7ZIP = Object.freeze({
  version: '5.2.0',
  bytes: 1_231_360,
  sha256: 'b0cfdeaf429f5cc53f85123dd8f5a5feb92c19d31aa34df257edf9a26be05f95'
});
const DEFAULT_MEMBERS = Object.freeze([
  Object.freeze({
    path: 'resources/app.asar',
    maxBytes: 64 * 1024 * 1024
  }),
  Object.freeze({
    path: 'resources/skills/llm-wiki/scripts/wiki-basic.cjs',
    maxBytes: 4 * 1024 * 1024
  })
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const normalizedPathKey = (value) => path.resolve(value).replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase();

const normalizePayloadRelative = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/').normalize('NFC').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/iu.test(normalized)
    || normalized.split('/').some((part) => !part || part === '.' || part === '..'
      || /[<>:"|?*\u0000-\u001f]/u.test(part) || /[. ]$/u.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    const error = new Error('Release archive contains an unsafe payload path.');
    error.code = 'unsafe-release-payload-path';
    throw error;
  }
  return normalized;
};

const mapLimit = async (items, limit, operation) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const treeDigest = (records) => {
  const digest = createHash('sha256');
  for (const record of [...records].sort((left, right) => left.path.localeCompare(right.path, 'en'))) {
    digest.update(record.path).update('\0').update(String(record.bytes)).update('\0').update(record.sha256).update('\n');
  }
  return digest.digest('hex');
};

const inspectPlainFile = async (target, maxBytes, { allowEmpty = false } = {}) => {
  const resolved = path.resolve(target);
  const info = await fsp.lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink() || (!allowEmpty && info.size < 1) || info.size > maxBytes) {
    const error = new Error('Release payload input is not a bounded regular file.');
    error.code = 'unsafe-release-payload-file';
    throw error;
  }
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(resolved)) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      const error = new Error('Release payload input exceeded its read bound.');
      error.code = 'release-payload-too-large';
      throw error;
    }
    digest.update(chunk);
  }
  if (bytes !== info.size) {
    const error = new Error('Release payload input changed while it was read.');
    error.code = 'release-payload-changed';
    throw error;
  }
  return Object.freeze({ bytes, sha256: digest.digest('hex') });
};

const inspectPeHeader = async (target) => {
  const handle = await fsp.open(path.resolve(target), 'r');
  try {
    const info = await handle.stat();
    const header = Buffer.alloc(Math.min(info.size, 4096));
    await handle.read(header, 0, header.length, 0);
    if (header.length < 256 || header.readUInt16LE(0) !== 0x5a4d) return false;
    const peOffset = header.readUInt32LE(0x3c);
    if (peOffset < 64 || peOffset + 26 > header.length || header.readUInt32LE(peOffset) !== 0x00004550) return false;
    const optionalMagic = header.readUInt16LE(peOffset + 24);
    return optionalMagic === 0x20b || optionalMagic === 0x10b;
  } finally {
    await handle.close();
  }
};

const inspectArchiveFile = async (target) => {
  const resolved = path.resolve(target);
  const [content, canonical, identity, looksLikePe] = await Promise.all([
    inspectPlainFile(resolved, MAX_ARCHIVE_BYTES),
    fsp.realpath(resolved),
    fsp.lstat(resolved, { bigint: true }),
    inspectPeHeader(resolved)
  ]);
  return Object.freeze({
    name: path.basename(resolved),
    ...content,
    looksLikePe,
    canonicalKey: normalizedPathKey(canonical),
    identity: `${identity.dev}:${identity.ino}`
  });
};

const assertFixedSevenZip = async (candidate = path7za) => {
  if (process.platform !== 'win32' || process.arch !== 'x64' || sevenZipManifest.version !== FIXED_7ZIP.version) {
    const error = new Error('Release payload verification requires the pinned Windows x64 7-Zip runtime.');
    error.code = 'unsupported-release-extractor-platform';
    throw error;
  }
  const packageRoot = path.dirname(require.resolve('7zip-bin/package.json'));
  const expected = path.join(packageRoot, 'win', 'x64', '7za.exe');
  const resolved = path.resolve(candidate);
  if (normalizedPathKey(resolved) !== normalizedPathKey(expected)) {
    const error = new Error('Release payload verification refuses an unpinned 7-Zip executable.');
    error.code = 'unexpected-release-extractor';
    throw error;
  }
  const evidence = await inspectPlainFile(resolved, 2 * 1024 * 1024);
  if (evidence.bytes !== FIXED_7ZIP.bytes || evidence.sha256 !== FIXED_7ZIP.sha256) {
    const error = new Error('The pinned 7-Zip extractor failed its content identity check.');
    error.code = 'release-extractor-identity-mismatch';
    throw error;
  }
  return resolved;
};

const runSevenZip = async (sevenZipPath, args, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxStdoutBytes = 1024 * 1024
} = {}) => {
  const tool = await assertFixedSevenZip(sevenZipPath);
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    let pendingError = null;
    const finish = (method, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      method(value);
    };
    const rememberFailure = (code, message) => {
      if (settled || pendingError) return;
      pendingError = new Error(message);
      pendingError.code = code;
      try { child.kill(); } catch { /* The extractor may already have exited. */ }
    };
    const timer = setTimeout(() => rememberFailure('release-extraction-timeout', 'Release archive inspection timed out.'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (pendingError) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) {
        rememberFailure('release-extractor-stdout-overflow', 'Release extractor stdout exceeded its bound.');
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      if (pendingError) return;
      stderr += chunk.toString('utf8');
      if (Buffer.byteLength(stderr, 'utf8') > MAX_STDERR_BYTES) {
        rememberFailure('release-extractor-stderr-overflow', 'Release extractor stderr exceeded its bound.');
      }
    });
    child.once('error', (error) => rememberFailure('release-extractor-launch-failed', error.message));
    child.once('close', (code, signal) => {
      if (settled) return;
      if (pendingError) {
        finish(reject, pendingError);
        return;
      }
      if (code !== 0 || signal !== null) {
        const error = new Error(`Release extractor exited ${code ?? signal}.`);
        error.code = 'release-archive-extraction-failed';
        finish(reject, error);
        return;
      }
      if (stderr.trim()) {
        const error = new Error('Release extractor emitted unexpected stderr.');
        error.code = 'release-extractor-warning';
        finish(reject, error);
        return;
      }
      finish(resolve, Buffer.concat(stdout, stdoutBytes));
    });
  });
};

const parseArchiveListing = (bytes) => {
  const records = [];
  const seen = new Set();
  let totalBytes = 0;
  for (const block of bytes.toString('utf8').split(/\r?\n\r?\n/u)) {
    if (!block.trim()) continue;
    const fields = {};
    for (const line of block.split(/\r?\n/u)) {
      const separator = line.indexOf(' = ');
      if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 3);
    }
    if (!fields.Path) continue;
    const relative = normalizePayloadRelative(fields.Path);
    const key = relative.toLocaleLowerCase();
    if (seen.has(key)) {
      const error = new Error('Release archive contains duplicate equivalent payload paths.');
      error.code = 'duplicate-release-payload-path';
      throw error;
    }
    seen.add(key);
    if (fields.Encrypted === '+') {
      const error = new Error('Release archive contains an encrypted payload entry.');
      error.code = 'encrypted-release-payload';
      throw error;
    }
    if (/D/u.test(fields.Attributes || '')) continue;
    const size = Number(fields.Size);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_BYTES) {
      const error = new Error('Release archive contains an invalid payload size.');
      error.code = 'invalid-release-payload-size';
      throw error;
    }
    totalBytes += size;
    records.push(Object.freeze({ path: relative, bytes: size }));
    if (records.length > MAX_PAYLOAD_FILES || totalBytes > MAX_PAYLOAD_BYTES) {
      const error = new Error('Release archive payload exceeds its extraction bound.');
      error.code = 'release-payload-too-large';
      throw error;
    }
  }
  if (records.length < 1) {
    const error = new Error('Release archive payload listing is empty.');
    error.code = 'release-payload-empty';
    throw error;
  }
  return Object.freeze({ files: records.length, bytes: totalBytes, records: Object.freeze(records) });
};

const listArchivePayload = async (archivePath, { sevenZipPath = path7za, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const archive = path.resolve(archivePath);
  await inspectPlainFile(archive, MAX_ARCHIVE_BYTES);
  const stdout = await runSevenZip(sevenZipPath, ['l', '-ba', '-slt', '-sccUTF-8', '--', archive], {
    timeoutMs,
    maxStdoutBytes: MAX_ARCHIVE_LISTING_BYTES
  });
  return parseArchiveListing(stdout);
};

const hashPayloadTree = async (rootPath) => {
  const root = path.resolve(rootPath);
  const rootInfo = await fsp.lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    const error = new Error('Release payload root must be a plain directory.');
    error.code = 'unsafe-release-payload-root';
    throw error;
  }
  const files = [];
  let totalBytes = 0;
  const seen = new Set();
  const visit = async (directory, prefix = '') => {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const relative = normalizePayloadRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
      const key = relative.toLocaleLowerCase();
      if (seen.has(key)) {
        const error = new Error('Release payload tree contains duplicate equivalent paths.');
        error.code = 'duplicate-release-payload-path';
        throw error;
      }
      seen.add(key);
      const info = await fsp.lstat(target);
      if (info.isSymbolicLink()) {
        const error = new Error('Release payload tree contains a linked entry.');
        error.code = 'linked-release-payload-entry';
        throw error;
      }
      if (info.isDirectory()) {
        await visit(target, relative);
        continue;
      }
      if (!info.isFile() || info.size > MAX_ARCHIVE_BYTES) {
        const error = new Error('Release payload tree contains an unsupported entry.');
        error.code = 'unsafe-release-payload-entry';
        throw error;
      }
      totalBytes += info.size;
      files.push(Object.freeze({ path: relative, filePath: target, bytes: info.size }));
      if (files.length > MAX_PAYLOAD_FILES || totalBytes > MAX_PAYLOAD_BYTES) {
        const error = new Error('Release payload tree exceeds its inspection bound.');
        error.code = 'release-payload-too-large';
        throw error;
      }
    }
  };
  await visit(root);
  const records = await mapLimit(files, TREE_HASH_CONCURRENCY, async (file) => Object.freeze({
    path: file.path,
    ...(await inspectPlainFile(file.filePath, MAX_ARCHIVE_BYTES, { allowEmpty: true }))
  }));
  return Object.freeze({
    files: records.length,
    bytes: records.reduce((sum, record) => sum + record.bytes, 0),
    treeSha256: treeDigest(records),
    records: Object.freeze(records)
  });
};

const assertSafeTemporaryExtraction = (directory) => {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(directory);
  const relative = path.relative(tempRoot, resolved);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || !path.basename(resolved).startsWith(TEMP_DIRECTORY_PREFIX)) {
    const error = new Error('Release extraction directory escaped the temporary root.');
    error.code = 'unsafe-release-extraction-directory';
    throw error;
  }
};

const inspectArchivePayload = async (archivePath, {
  sevenZipPath = path7za,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) => {
  const archive = path.resolve(archivePath);
  const listing = await listArchivePayload(archive, { sevenZipPath, timeoutMs });
  const extractionRoot = await fsp.mkdtemp(path.join(path.resolve(os.tmpdir()), TEMP_DIRECTORY_PREFIX));
  assertSafeTemporaryExtraction(extractionRoot);
  try {
    await runSevenZip(sevenZipPath, ['x', '-y', '-bd', '-bb0', `-o${extractionRoot}`, '--', archive], {
      timeoutMs,
      maxStdoutBytes: 1024 * 1024
    });
    const tree = await hashPayloadTree(extractionRoot);
    if (tree.files !== listing.files || tree.bytes !== listing.bytes) {
      const error = new Error('Extracted release payload does not match its bounded archive listing.');
      error.code = 'release-payload-listing-mismatch';
      throw error;
    }
    return tree;
  } finally {
    assertSafeTemporaryExtraction(extractionRoot);
    await fsp.rm(extractionRoot, { recursive: true, force: true });
  }
};

const summarizeTreeComparison = (reference, candidate) => {
  const expected = new Map(reference.records.map((record) => [record.path, record]));
  const actual = new Map(candidate.records.map((record) => [record.path, record]));
  const missing = [...expected.keys()].filter((name) => !actual.has(name));
  const unexpected = [...actual.keys()].filter((name) => !expected.has(name));
  const mismatched = [...expected.entries()].filter(([name, record]) => {
    const other = actual.get(name);
    return other && (record.bytes !== other.bytes || record.sha256 !== other.sha256);
  }).map(([name]) => name);
  const matches = reference.files === candidate.files
    && reference.bytes === candidate.bytes
    && reference.treeSha256 === candidate.treeSha256
    && missing.length === 0
    && unexpected.length === 0
    && mismatched.length === 0;
  return Object.freeze({
    matches,
    files: candidate.files,
    bytes: candidate.bytes,
    treeSha256: candidate.treeSha256,
    missing: Object.freeze(missing.slice(0, 20)),
    unexpected: Object.freeze(unexpected.slice(0, 20)),
    mismatched: Object.freeze(mismatched.slice(0, 20))
  });
};

const extractArchiveMember = async (archivePath, memberPath, {
  maxBytes,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  sevenZipPath = path7za
} = {}) => {
  const archive = path.resolve(archivePath);
  await inspectPlainFile(archive, MAX_ARCHIVE_BYTES);
  const tool = await assertFixedSevenZip(sevenZipPath);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    const error = new Error('The release member bound is invalid.');
    error.code = 'invalid-release-member-bound';
    throw error;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(tool, ['e', '-so', '-bd', '-bb0', archive, memberPath], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const digest = createHash('sha256');
    let bytes = 0;
    let stderr = '';
    let settled = false;
    const finish = (method, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      method(value);
    };
    const fail = (code, message) => {
      try { child.kill(); } catch { /* The extractor may already have exited. */ }
      const error = new Error(message);
      error.code = code;
      finish(reject, error);
    };
    const timer = setTimeout(() => fail('release-extraction-timeout', 'Release member extraction timed out.'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail('release-member-too-large', 'Release member exceeded its extraction bound.');
        return;
      }
      digest.update(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (Buffer.byteLength(stderr, 'utf8') > MAX_STDERR_BYTES) {
        fail('release-extractor-stderr-overflow', 'Release extractor stderr exceeded its bound.');
      }
    });
    child.once('error', (error) => fail('release-extractor-launch-failed', error.message));
    child.once('close', (code, signal) => {
      if (settled) return;
      if (code !== 0 || signal !== null) {
        fail('release-member-extraction-failed', `Release member extraction exited ${code ?? signal}.`);
        return;
      }
      if (stderr.trim()) {
        fail('release-extractor-warning', 'Release extractor emitted unexpected stderr.');
        return;
      }
      if (bytes < 1) {
        fail('release-member-empty', 'Release member was missing or empty.');
        return;
      }
      finish(resolve, Object.freeze({ bytes, sha256: digest.digest('hex') }));
    });
  });
};

const failureRecord = (error) => Object.freeze({
  ok: false,
  code: typeof error?.code === 'string' ? error.code : 'release-member-inspection-failed'
});

const matchesDefaultMemberPolicy = (members) => Array.isArray(members)
  && members.length === DEFAULT_MEMBERS.length
  && members.every((member, index) => (
    member?.path?.replace(/\\/g, '/') === DEFAULT_MEMBERS[index].path
      && member?.maxBytes === DEFAULT_MEMBERS[index].maxBytes
  ));

const inspectReleasePayloadBinding = async ({
  installerPath,
  portablePath,
  unpackedRoot,
  expectedVersion,
  members = DEFAULT_MEMBERS,
  extractMember = extractArchiveMember,
  inspectArchiveTree = inspectArchivePayload,
  inspectArchive = inspectArchiveFile
} = {}) => {
  const installer = path.resolve(installerPath || '');
  const portable = path.resolve(portablePath || '');
  const unpacked = path.resolve(unpackedRoot || '');
  const expectedNames = {
    installer: `DSH-Desktop-Setup-${expectedVersion}.exe`,
    portable: `DSH-Desktop-Portable-${expectedVersion}.exe`
  };
  const archives = {};
  const archiveDetails = {};
  for (const [name, target] of [['installer', installer], ['portable', portable]]) {
    try {
      archiveDetails[name] = await inspectArchive(target);
      archives[name] = Object.freeze({
        ok: true,
        name: path.basename(target),
        bytes: archiveDetails[name].bytes,
        sha256: archiveDetails[name].sha256,
        looksLikePe: archiveDetails[name].looksLikePe === true
      });
    } catch (error) {
      archives[name] = Object.freeze({ name: path.basename(target), ...failureRecord(error) });
    }
  }
  const archiveIdentity = Object.freeze({
    namesValid: /^\d+\.\d+\.\d+$/u.test(expectedVersion || '')
      && archives.installer?.name === expectedNames.installer
      && archives.portable?.name === expectedNames.portable,
    canonicalPathsDistinct: Boolean(archiveDetails.installer && archiveDetails.portable
      && archiveDetails.installer.canonicalKey !== archiveDetails.portable.canonicalKey),
    fileIdentitiesDistinct: Boolean(archiveDetails.installer && archiveDetails.portable
      && archiveDetails.installer.identity !== archiveDetails.portable.identity),
    contentDistinct: Boolean(archiveDetails.installer && archiveDetails.portable
      && archiveDetails.installer.sha256 !== archiveDetails.portable.sha256),
    executablesValid: archiveDetails.installer?.looksLikePe === true
      && archiveDetails.portable?.looksLikePe === true
  });

  let referenceTree;
  let referenceTreeReport;
  try {
    referenceTree = await hashPayloadTree(unpacked);
    referenceTreeReport = Object.freeze({
      ok: true,
      files: referenceTree.files,
      bytes: referenceTree.bytes,
      treeSha256: referenceTree.treeSha256
    });
  } catch (error) {
    referenceTreeReport = failureRecord(error);
  }
  const payloadTrees = {};
  for (const [name, archive] of [['installer', installer], ['portable', portable]]) {
    try {
      const candidate = await inspectArchiveTree(archive);
      payloadTrees[name] = referenceTree
        ? Object.freeze({ ok: true, ...summarizeTreeComparison(referenceTree, candidate) })
        : Object.freeze({ ok: true, matches: false, files: candidate.files, bytes: candidate.bytes, treeSha256: candidate.treeSha256 });
    } catch (error) {
      payloadTrees[name] = failureRecord(error);
    }
  }

  const results = [];
  for (const member of members) {
    const normalized = typeof member?.path === 'string' ? member.path.replace(/\\/g, '/') : '';
    const maxBytes = Number(member?.maxBytes);
    const target = path.resolve(unpacked, ...normalized.split('/'));
    let reference;
    try {
      if (!normalized.startsWith('resources/') || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        const error = new Error('Release member policy is invalid.');
        error.code = 'invalid-release-member-policy';
        throw error;
      }
      if (path.relative(unpacked, target).startsWith('..') || path.isAbsolute(path.relative(unpacked, target))) {
        const error = new Error('Release member escaped the unpacked root.');
        error.code = 'release-member-path-escape';
        throw error;
      }
      reference = Object.freeze({ ok: true, ...(await inspectPlainFile(target, maxBytes)) });
    } catch (error) {
      reference = failureRecord(error);
    }
    const extracted = {};
    for (const [name, archive] of [['installer', installer], ['portable', portable]]) {
      try {
        extracted[name] = Object.freeze({ ok: true, ...(await extractMember(archive, normalized.replace(/\//g, '\\'), { maxBytes })) });
      } catch (error) {
        extracted[name] = failureRecord(error);
      }
    }
    const matches = reference.ok === true
      && extracted.installer.ok === true
      && extracted.portable.ok === true
      && extracted.installer.bytes === reference.bytes
      && extracted.installer.sha256 === reference.sha256
      && extracted.portable.bytes === reference.bytes
      && extracted.portable.sha256 === reference.sha256;
    results.push(Object.freeze({ path: normalized, maxBytes, reference, ...extracted, matches }));
  }
  const stability = {};
  for (const [name, target] of [['installer', installer], ['portable', portable]]) {
    try {
      const after = await inspectArchive(target);
      const before = archiveDetails[name];
      stability[name] = Object.freeze({
        ok: true,
        stable: Boolean(before
          && before.bytes === after.bytes
          && before.sha256 === after.sha256
          && before.canonicalKey === after.canonicalKey
          && before.identity === after.identity
          && before.looksLikePe === after.looksLikePe)
      });
    } catch (error) {
      stability[name] = failureRecord(error);
    }
  }
  try {
    const after = await hashPayloadTree(unpacked);
    stability.unpacked = Object.freeze({
      ok: true,
      stable: Boolean(referenceTree
        && referenceTree.files === after.files
        && referenceTree.bytes === after.bytes
        && referenceTree.treeSha256 === after.treeSha256)
    });
  } catch (error) {
    stability.unpacked = failureRecord(error);
  }
  const accepted = archives.installer?.ok === true
    && archives.portable?.ok === true
    && Object.values(archiveIdentity).every(Boolean)
    && referenceTreeReport.ok === true
    && payloadTrees.installer?.matches === true
    && payloadTrees.portable?.matches === true
    && matchesDefaultMemberPolicy(members)
    && results.every((entry) => entry.matches)
    && Object.values(stability).every((entry) => entry.ok === true && entry.stable === true);
  return Object.freeze({
    schemaVersion: 2,
    accepted,
    producer: Object.freeze({ package: '7zip-bin', version: sevenZipManifest.version }),
    archives: Object.freeze(archives),
    archiveIdentity,
    stability: Object.freeze(stability),
    payloadTrees: Object.freeze({ reference: referenceTreeReport, ...payloadTrees }),
    members: Object.freeze(results)
  });
};

module.exports = {
  DEFAULT_MEMBERS,
  MAX_ARCHIVE_BYTES,
  extractArchiveMember,
  hashPayloadTree,
  inspectArchivePayload,
  inspectPlainFile,
  inspectReleasePayloadBinding,
  listArchivePayload,
  matchesDefaultMemberPolicy,
  normalizePayloadRelative,
  parseArchiveListing,
  summarizeTreeComparison,
  sha256
};
