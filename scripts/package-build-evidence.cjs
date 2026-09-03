'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { extractFile, listPackage } = require('@electron/asar');
const { inspectWindowsExecutableIdentity } = require('./release-governance.cjs');

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_TREE_FILES = 250_000;
const HASH_CONCURRENCY = 12;
const DEFAULT_IGNORED_RESOURCE_NAMES = new Set(['.DS_Store', '.gitkeep']);
const DEFAULT_GENERATED_RESOURCE_POLICY = Object.freeze({
  appUpdate: Object.freeze({
    owner: 'hejiahang0001-oss',
    repo: 'dsh-desktop',
    provider: 'github',
    updaterCacheDirName: 'dsh-desktop-updater'
  }),
  elevate: Object.freeze({
    electronBuilderVersion: '26.8.1',
    nsisVersion: '3.0.4.1',
    bytes: 107_520,
    sha256: '9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37'
  })
});
const GENERATED_RESOURCE_NAMES = Object.freeze(['app-update.yml', 'elevate.exe']);
const PACKAGED_MANIFEST_FIELDS = Object.freeze([
  'name', 'version', 'description', 'main', 'author', 'copyright', 'license', 'packageManager', 'private', 'dependencies'
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalizeRelative = (value) => {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error(`Package evidence received an unsafe relative path: ${value}`);
  }
  return normalized;
};

const readPlainFile = async (filePath, { maxBytes = Infinity, allowEmpty = true } = {}) => {
  const info = await fs.lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Package evidence requires a plain file: ${filePath}`);
  if ((!allowEmpty && info.size < 1) || info.size > maxBytes) throw new Error(`Package evidence file size is invalid: ${filePath}`);
  return fs.readFile(filePath);
};

const inside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

const resolveTreeRoot = async (treeRoot, workspaceRoot, { allowRootLink = false } = {}) => {
  const info = await fs.lstat(treeRoot);
  if (!info.isSymbolicLink()) return { root: treeRoot, info };
  if (!allowRootLink) throw new Error(`Package evidence rejects a linked tree root: ${treeRoot}`);
  const resolved = await fs.realpath(treeRoot);
  if (!inside(workspaceRoot, resolved)) throw new Error(`Package evidence tree link escapes the workspace: ${treeRoot}`);
  const resolvedInfo = await fs.lstat(resolved);
  return { root: resolved, info: resolvedInfo };
};

const walkPlainFiles = async (treeRoot, { workspaceRoot = treeRoot, allowRootLink = false } = {}) => {
  const resolved = await resolveTreeRoot(treeRoot, workspaceRoot, { allowRootLink });
  if (resolved.info.isFile()) return Object.freeze([{ relative: '', filePath: resolved.root, bytes: resolved.info.size }]);
  if (!resolved.info.isDirectory()) throw new Error(`Package evidence requires a file or directory tree: ${treeRoot}`);
  const files = [];
  const visit = async (directory, prefix = '') => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = await fs.lstat(filePath);
      if (info.isSymbolicLink()) throw new Error(`Package evidence rejects a linked tree entry: ${filePath}`);
      if (info.isDirectory()) {
        await visit(filePath, relative);
      } else if (info.isFile()) {
        files.push({ relative: normalizeRelative(relative), filePath, bytes: info.size });
        if (files.length > MAX_TREE_FILES) throw new Error(`Package evidence tree exceeds ${MAX_TREE_FILES} files: ${treeRoot}`);
      } else {
        throw new Error(`Package evidence rejects a non-file tree entry: ${filePath}`);
      }
    }
  };
  await visit(resolved.root);
  return Object.freeze(files);
};

const globToRegExp = (pattern) => {
  const normalized = String(pattern || '').replaceAll('\\', '/').replace(/^\.\//, '');
  let expression = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        index += 1;
        if (normalized[index + 1] === '/') {
          index += 1;
          expression += '(?:.*/)?';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`, 'u');
};

