const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isRestrictedPath } = require('../electron/sensitive-path-policy.cjs');

const FIXED_STATE_FILES = Object.freeze([
  'desktop-state.json',
  'network-state.json',
  'Preferences',
  'workbench-state.json',
  'harness/.anonymous-user-id',
  'harness/settings.yaml',
  'harness/storages/session_project_catalog.json',
  'harness/storages/workspace.json'
]);
const MAX_TREE_DEPTH = 4;
const MAX_SNAPSHOT_FILES = 4096;
const PROFILE_STATE_NAMES = Object.freeze(new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json.dsh-desktop-toggle.json',
  'package.json.dsh-desktop-toggle.json.bak',
  'package.json.dsh-desktop-plugin-transaction.json',
  'package.json.dsh-desktop-plugin-transaction.json.bak',
  'package.json.dsh-desktop-plugin-last-known-good.json',
  'package.json.dsh-desktop-plugin-last-known-good.json.bak'
]));

const hashFile = async (filePath) => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const semanticLevelDbName = (name) => (
  /^\d+\.ldb$/i.test(name) || /^MANIFEST-/i.test(name) || name === 'CURRENT'
);

const addFile = async (root, relativePath, category, files) => {
  const normalized = relativePath.replaceAll('\\', '/');
  if (isRestrictedPath(normalized)) return;
  const target = path.join(root, relativePath);
  let info;
  try {
    info = await fsp.lstat(target);
  } catch {
    return;
  }
  if (!info.isFile() || info.isSymbolicLink()) return;
  files.push(Object.freeze({
    path: normalized,
    category,
    bytes: info.size,
    sha256: await hashFile(target)
  }));
};

const addFlatDirectory = async (root, relativeDirectory, category, predicate, files) => {
  const directory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !predicate(entry.name)) continue;
    await addFile(root, path.join(relativeDirectory, entry.name), category, files);
  }
};

const addDirectoryTree = async (root, relativeDirectory, category, files, depth = 0) => {
  if (depth > MAX_TREE_DEPTH || files.length >= MAX_SNAPSHOT_FILES || isRestrictedPath(relativeDirectory)) return;
  const directory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    if (files.length >= MAX_SNAPSHOT_FILES) break;
    if (entry.isSymbolicLink()) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (isRestrictedPath(relativePath)) continue;
    if (entry.isDirectory()) await addDirectoryTree(root, relativePath, category, files, depth + 1);
    else if (entry.isFile()) await addFile(root, relativePath, category, files);
  }
};

const addProfileState = async (root, files) => {
  const relativeRoot = 'harness/profiles';
  let profiles;
  try { profiles = await fsp.readdir(path.join(root, relativeRoot), { withFileTypes: true }); } catch { return; }
  for (const profile of profiles
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== 'node_modules')
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
    .slice(0, 16)) {
    let entries;
    try { entries = await fsp.readdir(path.join(root, relativeRoot, profile.name), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!entry.isFile() || entry.isSymbolicLink() || !PROFILE_STATE_NAMES.has(entry.name)) continue;
      await addFile(root, path.join(relativeRoot, profile.name, entry.name), 'pluginProfile', files);
    }
  }
};

const snapshotSemanticUserData = async (rootPath) => {
  const root = path.resolve(rootPath);
  const files = [];
  for (const relativePath of FIXED_STATE_FILES) await addFile(root, relativePath, 'state', files);
  await addDirectoryTree(root, 'harness/sessions', 'session', files);
  await addProfileState(root, files);
  await addFlatDirectory(root, 'Local Storage/leveldb', 'local-storage', semanticLevelDbName, files);
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return Object.freeze({
    version: 1,
    files: Object.freeze(files),
    counts: Object.freeze({
      state: files.filter((file) => file.category === 'state').length,
      sessions: files.filter((file) => file.category === 'session').length,
      pluginProfiles: files.filter((file) => file.category === 'pluginProfile').length,
      localStorage: files.filter((file) => file.category === 'local-storage').length
    })
  });
};

const readArgument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

if (require.main === module) {
  const root = readArgument('root');
  if (!root) {
    process.stderr.write('Usage: node scripts/semantic-state-snapshot.cjs --root=<DSH user-data directory>\n');
    process.exitCode = 2;
  } else {
    snapshotSemanticUserData(root)
      .then((snapshot) => process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}

module.exports = {
  FIXED_STATE_FILES,
  MAX_SNAPSHOT_FILES,
  MAX_TREE_DEPTH,
  semanticLevelDbName,
  snapshotSemanticUserData
};
