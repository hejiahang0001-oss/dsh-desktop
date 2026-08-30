'use strict';

const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { isRestrictedPath } = require('./sensitive-path-policy.cjs');

const SUPPORT_BACKUP_VERSION = 1;
const MAX_BACKUP_FILES = 4096;
const MAX_BACKUP_FILE_BYTES = 512 * 1024 * 1024;
const MAX_BACKUP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_TREE_DEPTH = 4;
const MAX_VALIDATION_DEPTH = 12;
const MANIFEST_NAME = 'dsh-backup-manifest.json';
const FIXED_STATE_FILES = Object.freeze([
  'desktop-state.json',
  'update-state.json',
  'wiki-settings.json',
  'Preferences',
  'workbench-state.json',
  'workbench-dock.json',
  'session-continuity.json',
  'session-handoffs.json',
  'background-tasks.json',
  'background-tasks.json.bak',
  'worktrees/ownership.json',
  'worktrees/ownership.json.bak',
  'harness/.anonymous-user-id',
  'harness/settings.yaml',
  'harness/storages/session_project_catalog.json',
  'harness/storages/workspace.json'
]);
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
const FIXED_STATE_SET = Object.freeze(new Set(FIXED_STATE_FILES));

class SupportBackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SupportBackupError';
    this.code = code;
  }
}

const pathInside = (rootPath, candidatePath) => {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const hashFile = async (filePath) => {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
};

const safeRelativePath = (value) => {
  if (typeof value !== 'string' || !value || value.length > 520 || value.includes('\\') || path.posix.isAbsolute(value)) return '';
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || /[\u0000-\u001f<>:"|?*]/u.test(segment)
    || /[. ]$/u.test(segment)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) return '';
  return isRestrictedPath(value) ? '' : segments.join('/');
};

const semanticLevelDbName = (name) => /^\d+\.ldb$/iu.test(name) || /^MANIFEST-/u.test(name) || name === 'CURRENT';

const backupCategoryForPath = (relativePath) => {
  if (FIXED_STATE_SET.has(relativePath)) return 'state';
  if (/^task-archives\/(?:released-|recovered-)?\d{10,16}-[a-f0-9-]{36}\.json$/i.test(relativePath)) return 'state';
  const segments = relativePath.split('/');
  if (segments.length >= 3 && segments.length <= 7 && segments[0] === 'harness' && segments[1] === 'sessions') return 'session';
  if (segments.length === 4 && segments[0] === 'harness' && segments[1] === 'profiles' && segments[2] !== 'node_modules' && PROFILE_STATE_NAMES.has(segments[3])) return 'pluginProfile';
  if (segments.length === 3 && segments[0] === 'Local Storage' && segments[1] === 'leveldb' && semanticLevelDbName(segments[2])) return 'local-storage';
  return '';
};

const lstatWithoutLinks = async (root, relativePath) => {
  const normalized = String(relativePath).replaceAll('\\', '/');
  if (!safeRelativePath(normalized)) return null;
  let current = path.resolve(root);
  let info = null;
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment);
    try { info = await fsp.lstat(current); } catch { return null; }
    if (info.isSymbolicLink()) return null;
  }
  return info;
};

const addFile = async (root, relativePath, category, files) => {
  const normalized = String(relativePath).replaceAll('\\', '/');
  if (!safeRelativePath(normalized)) return;
  if (files.length >= MAX_BACKUP_FILES) throw new SupportBackupError('backup-file-limit', 'DSH 备份文件数量超过上限。');
  const target = path.join(root, ...normalized.split('/'));
  const info = await lstatWithoutLinks(root, normalized);
  if (!info?.isFile()) return;
  if (info.size > MAX_BACKUP_FILE_BYTES) throw new SupportBackupError('backup-file-too-large', `DSH 备份文件超过单文件上限：${normalized}`);
  files.push(Object.freeze({ path: normalized, category, bytes: info.size, sha256: await hashFile(target) }));
};