const selectedByFilters = (relative, filters = ['**/*']) => {
  const normalized = normalizeRelative(relative);
  if (normalized.split('/').some((part) => DEFAULT_IGNORED_RESOURCE_NAMES.has(part))) return false;
  const positive = filters.filter((value) => typeof value === 'string' && !value.startsWith('!'));
  const negative = filters.filter((value) => typeof value === 'string' && value.startsWith('!')).map((value) => value.slice(1));
  const included = positive.length === 0 || positive.some((pattern) => globToRegExp(pattern).test(normalized));
  return included && !negative.some((pattern) => globToRegExp(pattern).test(normalized));
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const normalizeArchivedDependencyManifest = (bytes) => {
  const manifest = JSON.parse(bytes.toString('utf8'));
  delete manifest.scripts;
  delete manifest.keywords;
  return Buffer.from(JSON.stringify(canonicalize(manifest)), 'utf8');
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

const summarizeComparison = (records, missing = [], unexpected = []) => {
  const sourceRecords = records.map((record) => ({ path: record.path, bytes: record.sourceBytes, sha256: record.sourceSha256 }));
  const packagedRecords = records.map((record) => ({ path: record.path, bytes: record.packagedBytes, sha256: record.packagedSha256 }));
  const mismatched = records.filter((record) => !record.matches).map((record) => record.path);
  return Object.freeze({
    files: records.length,
    bytes: sourceRecords.reduce((total, record) => total + record.bytes, 0),
    sourceTreeSha256: treeDigest(sourceRecords),
    packagedTreeSha256: treeDigest(packagedRecords),
    missing: Object.freeze(missing.slice(0, 20)),
    unexpected: Object.freeze(unexpected.slice(0, 20)),
    mismatched: Object.freeze(mismatched.slice(0, 20)),
    matches: mismatched.length === 0 && missing.length === 0 && unexpected.length === 0
  });
};

const readOptionalPackagedFile = async (filePath) => {
  try {
    return await readPlainFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const expectedAppUpdateBytes = (fields) => Buffer.from([
  `owner: ${fields.owner}`,
  `repo: ${fields.repo}`,
  `provider: ${fields.provider}`,
  `updaterCacheDirName: ${fields.updaterCacheDirName}`,
  ''
].join('\n'), 'utf8');

const inspectGeneratedResources = async ({
  packagedRoot,
  sourceManifest,
  policy = DEFAULT_GENERATED_RESOURCE_POLICY
}) => {
  const resourceRoot = path.join(packagedRoot, 'resources');
  const [appUpdateBytes, elevateBytes] = await Promise.all([
    readOptionalPackagedFile(path.join(resourceRoot, 'app-update.yml')),
    readOptionalPackagedFile(path.join(resourceRoot, 'elevate.exe'))
  ]);
  const expectedUpdate = expectedAppUpdateBytes(policy.appUpdate);
  const updatePresent = Boolean(appUpdateBytes);
  const updateMatches = !updatePresent || appUpdateBytes.equals(expectedUpdate);
  const elevatePresent = Boolean(elevateBytes);
  const elevatePe = elevatePresent ? inspectPeHeader(elevateBytes) : Object.freeze({ valid: false, peOffset: -1 });
  const sourceBuilderVersion = sourceManifest.devDependencies?.['electron-builder'] || '';
  const elevateMatches = !elevatePresent || (
    sourceBuilderVersion === policy.elevate.electronBuilderVersion
    && elevateBytes.length === policy.elevate.bytes
    && elevatePe.valid
    && sha256(elevateBytes) === policy.elevate.sha256
  );
  return Object.freeze({
    matches: updateMatches && elevateMatches,
    presentFiles: Object.freeze(GENERATED_RESOURCE_NAMES.filter((name) => (
      name === 'app-update.yml' ? updatePresent : elevatePresent
    ))),
    appUpdate: Object.freeze({
      present: updatePresent,
      matches: updateMatches,
      bytes: appUpdateBytes?.length ?? 0,
      sha256: appUpdateBytes ? sha256(appUpdateBytes) : '',
      expectedBytes: expectedUpdate.length,
      expectedSha256: sha256(expectedUpdate),
      fields: Object.freeze({ ...policy.appUpdate })
    }),
    elevate: Object.freeze({
      present: elevatePresent,
      matches: elevateMatches,
      bytes: elevateBytes?.length ?? 0,
      sha256: elevateBytes ? sha256(elevateBytes) : '',
      looksLikePe: elevatePe.valid,
      peOffset: elevatePe.peOffset,
      expectedBytes: policy.elevate.bytes,
      expectedSha256: policy.elevate.sha256,
      producer: Object.freeze({
        electronBuilderVersion: policy.elevate.electronBuilderVersion,
        nsisVersion: policy.elevate.nsisVersion,
        sourceElectronBuilderVersion: sourceBuilderVersion
      })
    })
  });
};

const bindExtraResources = async ({
  root,
  packagedRoot,
  entries,
  sourceManifest,
  generatedResourcePolicy = DEFAULT_GENERATED_RESOURCE_POLICY
}) => {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Package evidence requires declared extraResources.');
  const expectedDestinations = new Map();
  const bindings = {};
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || typeof entry.from !== 'string' || typeof entry.to !== 'string') {
      throw new Error(`Package evidence does not support extraResources entry ${index}.`);
    }
    const sourceRoot = path.resolve(root, entry.from);
    if (!inside(root, sourceRoot)) throw new Error(`Package evidence extraResource escapes the workspace: ${entry.from}`);
    const sourceInfo = await fs.lstat(sourceRoot);
    let selected;
    if (sourceInfo.isFile()) {
      selected = [{ relative: '', filePath: sourceRoot, bytes: sourceInfo.size }];
    } else {
      const files = await walkPlainFiles(sourceRoot, { workspaceRoot: root, allowRootLink: true });
      selected = files.filter((file) => selectedByFilters(file.relative, entry.filter));
    }
    if (selected.length === 0) throw new Error(`Package evidence extraResource selected no files: ${entry.from}`);
    const bindingName = `${index}:${entry.from}->${entry.to}`;
    const mapped = selected.map((file) => {
      const destination = normalizeRelative(file.relative ? `${entry.to}/${file.relative}` : entry.to);
      if (expectedDestinations.has(destination)) throw new Error(`Package evidence has overlapping extraResource output: ${destination}`);
      expectedDestinations.set(destination, file.filePath);
      return { ...file, destination };
    });
    const records = await mapLimit(mapped, HASH_CONCURRENCY, async (file) => {
      const [sourceBytes, packagedBytes] = await Promise.all([
        readPlainFile(file.filePath),
        readOptionalPackagedFile(path.join(packagedRoot, 'resources', ...file.destination.split('/')))
      ]);
      return {
        path: file.destination,
        sourceBytes: sourceBytes.length,
        sourceSha256: sha256(sourceBytes),
        packagedBytes: packagedBytes?.length ?? -1,
        packagedSha256: packagedBytes ? sha256(packagedBytes) : '',
        matches: Boolean(packagedBytes) && sourceBytes.equals(packagedBytes)
      };
    });
    bindings[bindingName] = summarizeComparison(records);
  }
  const actualFiles = (await walkPlainFiles(path.join(packagedRoot, 'resources')))
    .map((file) => file.relative)
    .filter((relative) => relative !== 'app.asar');
  const actual = new Set(actualFiles);
  const generated = await inspectGeneratedResources({
    packagedRoot,
    sourceManifest,
    policy: generatedResourcePolicy
  });
  const acceptedGenerated = generated.presentFiles.filter((name) => generated[
    name === 'app-update.yml' ? 'appUpdate' : 'elevate'
  ].matches);
  const expected = new Set([...expectedDestinations.keys(), ...acceptedGenerated]);
  const missing = [...expected].filter((relative) => !actual.has(relative)).sort();
  const unexpected = [...actual].filter((relative) => !expected.has(relative)).sort();
  return Object.freeze({
    bindings: Object.freeze(bindings),
    generated,
    layout: Object.freeze({
      files: actual.size,
      expectedFiles: expected.size,
      missing: Object.freeze(missing.slice(0, 20)),
      unexpected: Object.freeze(unexpected.slice(0, 20)),
      matches: missing.length === 0 && unexpected.length === 0
    })
  });
};

const enumerateRequiredAppFiles = async (root, patterns) => {
  if (!Array.isArray(patterns) || patterns.length === 0) throw new Error('Package evidence requires declared application files.');
  const positive = patterns.filter((value) => typeof value === 'string' && !value.startsWith('!'));
  const required = new Set();
  for (const pattern of positive) {
    const normalizedPattern = String(pattern).replaceAll('\\', '/').replace(/^\.\//, '');
    const wildcardIndex = normalizedPattern.search(/[?*]/u);
    if (wildcardIndex < 0) {
      const relative = normalizeRelative(normalizedPattern);
      const target = path.resolve(root, ...relative.split('/'));
      if (!inside(root, target)) throw new Error(`Package evidence application file escapes the workspace: ${pattern}`);
      const info = await fs.lstat(target);
      if (info.isFile()) required.add(relative);
      else if (info.isDirectory()) {
        for (const file of await walkPlainFiles(target, { workspaceRoot: root, allowRootLink: true })) {
          required.add(normalizeRelative(`${relative}/${file.relative}`));
        }
      } else throw new Error(`Package evidence application source is not a file: ${pattern}`);
      continue;
    }
    const prefixText = normalizedPattern.slice(0, wildcardIndex).replace(/\/+$/g, '');
    if (!prefixText) throw new Error(`Package evidence refuses an unbounded application glob: ${pattern}`);
    const prefix = normalizeRelative(prefixText);
    const target = path.resolve(root, ...prefix.split('/'));
    if (!inside(root, target)) throw new Error(`Package evidence application glob escapes the workspace: ${pattern}`);
    for (const file of await walkPlainFiles(target, { workspaceRoot: root, allowRootLink: true })) {
      const relative = normalizeRelative(`${prefix}/${file.relative}`);
      if (selectedByFilters(relative, patterns)) required.add(relative);
    }
  }
  return Object.freeze([...required].sort((left, right) => left.localeCompare(right, 'en')));
};

const packagedManifestProjection = (manifest) => Object.fromEntries(
  PACKAGED_MANIFEST_FIELDS.filter((name) => manifest[name] !== undefined).map((name) => [name, manifest[name]])
);

const bindAppArchive = async ({ root, archive, sourceManifest, packagedManifest }) => {
  const listed = listPackage(archive).map((entry) => normalizeRelative(entry));
  const listedSet = new Set(listed);
  const actualFiles = listed.filter((relative) => ![...listedSet].some((candidate) => (
    candidate.length > relative.length && candidate.startsWith(`${relative}/`)
  )));
  actualFiles.sort((left, right) => left.localeCompare(right, 'en'));
  const required = await enumerateRequiredAppFiles(root, sourceManifest.build?.files);
  const actual = new Set(actualFiles);
  const missing = required.filter((relative) => !actual.has(relative));
  const unexpected = actualFiles.filter((relative) => (
    relative !== 'package.json'
    && !required.includes(relative)
    && !/^node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/u.test(relative)
  ));
  const comparable = actualFiles.filter((relative) => relative !== 'package.json');
  const records = await mapLimit(comparable, HASH_CONCURRENCY, async (relative) => {
    const sourcePath = path.resolve(root, ...relative.split('/'));
    let sourceBytes = null;
    try {
      if (!inside(root, sourcePath)) throw new Error(`Package evidence application path escapes the workspace: ${relative}`);
      sourceBytes = await readPlainFile(sourcePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    let packagedBytes = extractFile(archive, relative.split('/').join(path.sep));
    if (sourceBytes && /^node_modules\/.+\/package\.json$/u.test(relative)) {
      sourceBytes = normalizeArchivedDependencyManifest(sourceBytes);
      packagedBytes = normalizeArchivedDependencyManifest(packagedBytes);
    }
    return {
      path: relative,
      sourceBytes: sourceBytes?.length ?? -1,
      sourceSha256: sourceBytes ? sha256(sourceBytes) : '',
      packagedBytes: packagedBytes.length,
      packagedSha256: sha256(packagedBytes),
      matches: Boolean(sourceBytes) && sourceBytes.equals(packagedBytes)
    };
  });
  const manifestMatches = JSON.stringify(packagedManifestProjection(packagedManifest))
    === JSON.stringify(packagedManifestProjection(sourceManifest));
  const summary = summarizeComparison(records, missing, unexpected);
  return Object.freeze({ ...summary, manifestMatches, matches: summary.matches && manifestMatches });
};

const inspectPeHeader = (bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 0x58 || bytes.readUInt16LE(0) !== 0x5a4d) return Object.freeze({ valid: false, peOffset: -1 });
  const peOffset = bytes.readUInt32LE(0x3c);
  const valid = peOffset >= 0x40 && peOffset <= bytes.length - 24 && bytes.readUInt32LE(peOffset) === 0x00004550;
  return Object.freeze({ valid, peOffset: valid ? peOffset : -1 });
};

const inspectPackagedBuild = async ({
  workspaceRoot,
  executablePath,
  asarPath,
  inspectExecutableIdentity = inspectWindowsExecutableIdentity,
  generatedResourcePolicy = DEFAULT_GENERATED_RESOURCE_POLICY
} = {}) => {
  const root = path.resolve(workspaceRoot || path.join(__dirname, '..'));
  const executable = path.resolve(executablePath || path.join(root, 'dist', 'win-unpacked', 'DSH Desktop.exe'));
  const archive = path.resolve(asarPath || path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar'));
  const packagedRoot = path.dirname(executable);
  const sourceManifestBytes = await readPlainFile(path.join(root, 'package.json'), { maxBytes: MAX_MANIFEST_BYTES, allowEmpty: false });
  const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8'));
  const executableBytes = await readPlainFile(executable, { allowEmpty: false });
  const archiveBytes = await readPlainFile(archive, { allowEmpty: false });
  const packagedManifestBytes = extractFile(archive, 'package.json');
  if (packagedManifestBytes.length < 1 || packagedManifestBytes.length > MAX_MANIFEST_BYTES) throw new Error('Packaged application manifest size is invalid.');
  const packagedManifest = JSON.parse(packagedManifestBytes.toString('utf8'));
  const [appTree, resources, executableIdentity] = await Promise.all([
    bindAppArchive({ root, archive, sourceManifest, packagedManifest }),
    bindExtraResources({
      root,
      packagedRoot,
      entries: sourceManifest.build?.extraResources,
      sourceManifest,
      generatedResourcePolicy
    }),
    inspectExecutableIdentity(packagedRoot)
  ]);
  const version = typeof sourceManifest.version === 'string' ? sourceManifest.version : '';
  const pe = inspectPeHeader(executableBytes);
  const accepted = /^\d+\.\d+\.\d+$/.test(version)
    && sourceManifest.name === 'dsh-desktop'
    && packagedManifest.name === sourceManifest.name
    && packagedManifest.version === version
    && pe.valid
    && executableIdentity?.ok === true
    && executableIdentity.expectedVersion === version
    && executableIdentity.productName === 'DSH Desktop'
    && appTree.matches
    && resources.generated.matches
    && resources.layout.matches
    && Object.values(resources.bindings).every((binding) => binding.matches);
  const evidence = {
    schemaVersion: 2,
    accepted,
    package: Object.freeze({ name: sourceManifest.name || '', version, configSha256: sha256(sourceManifestBytes) }),
    packagedManifest: Object.freeze({ name: packagedManifest.name || '', version: packagedManifest.version || '' }),
    executable: Object.freeze({
      name: path.basename(executable), bytes: executableBytes.length, sha256: sha256(executableBytes),
      looksLikePe: pe.valid, peOffset: pe.peOffset,
      identity: Object.freeze({
        ok: executableIdentity?.ok === true,
        productName: executableIdentity?.productName || '', fileDescription: executableIdentity?.fileDescription || '',
        internalName: executableIdentity?.internalName || '', fileVersion: executableIdentity?.fileVersion || '',
        productVersion: executableIdentity?.productVersion || '', companyName: executableIdentity?.companyName || '',
        originalFilename: executableIdentity?.originalFilename || '', expectedVersion: executableIdentity?.expectedVersion || ''
      })
    }),
    appAsar: Object.freeze({ name: path.basename(archive), bytes: archiveBytes.length, sha256: sha256(archiveBytes), tree: appTree }),
    resourceBindings: resources.bindings,
    generatedResources: resources.generated,
    resourceLayout: resources.layout
  };
  return Object.freeze({ ...evidence, fingerprint: sha256(Buffer.from(JSON.stringify(evidence), 'utf8')) });
};

module.exports = {
  DEFAULT_GENERATED_RESOURCE_POLICY,
  bindAppArchive,
  bindExtraResources,
  globToRegExp,
  inspectPackagedBuild,
  inspectGeneratedResources,
  inspectPeHeader,
  readPlainFile,
  selectedByFilters,
  sha256,
  walkPlainFiles
};