const addFlatDirectory = async (root, relativeDirectory, category, predicate, files) => {
  const directoryInfo = await lstatWithoutLinks(root, relativeDirectory);
  if (!directoryInfo?.isDirectory()) return;
  let entries;
  try { entries = await fsp.readdir(path.join(root, relativeDirectory), { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !predicate(entry.name)) continue;
    await addFile(root, path.join(relativeDirectory, entry.name), category, files);
  }
};

const addDirectoryTree = async (root, relativeDirectory, category, files, depth = 0) => {
  if (depth > MAX_TREE_DEPTH) throw new SupportBackupError('backup-tree-too-deep', 'DSH 会话目录层级超过备份上限。');
  if (files.length >= MAX_BACKUP_FILES) throw new SupportBackupError('backup-file-limit', 'DSH 备份文件数量超过上限。');
  if (isRestrictedPath(relativeDirectory)) return;
  const directoryInfo = await lstatWithoutLinks(root, relativeDirectory);
  if (!directoryInfo?.isDirectory()) return;
  let entries;
  try { entries = await fsp.readdir(path.join(root, relativeDirectory), { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (files.length >= MAX_BACKUP_FILES) throw new SupportBackupError('backup-file-limit', 'DSH 备份文件数量超过上限。');
    if (entry.isSymbolicLink()) continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (isRestrictedPath(relativePath)) continue;
    if (entry.isDirectory()) await addDirectoryTree(root, relativePath, category, files, depth + 1);
    else if (entry.isFile()) await addFile(root, relativePath, category, files);
  }
};

const addProfileState = async (root, files) => {
  const relativeRoot = 'harness/profiles';
  const rootInfo = await lstatWithoutLinks(root, relativeRoot);
  if (!rootInfo?.isDirectory()) return;
  let profiles;
  try { profiles = await fsp.readdir(path.join(root, relativeRoot), { withFileTypes: true }); } catch { return; }
  const supportedProfiles = profiles.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== 'node_modules')
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  if (supportedProfiles.length > 16) throw new SupportBackupError('backup-profile-limit', 'DSH Profile 数量超过备份上限。');
  for (const profile of supportedProfiles) {
    let entries;
    try { entries = await fsp.readdir(path.join(root, relativeRoot, profile.name), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!entry.isFile() || entry.isSymbolicLink() || !PROFILE_STATE_NAMES.has(entry.name)) continue;
      await addFile(root, path.join(relativeRoot, profile.name, entry.name), 'pluginProfile', files);
    }
  }
};

const collectSupportBackupFiles = async (dataRoot) => {
  const root = path.resolve(dataRoot);
  const info = await fsp.lstat(root).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new SupportBackupError('invalid-data-root', 'DSH 数据目录不可用。');
  const files = [];
  for (const relativePath of FIXED_STATE_FILES) await addFile(root, relativePath, 'state', files);
  await addDirectoryTree(root, 'harness/sessions', 'session', files);
  await addFlatDirectory(root, 'task-archives', 'state', (name) => Boolean(backupCategoryForPath(`task-archives/${name}`)), files);
  await addProfileState(root, files);
  await addFlatDirectory(root, 'Local Storage/leveldb', 'local-storage', semanticLevelDbName, files);
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (files.length > MAX_BACKUP_FILES || totalBytes > MAX_BACKUP_TOTAL_BYTES) throw new SupportBackupError('backup-too-large', 'DSH 数据超过单次备份上限。');
  return Object.freeze({
    files: Object.freeze(files),
    totalBytes,
    counts: Object.freeze({
      state: files.filter((file) => file.category === 'state').length,
      sessions: files.filter((file) => file.category === 'session').length,
      pluginProfiles: files.filter((file) => file.category === 'pluginProfile').length,
      localStorage: files.filter((file) => file.category === 'local-storage').length
    })
  });
};

const backupFolderName = (version, date) => {
  const timestamp = date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z').replace('T', '-');
  return `DSH-Desktop-Backup-v${String(version || 'unknown').replace(/[^0-9A-Za-z.-]/gu, '-')}-${timestamp}`;
};

const collectBackupTreeFiles = async (backupRoot, relativeDirectory = '', depth = 0, files = new Set()) => {
  if (depth > MAX_VALIDATION_DEPTH) throw new SupportBackupError('backup-tree-too-deep', 'DSH 备份目录层级超过验证上限。');
  const directory = relativeDirectory ? path.join(backupRoot, ...relativeDirectory.split('/')) : backupRoot;
  let entries;
  try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { throw new SupportBackupError('invalid-backup', 'DSH 备份目录不可读取。'); }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (entry.isSymbolicLink()) throw new SupportBackupError('backup-link', 'DSH 备份包含不允许的链接。');
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (!safeRelativePath(relative)) throw new SupportBackupError('backup-path', 'DSH 备份包含不安全的路径。');
    const info = await lstatWithoutLinks(backupRoot, relative);
    if (!info) throw new SupportBackupError('backup-link', 'DSH 备份包含不允许的链接。');
    if (info.isDirectory()) {
      await collectBackupTreeFiles(backupRoot, relative, depth + 1, files);
    } else if (info.isFile()) {
      files.add(relative);
      if (files.size > MAX_BACKUP_FILES + 1) throw new SupportBackupError('backup-file-limit', 'DSH 备份文件数量超过验证上限。');
    } else {
      throw new SupportBackupError('backup-entry', 'DSH 备份包含不支持的文件类型。');
    }
  }
  return files;
};

const createSupportBackup = async ({ dataRoot, destinationRoot, appVersion, clock = () => new Date() }) => {
  const sourceRoot = await fsp.realpath(path.resolve(dataRoot)).catch(() => '');
  const destination = await fsp.realpath(path.resolve(destinationRoot)).catch(() => '');
  if (!sourceRoot) throw new SupportBackupError('invalid-data-root', 'DSH 数据目录不可用。');
  if (!destination) throw new SupportBackupError('invalid-destination', '所选备份目录不可用。');
  const destinationInfo = await fsp.lstat(destination).catch(() => null);
  if (!destinationInfo?.isDirectory() || destinationInfo.isSymbolicLink()) throw new SupportBackupError('invalid-destination', '所选备份目录不可用。');
  const snapshot = await collectSupportBackupFiles(sourceRoot);
  if (snapshot.files.length < 1) throw new SupportBackupError('backup-empty', '没有找到可备份的 DSH 会话或设置。');
  const createdAt = clock();
  const backupRoot = path.join(destination, backupFolderName(appVersion, createdAt));
  if (pathInside(sourceRoot, backupRoot) || path.resolve(sourceRoot) === path.resolve(backupRoot)) {
    throw new SupportBackupError('destination-inside-data', '备份目录不能位于 DSH 数据目录内部。');
  }
  await fsp.mkdir(backupRoot, { recursive: false });
  try {
    for (const file of snapshot.files) {
      const source = path.join(sourceRoot, ...file.path.split('/'));
      const target = path.join(backupRoot, ...file.path.split('/'));
      if (!pathInside(backupRoot, target)) throw new SupportBackupError('path-escape', '备份文件路径越过目标目录。');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      const copied = await fsp.lstat(target);
      if (!copied.isFile() || copied.isSymbolicLink() || copied.size !== file.bytes || await hashFile(target) !== file.sha256) {
        throw new SupportBackupError('copy-verification-failed', `备份文件校验失败：${file.path}`);
      }
    }
    const manifest = {
      schemaVersion: SUPPORT_BACKUP_VERSION,
      product: 'DSH Desktop',
      appVersion: String(appVersion || ''),
      createdAt: createdAt.toISOString(),
      includesCredentialFiles: false,
      contentRedacted: false,
      fileCount: snapshot.files.length,
      totalBytes: snapshot.totalBytes,
      counts: snapshot.counts,
      files: snapshot.files
    };
    const manifestPath = path.join(backupRoot, MANIFEST_NAME);
    const handle = await fsp.open(manifestPath, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    const verified = await validateSupportBackup(backupRoot);
    return Object.freeze({ ok: true, backupRoot, ...verified });
  } catch (error) {
    await fsp.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
};

const validateSupportBackup = async (backupPath) => {
  const backupRoot = await fsp.realpath(path.resolve(backupPath)).catch(() => '');
  if (!backupRoot) throw new SupportBackupError('invalid-backup', '所选目录不是安全的 DSH 备份。');
  const rootInfo = await fsp.lstat(backupRoot).catch(() => null);
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new SupportBackupError('invalid-backup', '所选目录不是安全的 DSH 备份。');
  const manifestPath = path.join(backupRoot, MANIFEST_NAME);
  const manifestInfo = await fsp.lstat(manifestPath).catch(() => null);
  if (!manifestInfo?.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 2 * 1024 * 1024) throw new SupportBackupError('manifest-missing', '未找到有效的 DSH 备份清单。');
  let manifest;
  try { manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')); } catch { throw new SupportBackupError('manifest-invalid', 'DSH 备份清单格式无效。'); }
  if (!manifest || manifest.schemaVersion !== SUPPORT_BACKUP_VERSION || manifest.product !== 'DSH Desktop'
    || manifest.includesCredentialFiles !== false || manifest.contentRedacted !== false || !Array.isArray(manifest.files)
    || manifest.files.length < 1 || manifest.files.length > MAX_BACKUP_FILES
    || typeof manifest.appVersion !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$/u.test(manifest.appVersion)
    || typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))
    || new Date(manifest.createdAt).toISOString() !== manifest.createdAt
    || !Number.isInteger(manifest.fileCount) || !Number.isInteger(manifest.totalBytes)
    || !manifest.counts || typeof manifest.counts !== 'object' || Array.isArray(manifest.counts)) {
    throw new SupportBackupError('manifest-invalid', 'DSH 备份清单不完整或版本不受支持。');
  }
  const treeFiles = await collectBackupTreeFiles(backupRoot);
  const seen = new Set();
  const seenKeys = new Set();
  let totalBytes = 0;
  const counts = { state: 0, sessions: 0, pluginProfiles: 0, localStorage: 0 };
  for (const file of manifest.files) {
    const relative = safeRelativePath(file?.path);
    const relativeKey = relative.toLocaleLowerCase('en-US');
    if (!relative || seenKeys.has(relativeKey) || backupCategoryForPath(relative) !== file?.category
      || !Number.isInteger(file?.bytes) || file.bytes < 0 || file.bytes > MAX_BACKUP_FILE_BYTES
      || typeof file?.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
      throw new SupportBackupError('manifest-invalid', 'DSH 备份清单包含无效文件记录。');
    }
    seen.add(relative);
    seenKeys.add(relativeKey);
    const target = path.join(backupRoot, ...relative.split('/'));
    if (!pathInside(backupRoot, target)) throw new SupportBackupError('path-escape', 'DSH 备份文件路径不安全。');
    const info = await lstatWithoutLinks(backupRoot, relative);
    if (!info?.isFile() || info.size !== file.bytes || await hashFile(target) !== file.sha256) {
      throw new SupportBackupError('backup-mismatch', `DSH 备份文件缺失或校验失败：${relative}`);
    }
    totalBytes += info.size;
    if (totalBytes > MAX_BACKUP_TOTAL_BYTES) throw new SupportBackupError('backup-too-large', 'DSH 备份超过验证上限。');
    if (file.category === 'state') counts.state += 1;
    if (file.category === 'session') counts.sessions += 1;
    if (file.category === 'pluginProfile') counts.pluginProfiles += 1;
    if (file.category === 'local-storage') counts.localStorage += 1;
  }
  if (manifest.fileCount !== seen.size || manifest.totalBytes !== totalBytes
    || manifest.counts.state !== counts.state || manifest.counts.sessions !== counts.sessions
    || manifest.counts.pluginProfiles !== counts.pluginProfiles || manifest.counts.localStorage !== counts.localStorage) {
    throw new SupportBackupError('manifest-mismatch', 'DSH 备份清单计数或大小不一致。');
  }
  const expectedTreeFiles = new Set([MANIFEST_NAME, ...seen]);
  if (treeFiles.size !== expectedTreeFiles.size || [...treeFiles].some((relative) => !expectedTreeFiles.has(relative))) {
    throw new SupportBackupError('backup-extra-files', 'DSH 备份包含清单之外的文件。');
  }
  return Object.freeze({
    valid: true,
    appVersion: String(manifest.appVersion || ''),
    createdAt: String(manifest.createdAt || ''),
    includesCredentialFiles: false,
    contentRedacted: false,
    fileCount: seen.size,
    totalBytes,
    counts: Object.freeze(counts)
  });
};

const oneLine = (value, maxLength = 120) => String(value || '').replace(/[\u0000-\u001f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength);
const safeLabel = (value, maxLength = 120) => {
  const normalized = oneLine(value, maxLength);
  if (/(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\)/u.test(normalized)) return '[已遮蔽路径]';
  if (/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S/iu.test(normalized)) return '[已遮蔽地址]';
  return normalized
    .replace(/\b(?:sk|ds)-[A-Za-z0-9_-]{16,}\b/gu, '[已遮蔽 Key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/giu, 'Bearer [已遮蔽 Token]')
    .replace(/\b(DEEPSEEK_API_KEY|API_KEY|PASSWORD|SECRET|TOKEN)\b\s*([:=])\s*\S+/giu, '$1$2[已遮蔽凭据]');
};

const boundedCount = (value) => (Number.isInteger(value) && value >= 0 && value <= MAX_BACKUP_FILES ? value : 0);
const boundedBytes = (value) => (Number.isInteger(value) && value >= 0 && value <= MAX_BACKUP_TOTAL_BYTES ? value : 0);

const createRedactedDiagnosticReport = ({ appInfo = {}, runtime = {}, diagnostics = {}, network = {}, workspace = {}, backup = {} } = {}) => Object.freeze({
  schemaVersion: 1,
  product: 'DSH Desktop',
  generatedAt: new Date().toISOString(),
  app: {
    version: safeLabel(appInfo.version, 32),
    platform: safeLabel(appInfo.platform, 24),
    packaged: appInfo.packaged === true,
    electron: safeLabel(runtime.electron, 32),
    node: safeLabel(runtime.node, 32),
    harness: safeLabel(runtime.harness, 32),
    pnpm: safeLabel(runtime.pnpm, 32)
  },
  workspace: {
    configured: workspace.isFallback !== true,
    name: safeLabel(workspace.displayName || '未选择仓库'),
    syncStatus: safeLabel(diagnostics.workspaceSync?.status || 'unknown', 40)
  },
  harness: {
    status: safeLabel(diagnostics.harnessStatus || 'unknown', 40),
    sessionsAvailable: diagnostics.sessions?.available !== false,
    sessionCount: boundedCount(diagnostics.sessions?.count),
    agentStatus: safeLabel(diagnostics.agent?.status || 'unknown', 40),
    pendingCount: boundedCount(diagnostics.agent?.pendingCount),
    queuedCount: boundedCount(diagnostics.agent?.queuedCount)
  },
  credential: { status: safeLabel(diagnostics.credential?.status || 'unknown', 40), valueIncluded: false },
  network: {
    mode: safeLabel(network.mode || 'direct', 24),
    status: safeLabel(network.status || 'unknown', 40),
    proxyConfigured: Boolean(network.proxyUrl || network.effectiveProxy),
    proxyValueIncluded: false
  },
  backup: {
    semanticFiles: boundedCount(backup.fileCount),
    semanticBytes: boundedBytes(backup.totalBytes),
    counts: {
      state: boundedCount(backup.counts?.state),
      sessions: boundedCount(backup.counts?.sessions),
      pluginProfiles: boundedCount(backup.counts?.pluginProfiles),
      localStorage: boundedCount(backup.counts?.localStorage)
    },
    credentialFilesIncluded: false,
    contentRedacted: false
  },
  privacy: {
    rawWorkspacePathIncluded: false,
    apiKeyIncluded: false,
    proxyUrlIncluded: false,
    sessionContentIncluded: false,
    logContentIncluded: false
  }
});

module.exports = {
  FIXED_STATE_FILES,
  MANIFEST_NAME,
  MAX_BACKUP_FILES,
  SUPPORT_BACKUP_VERSION,
  SupportBackupError,
  collectSupportBackupFiles,
  createRedactedDiagnosticReport,
  createSupportBackup,
  safeRelativePath,
  validateSupportBackup
};
