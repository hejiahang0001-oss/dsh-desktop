'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const WIKI_SCHEMA_VERSION = 1;
const MAX_QUERY_LENGTH = 300;
const MAX_RESULTS = 12;
const MAX_SCAN_FILES = 2000;
const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_CAPTURE_CHARS = 20000;
const MAX_TITLE_CHARS = 120;
const MAX_PROJECT_FILES = 800;
const MAX_PROJECT_FILE_BYTES = 256 * 1024;
const MAX_PROJECT_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_PROJECT_DEPTH = 20;
const MAX_PROJECT_DIRECTORIES = 1000;
const MAX_PROJECT_DIRECTORY_ENTRIES = 2000;
const MAX_PROJECT_TOTAL_ENTRIES = 10000;
const MAX_PROJECT_PAGES = 12;
const MAX_PROJECT_PAGE_CHARS = 30000;
const MAX_PROJECT_TOTAL_PAGE_CHARS = 150000;
const RELEASE_KNOWLEDGE_PAGE_NAMES = Object.freeze([
  'version-overview',
  'capability-evolution',
  'harness-compatibility',
  'release-channels',
  'iteration-standards',
  'validation-evidence'
]);
const RELEASE_KNOWLEDGE_SOURCE = /^(?:package\.json|README\.md|PROGRESS\.md|DSH_DESKTOP_ITERATION_PLAN\.md|CONTRIBUTING\.md|docs\/DEVELOPMENT_PLAYBOOK\.md|docs\/VALIDATION\.md|docs\/RELEASE_NOTES_v\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*\.md|docs\/HARNESS_UPSTREAM(?:_OVERLAP)?_[A-Za-z0-9.-]+\.md)$/u;
const HISTORY_SOURCE_VERSION = 1;
const MAX_HISTORY_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_SESSIONS = 8;
const MAX_HISTORY_MESSAGES_PER_SESSION = 80;
const MAX_HISTORY_MESSAGE_CHARS = 8000;
const MAX_HISTORY_TOTAL_MESSAGES = 320;
const MAX_HISTORY_TOTAL_CHARS = 400000;
const MAX_HISTORY_PAGES = 10;
const MAX_HISTORY_PAGE_CHARS = 30000;
const MAX_HISTORY_TOTAL_PAGE_CHARS = 150000;
const WIKI_WRITE_LOCK_NAME = '.dsh-wiki-write.lock';
const WIKI_WRITE_LOCK_MAX_BYTES = 1024;
const WIKI_WRITE_LOCK_STALE_MS = 5 * 60 * 1000;
const WIKI_RECOVERY_MARKER_NAME = '.dsh-wiki-recovery-required.json';
const WIKI_RECOVERY_MARKER_MAX_BYTES = 16 * 1024;
const WIKI_RECOVERY_CLEAR_GUARD_NAME = '.dsh-wiki-recovery-clear.lock';
const WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES = 64 * 1024;
const WIKI_RECOVERY_CLEAR_JOURNAL_MAGIC = 'DSH-WIKI-RECOVERY-CLEAR/1 ';
const WIKI_WRITE_LOCK_RETRY_DELAYS_MS = Object.freeze([0, 10, 30, 75]);
const WIKI_WRITE_LOCK_TRANSIENT_CODES = new Set(['EACCES', 'EPERM', 'EBUSY']);
const WIKI_RECOVERY_ARCHIVE_KINDS = Object.freeze({
  capture: 'dsh-capture',
  'project-sync': 'dsh-project-sync',
  'history-ingest': 'dsh-history-ingest'
});
const LEGACY_WIKI_WRITE_LOCKS = Object.freeze([
  Object.freeze({
    name: '.dsh-wiki-project-sync.lock',
    busyCode: 'project-sync-busy',
    unsafeCode: 'unsafe-project-sync-lock',
    label: '项目同步'
  }),
  Object.freeze({
    name: '.dsh-wiki-history-ingest.lock',
    busyCode: 'history-ingest-busy',
    unsafeCode: 'unsafe-history-lock',
    label: 'DSH 历史导入'
  })
]);
const vaultWriteLockOwners = new Map();
const WIKI_DIRECTORIES = Object.freeze([
  'concepts',
  'entities',
  'skills',
  'references',
  'synthesis',
  'journal',
  'projects',
  '_archives',
  '_raw',
  '_staging',
  '.obsidian'
]);
const QUERY_EXCLUDED_DIRECTORIES = new Set(['_archives', '_raw', '_staging', '.obsidian', '.git']);
const QUERY_EXCLUDED_FILES = new Set(['index.md', 'log.md', 'hot.md']);
const PROJECT_EXCLUDED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.idea', '.vscode', '.next', '.nuxt', '.output', '.turbo',
  'node_modules', 'dist', 'build', 'coverage', 'out', 'release', 'releases', 'target',
  'vendor', '__pycache__', '.venv', 'venv', 'tmp', 'temp', 'logs'
]);
const PROJECT_ALLOWED_EXTENSIONS = new Set([
  '.c', '.cc', '.cjs', '.cpp', '.cs', '.css', '.csv', '.go', '.h', '.hpp', '.html',
  '.ini', '.java', '.js', '.json', '.jsx', '.kt', '.kts', '.md', '.mjs', '.php',
  '.properties', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.swift', '.toml',
  '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml'
]);
const PROJECT_SENSITIVE_FILES = new Set([
  '.env', '.env.local', '.env.production', '.env.development', '.npmrc', '.pypirc',
  'credentials', 'credentials.json', 'secrets.json', 'id_rsa', 'id_ed25519'
]);

class WikiBasicError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WikiBasicError';
    this.code = code;
  }
}

const normalizeText = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength);
};

const oneLine = (value, maxLength = 240) => normalizeText(value, maxLength * 4)
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const yamlString = (value) => JSON.stringify(String(value || ''));

const isoNow = (clock = () => new Date()) => clock().toISOString();

const pathInside = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const normalizeAbsolutePath = (value, label) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || !path.isAbsolute(value)) {
    throw new WikiBasicError('invalid-path', `${label}必须是有效的绝对路径。`);
  }
  return path.resolve(value);
};

const assertPlainDirectory = async (directory, { create = false, label = '知识库路径' } = {}) => {
  const resolved = normalizeAbsolutePath(directory, label);
  if (create) await fsp.mkdir(resolved, { recursive: true });
  let info;
  try {
    info = await fsp.lstat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new WikiBasicError('directory-missing', `${label}不存在。`);
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WikiBasicError('unsafe-directory', `${label}必须是普通本地目录，不能是文件、符号链接或目录联接。`);
  }
  return resolved;
};

const sha256Text = (value) => createHash('sha256').update(value).digest('hex');

const readBoundedRegularFile = async (filePath, maxBytes) => {
  const handle = await fsp.open(filePath, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, Math.max(1, info.size + 1)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) return null;
    return { bytes: buffer.subarray(0, bytesRead), size: bytesRead };
  } finally {
    await handle.close();
  }
};

const normalizedPathKey = (value) => path.resolve(value).replace(/\\/g, '/').toLowerCase();
const policyPathKey = (value) => String(value || '').replace(/\\/g, '/').normalize('NFC').toLocaleLowerCase();

const assertUniquePolicyPaths = (values, code = 'invalid-manifest', message = '知识库清单包含大小写等价的重复路径。') => {
  const seen = new Set();
  for (const value of values) {
    const key = policyPathKey(value);
    if (!key || seen.has(key)) throw new WikiBasicError(code, message);
    seen.add(key);
  }
};

const isSensitiveProjectPath = (relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  const basename = path.posix.basename(normalized);
  return PROJECT_SENSITIVE_FILES.has(basename)
    || basename.startsWith('.env.')
    || basename.startsWith('.dsh-wiki-')
    || /(?:^|\/)(?:secret|secrets|credential|credentials|private)(?:\/|$)/u.test(normalized)
    || /\.(?:pem|key|p12|pfx)$/u.test(basename);
};

const isProjectSourceFile = (name) => {
  const lower = name.toLowerCase();
  return PROJECT_ALLOWED_EXTENSIONS.has(path.extname(lower))
    || new Set(['dockerfile', 'makefile', 'license', 'readme', 'changelog']).has(lower);
};

const walkProjectSources = async (workspacePath) => {
  const workspace = await assertPlainDirectory(workspacePath, { label: '工作区路径' });
  const files = [];
  let totalBytes = 0;
  let directories = 0;
  let totalEntries = 0;
  let limited = false;

  const visit = async (directory, depth = 0) => {
    if (depth > MAX_PROJECT_DEPTH || directories >= MAX_PROJECT_DIRECTORIES || totalEntries >= MAX_PROJECT_TOTAL_ENTRIES) {
      limited = true;
      return;
    }
    if (files.length >= MAX_PROJECT_FILES || totalBytes >= MAX_PROJECT_TOTAL_BYTES) {
      limited = true;
      return;
    }
    directories += 1;
    const entries = [];
    for await (const entry of await fsp.opendir(directory)) {
      entries.push(entry);
      if (entries.length > MAX_PROJECT_DIRECTORY_ENTRIES) {
        limited = true;
        return;
      }
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      totalEntries += 1;
      if (totalEntries > MAX_PROJECT_TOTAL_ENTRIES) {
        limited = true;
        break;
      }
      if (files.length >= MAX_PROJECT_FILES || totalBytes >= MAX_PROJECT_TOTAL_BYTES) {
        limited = true;
        break;
      }
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(workspace, absolute).replace(/\\/g, '/');
      if (!pathInside(workspace, absolute)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!PROJECT_EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) await visit(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile() || isSensitiveProjectPath(relative) || !isProjectSourceFile(entry.name)) continue;
      const opened = await readBoundedRegularFile(absolute, MAX_PROJECT_FILE_BYTES);
      if (!opened || opened.bytes.includes(0)) continue;
      if (totalBytes + opened.size > MAX_PROJECT_TOTAL_BYTES) {
        limited = true;
        continue;
      }
      totalBytes += opened.size;
      files.push({ path: relative, size: opened.size, sha256: sha256Text(opened.bytes) });
    }
  };

  await visit(workspace);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    workspace,
    files,
    totalBytes,
    limited,
    fingerprint: sha256Text(JSON.stringify(files))
  };
};

const sanitizedGitEnvironment = () => {
  const blocked = /(?:api[_-]?key|token|secret|password|credential|deepseek|openai|anthropic|git_(?:dir|work_tree|index_file|object_directory))/i;
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !blocked.test(name)));
};

const inspectProjectGit = async (workspacePath, previousCommit = '') => {
  const workspace = normalizeAbsolutePath(workspacePath, '工作区路径');
  const run = async (...args) => oneLine((await execFileAsync('git', ['-C', workspace, ...args], {
    cwd: workspace,
    env: sanitizedGitEnvironment(),
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  })).stdout, 4096);
  try {
    const root = await run('rev-parse', '--show-toplevel');
    if (normalizedPathKey(root) !== normalizedPathKey(workspace)) return { status: 'unavailable', reason: 'nested-workspace' };
    const head = await run('rev-parse', 'HEAD');
    if (!/^[a-f0-9]{40}$/i.test(head)) return { status: 'unavailable', reason: 'invalid-head' };
    const branch = await run('branch', '--show-current').catch(() => '');
    let ancestor = null;
    if (/^[a-f0-9]{40}$/i.test(previousCommit)) {
      try {
        await execFileAsync('git', ['-C', workspace, 'merge-base', '--is-ancestor', previousCommit, head], {
          cwd: workspace,
          env: sanitizedGitEnvironment(),
          windowsHide: true,
          timeout: 10000
        });
        ancestor = true;
      } catch {
        ancestor = false;
      }
    }
    return { status: 'ready', head, branch, previousCommit: previousCommit || '', previousCommitIsAncestor: ancestor };
  } catch (error) {
    return { status: 'unavailable', reason: error?.code === 'ENOENT' ? 'git-not-found' : 'not-a-repository' };
  }
};

const readJsonFile = async (filePath, fallback = {}) => {
  try {
    const value = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

const atomicWriteText = async (filePath, text) => {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  const temp = `${resolved}.${process.pid}-${randomUUID()}.tmp`;
  await fsp.mkdir(directory, { recursive: true });
  let handle;
  try {
    handle = await fsp.open(temp, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(temp, resolved);
  } finally {
    await handle?.close().catch(() => undefined);
    await fsp.unlink(temp).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
};

const writeNewTextAtomically = async (filePath, text) => {
  const resolved = path.resolve(filePath);
  const directory = path.dirname(resolved);
  const temp = `${resolved}.${process.pid}-${randomUUID()}.tmp`;
  await fsp.mkdir(directory, { recursive: true });
  let handle;
  let published = false;
  let publicationRecovered = false;
  let cleanupPending = false;
  try {
    handle = await fsp.open(temp, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await fsp.link(temp, resolved);
      published = true;
    } catch (error) {
      if (error?.code === 'EEXIST') throw error;
      const current = await readRollbackTarget(resolved).catch(() => ({ state: 'unavailable' }));
      if (current.state !== 'file' || current.text !== text) throw error;
      published = true;
      publicationRecovered = true;
    }
  } finally {
    await handle?.close().catch(() => undefined);
    try {
      await fsp.unlink(temp);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        if (!published) throw error;
        cleanupPending = true;
      }
    }
  }
  return { cleanupPending, publicationRecovered };
};

const writeIfMissing = async (filePath, text) => {
  try {
    const handle = await fsp.open(filePath, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
};

const normalizeSettings = (value = {}) => ({
  version: WIKI_SCHEMA_VERSION,
  vaultPath: typeof value.vaultPath === 'string' && path.isAbsolute(value.vaultPath)
    ? path.resolve(value.vaultPath)
    : ''
});

class WikiSettingsStore {
  constructor({ filePath }) {
    this.filePath = normalizeAbsolutePath(filePath, 'Wiki 设置文件路径');
    this.state = normalizeSettings();
  }

  async init() {
    this.state = normalizeSettings(await readJsonFile(this.filePath, {}));
    await this._persist();
    return this.getState();
  }

  async setVault(vaultPath) {
    const resolved = await assertPlainDirectory(vaultPath);
    this.state = normalizeSettings({ vaultPath: resolved });
    await this._persist();
    return this.getState();
  }

  async _persist() {
    await atomicWriteText(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  getState() {
    return { ...this.state };
  }
}

const vaultTemplates = (vaultPath, timestamp) => ({
  'index.md': `---\ntitle: Wiki Index\n---\n\n# Wiki Index\n\n*此索引由 DSH Desktop 维护。最后更新：${timestamp}*\n\n## Concepts\n\n## Entities\n\n## Skills\n\n## References\n\n## Synthesis\n\n## Journal\n`,
  'log.md': `---\ntitle: Wiki Log\n---\n\n# Wiki Log\n\n- [${timestamp}] INIT vault_path=${yamlString(vaultPath)} categories=concepts,entities,skills,references,synthesis,journal\n`,
  'hot.md': `---\ntitle: Hot Cache\nupdated: ${timestamp}\n---\n\n# Hot Cache\n\n## Recent Activity\n\n- [${timestamp}] INIT — vault created by DSH Desktop\n\n## Active Threads\n\n*None yet.*\n\n## Key Takeaways\n\n*None yet.*\n\n## Flagged Contradictions\n\n*None yet.*\n`,
  '.manifest.json': '{}\n',
  [path.join('.obsidian', 'app.json')]: `${JSON.stringify({ strictLineBreaks: false, showFrontmatter: false, defaultViewMode: 'preview', livePreview: true }, null, 2)}\n`,
  [path.join('.obsidian', 'appearance.json')]: `${JSON.stringify({ baseFontSize: 16 }, null, 2)}\n`
});

const initializeWikiVault = async (vaultPath, { clock = () => new Date() } = {}) => {
  const resolved = await assertPlainDirectory(vaultPath, { create: true });
  await assertNoWikiRecoveryClearGuard(resolved);
  for (const directory of WIKI_DIRECTORIES) {
    await assertNoWikiRecoveryClearGuard(resolved);
    const target = path.join(resolved, directory);
    await fsp.mkdir(target, { recursive: true });
    const info = await fsp.lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WikiBasicError('unsafe-vault-entry', `知识库目录 ${directory} 不是普通目录。`);
    }
  }
  const timestamp = isoNow(clock);
  const created = [];
  const preserved = [];
  for (const [relative, text] of Object.entries(vaultTemplates(resolved, timestamp))) {
    await assertNoWikiRecoveryClearGuard(resolved);
    const target = path.join(resolved, relative);
    if (!pathInside(resolved, target)) throw new WikiBasicError('path-escape', '知识库初始化路径越界。');
    (await writeIfMissing(target, text) ? created : preserved).push(relative.replace(/\\/g, '/'));
  }
  await assertNoWikiRecoveryClearGuard(resolved);
  return { ok: true, vaultPath: resolved, created, preserved, state: await inspectWikiVault(resolved) };
};

const walkMarkdown = async (root) => {
  const files = [];
  const visit = async (directory, depth) => {
    if (depth > 16 || files.length >= MAX_SCAN_FILES) return;
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_SCAN_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (QUERY_EXCLUDED_DIRECTORIES.has(policyPathKey(entry.name))) continue;
        await visit(absolute, depth + 1);
      } else if (entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.md')) {
        if (depth === 0 && QUERY_EXCLUDED_FILES.has(entry.name.toLocaleLowerCase())) continue;
        const stat = await fsp.stat(absolute);
        if (stat.size <= MAX_MARKDOWN_BYTES) files.push({ absolute, relative, size: stat.size });
      }
    }
  };
  await visit(root, 0);
  return { files, limited: files.length >= MAX_SCAN_FILES };
};

const manifestLastSyncAt = (manifest) => {
  const timestamps = [];
  for (const entry of Object.values(manifest?.projects || {})) {
    if (typeof entry?.updated === 'string' && Number.isFinite(Date.parse(entry.updated))) timestamps.push(entry.updated);
  }
  for (const channel of Object.values(manifest?.history || {})) {
    if (!channel || typeof channel !== 'object' || Array.isArray(channel)) continue;
    for (const entry of Object.values(channel)) {
      if (typeof entry?.updated === 'string' && Number.isFinite(Date.parse(entry.updated))) timestamps.push(entry.updated);
    }
  }
  return timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0] || '';
};

const inspectWikiVault = async (vaultPath) => {
  if (!vaultPath) return { configured: false, status: 'unconfigured', vaultPath: '', missing: [], pageCount: 0, limited: false };
  let resolved;
  try {
    resolved = await assertPlainDirectory(vaultPath);
  } catch (error) {
    return { configured: true, status: 'unavailable', vaultPath: path.resolve(vaultPath), missing: [], pageCount: 0, limited: false, message: error.message };
  }
  const required = [...WIKI_DIRECTORIES, 'index.md', 'log.md', 'hot.md', '.manifest.json'];
  const missing = [];
  for (const relative of required) {
    try {
      const info = await fsp.lstat(path.join(resolved, relative));
      if (info.isSymbolicLink() || (!info.isDirectory() && WIKI_DIRECTORIES.includes(relative)) || (!info.isFile() && !WIKI_DIRECTORIES.includes(relative))) missing.push(relative.replace(/\\/g, '/'));
    } catch {
      missing.push(relative.replace(/\\/g, '/'));
    }
  }
  const scan = await walkMarkdown(resolved);
  let manifest = {};
  let manifestValid = true;
  let recovery = null;
  let recoveryInvalid = false;
  if (!missing.includes('.manifest.json')) {
    try {
      const opened = await readBoundedRegularFile(path.join(resolved, '.manifest.json'), MAX_MARKDOWN_BYTES);
      if (!opened) throw new Error('manifest-too-large');
      manifest = JSON.parse(opened.bytes.toString('utf8'));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest-invalid');
      if (manifest.projects !== undefined && (!manifest.projects || typeof manifest.projects !== 'object' || Array.isArray(manifest.projects))) throw new Error('manifest-projects-invalid');
      if (manifest.history !== undefined && (!manifest.history || typeof manifest.history !== 'object' || Array.isArray(manifest.history))) throw new Error('manifest-history-invalid');
    } catch {
      manifestValid = false;
    }
  }
  try {
    recovery = await readWikiRecoveryProtection(resolved);
  } catch (error) {
    recoveryInvalid = true;
    recovery = {
      invalid: true,
      code: oneLine(error?.code || 'invalid-recovery-protection', 80),
      message: error?.message || 'Wiki 恢复标记无法安全读取。'
    };
  }
  const status = recoveryInvalid
    ? 'unavailable'
    : recovery
      ? 'recovery-required'
      : missing.length > 0
        ? 'needs-init'
        : manifestValid
          ? 'ready'
          : 'unavailable';
  return {
    configured: true,
    status,
    vaultPath: resolved,
    missing,
    pageCount: scan.files.length,
    limited: scan.limited,
    lastSyncAt: manifestValid ? manifestLastSyncAt(manifest) : '',
    recovery,
    message: status === 'ready'
      ? '知识库结构完整。'
      : status === 'needs-init'
        ? `还缺少 ${missing.length} 个基础目录或文件。`
        : status === 'recovery-required'
          ? `检测到未完整回退或清理中断的 Wiki 事务；请从 ${recovery.archive || '错误提示中的恢复归档'} 核对人工内容。`
          : recoveryInvalid
            ? 'Wiki 恢复标记无法安全读取；页面未被修改。'
            : '知识库清单无法读取；页面未被修改，请从最近恢复副本核对。'
  };
};

const parseFrontmatter = (text) => {
  if (!text.startsWith('---\n')) return { body: text, metadata: {} };
  const end = text.indexOf('\n---\n', 4);
  if (end < 0 || end > 16000) return { body: text, metadata: {} };
  const yaml = text.slice(4, end);
  const body = text.slice(end + 5);
  const metadata = {};
  for (const name of ['title', 'summary', 'lifecycle', 'updated']) {
    const match = yaml.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
    if (match) metadata[name] = match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  const tags = yaml.match(/^tags:\s*\[([^\]]*)\]/m)?.[1];
  metadata.tags = tags ? tags.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : [];
  const sources = [];
  const inlineSources = yaml.match(/^sources:\s*\[([^\]]*)\]/m)?.[1];
  if (inlineSources) sources.push(...inlineSources.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean));
  const sourceBlock = yaml.match(/^sources:\s*\n((?:\s+-\s+.*\n?)*)/m)?.[1] || '';
  for (const line of sourceBlock.split('\n')) {
    const match = line.match(/^\s+-\s+(.+)$/);
    if (match) sources.push(match[1].trim().replace(/^['"]|['"]$/g, ''));
  }
  metadata.sources = sources.slice(0, 12);
  return { body, metadata };
};

const queryTerms = (query) => {
  const normalized = normalizeText(query, MAX_QUERY_LENGTH).toLocaleLowerCase();
  if (!normalized) throw new WikiBasicError('empty-query', '请输入要查询的知识主题。');
  const split = normalized.split(/[\s,，。！？；;:：/\\|()[\]{}<>“”"']+/u).filter((item) => item.length >= 2);
  return [...new Set([normalized, ...split])].slice(0, 12);
};

const countOccurrences = (text, term) => {
  if (!term) return 0;
  let count = 0;
  let cursor = 0;
  while (count < 12) {
    const found = text.indexOf(term, cursor);
    if (found < 0) break;
    count += 1;
    cursor = found + Math.max(1, term.length);
  }
  return count;
};

const excerptAround = (body, terms) => {
  const compact = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const lower = compact.toLocaleLowerCase();
  let position = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (position < 0 || found < position)) position = found;
  }
  if (position < 0) position = 0;
  const start = Math.max(0, position - 70);
  return `${start > 0 ? '…' : ''}${compact.slice(start, start + 320)}${start + 320 < compact.length ? '…' : ''}`;
};

const wikiWriteInProgress = async (vaultPath) => {
  try {
    await fsp.lstat(recoveryClearGuardPath(vaultPath));
    return true;
  } catch (error) {
    if (error?.code !== 'ENOENT') return true;
  }
  const staging = path.join(vaultPath, '_staging');
  for (const name of [WIKI_WRITE_LOCK_NAME, ...LEGACY_WIKI_WRITE_LOCKS.map((item) => item.name)]) {
    try {
      await fsp.lstat(path.join(staging, name));
      return true;
    } catch (error) {
      if (error?.code !== 'ENOENT') return true;
    }
  }
  return false;
};

const busyQueryResult = (query, scanned = 0, limited = false) => ({
  ok: false,
  code: 'wiki-read-busy',
  query: normalizeText(query, MAX_QUERY_LENGTH),
  results: [],
  scanned,
  limited,
  logged: false,
  message: 'Wiki 正在更新，为避免读到未提交内容，请稍后重试。'
});

const queryWiki = async (vaultPath, query, { limit = 8, clock = () => new Date(), log = true } = {}) => {
  const resolved = await assertPlainDirectory(vaultPath);
  const terms = queryTerms(query);
  if (await wikiWriteInProgress(resolved)) return busyQueryResult(query);
  const state = await inspectWikiVault(resolved);
  if (state.status !== 'ready') throw new WikiBasicError('vault-not-ready', '知识库尚未初始化，不能执行查询。');
  if (await wikiWriteInProgress(resolved)) return busyQueryResult(query);
  const scan = await walkMarkdown(resolved);
  const results = [];
  for (const file of scan.files) {
    const text = await fsp.readFile(file.absolute, 'utf8');
    const { body, metadata } = parseFrontmatter(text);
    const title = oneLine(metadata.title || path.basename(file.relative, '.md'), MAX_TITLE_CHARS);
    const summary = oneLine(metadata.summary || '', 240);
    const titleLower = title.toLocaleLowerCase();
    const summaryLower = summary.toLocaleLowerCase();
    const tagLower = (metadata.tags || []).join(' ').toLocaleLowerCase();
    const bodyLower = body.toLocaleLowerCase();
    let score = 0;
    for (const term of terms) {
      if (titleLower === term) score += 120;
      else if (titleLower.includes(term)) score += 70;
      if (tagLower.includes(term)) score += 45;
      if (summaryLower.includes(term)) score += 30;
      score += Math.min(20, countOccurrences(bodyLower, term) * 4);
    }
    if (score <= 0) continue;
    results.push({
      title,
      path: file.relative,
      summary,
      excerpt: excerptAround(body, terms),
      sources: metadata.sources || [],
      lifecycle: oneLine(metadata.lifecycle || 'draft', 32),
      updated: oneLine(metadata.updated || '', 40),
      score,
      _absolute: file.absolute,
      _sha256: sha256Text(text)
    });
  }
  results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const boundedLimit = Math.min(MAX_RESULTS, Math.max(1, Number.isInteger(limit) ? limit : 8));
  const selectedInternal = results.slice(0, boundedLimit);
  if (await wikiWriteInProgress(resolved)) return busyQueryResult(query, scan.files.length, scan.limited);
  for (const item of selectedInternal) {
    try {
      const opened = await readBoundedRegularFile(item._absolute, MAX_MARKDOWN_BYTES);
      if (!opened || sha256Text(opened.bytes) !== item._sha256) return busyQueryResult(query, scan.files.length, scan.limited);
    } catch {
      return busyQueryResult(query, scan.files.length, scan.limited);
    }
  }
  const selected = selectedInternal.map(({ _absolute, _sha256, ...item }) => item);
  let logged = false;
  if (log) {
    try {
      await appendQueryLog(resolved, query, selected.length, clock);
      logged = true;
    } catch {
      logged = false;
    }
  }
  return { ok: true, query: normalizeText(query, MAX_QUERY_LENGTH), results: selected, scanned: scan.files.length, limited: scan.limited, logged };
};

const sensitiveFindings = (content) => {
  const text = String(content || '');
  const checks = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i, '疑似私钥'],
    ['api-key', /\b(?:sk|ds)-[A-Za-z0-9_-]{16,}\b/, '疑似 API Key'],
    ['bearer', /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i, '疑似 Bearer Token'],
    ['credential-name', /\b(?:DEEPSEEK_API_KEY|API_KEY|PASSWORD|SECRET|TOKEN)\b\s*[:=]/i, '疑似凭据字段']
  ];
  return checks.filter(([, pattern]) => pattern.test(text)).map(([id, , label]) => ({ id, label }));
};

const slugify = (title) => {
  const normalized = title.normalize('NFKC').toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return [...normalized].slice(0, 50).join('').replace(/-+$/g, '') || `session-conclusion-${Date.now()}`;
};

const buildCapturePreview = (vaultPath, capture) => {
  const title = oneLine(capture?.title, MAX_TITLE_CHARS);
  const content = normalizeText(capture?.content, MAX_CAPTURE_CHARS);
  if (!title) throw new WikiBasicError('invalid-title', '请输入结论标题。');
  if (!content) throw new WikiBasicError('invalid-content', '请选择或填写要保存的会话结论。');
  if (String(capture?.content || '').length > MAX_CAPTURE_CHARS) throw new WikiBasicError('content-too-large', `单次保存内容不能超过 ${MAX_CAPTURE_CHARS} 个字符。`);
  const slug = slugify(title);
  const relativePath = `synthesis/${slug}.md`;
  return {
    title,
    content,
    relativePath,
    absolutePath: path.join(path.resolve(vaultPath), relativePath),
    summary: oneLine(content, 180),
    sensitive: sensitiveFindings(`${title}\n${content}`),
    sourceSessionId: oneLine(capture?.sourceSessionId, 120),
    sourceSeq: Number.isInteger(capture?.sourceSeq) && capture.sourceSeq >= 0 ? capture.sourceSeq : null,
    sourceTime: Number.isFinite(capture?.sourceTime) ? capture.sourceTime : null
  };
};

const updateIndexText = (text, relativePath, title, summary, timestamp) => {
  const linkPath = relativePath.replace(/\.md$/i, '');
  const entry = `- [[${linkPath}|${title}]] — ${summary} ( #dsh #session-capture)`;
  if (text.includes(`[[${linkPath}|`) || text.includes(`[[${linkPath}]]`)) return text;
  let next = text.replace(/\*此索引由 DSH Desktop 维护。最后更新：[^*]+\*/u, `*此索引由 DSH Desktop 维护。最后更新：${timestamp}*`);
  const marker = '## Synthesis';
  const start = next.indexOf(marker);
  if (start < 0) return `${next.trimEnd()}\n\n${marker}\n\n${entry}\n`;
  const afterHeading = start + marker.length;
  const following = next.indexOf('\n## ', afterHeading);
  const insertAt = following >= 0 ? following : next.length;
  return `${next.slice(0, insertAt).trimEnd()}\n\n${entry}\n${next.slice(insertAt)}`;
};

const capturePageText = (preview, timestamp, workspaceName) => {
  const date = timestamp.slice(0, 10);
  const source = preview.sourceSessionId
    ? `dsh-session:${preview.sourceSessionId}${Number.isInteger(preview.sourceSeq) ? `#seq=${preview.sourceSeq}` : ''}`
    : 'dsh-session:current';
  return `---\ntitle: ${yamlString(preview.title)}\ncategory: synthesis\ntags: [dsh, session-capture]\nsources:\n  - ${yamlString(source)}\nsource_time: ${preview.sourceTime ?? 'null'}\nsummary: ${yamlString(preview.summary)}\nprovenance:\n  extracted: 0.90\n  inferred: 0.10\n  ambiguous: 0.00\nbase_confidence: 0.42\nlifecycle: draft\nlifecycle_changed: ${date}\ntier: supporting\ncreated: ${timestamp}\nupdated: ${timestamp}\n---\n\n# ${preview.title}\n\n${preview.content}\n\n## 来源\n\n- DSH 会话：${preview.sourceSessionId || '当前会话'}${Number.isInteger(preview.sourceSeq) ? `，事件序号 ${preview.sourceSeq}` : ''}\n- 会话时间：${preview.sourceTime ?? '未记录'}\n- 工作区：${workspaceName || '当前工作区'}\n- 说明：内容由用户在保存前选定并可编辑；原始会话保持只读。\n`;
};

const saveCaptureLocked = async (vaultPath, capture, {
  confirmedSensitive = false,
  workspaceName = '',
  clock = () => new Date(),
  afterPageWrites = async () => undefined
} = {}) => {
  const resolved = await assertPlainDirectory(vaultPath);
  const state = await inspectWikiVault(resolved);
  if (state.status !== 'ready') throw new WikiBasicError('vault-not-ready', '知识库尚未初始化，不能保存结论。');
  const preview = buildCapturePreview(resolved, capture);
  if (preview.sensitive.length > 0 && !confirmedSensitive) {
    throw new WikiBasicError('sensitive-confirmation-required', '内容可能包含凭据或敏感字段，需要用户再次确认。');
  }
  if (!pathInside(resolved, preview.absolutePath)) throw new WikiBasicError('path-escape', '保存目标越过知识库目录。');
  await fsp.mkdir(path.dirname(preview.absolutePath), { recursive: true });
  const synthesisInfo = await fsp.lstat(path.dirname(preview.absolutePath));
  if (!synthesisInfo.isDirectory() || synthesisInfo.isSymbolicLink()) throw new WikiBasicError('unsafe-target', '知识库 synthesis 目录不是普通目录。');

  const indexPath = path.join(resolved, 'index.md');
  const logPath = path.join(resolved, 'log.md');
  const [originalIndex, originalLog] = await Promise.all([
    fsp.readFile(indexPath, 'utf8'),
    fsp.readFile(logPath, 'utf8')
  ]);
  const timestamp = isoNow(clock);
  const pageText = capturePageText(preview, timestamp, oneLine(workspaceName, 160));
  const nextIndex = updateIndexText(originalIndex, preview.relativePath, preview.title, preview.summary, timestamp);
  const logLine = `- [${timestamp}] CAPTURE type=synthesis page=${yamlString(preview.relativePath)} title=${yamlString(preview.title)} source=${yamlString(preview.sourceSessionId || 'current')}\n`;
  const archiveRoot = await createWikiTransactionArchive(resolved, 'dsh-capture', timestamp, [
    { path: 'index.md', text: originalIndex },
    { path: 'log.md', text: originalLog }
  ]);
  await registerActiveWikiTransactionArchive(resolved, archiveRoot, 'capture');
  const writes = [{ path: preview.relativePath, absolute: preview.absolutePath, exists: false, expectedSha256: null, text: pageText }];
  const metadataWrites = [
    { path: 'index.md', absolute: indexPath, exists: true, expectedSha256: sha256Text(originalIndex), text: nextIndex },
    { path: 'log.md', absolute: logPath, exists: true, expectedSha256: sha256Text(originalLog), text: `${originalLog.trimEnd()}\n${logLine}` }
  ];
  const transactionWrites = [...writes, ...metadataWrites];
  const pageWriteErrors = {
    staleCode: 'page-exists',
    staleMessage: '知识库中已有同名页面，请修改标题后再保存。',
    untrackedCode: 'page-exists',
    untrackedMessage: '知识库中已有同名页面，请修改标题后再保存。'
  };
  const metadataWriteErrors = {
    staleCode: 'stale-wiki-metadata',
    staleMessage: 'Wiki 索引或日志在保存期间发生变化，已停止覆盖。',
    untrackedCode: 'stale-wiki-metadata',
    untrackedMessage: 'Wiki 索引或日志状态异常，已停止覆盖。'
  };
  let pageCreated = false;
  let temporaryCleanupPending = false;
  try {
    const published = await writeExpectedPage(writes[0], pageWriteErrors, { vaultPath: resolved, archiveRoot });
    pageCreated = true;
    temporaryCleanupPending = published.cleanupPending;
    await afterPageWrites();
    await writeExpectedPage(metadataWrites[0], metadataWriteErrors, { vaultPath: resolved, archiveRoot });
    await writeExpectedPage(metadataWrites[1], metadataWriteErrors, { vaultPath: resolved, archiveRoot });
    await assertTransactionClaimsStable(transactionWrites, 'concurrent-wiki-edit', '检测到 Wiki 文件在事务提交期间被其他程序修改，已停止提交');
    const [verifiedPage, verifiedIndex, verifiedLog] = await Promise.all([
      fsp.readFile(preview.absolutePath, 'utf8'),
      fsp.readFile(indexPath, 'utf8'),
      fsp.readFile(logPath, 'utf8')
    ]);
    if (verifiedPage !== pageText || verifiedIndex !== nextIndex || verifiedLog !== `${originalLog.trimEnd()}\n${logLine}`) {
      throw new WikiBasicError('write-verification-failed', '结论页面、索引或日志写入后校验失败。');
    }
  } catch (error) {
    if (transactionWrites.some((write) => write.transactionTouched)) {
      await rollbackWikiTransaction({
        vaultPath: resolved,
        archiveRoot,
        operation: 'capture',
        writes: transactionWrites.filter((write) => write.transactionTouched),
        originalError: error
      });
    }
    if (error?.code === 'EEXIST') throw new WikiBasicError('page-exists', '知识库中已有同名页面，请修改标题后再保存。');
    throw error;
  }
  return {
    ok: true,
    title: preview.title,
    path: preview.relativePath,
    vaultPath: resolved,
    sensitive: preview.sensitive,
    archive: path.relative(resolved, archiveRoot).replace(/\\/g, '/'),
    temporaryCleanupPending,
    message: temporaryCleanupPending
      ? '结论已完整保存；一个不可见临时副本仍待系统清理，请勿重复提交。'
      : '结论页面、索引、日志和恢复副本已更新；原始会话未修改。'
  };
};

const readManifestStrict = async (vaultPath) => {
  const manifestPath = path.join(vaultPath, '.manifest.json');
  try {
    const raw = await fsp.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('invalid-object');
    if (manifest.projects !== undefined && (!manifest.projects || typeof manifest.projects !== 'object' || Array.isArray(manifest.projects))) {
      throw new Error('invalid-projects');
    }
    if (manifest.history !== undefined && (!manifest.history || typeof manifest.history !== 'object' || Array.isArray(manifest.history))) {
      throw new Error('invalid-history');
    }
    return { ...manifest, projects: manifest.projects || {}, history: manifest.history || {} };
  } catch (error) {
    if (error?.code === 'ENOENT') throw new WikiBasicError('vault-not-ready', '知识库缺少清单文件。');
    throw new WikiBasicError('invalid-manifest', '知识库清单文件损坏，已停止项目同步。');
  }
};

const projectSlug = (workspacePath) => slugify(path.basename(workspacePath)).slice(0, 48);

const projectIdentity = (workspacePath) => {
  const sourceCwd = path.resolve(workspacePath);
  const slug = projectSlug(sourceCwd);
  const id = `${slug}-${sha256Text(normalizedPathKey(sourceCwd)).slice(0, 10)}`;
  return {
    id,
    name: oneLine(path.basename(sourceCwd), MAX_TITLE_CHARS),
    sourceCwd,
    rootPath: `projects/${id}`,
    overviewPath: `projects/${id}/${id}.md`
  };
};

const previousProjectFiles = (entry) => Array.isArray(entry?.files)
  ? entry.files.filter((item) => item && typeof item.path === 'string' && /^[a-f0-9]{64}$/i.test(item.sha256 || ''))
    .map((item) => ({ path: item.path.replace(/\\/g, '/'), size: Number(item.size) || 0, sha256: item.sha256 }))
  : [];

const projectFileDelta = (before, after) => {
  const previous = new Map(before.map((item) => [item.path, item]));
  const current = new Map(after.map((item) => [item.path, item]));
  const added = after.filter((item) => !previous.has(item.path));
  const modified = after.filter((item) => previous.has(item.path) && previous.get(item.path).sha256 !== item.sha256);
  const removed = before.filter((item) => !current.has(item.path));
  return { added, modified, removed };
};

const listCurrentProjectPages = async (vaultPath, project, entry) => {
  const configured = Array.isArray(entry?.pages_in_vault) ? entry.pages_in_vault : [];
  assertUniquePolicyPaths(configured.filter((item) => typeof item === 'string'));
  assertUniquePolicyPaths(Object.keys(entry?.page_sha256 && typeof entry.page_sha256 === 'object' ? entry.page_sha256 : {}));
  const committedHashes = normalizedPageHashes(entry?.page_sha256);
  const candidateMap = new Map();
  for (const item of [...configured, project.overviewPath]) {
    if (typeof item !== 'string') continue;
    const normalized = item.replace(/\\/g, '/');
    if (!candidateMap.has(policyPathKey(normalized))) candidateMap.set(policyPathKey(normalized), normalized);
  }
  const managed = new Set(configured.map((item) => typeof item === 'string' ? policyPathKey(item) : '').filter(Boolean));
  if (entry) managed.add(policyPathKey(project.overviewPath));
  const pages = [];
  const missingManagedPages = [];
  for (const relative of candidateMap.values()) {
    const normalized = typeof relative === 'string' ? relative.replace(/\\/g, '/') : '';
    if (!normalized.startsWith(`${project.rootPath}/`) || !normalized.endsWith('.md')) {
      if (managed.has(policyPathKey(normalized))) missingManagedPages.push(normalized.slice(0, 260));
      continue;
    }
    const absolute = path.join(vaultPath, normalized);
    if (!pathInside(vaultPath, absolute)) {
      if (managed.has(policyPathKey(normalized))) missingManagedPages.push(normalized);
      continue;
    }
    try {
      const info = await fsp.lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKDOWN_BYTES) {
        if (managed.has(policyPathKey(normalized))) missingManagedPages.push(normalized);
        continue;
      }
      const opened = await readBoundedRegularFile(absolute, MAX_MARKDOWN_BYTES);
      if (!opened) {
        if (managed.has(policyPathKey(normalized))) missingManagedPages.push(normalized);
        continue;
      }
      const text = opened.bytes.toString('utf8');
      const sha256 = sha256Text(text);
      const committedSha256 = committedHashes[normalized] || '';
      if (!managed.has(policyPathKey(normalized)) || !committedSha256) {
        throw new WikiBasicError('untracked-project-page', `知识库中已有未纳入项目清单的页面 ${normalized}，已停止覆盖。`);
      }
      pages.push({
        path: normalized,
        sha256,
        size: opened.size,
        committedSha256,
        humanEdited: Boolean(committedSha256 && committedSha256 !== sha256)
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (managed.has(policyPathKey(normalized))) missingManagedPages.push(normalized);
    }
  }
  pages.sort((left, right) => left.path.localeCompare(right.path));
  missingManagedPages.sort((left, right) => left.localeCompare(right));
  return { pages, missingManagedPages: [...new Set(missingManagedPages)] };
};

const inspectReleaseKnowledgePages = async (vaultPath, project, entry, existingPages) => {
  const releaseRoot = `${project.rootPath}/references/releases`;
  const referencesDirectory = path.join(vaultPath, ...`${project.rootPath}/references`.split('/'));
  let releaseDirectory = path.join(referencesDirectory, 'releases');
  const requiredPaths = RELEASE_KNOWLEDGE_PAGE_NAMES.map((name) => `${releaseRoot}/${name}.md`);
  const required = new Set(requiredPaths);
  const actual = [];
  await assertSafeDirectoryChain(vaultPath, referencesDirectory);
  try {
    const aliases = (await fsp.readdir(referencesDirectory, { withFileTypes: true }))
      .filter((item) => policyPathKey(item.name) === 'releases');
    if (aliases.length > 1 || (aliases.length === 1 && aliases[0].name !== 'releases')) {
      throw new WikiBasicError('noncanonical-release-knowledge-directory', '版本知识目录必须使用规范名称 references/releases；请先人工整理大小写变体。');
    }
    if (aliases.length === 0) throw Object.assign(new Error('release-directory-missing'), { code: 'ENOENT' });
    releaseDirectory = path.join(referencesDirectory, aliases[0].name);
    await assertSafeDirectoryChain(vaultPath, releaseDirectory);
    const info = await fsp.lstat(releaseDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new WikiBasicError('unsafe-release-knowledge-directory', '版本知识目录不能是文件、符号链接或目录联接。');
    }
    const seenNames = new Set();
    for (const item of await fsp.readdir(releaseDirectory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new WikiBasicError('unsafe-release-knowledge-page', '版本知识目录包含符号链接，已停止同步。');
      if (!item.isFile() || !item.name.toLocaleLowerCase().endsWith('.md')) continue;
      const nameKey = policyPathKey(item.name);
      if (seenNames.has(nameKey)) throw new WikiBasicError('duplicate-release-knowledge-page', '版本知识目录包含大小写等价的重复页面，请先人工整理。');
      seenNames.add(nameKey);
      const relative = `${releaseRoot}/${item.name}`;
      const opened = await readBoundedRegularFile(path.join(releaseDirectory, item.name), MAX_MARKDOWN_BYTES);
      if (!opened) throw new WikiBasicError('unsafe-release-knowledge-page', `版本知识页面 ${relative} 不是受支持的小型普通文件。`);
      actual.push({ path: relative, sha256: sha256Text(opened.bytes) });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  actual.sort((left, right) => left.path.localeCompare(right.path));
  const actualPaths = new Set(actual.map((item) => item.path));
  const committedHashes = normalizedPageHashes(entry?.page_sha256);
  const existing = new Map(existingPages.map((item) => [item.path, item]));
  const missingPages = requiredPaths.filter((pagePath) => !actualPaths.has(pagePath));
  const extraPages = actual.filter((item) => !required.has(item.path)).map((item) => item.path);
  const humanEditedPages = requiredPaths.filter((pagePath) => {
    const page = existing.get(pagePath);
    return Boolean(page?.humanEdited || (actualPaths.has(pagePath) && committedHashes[pagePath] && actual.find((item) => item.path === pagePath)?.sha256 !== committedHashes[pagePath]));
  });
  const workflowMode = entry?.release_knowledge?.mode || entry?.workflow_mode || '';
  const established = workflowMode === 'release-knowledge' || actual.length > 0;
  const complete = missingPages.length === 0 && extraPages.length === 0;
  return {
    mode: workflowMode === 'release-knowledge' ? 'release-knowledge' : '',
    established,
    complete,
    healthy: complete && humanEditedPages.length === 0,
    rootPath: releaseRoot,
    requiredPaths,
    actualPages: actual,
    missingPages,
    extraPages,
    humanEditedPages
  };
};

const assertSafeDirectoryChain = async (rootPath, directoryPath) => {
  const root = path.resolve(rootPath);
  const directory = path.resolve(directoryPath);
  if (!pathInside(root, directory)) throw new WikiBasicError('path-escape', '项目知识目录越过知识库范围。');
  const relative = path.relative(root, directory);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const info = await fsp.lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new WikiBasicError('unsafe-project-directory', '项目知识目录不能包含文件、符号链接或目录联接。');
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
};

const normalizedPageHashes = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([pagePath, digest]) => typeof pagePath === 'string' && /^[a-f0-9]{64}$/iu.test(digest || ''))
    .map(([pagePath, digest]) => [pagePath.replace(/\\/g, '/'), digest.toLowerCase()]));
};

const sortedPageHashes = (entries) => Object.fromEntries([...entries]
  .filter(([pagePath, digest]) => typeof pagePath === 'string' && /^[a-f0-9]{64}$/iu.test(digest || ''))
  .sort(([left], [right]) => left.localeCompare(right)));

const recoveryMarkerPath = (vaultPath) => path.join(vaultPath, '_staging', WIKI_RECOVERY_MARKER_NAME);

const requireSafeRecoveryStaging = async (vaultPath, { create = false, allowMissing = false } = {}) => {
  const staging = path.join(vaultPath, '_staging');
  try {
    await assertSafeDirectoryChain(vaultPath, staging);
  } catch (error) {
    if (error?.code === 'unsafe-project-directory') throw new WikiBasicError('unsafe-recovery-staging', 'Wiki 恢复目录不能包含符号链接或目录联接。');
    throw error;
  }
  if (create) await fsp.mkdir(staging, { recursive: true });
  let info;
  try {
    info = await fsp.lstat(staging);
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WikiBasicError('unsafe-recovery-staging', 'Wiki 恢复目录不能是文件、符号链接或目录联接。');
  }
  await assertSafeDirectoryChain(vaultPath, staging);
  const [realVault, realStaging] = await Promise.all([fsp.realpath(vaultPath), fsp.realpath(staging)]);
  if (normalizedPathKey(realStaging) !== normalizedPathKey(path.join(realVault, '_staging'))) {
    throw new WikiBasicError('unsafe-recovery-staging', 'Wiki 恢复目录解析到知识库之外，已停止操作。');
  }
  return staging;
};

const directoryIdentity = async (directoryPath) => {
  const info = await fsp.lstat(directoryPath, { bigint: true });
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    birthtimeNs: String(info.birthtimeNs ?? ''),
    isDirectory: info.isDirectory(),
    isSymbolicLink: info.isSymbolicLink()
  };
};

const regularFileIdentityFromInfo = (info) => ({
  dev: String(info.dev),
  ino: String(info.ino),
  birthtimeNs: String(info.birthtimeNs ?? ''),
  isFile: info.isFile(),
  isSymbolicLink: info.isSymbolicLink()
});

const sameRegularFileIdentity = (left, right) => Boolean(left && right
  && left.isFile && right.isFile
  && !left.isSymbolicLink && !right.isSymbolicLink
  && left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs);

const sameDirectoryIdentity = (left, right) => Boolean(left && right
  && left.isDirectory && right.isDirectory
  && !left.isSymbolicLink && !right.isSymbolicLink
  && left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs);

const assertWriteParentStable = async (write) => {
  const parent = path.dirname(write.absolute);
  const current = await directoryIdentity(parent);
  if (!current.isDirectory || current.isSymbolicLink) {
    write.unsafeParent = true;
    throw new WikiBasicError('unsafe-target-directory', `Wiki 目标目录 ${write.path} 不是普通目录，已停止操作。`);
  }
  if (!write.parentIdentity) {
    write.parentIdentity = current;
    return current;
  }
  if (!sameDirectoryIdentity(write.parentIdentity, current)) {
    write.unsafeParent = true;
    throw new WikiBasicError('unsafe-target-directory', `Wiki 目标目录 ${write.path} 在写入期间被替换，已保留恢复现场。`);
  }
  return current;
};

const assertClaimedRecoveryStaging = async (vaultPath, claimPath, expectedIdentity) => {
  if (path.dirname(path.resolve(claimPath)) !== path.resolve(vaultPath)
    || !path.basename(claimPath).startsWith('_staging-recovery-clear-')) {
    throw new WikiBasicError('unsafe-recovery-staging', 'Wiki 恢复目录认领位置无效。');
  }
  const info = await fsp.lstat(claimPath);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WikiBasicError('unsafe-recovery-staging', '已认领的 Wiki 恢复目录不是普通目录，已隔离并停止操作。');
  }
  const claimedIdentity = await directoryIdentity(claimPath);
  if (!sameDirectoryIdentity(expectedIdentity, claimedIdentity)) {
    throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复目录在认领前被替换，已隔离并停止操作。');
  }
  await assertSafeDirectoryChain(vaultPath, claimPath);
  const [realVault, realClaim] = await Promise.all([fsp.realpath(vaultPath), fsp.realpath(claimPath)]);
  if (normalizedPathKey(realClaim) !== normalizedPathKey(path.join(realVault, path.basename(claimPath)))) {
    throw new WikiBasicError('unsafe-recovery-staging', '已认领的 Wiki 恢复目录解析到知识库之外，已隔离并停止操作。');
  }
  return claimPath;
};

const assertRetainedRecoveryStaging = async (vaultPath, archivePath, retainedPath, expectedIdentity, token) => {
  const expectedName = `_cleared-staging-${token}`;
  if (path.dirname(path.resolve(retainedPath)) !== path.resolve(archivePath)
    || path.basename(retainedPath) !== expectedName
    || !pathInside(path.join(vaultPath, '_archives'), retainedPath)) {
    throw new WikiBasicError('unsafe-recovery-staging', 'Wiki 恢复目录归档位置无效。');
  }
  const info = await fsp.lstat(retainedPath);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WikiBasicError('unsafe-recovery-staging', '已归档的 Wiki 恢复目录不是普通目录，已停止操作。');
  }
  const retainedIdentity = await directoryIdentity(retainedPath);
  if (!sameDirectoryIdentity(expectedIdentity, retainedIdentity)) {
    throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复目录归档后身份发生变化，已保留保护锁。');
  }
  await assertSafeDirectoryChain(vaultPath, retainedPath);
  const [realArchive, realRetained] = await Promise.all([fsp.realpath(archivePath), fsp.realpath(retainedPath)]);
  if (normalizedPathKey(realRetained) !== normalizedPathKey(path.join(realArchive, expectedName))) {
    throw new WikiBasicError('unsafe-recovery-staging', '已归档的 Wiki 恢复目录解析到预期归档之外。');
  }
  return retainedPath;
};

const readWikiRecoveryMarkerFile = async (vault, markerPath) => {
  if (!pathInside(vault, markerPath)) throw new WikiBasicError('unsafe-recovery-marker', 'Wiki 恢复标记越过知识库范围。');
  let opened;
  try {
    const info = await fsp.lstat(markerPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > WIKI_RECOVERY_MARKER_MAX_BYTES) {
      throw new WikiBasicError('unsafe-recovery-marker', 'Wiki 恢复标记不是安全的小型普通文件。');
    }
    opened = await readBoundedRegularFile(markerPath, WIKI_RECOVERY_MARKER_MAX_BYTES);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (!opened) throw new WikiBasicError('unsafe-recovery-marker', 'Wiki 恢复标记超出安全上限。');
  let marker;
  try { marker = JSON.parse(opened.bytes.toString('utf8')); } catch {}
  const kind = WIKI_RECOVERY_ARCHIVE_KINDS[marker?.operation];
  const expectedPrefix = kind ? `_archives/${kind}/` : '';
  const failures = Array.isArray(marker?.failures) ? marker.failures : null;
  if (!marker || marker.version !== 1 || !kind
    || typeof marker.id !== 'string' || !/^[a-f0-9-]{36}$/iu.test(marker.id)
    || typeof marker.archive !== 'string' || !marker.archive.startsWith(expectedPrefix)
    || !/^[A-Za-z0-9-]{20,160}$/u.test(marker.archive.slice(expectedPrefix.length))
    || typeof marker.createdAt !== 'string' || !Number.isFinite(Date.parse(marker.createdAt))
    || (marker.originalCode !== undefined && (typeof marker.originalCode !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(marker.originalCode)))
    || !failures || failures.length < 1 || failures.length > 64
    || failures.some((item) => typeof item !== 'string' || item.length < 1 || item.length > 300)) {
    throw new WikiBasicError('unsafe-recovery-marker', 'Wiki 恢复标记内容无效，已禁止自动定位恢复目录。');
  }
  const archivePath = path.join(vault, ...marker.archive.split('/'));
  if (!pathInside(path.join(vault, '_archives'), archivePath)) {
    throw new WikiBasicError('unsafe-recovery-marker', 'Wiki 恢复标记指向知识库归档范围之外。');
  }
  await assertSafeDirectoryChain(vault, archivePath);
  const archiveInfo = await fsp.lstat(archivePath);
  if (!archiveInfo.isDirectory() || archiveInfo.isSymbolicLink()) {
    throw new WikiBasicError('unsafe-recovery-marker', 'Wiki 恢复标记指向的归档目录不可用。');
  }
  return {
    version: 1,
    id: marker.id,
    operation: marker.operation,
    archive: marker.archive,
    archivePath,
    createdAt: marker.createdAt,
    originalCode: marker.originalCode || 'wiki-write-failed',
    failures: failures.map((item) => oneLine(item, 300)),
    markerSha256: sha256Text(opened.bytes)
  };
};

const readWikiRecoveryMarker = async (vaultPath) => {
  const vault = await assertPlainDirectory(vaultPath);
  const staging = await requireSafeRecoveryStaging(vault, { allowMissing: true });
  if (!staging) return null;
  return readWikiRecoveryMarkerFile(vault, path.join(staging, WIKI_RECOVERY_MARKER_NAME));
};

const writeWikiRecoveryMarker = async ({ vaultPath, archiveRoot, operation, originalError, failures }) => {
  const kind = WIKI_RECOVERY_ARCHIVE_KINDS[operation];
  if (!kind) throw new WikiBasicError('invalid-recovery-operation', 'Wiki 恢复事务类型无效。');
  const archive = path.relative(vaultPath, archiveRoot).replace(/\\/g, '/');
  if (!archive.startsWith(`_archives/${kind}/`)) throw new WikiBasicError('unsafe-recovery-archive', 'Wiki 恢复事务归档路径无效。');
  const marker = {
    version: 1,
    id: randomUUID(),
    operation,
    archive,
    createdAt: isoNow(),
    originalCode: oneLine(originalError?.code || 'wiki-write-failed', 80).toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'wiki-write-failed',
    failures: failures.slice(0, 64).map((item) => oneLine(item, 300))
  };
  const staging = await requireSafeRecoveryStaging(vaultPath, { create: true });
  await assertSafeDirectoryChain(vaultPath, staging);
  const archiveMarkerPath = path.join(archiveRoot, `_recovery-marker-${marker.id}.json`);
  const markerText = `${JSON.stringify(marker, null, 2)}\n`;
  await atomicWriteText(archiveMarkerPath, markerText);
  try {
    await writeNewTextAtomically(path.join(staging, WIKI_RECOVERY_MARKER_NAME), markerText);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new WikiBasicError('recovery-marker-exists', '已有 Wiki 恢复标记，未覆盖原标记。');
    throw error;
  }
  await requireSafeRecoveryStaging(vaultPath);
  return marker;
};

const clearWikiRecoveryMarker = async (vaultPath, expectedProtection) => {
  const vault = await assertPlainDirectory(vaultPath);
  const interruptedGuard = await readWikiRecoveryClearGuard(vault);
  if (interruptedGuard) return resumeWikiRecoveryClearGuard(vault, interruptedGuard, expectedProtection);
  const guard = await acquireWikiRecoveryClearGuard(vault);
  let protection = null;
  let stagingClaim = '';
  let retainedDirectory = '';
  let stagingMoved = false;
  let stagingClaimAttempted = false;
  let stagingIdentity = null;
  let freshStagingIdentity = null;
  let phase = 'created';
  let benignExit = false;
  try {
    const staging = await requireSafeRecoveryStaging(vault, { allowMissing: true });
    if (!staging) {
      benignExit = true;
      await archiveWikiRecoveryClearGuard(guard);
      return { ok: true, cleared: false };
    }
    await assertNoLegacyWikiWriteLocks(staging);
    stagingIdentity = await directoryIdentity(staging);
    const rawLock = await readWikiWriteLockAtStaging(staging);
    const recoverableRawLock = rawLock?.record?.state === 'recovery-required'
      || (rawLock?.record?.state === 'held' && typeof rawLock.record.archive === 'string' && !processIsActive(Number(rawLock.record.pid) || 0));
    if (rawLock && !recoverableRawLock) throw new WikiBasicError('wiki-write-busy', 'Wiki 正在写入，不能同时解除恢复保护。');
    protection = await readWikiRecoveryProtectionAtStaging(vault, staging, rawLock);
    if (!protection) {
      if (rawLock) throw new WikiBasicError('wiki-write-busy', 'Wiki 正在写入，不能同时解除恢复保护。');
      benignExit = true;
      await archiveWikiRecoveryClearGuard(guard);
      return { ok: true, cleared: false };
    }
    assertExpectedWikiRecoveryProtection(protection, expectedProtection);
    await writeWikiRecoveryClearGuardRecord(guard, {
      state: 'clearing',
      phase: 'protection-validated',
      archive: protection.archive,
      protection: wikiRecoveryProtectionIdentity(protection)
    });
    phase = 'protection-validated';

    stagingClaim = path.join(vault, `_staging-recovery-clear-${guard.token}`);
    guard.claimedStaging = path.basename(stagingClaim);
    await writeWikiRecoveryClearGuardRecord(guard, {
      state: 'clearing',
      phase: 'prepared',
      archive: protection.archive,
      protection: wikiRecoveryProtectionIdentity(protection),
      claimedStaging: guard.claimedStaging,
      stagingIdentity
    });
    phase = 'prepared';
    try {
      stagingClaimAttempted = true;
      await fsp.rename(staging, stagingClaim);
      stagingMoved = true;
    } catch (error) {
      const claimInfo = await fsp.lstat(stagingClaim).catch(() => null);
      const sourceInfo = await fsp.lstat(staging).catch(() => null);
      if (!claimInfo && sourceInfo) {
        await requireSafeRecoveryStaging(vault);
        stagingClaimAttempted = false;
        throw error;
      }
      if (!claimInfo || sourceInfo) throw error;
      stagingMoved = true;
    }
    await assertClaimedRecoveryStaging(vault, stagingClaim, stagingIdentity);
    const claimedLock = await readWikiWriteLockAtStaging(stagingClaim);
    const claimedProtection = await readWikiRecoveryProtectionAtStaging(vault, stagingClaim, claimedLock);
    if (!claimedProtection || !sameWikiRecoveryProtection(protection, claimedProtection)) {
      throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复保护在解除期间发生变化，已保留现场。');
    }
    phase = 'claimed';
    await writeWikiRecoveryClearGuardRecord(guard, {
      state: 'clearing',
      phase,
      archive: protection.archive,
      protection: wikiRecoveryProtectionIdentity(protection),
      claimedStaging: guard.claimedStaging,
      stagingIdentity
    });

    retainedDirectory = path.join(protection.archivePath, `_cleared-staging-${guard.token}`);
    await assertSafeDirectoryChain(vault, protection.archivePath);
    try {
      await fsp.rename(stagingClaim, retainedDirectory);
      stagingMoved = false;
    } catch (error) {
      const retainedInfo = await fsp.lstat(retainedDirectory).catch(() => null);
      const claimInfo = await fsp.lstat(stagingClaim).catch(() => null);
      if (!retainedInfo?.isDirectory() || retainedInfo.isSymbolicLink() || claimInfo) throw error;
      stagingMoved = false;
    }
    await assertRetainedRecoveryStaging(vault, protection.archivePath, retainedDirectory, stagingIdentity, guard.token);
    phase = 'retained';
    await writeWikiRecoveryClearGuardRecord(guard, {
      state: 'clearing',
      phase,
      archive: protection.archive,
      protection: wikiRecoveryProtectionIdentity(protection),
      claimedStaging: guard.claimedStaging,
      retainedStaging: path.basename(retainedDirectory),
      stagingIdentity
    });
    await fsp.mkdir(path.join(vault, '_staging'));
    await requireSafeRecoveryStaging(vault);
    freshStagingIdentity = await directoryIdentity(path.join(vault, '_staging'));
    phase = 'staging-created';
    await writeWikiRecoveryClearGuardRecord(guard, {
      state: 'clearing',
      phase,
      archive: protection.archive,
      protection: wikiRecoveryProtectionIdentity(protection),
      claimedStaging: guard.claimedStaging,
      retainedStaging: path.basename(retainedDirectory),
      stagingIdentity,
      freshStagingIdentity
    });
    forgetRecoveredWikiWriteLock(vault, protection);
    const retainedGuardPath = await archiveWikiRecoveryClearGuard(guard, protection.archivePath);
    return {
      ok: true,
      cleared: true,
      archive: protection.archive,
      protectionType: protection.type,
      retainedStaging: path.relative(vault, retainedDirectory).replace(/\\/g, '/'),
      retainedGuard: path.relative(vault, retainedGuardPath).replace(/\\/g, '/')
    };
  } catch (error) {
    if (benignExit) throw error;
    if (!stagingClaimAttempted) {
      let archiveError;
      try {
        await archiveWikiRecoveryClearGuard(guard, protection?.archivePath || '');
      } catch (failure) {
        archiveError = failure;
      }
      if (archiveError) throw new AggregateError([error, archiveError], 'Wiki 恢复保护未变更，但临时清理保护锁未能安全归档。');
      throw error;
    }
    let guardError;
    try {
      await retainWikiRecoveryClearGuard(guard, {
        phase,
        archive: protection?.archive || '',
        protection: protection ? wikiRecoveryProtectionIdentity(protection) : undefined,
        claimedStaging: stagingClaim ? path.basename(stagingClaim) : '',
        retainedStaging: retainedDirectory ? path.basename(retainedDirectory) : '',
        stagingIdentity: stagingIdentity || undefined,
        freshStagingIdentity: freshStagingIdentity || undefined,
        failure: oneLine(error?.code || error?.message || 'recovery-clear-failed', 160)
      });
    } catch (failure) {
      guardError = failure;
    }
    if (guardError) throw new AggregateError([error, guardError], 'Wiki 恢复保护解除失败，且清理保护锁未能完整记录。');
    throw error;
  }
};

const createWikiTransactionArchive = async (vaultPath, kind, timestamp, files) => {
  const transactionId = `${timestamp.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const archiveRoot = path.join(vaultPath, '_archives', kind, transactionId);
  await assertSafeDirectoryChain(vaultPath, path.dirname(archiveRoot));
  await fsp.mkdir(archiveRoot, { recursive: true });
  await assertSafeDirectoryChain(vaultPath, archiveRoot);
  for (const file of files) {
    const target = path.join(archiveRoot, file.path);
    if (!pathInside(archiveRoot, target)) throw new WikiBasicError('path-escape', '恢复副本路径越过事务归档目录。');
    await assertSafeDirectoryChain(archiveRoot, path.dirname(target));
    await atomicWriteText(target, file.text);
  }
  return archiveRoot;
};

const readRollbackTarget = async (filePath) => {
  try {
    const info = await fsp.lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKDOWN_BYTES) return { state: 'unsafe' };
    const opened = await readBoundedRegularFile(filePath, MAX_MARKDOWN_BYTES);
    return opened ? { state: 'file', text: opened.bytes.toString('utf8') } : { state: 'unsafe' };
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing' };
    throw error;
  }
};

const assertExpectedPageState = async (write, { staleCode, staleMessage, untrackedCode, untrackedMessage }) => {
  const current = await readRollbackTarget(write.absolute);
  if (write.exists) {
    if (current.state !== 'file' || sha256Text(current.text) !== write.expectedSha256) {
      throw new WikiBasicError(staleCode, staleMessage);
    }
    return current.text;
  }
  if (current.state !== 'missing') throw new WikiBasicError(untrackedCode, untrackedMessage);
  return '';
};

const transactionClaimPath = async (vaultPath, archiveRoot, phase, relativePath) => {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('//') || normalized.length > 520) {
    throw new WikiBasicError('unsafe-transaction-path', 'Wiki 事务文件路径无效。');
  }
  const segments = normalized.split('/');
  const filename = segments.pop();
  const claim = path.join(archiveRoot, '_claims', phase, ...segments, `${filename}.${randomUUID()}.claim`);
  if (!pathInside(archiveRoot, claim)) throw new WikiBasicError('path-escape', 'Wiki 事务认领路径越过恢复归档。');
  await assertSafeDirectoryChain(vaultPath, path.dirname(claim));
  await fsp.mkdir(path.dirname(claim), { recursive: true });
  await assertSafeDirectoryChain(vaultPath, path.dirname(claim));
  try {
    await fsp.lstat(claim);
    throw new WikiBasicError('transaction-claim-exists', 'Wiki 事务认领位置已存在，已停止写入。');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return claim;
};

const publishRegularClaimIfMissing = async (claimPath, targetPath) => {
  const claimed = await readRollbackTarget(claimPath);
  if (claimed.state !== 'file') return { restored: false, reason: `claim-${claimed.state}` };
  try {
    await writeNewTextAtomically(targetPath, claimed.text);
    return { restored: true, text: claimed.text };
  } catch (error) {
    if (error?.code === 'EEXIST') return { restored: false, reason: 'target-reappeared' };
    return { restored: false, reason: error?.code || error?.message || 'claim-publish-failed' };
  }
};

const writeExpectedPage = async (write, errors, { vaultPath, archiveRoot } = {}) => {
  await assertWriteParentStable(write);
  if (!write.exists) {
    try {
      const result = await writeNewTextAtomically(write.absolute, write.text);
      write.transactionTouched = true;
      write.published = true;
      await assertWriteParentStable(write);
      return result;
    } catch (error) {
      if (error?.code === 'EEXIST') throw new WikiBasicError(errors.untrackedCode, errors.untrackedMessage);
      throw error;
    }
  }
  const resolved = path.resolve(write.absolute);
  const temp = `${resolved}.${process.pid}-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fsp.open(temp, 'wx', 0o600);
    await handle.writeFile(write.text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    const claimPath = await transactionClaimPath(vaultPath, archiveRoot, 'prewrite', write.path);
    write.transactionTouched = true;
    write.prewriteClaim = claimPath;
    await assertWriteParentStable(write);
    try {
      await fsp.rename(resolved, claimPath);
    } catch (error) {
      const [claimedAfterError, liveAfterError] = await Promise.all([
        readRollbackTarget(claimPath).catch(() => ({ state: 'unavailable' })),
        readRollbackTarget(resolved).catch(() => ({ state: 'unavailable' }))
      ]);
      const claimMatches = claimedAfterError.state === 'file' && sha256Text(claimedAfterError.text) === write.expectedSha256;
      if (!claimMatches || liveAfterError.state !== 'missing') {
        if (error?.code === 'ENOENT') throw new WikiBasicError(errors.staleCode, errors.staleMessage);
        throw error;
      }
    }
    const claimed = await readRollbackTarget(claimPath);
    if (claimed.state !== 'file' || sha256Text(claimed.text) !== write.expectedSha256) {
      await publishRegularClaimIfMissing(claimPath, resolved);
      throw new WikiBasicError(errors.staleCode, errors.staleMessage);
    }
    let publicationRecovered = false;
    await assertWriteParentStable(write);
    try {
      await fsp.link(temp, resolved);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new WikiBasicError(errors.staleCode, errors.staleMessage);
      const current = await readRollbackTarget(resolved).catch(() => ({ state: 'unavailable' }));
      if (current.state !== 'file' || current.text !== write.text) throw error;
      publicationRecovered = true;
    }
    write.published = true;
    await assertWriteParentStable(write);
    return { cleanupPending: false, publicationRecovered };
  } finally {
    await handle?.close().catch(() => undefined);
    await fsp.unlink(temp).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
};

const assertTransactionClaimsStable = async (writes, code, message) => {
  for (const write of writes) {
    if (!write.exists || !write.prewriteClaim) continue;
    const claimed = await readRollbackTarget(write.prewriteClaim);
    if (claimed.state !== 'file' || sha256Text(claimed.text) !== write.expectedSha256) {
      throw new WikiBasicError(code, `${message}（${write.path}）`);
    }
  }
};

const rollbackWikiTransaction = async ({ vaultPath, archiveRoot, operation, writes, originalError }) => {
  const failures = [];
  for (const write of [...writes].reverse()) {
    try {
      if (!write.transactionTouched) continue;
      if (write.unsafeParent) throw new Error('target-parent-changed');
      if (!write.published) {
        const current = await readRollbackTarget(write.absolute);
        if (current.state === 'file' && current.text === write.text) {
          write.published = true;
        } else {
          if (current.state === 'unsafe') throw new Error('unpublished-target-unsafe');
          if (write.exists && write.prewriteClaim && current.state === 'missing') {
            const restored = await publishRegularClaimIfMissing(write.prewriteClaim, write.absolute);
            if (!restored.restored) throw new Error(restored.reason || 'prewrite-claim-restore-failed');
          }
          continue;
        }
      }
      const rollbackClaim = await transactionClaimPath(vaultPath, archiveRoot, 'rollback', write.path);
      write.rollbackClaim = rollbackClaim;
      try {
        await fsp.rename(write.absolute, rollbackClaim);
      } catch (error) {
        const [claimedAfterError, liveAfterError] = await Promise.all([
          readRollbackTarget(rollbackClaim).catch(() => ({ state: 'unavailable' })),
          readRollbackTarget(write.absolute).catch(() => ({ state: 'unavailable' }))
        ]);
        if (claimedAfterError.state === 'file' && claimedAfterError.text === write.text && liveAfterError.state === 'missing') {
          // The rename completed even though the platform reported an error.
        } else {
          if (error?.code === 'ENOENT') {
            if (!write.exists) continue;
            throw new Error('concurrent-target-missing');
          }
          throw error;
        }
      }
      const current = await readRollbackTarget(rollbackClaim);
      if (current.state !== 'file') throw new Error(`concurrent-target-${current.state}`);
      if (current.text !== write.text) {
        const preserved = await publishRegularClaimIfMissing(rollbackClaim, write.absolute);
        if (!preserved.restored) throw new Error(`concurrent-content-${preserved.reason || 'preserve-failed'}`);
        throw new Error('concurrent-content-preserved');
      }
      if (!write.exists) continue;
      if (!write.prewriteClaim) throw new Error('prewrite-claim-missing');
      const original = await readRollbackTarget(write.prewriteClaim);
      if (original.state !== 'file') throw new Error(`prewrite-claim-${original.state}`);
      const restored = await publishRegularClaimIfMissing(write.prewriteClaim, write.absolute);
      if (!restored.restored) throw new Error(restored.reason || 'prewrite-claim-restore-failed');
      if (sha256Text(original.text) !== write.expectedSha256) throw new Error('concurrent-prewrite-content-preserved');
    } catch (error) {
      failures.push(`${write.path}: ${error?.code || error?.message || 'restore-failed'}`);
    }
  }
  if (!failures.length) return;
  const archive = path.relative(vaultPath, archiveRoot).replace(/\\/g, '/');
  let markerWritten = false;
  try {
    await writeWikiRecoveryMarker({ vaultPath, archiveRoot, operation, originalError, failures });
    markerWritten = true;
  } catch (error) {
    failures.push(`${WIKI_RECOVERY_MARKER_NAME}: ${error?.code || error?.message || 'marker-write-failed'}`);
  }
  const rollbackError = new WikiBasicError(
    'rollback-incomplete',
    `Wiki 写入失败，且自动回退未能完整恢复。请保留现场并从 ${archive} 手动恢复。`
  );
  rollbackError.archive = archive;
  rollbackError.originalCode = originalError?.code || 'wiki-write-failed';
  rollbackError.rollbackFailures = failures;
  rollbackError.cause = originalError;
  rollbackError.retainWriteLock = !markerWritten;
  throw rollbackError;
};

const waitForWikiLockRetry = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const retryWikiLockTransient = async (operation) => {
  let lastError;
  for (const delayMs of WIKI_WRITE_LOCK_RETRY_DELAYS_MS) {
    if (delayMs > 0) await waitForWikiLockRetry(delayMs);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!WIKI_WRITE_LOCK_TRANSIENT_CODES.has(error?.code)) throw error;
    }
  }
  throw lastError;
};

const readWikiWriteLockRecord = async (lockPath) => {
  const info = await fsp.lstat(lockPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > WIKI_WRITE_LOCK_MAX_BYTES) {
    throw new WikiBasicError('unsafe-wiki-write-lock', '知识库写入锁不是安全的普通文件，已停止写入。');
  }
  const opened = await readBoundedRegularFile(lockPath, WIKI_WRITE_LOCK_MAX_BYTES);
  if (!opened) throw new WikiBasicError('unsafe-wiki-write-lock', '知识库写入锁超出安全大小，已停止写入。');
  let record = {};
  try { record = JSON.parse(opened.bytes.toString('utf8') || '{}'); } catch {}
  return {
    info,
    record: record && typeof record === 'object' && !Array.isArray(record) ? record : {},
    digest: sha256Text(opened.bytes)
  };
};

const readWikiWriteLockAtStaging = async (staging) => {
  const lockPath = path.join(staging, WIKI_WRITE_LOCK_NAME);
  try {
    return await readWikiWriteLockRecord(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const readWikiRecoveryLockAtStaging = async (vaultPath, staging, current = null) => {
  const lock = current || await readWikiWriteLockAtStaging(staging);
  if (!lock) return null;
  const recoverableCrash = lock.record.state === 'held'
    && typeof lock.record.archive === 'string'
    && !processIsActive(Number(lock.record.pid) || 0);
  if (lock.record.state !== 'recovery-required' && !recoverableCrash) return null;
  const kind = WIKI_RECOVERY_ARCHIVE_KINDS[lock.record.operation];
  const archive = typeof lock.record.archive === 'string' ? lock.record.archive.replace(/\\/g, '/') : '';
  if (!kind || !archive.startsWith(`_archives/${kind}/`)) {
    throw new WikiBasicError('unsafe-wiki-write-lock', 'Wiki 恢复保护锁缺少有效归档信息，已停止写入。');
  }
  const archivePath = path.join(vaultPath, ...archive.split('/'));
  if (!pathInside(path.join(vaultPath, '_archives'), archivePath)) throw new WikiBasicError('unsafe-wiki-write-lock', 'Wiki 恢复保护锁指向归档范围之外。');
  await assertSafeDirectoryChain(vaultPath, archivePath);
  const archiveInfo = await fsp.lstat(archivePath);
  if (!archiveInfo.isDirectory() || archiveInfo.isSymbolicLink()) {
    throw new WikiBasicError('unsafe-wiki-write-lock', 'Wiki 恢复保护锁指向的归档目录不可用。');
  }
  return {
    type: 'retained-lock',
    operation: lock.record.operation,
    archive,
    archivePath,
    createdAt: oneLine(lock.record.started || '', 80),
    originalCode: oneLine(lock.record.originalCode || (recoverableCrash ? 'interrupted-write' : 'rollback-incomplete'), 80),
    failures: [recoverableCrash ? '检测到写入进程已结束，DSH 已保留带事务归档的写入锁。' : '恢复标记未能发布，DSH 已保留写入保护锁。'],
    lockProtected: true,
    lockToken: oneLine(lock.record.token || '', 80),
    lockSha256: lock.digest,
    interrupted: recoverableCrash
  };
};

const readWikiRecoveryLock = async (vaultPath) => {
  const vault = await assertPlainDirectory(vaultPath);
  const staging = await requireSafeRecoveryStaging(vault, { allowMissing: true });
  if (!staging) return null;
  return readWikiRecoveryLockAtStaging(vault, staging);
};

const recoveryClearGuardPath = (vaultPath) => path.join(vaultPath, WIKI_RECOVERY_CLEAR_GUARD_NAME);

const validRecoveryClearDirectoryIdentity = (identity) => Boolean(identity && typeof identity === 'object' && !Array.isArray(identity)
  && typeof identity.dev === 'string' && identity.dev.length > 0
  && typeof identity.ino === 'string' && identity.ino.length > 0
  && typeof identity.birthtimeNs === 'string'
  && identity.isDirectory === true && identity.isSymbolicLink === false);

const validRecoveryClearProtectionIdentity = (identity) => Boolean(identity && typeof identity === 'object' && !Array.isArray(identity)
  && ['marker', 'retained-lock'].includes(identity.type)
  && typeof identity.archive === 'string' && identity.archive.startsWith('_archives/')
  && typeof identity.id === 'string' && identity.id.length > 0 && identity.id.length <= 160
  && typeof identity.digest === 'string' && /^[a-f0-9]{64}$/u.test(identity.digest));

const validateWikiRecoveryClearGuardRecord = async (vaultPath, record, { requirePhase = false } = {}) => {
  const phases = new Set(['created', 'protection-validated', 'prepared', 'claimed', 'retained', 'staging-created']);
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || record.version !== 1
    || typeof record.token !== 'string' || !/^[a-f0-9-]{36}$/iu.test(record.token)
    || !Number.isSafeInteger(record.pid) || record.pid <= 0
    || !['clearing', 'recovery-required'].includes(record.state)
    || typeof record.started !== 'string' || !Number.isFinite(Date.parse(record.started))
    || (requirePhase && !phases.has(record.phase))
    || (record.phase !== undefined && !phases.has(record.phase))
    || (record.archive !== undefined && typeof record.archive !== 'string')
    || (record.claimedStaging !== undefined && typeof record.claimedStaging !== 'string')
    || (record.retainedStaging !== undefined && typeof record.retainedStaging !== 'string')
    || (record.failure !== undefined && (typeof record.failure !== 'string' || record.failure.length > 160))
    || (record.resumedAt !== undefined && (typeof record.resumedAt !== 'string' || !Number.isFinite(Date.parse(record.resumedAt))))
    || (record.protection !== undefined && !validRecoveryClearProtectionIdentity(record.protection))
    || (record.stagingIdentity !== undefined && !validRecoveryClearDirectoryIdentity(record.stagingIdentity))
    || (record.freshStagingIdentity !== undefined && !validRecoveryClearDirectoryIdentity(record.freshStagingIdentity))) {
    throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁内容无效。');
  }
  let archivePath = '';
  const archive = typeof record.archive === 'string' ? record.archive.replace(/\\/g, '/') : '';
  const expectedClaimedStaging = `_staging-recovery-clear-${record.token}`;
  const expectedRetainedStaging = `_cleared-staging-${record.token}`;
  if ((record.archive !== undefined && record.archive !== archive)
    || (record.protection && record.protection.archive !== archive)
    || (record.claimedStaging !== undefined && record.claimedStaging !== '' && record.claimedStaging !== expectedClaimedStaging)
    || (record.retainedStaging !== undefined && record.retainedStaging !== '' && record.retainedStaging !== expectedRetainedStaging)
    || (['protection-validated', 'prepared', 'claimed', 'retained', 'staging-created'].includes(record.phase) && (!record.protection || !archive))
    || (['prepared', 'claimed', 'retained', 'staging-created'].includes(record.phase) && (!record.stagingIdentity || record.claimedStaging !== expectedClaimedStaging))
    || (['retained', 'staging-created'].includes(record.phase) && record.retainedStaging !== expectedRetainedStaging)
    || (record.phase === 'staging-created' && !record.freshStagingIdentity)) {
    throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁阶段信息无效。');
  }
  if (archive) {
    if (!archive.startsWith('_archives/')) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁归档路径无效。');
    archivePath = path.join(vaultPath, ...archive.split('/'));
    if (!pathInside(path.join(vaultPath, '_archives'), archivePath)) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁指向归档范围之外。');
    await assertSafeDirectoryChain(vaultPath, archivePath);
    const archiveInfo = await fsp.lstat(archivePath);
    if (!archiveInfo.isDirectory() || archiveInfo.isSymbolicLink()) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁指向的归档目录不可用。');
  }
  return { record, archive, archivePath };
};

const sameRecoveryClearProtectionIdentity = (left, right) => Boolean(left && right
  && left.type === right.type && left.archive === right.archive
  && left.id === right.id && left.digest === right.digest);

const assertWikiRecoveryClearRecordContinuation = (previous, current) => {
  if (!previous) return;
  const phaseRank = new Map([
    ['created', 0],
    ['protection-validated', 1],
    ['prepared', 2],
    ['claimed', 3],
    ['retained', 4],
    ['staging-created', 5]
  ]);
  const stale = previous.token !== current.token
    || previous.started !== current.started
    || phaseRank.get(current.phase) < phaseRank.get(previous.phase)
    || (phaseRank.has(previous.phase) && phaseRank.has(current.phase)
      && phaseRank.get(current.phase) > phaseRank.get(previous.phase) + 1)
    || (previous.archive && current.archive !== previous.archive)
    || (previous.protection && !sameRecoveryClearProtectionIdentity(previous.protection, current.protection))
    || (previous.claimedStaging && current.claimedStaging !== previous.claimedStaging)
    || (previous.retainedStaging && current.retainedStaging !== previous.retainedStaging)
    || (previous.stagingIdentity && !sameDirectoryIdentity(previous.stagingIdentity, current.stagingIdentity))
    || (previous.freshStagingIdentity && !sameDirectoryIdentity(previous.freshStagingIdentity, current.freshStagingIdentity));
  if (stale) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志阶段或身份链无效。');
};

const decodeWikiRecoveryClearJournalFrame = (lineBytes) => {
  const line = lineBytes.toString('utf8');
  if (!line.startsWith(WIKI_RECOVERY_CLEAR_JOURNAL_MAGIC) || !line.endsWith('\n')) {
    throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志帧不完整。');
  }
  const encoded = line.slice(WIKI_RECOVERY_CLEAR_JOURNAL_MAGIC.length, -1);
  const separator = encoded.lastIndexOf('.');
  const payloadText = separator > 0 ? encoded.slice(0, separator) : '';
  const checksum = separator > 0 ? encoded.slice(separator + 1) : '';
  if (!/^[A-Za-z0-9_-]+$/u.test(payloadText) || !/^[a-f0-9]{64}$/u.test(checksum)) {
    throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志帧格式无效。');
  }
  let payloadBytes;
  let payload;
  try {
    payloadBytes = Buffer.from(payloadText, 'base64url');
    if (payloadBytes.toString('base64url') !== payloadText || sha256Text(payloadBytes) !== checksum) throw new Error('checksum-mismatch');
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志帧校验失败。');
  }
  const allowedKeys = new Set(['journalVersion', 'sequence', 'previousFrameSha256', 'discardedTail', 'record']);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).some((key) => !allowedKeys.has(key))
    || payload.journalVersion !== 1
    || !Number.isSafeInteger(payload.sequence) || payload.sequence <= 0
    || typeof payload.previousFrameSha256 !== 'string'
    || (payload.previousFrameSha256 !== '' && !/^[a-f0-9]{64}$/u.test(payload.previousFrameSha256))
    || !payload.record || typeof payload.record !== 'object' || Array.isArray(payload.record)
    || (payload.discardedTail !== undefined && (!payload.discardedTail || typeof payload.discardedTail !== 'object'
      || Array.isArray(payload.discardedTail) || Object.keys(payload.discardedTail).some((key) => !['bytes', 'sha256'].includes(key))
      || !Number.isSafeInteger(payload.discardedTail.bytes) || payload.discardedTail.bytes <= 0
      || typeof payload.discardedTail.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(payload.discardedTail.sha256)))) {
    throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志帧负载无效。');
  }
  return { payload, frameSha256: sha256Text(lineBytes) };
};

const parseWikiRecoveryClearJournal = async (vaultPath, bytes) => {
  const magic = Buffer.from(WIKI_RECOVERY_CLEAR_JOURNAL_MAGIC, 'ascii');
  let cursor = 0;
  let lastCompleteOffset = 0;
  let lastSequence = 0;
  let lastFrameSha256 = '';
  let lastRecord = null;
  let legacy = false;

  if (bytes.length > 0 && !bytes.subarray(0, magic.length).equals(magic)) {
    const newline = bytes.indexOf(0x0a);
    if (newline >= 0) {
      const legacyLine = bytes.subarray(0, newline + 1);
      let legacyRecord;
      try { legacyRecord = JSON.parse(legacyLine.toString('utf8')); } catch {}
      if (!legacyRecord) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁包含完整但无效的日志记录。');
      const validated = await validateWikiRecoveryClearGuardRecord(vaultPath, legacyRecord);
      lastRecord = validated.record;
      lastFrameSha256 = sha256Text(legacyLine);
      lastCompleteOffset = newline + 1;
      cursor = lastCompleteOffset;
      legacy = true;
    }
  }

  while (cursor < bytes.length) {
    let candidate = bytes.indexOf(magic, cursor);
    if (candidate < 0) {
      const trailing = bytes.subarray(cursor);
      if (trailing.includes(0x0a)) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁包含完整但无效的日志记录。');
      break;
    }
    if (bytes.subarray(cursor, candidate).includes(0x0a)) {
      throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁包含未校验的完整日志记录。');
    }
    while (true) {
      const newline = bytes.indexOf(0x0a, candidate + magic.length);
      const nested = bytes.indexOf(magic, candidate + magic.length);
      if (nested >= 0 && (newline < 0 || nested < newline)) {
        candidate = nested;
        continue;
      }
      if (newline < 0) {
        candidate = -1;
        break;
      }
      const gap = bytes.subarray(cursor, candidate);
      const frameBytes = bytes.subarray(candidate, newline + 1);
      const decoded = decodeWikiRecoveryClearJournalFrame(frameBytes);
      const { payload } = decoded;
      if (payload.sequence !== lastSequence + 1 || payload.previousFrameSha256 !== lastFrameSha256) {
        throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志序号或哈希链无效。');
      }
      if (gap.length > 0) {
        if (!payload.discardedTail || payload.discardedTail.bytes !== gap.length
          || payload.discardedTail.sha256 !== sha256Text(gap)) {
          throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志未确认中断尾部。');
        }
      } else if (payload.discardedTail !== undefined) {
        throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志包含多余的尾部确认。');
      }
      const validated = await validateWikiRecoveryClearGuardRecord(vaultPath, payload.record, { requirePhase: true });
      if (!lastRecord && !legacy && validated.record.phase !== 'created') {
        throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁日志缺少初始阶段。');
      }
      assertWikiRecoveryClearRecordContinuation(lastRecord, validated.record);
      lastRecord = validated.record;
      lastSequence = payload.sequence;
      lastFrameSha256 = decoded.frameSha256;
      lastCompleteOffset = newline + 1;
      cursor = lastCompleteOffset;
      break;
    }
    if (candidate < 0) break;
  }

  return {
    record: lastRecord,
    uninitialized: !lastRecord,
    legacy,
    lastSequence,
    lastFrameSha256,
    lastCompleteOffset,
    trailingBytes: bytes.subarray(lastCompleteOffset)
  };
};

const recoveryClearUninitializedToken = (guardIdentity, digest) => {
  const value = sha256Text(`${digest}:${guardIdentity.dev}:${guardIdentity.ino}:${guardIdentity.birthtimeNs}`);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
};

const readWikiRecoveryClearGuardFile = async (vaultPath, guardPath) => {
  if (!pathInside(vaultPath, guardPath)) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁越过知识库范围。');
  let handle;
  let opened;
  let guardIdentity;
  try {
    handle = await fsp.open(guardPath, 'r');
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.isSymbolicLink() || info.size > BigInt(WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES)) {
      throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁不是安全的小型普通文件。');
    }
    guardIdentity = regularFileIdentityFromInfo(info);
    const buffer = Buffer.alloc(Math.min(WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES + 1, Math.max(1, Number(info.size) + 1)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES) throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁超出安全上限。');
    opened = { bytes: buffer.subarray(0, bytesRead), size: bytesRead };
    const currentInfo = await fsp.lstat(guardPath, { bigint: true });
    if (!sameRegularFileIdentity(guardIdentity, regularFileIdentityFromInfo(currentInfo))) {
      throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复清理保护锁在读取期间被替换。');
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
  const journal = await parseWikiRecoveryClearJournal(vaultPath, opened.bytes);
  const digest = sha256Text(opened.bytes);
  if (journal.uninitialized) {
    const token = recoveryClearUninitializedToken(guardIdentity, digest);
    const result = {
      type: 'clear-guard',
      operation: 'recovery-clear',
      archive: '',
      archivePath: '',
      createdAt: '',
      originalCode: 'initial-write-incomplete',
      failures: ['恢复清理保护锁的首次日志写入未完整完成；知识页面尚未开始移动。'],
      guardToken: token,
      guardSha256: digest,
      guardPid: 0,
      claimedStaging: '',
      retainedStaging: '',
      guardPhase: 'uninitialized',
      guardState: 'recovery-required'
    };
    Object.defineProperties(result, {
      guardRecord: { value: null, enumerable: false },
      guardFileIdentity: { value: guardIdentity, enumerable: false },
      guardJournalUninitialized: { value: true, enumerable: false },
      guardJournalLegacy: { value: false, enumerable: false },
      guardJournalSequence: { value: 0, enumerable: false },
      guardJournalFrameSha256: { value: '', enumerable: false },
      guardJournalCompleteBytes: { value: 0, enumerable: false }
    });
    return result;
  }
  const validated = await validateWikiRecoveryClearGuardRecord(vaultPath, journal.record, { requirePhase: !journal.legacy });
  const { record, archive, archivePath } = validated;
  const result = {
    type: 'clear-guard',
    operation: 'recovery-clear',
    archive,
    archivePath,
    createdAt: record.started,
    originalCode: oneLine(record.failure || 'recovery-clear-incomplete', 80),
    failures: [record.state === 'clearing' ? '恢复保护清理仍在进行或被中断。' : '恢复保护清理未完整完成，根目录保护锁仍保留。'],
    guardToken: record.token,
    guardSha256: digest,
    guardPid: record.pid,
    claimedStaging: oneLine(record.claimedStaging || '', 180),
    retainedStaging: oneLine(record.retainedStaging || '', 180),
    guardPhase: oneLine(record.phase || '', 80),
    guardState: record.state
  };
  Object.defineProperties(result, {
    guardRecord: { value: record, enumerable: false },
    guardFileIdentity: { value: guardIdentity, enumerable: false },
    guardJournalUninitialized: { value: false, enumerable: false },
    guardJournalLegacy: { value: journal.legacy, enumerable: false },
    guardJournalSequence: { value: journal.lastSequence, enumerable: false },
    guardJournalFrameSha256: { value: journal.lastFrameSha256, enumerable: false },
    guardJournalCompleteBytes: { value: journal.lastCompleteOffset, enumerable: false }
  });
  return result;
};

const readWikiRecoveryClearGuard = async (vaultPath) => {
  try {
    return await readWikiRecoveryClearGuardFile(vaultPath, recoveryClearGuardPath(vaultPath));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const assertNoWikiRecoveryClearGuard = async (vaultPath) => {
  try {
    await fsp.lstat(recoveryClearGuardPath(vaultPath));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new WikiBasicError('wiki-recovery-clear-busy', 'Wiki 正在解除恢复保护或等待人工恢复，当前操作已停止。');
};

const readWikiRecoveryProtectionAtStaging = async (vaultPath, staging, rawLock = null) => {
  const marker = await readWikiRecoveryMarkerFile(vaultPath, path.join(staging, WIKI_RECOVERY_MARKER_NAME));
  if (marker) return { ...marker, type: 'marker' };
  return readWikiRecoveryLockAtStaging(vaultPath, staging, rawLock);
};

const readWikiRecoveryProtection = async (vaultPath) => {
  const vault = await assertPlainDirectory(vaultPath);
  const clearGuard = await readWikiRecoveryClearGuard(vault);
  if (clearGuard) return clearGuard;
  const staging = await requireSafeRecoveryStaging(vault, { allowMissing: true });
  if (!staging) return null;
  return readWikiRecoveryProtectionAtStaging(vault, staging);
};

const wikiRecoveryProtectionIdentity = (protection) => {
  if (protection?.type === 'marker') return {
    type: 'marker', archive: protection.archive, id: protection.id, digest: protection.markerSha256
  };
  if (protection?.type === 'retained-lock') return {
    type: 'retained-lock', archive: protection.archive, id: protection.lockToken, digest: protection.lockSha256
  };
  if (protection?.type === 'clear-guard') return {
    type: 'clear-guard', archive: protection.archive, id: protection.guardToken, digest: protection.guardSha256
  };
  return { type: '', archive: '', id: '', digest: '' };
};

const sameWikiRecoveryProtection = (left, right) => {
  const a = wikiRecoveryProtectionIdentity(left);
  const b = wikiRecoveryProtectionIdentity(right);
  return a.type === b.type && a.archive === b.archive && a.id === b.id && a.digest === b.digest;
};

const sameWikiRecoveryProtectionIdentity = (current, expectedIdentity) => {
  const identity = wikiRecoveryProtectionIdentity(current);
  return Boolean(expectedIdentity)
    && identity.type === expectedIdentity.type
    && identity.archive === expectedIdentity.archive
    && identity.id === expectedIdentity.id
    && identity.digest === expectedIdentity.digest;
};

const assertExpectedWikiRecoveryProtection = (current, expected) => {
  const identity = wikiRecoveryProtectionIdentity(current);
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)
    || expected.type !== identity.type || expected.archive !== identity.archive
    || expected.id !== identity.id || expected.digest !== identity.digest) {
    throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复保护已变化，请重新打开并核对。');
  }
};

const readWikiRecoveryClearGuardHandle = async (entry) => {
  if (!entry.handle) throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁已失去写入句柄。');
  const info = await entry.handle.stat({ bigint: true });
  const identity = regularFileIdentityFromInfo(info);
  if (!sameRegularFileIdentity(entry.guardIdentity, identity)
    || info.size > BigInt(WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES)) {
    throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁文件身份已变化。');
  }
  const buffer = Buffer.alloc(Math.min(WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES + 1, Math.max(1, Number(info.size) + 1)));
  const { bytesRead } = await entry.handle.read(buffer, 0, buffer.length, 0);
  if (bytesRead > WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES) {
    throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁内容超出安全上限。');
  }
  const currentInfo = await fsp.lstat(entry.guardPath, { bigint: true });
  if (!sameRegularFileIdentity(entry.guardIdentity, regularFileIdentityFromInfo(currentInfo))) {
    throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁目录项已被替换。');
  }
  return buffer.subarray(0, bytesRead);
};

const assertWikiRecoveryClearGuardEntryCurrent = async (entry) => {
  const bytes = await readWikiRecoveryClearGuardHandle(entry);
  if (entry.lastDigest && sha256Text(bytes) !== entry.lastDigest) {
    throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁内容已变化，已停止操作。');
  }
  return bytes;
};

const encodeWikiRecoveryClearJournalFrame = (entry, record, trailingBytes) => {
  const payload = {
    journalVersion: 1,
    sequence: entry.lastSequence + 1,
    previousFrameSha256: entry.lastFrameSha256,
    ...(trailingBytes.length > 0 ? {
      discardedTail: { bytes: trailingBytes.length, sha256: sha256Text(trailingBytes) }
    } : {}),
    record
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return Buffer.from(
    `${WIKI_RECOVERY_CLEAR_JOURNAL_MAGIC}${payloadBytes.toString('base64url')}.${sha256Text(payloadBytes)}\n`,
    'utf8'
  );
};

const writeWikiRecoveryClearGuardRecord = async (entry, extra = {}) => {
  if (!entry.handle) throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁已失去写入句柄。');
  const definedExtra = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined));
  const record = {
    ...(entry.lastRecord || {}),
    version: 1,
    token: entry.token,
    pid: process.pid,
    state: 'clearing',
    started: entry.started,
    phase: entry.lastRecord?.phase || 'created',
    ...definedExtra
  };
  await validateWikiRecoveryClearGuardRecord(entry.vaultPath, record, { requirePhase: true });
  assertWikiRecoveryClearRecordContinuation(entry.lastRecord, record);
  const currentBytes = await assertWikiRecoveryClearGuardEntryCurrent(entry);
  if (!Number.isSafeInteger(entry.lastCompleteOffset) || entry.lastCompleteOffset < 0
    || entry.lastCompleteOffset > currentBytes.length) {
    throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁日志边界无效。');
  }
  const trailingBytes = currentBytes.subarray(entry.lastCompleteOffset);
  if (trailingBytes.includes(0x0a)) {
    throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁包含未校验的完整日志记录。');
  }
  const frameBytes = encodeWikiRecoveryClearJournalFrame(entry, record, trailingBytes);
  if (currentBytes.length + frameBytes.length > WIKI_RECOVERY_CLEAR_GUARD_MAX_BYTES) {
    throw new WikiBasicError('recovery-clear-guard-too-large', 'Wiki 恢复清理保护日志达到安全上限，已停止操作。');
  }
  let written = 0;
  while (written < frameBytes.length) {
    const result = await entry.handle.write(frameBytes, written, frameBytes.length - written, null);
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten <= 0) {
      throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护日志未能完整追加。');
    }
    written += result.bytesWritten;
  }
  await entry.handle.sync();
  const expectedBytes = Buffer.concat([currentBytes, frameBytes]);
  entry.lastDigest = sha256Text(expectedBytes);
  entry.lastSequence += 1;
  entry.lastFrameSha256 = sha256Text(frameBytes);
  entry.lastCompleteOffset = expectedBytes.length;
  entry.lastRecord = record;
  await assertWikiRecoveryClearGuardEntryCurrent(entry);
};

const acquireWikiRecoveryClearGuard = async (vaultPath) => {
  const guardPath = recoveryClearGuardPath(vaultPath);
  const token = randomUUID();
  let handle;
  try {
    handle = await fsp.open(guardPath, 'ax+', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new WikiBasicError('wiki-recovery-clear-busy', '已有 Wiki 恢复清理保护锁；请重新检查恢复状态。');
    throw error;
  }
  const guardInfo = await handle.stat({ bigint: true });
  const entry = {
    vaultPath,
    guardPath,
    token,
    started: isoNow(),
    handle,
    guardIdentity: regularFileIdentityFromInfo(guardInfo),
    lastDigest: sha256Text(Buffer.alloc(0)),
    lastSequence: 0,
    lastFrameSha256: '',
    lastCompleteOffset: 0,
    lastRecord: null
  };
  try {
    await writeWikiRecoveryClearGuardRecord(entry, { phase: 'created' });
    return entry;
  } catch (error) {
    await handle.close().catch(() => undefined);
    entry.handle = null;
    throw error;
  }
};

const closeWikiRecoveryClearGuard = async (entry) => {
  if (!entry.handle) return;
  await entry.handle.close();
  entry.handle = null;
};

const archiveWikiRecoveryClearGuard = async (entry, destinationDirectory = '') => {
  const directory = destinationDirectory || path.join(entry.vaultPath, '_archives', 'recovery-clear-guards');
  await assertSafeDirectoryChain(entry.vaultPath, directory);
  await fsp.mkdir(directory, { recursive: true });
  await assertSafeDirectoryChain(entry.vaultPath, directory);
  const destination = path.join(directory, `_recovery-clear-guard-${entry.token}.json`);
  await assertWikiRecoveryClearGuardEntryCurrent(entry);
  await closeWikiRecoveryClearGuard(entry);
  try {
    await fsp.rename(entry.guardPath, destination);
  } catch (error) {
    const claimed = await readWikiRecoveryClearGuardFile(entry.vaultPath, destination).catch(() => null);
    const canonical = await fsp.lstat(entry.guardPath).catch(() => null);
    if (!claimed || claimed.guardToken !== entry.token || claimed.guardSha256 !== entry.lastDigest || canonical) throw error;
  }
  const claimed = await readWikiRecoveryClearGuardFile(entry.vaultPath, destination);
  if (claimed.guardToken !== entry.token || claimed.guardSha256 !== entry.lastDigest) {
    throw new WikiBasicError('recovery-clear-guard-lost', 'Wiki 恢复清理保护锁所有者或内容已变化。');
  }
  return destination;
};

const retainWikiRecoveryClearGuard = async (entry, details = {}) => {
  if (!entry.handle) return;
  try {
    await writeWikiRecoveryClearGuardRecord(entry, { state: 'recovery-required', ...details });
  } finally {
    await closeWikiRecoveryClearGuard(entry);
  }
};

const recoveryClearGuardDetails = (record, extra = {}) => ({
  phase: record.phase,
  archive: record.archive,
  protection: record.protection,
  claimedStaging: record.claimedStaging,
  retainedStaging: record.retainedStaging,
  stagingIdentity: record.stagingIdentity,
  freshStagingIdentity: record.freshStagingIdentity,
  failure: record.failure,
  ...extra
});

const claimInterruptedWikiRecoveryClearGuard = async (vaultPath, guard, expectedProtection) => {
  assertExpectedWikiRecoveryProtection(guard, expectedProtection);
  if (processIsActive(guard.guardPid)) {
    throw new WikiBasicError('wiki-recovery-clear-busy', 'Wiki 恢复清理仍由活跃进程持有，已停止接管。');
  }
  const guardPath = recoveryClearGuardPath(vaultPath);
  const handle = await fsp.open(guardPath, 'a+');
  const info = await handle.stat({ bigint: true });
  const entry = {
    vaultPath,
    guardPath,
    token: guard.guardToken,
    started: guard.createdAt,
    handle,
    guardIdentity: regularFileIdentityFromInfo(info),
    lastDigest: guard.guardSha256,
    lastSequence: guard.guardJournalSequence,
    lastFrameSha256: guard.guardJournalFrameSha256,
    lastCompleteOffset: guard.guardJournalCompleteBytes,
    lastRecord: guard.guardRecord
  };
  try {
    if (!sameRegularFileIdentity(guard.guardFileIdentity, entry.guardIdentity)) {
      throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复清理保护锁在确认后被替换。');
    }
    const currentBytes = await readWikiRecoveryClearGuardHandle(entry);
    if (sha256Text(currentBytes) !== guard.guardSha256) {
      throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复清理保护锁内容在确认后发生变化。');
    }
    await writeWikiRecoveryClearGuardRecord(entry, recoveryClearGuardDetails(guard.guardRecord, {
      state: 'clearing',
      resumedAt: isoNow()
    }));
    return entry;
  } catch (error) {
    await handle.close().catch(() => undefined);
    entry.handle = null;
    throw error;
  }
};

const lstatOrNull = async (target) => {
  try {
    return await fsp.lstat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const readExpectedRecoveryProtectionAt = async (vaultPath, stagingPath, expectedIdentity, expectedArchive = '') => {
  const protection = await readWikiRecoveryProtectionAtStaging(vaultPath, stagingPath);
  if (!protection) throw new WikiBasicError('stale-recovery-marker', 'Wiki 原恢复保护已不存在，已保留根目录保护锁。');
  if (expectedIdentity && !sameWikiRecoveryProtectionIdentity(protection, expectedIdentity)) {
    throw new WikiBasicError('stale-recovery-marker', 'Wiki 原恢复保护内容已变化，已保留根目录保护锁。');
  }
  if (expectedArchive && protection.archive !== expectedArchive) {
    throw new WikiBasicError('stale-recovery-marker', 'Wiki 原恢复保护归档已变化，已保留根目录保护锁。');
  }
  return protection;
};

const assertFreshRecoveryStaging = async (vaultPath, stagingPath, originalIdentity, expectedFreshIdentity = null) => {
  const safeStaging = await requireSafeRecoveryStaging(vaultPath);
  if (path.resolve(safeStaging) !== path.resolve(stagingPath)) {
    throw new WikiBasicError('unsafe-recovery-staging', 'Wiki 新恢复目录位置无效。');
  }
  const identity = await directoryIdentity(stagingPath);
  if (sameDirectoryIdentity(identity, originalIdentity)
    || (expectedFreshIdentity && !sameDirectoryIdentity(identity, expectedFreshIdentity))) {
    throw new WikiBasicError('stale-recovery-staging', 'Wiki 新恢复目录身份与中断记录不一致。');
  }
  const entries = await fsp.readdir(stagingPath);
  if (entries.length > 0) {
    throw new WikiBasicError('stale-recovery-staging', 'Wiki 新恢复目录已出现未确认内容，已保留根目录保护锁。');
  }
  return identity;
};

const resetUninitializedWikiRecoveryClearGuard = async (vaultPath, guard, expectedProtection) => {
  assertExpectedWikiRecoveryProtection(guard, expectedProtection);
  if (!guard.guardJournalUninitialized || guard.guardPhase !== 'uninitialized' || guard.archive) {
    throw new WikiBasicError('unsafe-recovery-clear-guard', 'Wiki 恢复清理保护锁不是可重置的首次写入现场。');
  }
  const suspiciousClaim = (await fsp.readdir(vaultPath, { withFileTypes: true }))
    .find((item) => policyPathKey(item.name).startsWith('_staging-recovery-clear-'));
  if (suspiciousClaim) {
    throw new WikiBasicError('stale-recovery-staging', '检测到无法归属的 Wiki 恢复目录认领现场，已保留根目录保护锁。');
  }
  await requireSafeRecoveryStaging(vaultPath, { allowMissing: true });

  const guardPath = recoveryClearGuardPath(vaultPath);
  const handle = await fsp.open(guardPath, 'a+');
  const info = await handle.stat({ bigint: true });
  const entry = {
    vaultPath,
    guardPath,
    token: guard.guardToken,
    started: '',
    handle,
    guardIdentity: regularFileIdentityFromInfo(info),
    lastDigest: guard.guardSha256,
    lastSequence: 0,
    lastFrameSha256: '',
    lastCompleteOffset: 0,
    lastRecord: null
  };
  try {
    if (!sameRegularFileIdentity(guard.guardFileIdentity, entry.guardIdentity)) {
      throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复清理保护锁在确认后被替换。');
    }
    const currentBytes = await assertWikiRecoveryClearGuardEntryCurrent(entry);
    if (sha256Text(currentBytes) !== guard.guardSha256) {
      throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复清理保护锁内容在确认后发生变化。');
    }
    const current = await readWikiRecoveryClearGuardFile(vaultPath, guardPath);
    if (!current.guardJournalUninitialized || current.guardToken !== guard.guardToken
      || current.guardSha256 !== guard.guardSha256
      || !sameRegularFileIdentity(current.guardFileIdentity, guard.guardFileIdentity)) {
      throw new WikiBasicError('stale-recovery-marker', 'Wiki 恢复清理保护锁首次写入现场已变化。');
    }
    const retainedGuardPath = await archiveWikiRecoveryClearGuard(entry);
    return {
      ok: true,
      cleared: false,
      reset: true,
      resumed: true,
      archive: '',
      protectionType: 'clear-guard',
      retainedGuard: path.relative(vaultPath, retainedGuardPath).replace(/\\/g, '/')
    };
  } catch (error) {
    await closeWikiRecoveryClearGuard(entry).catch(() => undefined);
    throw error;
  }
};

const resumeWikiRecoveryClearGuard = async (vaultPath, guard, expectedProtection) => {
  assertExpectedWikiRecoveryProtection(guard, expectedProtection);
  if (guard.guardJournalUninitialized) {
    return resetUninitializedWikiRecoveryClearGuard(vaultPath, guard, expectedProtection);
  }
  if (processIsActive(guard.guardPid)) {
    throw new WikiBasicError('wiki-recovery-clear-busy', 'Wiki 恢复清理仍由活跃进程持有，已停止接管。');
  }
  const record = guard.guardRecord;
  let entry = null;
  let details = recoveryClearGuardDetails(record);
  let originalProtection = null;
  try {
    entry = await claimInterruptedWikiRecoveryClearGuard(vaultPath, guard, expectedProtection);
    const token = guard.guardToken;
    const stagingPath = path.join(vaultPath, '_staging');
    const claimedName = `_staging-recovery-clear-${token}`;
    const claimedPath = path.join(vaultPath, claimedName);
    const retainedName = `_cleared-staging-${token}`;
    const retainedPath = guard.archivePath
      ? path.join(guard.archivePath, retainedName)
      : '';
    const [staging, claimedInfo, retainedInfo] = await Promise.all([
      requireSafeRecoveryStaging(vaultPath, { allowMissing: true }),
      lstatOrNull(claimedPath),
      retainedPath ? lstatOrNull(retainedPath) : Promise.resolve(null)
    ]);

    if (claimedInfo && record.claimedStaging !== claimedName) {
      throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复目录已被认领，但保护锁没有完整记录该位置。');
    }
    if (retainedInfo && (!guard.archivePath || (record.retainedStaging && record.retainedStaging !== retainedName))) {
      throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复归档位置与保护锁记录不一致。');
    }
    if (claimedInfo && retainedInfo) {
      throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复目录同时出现认领与归档副本，已保留根目录保护锁。');
    }

    if (staging && !claimedInfo && !retainedInfo) {
      if (['claimed', 'retained', 'staging-created'].includes(record.phase)) {
        throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复清理阶段与现有目录不一致。');
      }
      const currentIdentity = await directoryIdentity(staging);
      if (record.stagingIdentity && !sameDirectoryIdentity(record.stagingIdentity, currentIdentity)) {
        throw new WikiBasicError('stale-recovery-staging', 'Wiki 原恢复目录在中断后被替换。');
      }
      originalProtection = await readExpectedRecoveryProtectionAt(
        vaultPath,
        staging,
        record.protection || null,
        record.archive || ''
      );
      const retainedGuardPath = await archiveWikiRecoveryClearGuard(entry, originalProtection.archivePath);
      return {
        ok: true,
        cleared: false,
        reset: true,
        resumed: true,
        archive: originalProtection.archive,
        protectionType: 'clear-guard',
        nextProtectionType: originalProtection.type,
        retainedGuard: path.relative(vaultPath, retainedGuardPath).replace(/\\/g, '/')
      };
    }

    if (claimedInfo) {
      if (staging || !guard.archivePath || !record.protection || !record.stagingIdentity) {
        throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复目录认领现场不完整，已保留根目录保护锁。');
      }
      await assertClaimedRecoveryStaging(vaultPath, claimedPath, record.stagingIdentity);
      originalProtection = await readExpectedRecoveryProtectionAt(
        vaultPath,
        claimedPath,
        record.protection,
        record.archive
      );
      details = recoveryClearGuardDetails(record, {
        state: 'clearing',
        phase: 'claimed',
        retainedStaging: retainedName,
        resumedAt: isoNow()
      });
      await writeWikiRecoveryClearGuardRecord(entry, details);
      await assertSafeDirectoryChain(vaultPath, guard.archivePath);
      try {
        await fsp.rename(claimedPath, retainedPath);
      } catch (error) {
        const [currentClaim, currentRetained] = await Promise.all([
          lstatOrNull(claimedPath),
          lstatOrNull(retainedPath)
        ]);
        if (currentClaim || !currentRetained) throw error;
      }
    } else if (!retainedInfo) {
      throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复清理中断现场不完整，已保留根目录保护锁。');
    }

    if (!guard.archivePath || !record.protection || !record.stagingIdentity) {
      throw new WikiBasicError('stale-recovery-staging', 'Wiki 恢复归档缺少可验证的原保护信息。');
    }
    await assertRetainedRecoveryStaging(vaultPath, guard.archivePath, retainedPath, record.stagingIdentity, token);
    originalProtection = await readExpectedRecoveryProtectionAt(
      vaultPath,
      retainedPath,
      record.protection,
      record.archive
    );
    details = recoveryClearGuardDetails(record, {
      state: 'clearing',
      phase: record.phase === 'staging-created' ? 'staging-created' : 'retained',
      retainedStaging: retainedName,
      resumedAt: isoNow()
    });
    await writeWikiRecoveryClearGuardRecord(entry, details);

    let freshStagingIdentity;
    if (staging) {
      freshStagingIdentity = await assertFreshRecoveryStaging(
        vaultPath,
        stagingPath,
        record.stagingIdentity,
        record.freshStagingIdentity || null
      );
    } else {
      await fsp.mkdir(stagingPath);
      freshStagingIdentity = await assertFreshRecoveryStaging(vaultPath, stagingPath, record.stagingIdentity);
    }
    details = recoveryClearGuardDetails(record, {
      state: 'clearing',
      phase: 'staging-created',
      retainedStaging: retainedName,
      freshStagingIdentity,
      resumedAt: isoNow()
    });
    await writeWikiRecoveryClearGuardRecord(entry, details);
    forgetRecoveredWikiWriteLock(vaultPath, originalProtection);
    const retainedGuardPath = await archiveWikiRecoveryClearGuard(entry, guard.archivePath);
    return {
      ok: true,
      cleared: true,
      resumed: true,
      archive: originalProtection.archive,
      protectionType: originalProtection.type,
      retainedStaging: path.relative(vaultPath, retainedPath).replace(/\\/g, '/'),
      retainedGuard: path.relative(vaultPath, retainedGuardPath).replace(/\\/g, '/')
    };
  } catch (error) {
    if (!entry?.handle) throw error;
    let guardError;
    try {
      await retainWikiRecoveryClearGuard(entry, {
        ...details,
        state: 'recovery-required',
        failure: oneLine(error?.code || error?.message || 'recovery-clear-resume-failed', 160)
      });
    } catch (failure) {
      guardError = failure;
    }
    if (guardError) throw new AggregateError([error, guardError], 'Wiki 恢复清理续办失败，且根目录保护锁无法完整更新。');
    throw error;
  }
};

const assertNoLegacyWikiWriteLocks = async (stagingDir) => {
  for (const legacy of LEGACY_WIKI_WRITE_LOCKS) {
    const legacyPath = path.join(stagingDir, legacy.name);
    let info;
    try {
      info = await fsp.lstat(legacyPath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.size > WIKI_WRITE_LOCK_MAX_BYTES) {
      throw new WikiBasicError(legacy.unsafeCode, `检测到不安全的旧版 ${legacy.label}锁，已停止写入。`);
    }
    throw new WikiBasicError(
      legacy.busyCode,
      `检测到旧版 ${legacy.label}锁 ${legacy.name}，为防止不同版本同时写入已停止操作。请确认没有其他 DSH 正在写入后再处理该锁。`
    );
  }
};

const wikiWriteLockLost = () => new WikiBasicError(
  'wiki-write-lock-lost',
  '知识库写入锁所有者已变化，未删除其他锁。'
);

const removeCurrentOwner = (entry) => {
  if (vaultWriteLockOwners.get(entry.key) === entry) vaultWriteLockOwners.delete(entry.key);
};

const forgetRecoveredWikiWriteLock = (vaultPath, protection) => {
  if (protection?.type !== 'retained-lock' || !protection.lockToken) return;
  const key = normalizedPathKey(path.join(vaultPath, '_staging', WIKI_WRITE_LOCK_NAME));
  const owner = vaultWriteLockOwners.get(key);
  if (owner?.token === protection.lockToken && owner.state === 'recovery-blocked') removeCurrentOwner(owner);
};

const closeOwnedWikiWriteLockHandle = async (entry) => {
  if (!entry.handle) return;
  try {
    await retryWikiLockTransient(() => entry.handle.close());
    entry.handle = null;
  } catch (error) {
    if (error?.code === 'EBADF') {
      entry.handle = null;
      return;
    }
    throw error;
  }
};

const writeOwnedWikiWriteLockRecord = async (entry, extra = {}) => {
  const record = `${JSON.stringify({
    pid: process.pid,
    token: entry.token,
    operation: entry.operation,
    started: entry.started,
    ...extra
  })}\n`;
  const bytes = Buffer.from(record, 'utf8');
  if (bytes.length > WIKI_WRITE_LOCK_MAX_BYTES) throw new WikiBasicError('wiki-write-lock-too-large', 'Wiki 写入锁恢复信息超出安全上限。');
  await entry.handle.truncate(0);
  await entry.handle.write(bytes, 0, bytes.length, 0);
  await entry.handle.sync();
};

const registerActiveWikiTransactionArchive = async (vaultPath, archiveRoot, operation) => {
  const lockPath = path.join(vaultPath, '_staging', WIKI_WRITE_LOCK_NAME);
  const entry = vaultWriteLockOwners.get(normalizedPathKey(lockPath));
  if (!entry || entry.state !== 'held' || entry.operation !== operation) {
    throw new WikiBasicError('wiki-write-lock-lost', '无法把事务归档绑定到当前 Wiki 写入锁。');
  }
  const archive = path.relative(vaultPath, archiveRoot).replace(/\\/g, '/');
  const kind = WIKI_RECOVERY_ARCHIVE_KINDS[operation];
  if (!kind || !archive.startsWith(`_archives/${kind}/`)) {
    throw new WikiBasicError('unsafe-recovery-archive', 'Wiki 事务归档路径无效。');
  }
  await writeOwnedWikiWriteLockRecord(entry, { state: 'held', archive });
  entry.archive = archive;
};

const performOwnedWikiWriteLockRemoval = async (entry, { allowMissing = false } = {}) => {
  await closeOwnedWikiWriteLockHandle(entry);
  const claimPath = `${entry.lockPath}.release-${entry.token}-${randomUUID()}`;
  let lastError;
  let claimed = false;
  for (const delayMs of WIKI_WRITE_LOCK_RETRY_DELAYS_MS) {
    if (delayMs > 0) await waitForWikiLockRetry(delayMs);
    try {
      await fsp.rename(entry.lockPath, claimPath);
      claimed = true;
      break;
    } catch (error) {
      try {
        const uncertainClaim = await readWikiWriteLockRecord(claimPath);
        if (uncertainClaim.record.token === entry.token) {
          claimed = true;
          break;
        }
      } catch {}
      if (error?.code === 'ENOENT') {
        removeCurrentOwner(entry);
        if (allowMissing) return;
        throw wikiWriteLockLost();
      }
      if (WIKI_WRITE_LOCK_TRANSIENT_CODES.has(error?.code)) {
        lastError = error;
        continue;
      }
      removeCurrentOwner(entry);
      throw error;
    }
  }
  if (!claimed) throw lastError;

  let current;
  try {
    current = await retryWikiLockTransient(() => readWikiWriteLockRecord(claimPath));
  } catch (error) {
    entry.state = 'released-cleanup-pending';
    removeCurrentOwner(entry);
    error.releasedCleanupPending = true;
    error.releaseClaimPath = claimPath;
    throw error;
  }
  if (current.record.token !== entry.token) {
    try { await fsp.link(claimPath, entry.lockPath); } catch {}
    removeCurrentOwner(entry);
    throw wikiWriteLockLost();
  }

  entry.state = 'released-cleanup-pending';
  removeCurrentOwner(entry);
  try {
    await retryWikiLockTransient(async () => {
      try {
        await fsp.unlink(claimPath);
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
    });
  } catch (error) {
    error.releasedCleanupPending = true;
    error.releaseClaimPath = claimPath;
    throw error;
  }
};

const removeOwnedWikiWriteLock = async (entry, options = {}) => {
  if (entry.cleanupPromise) return entry.cleanupPromise;
  const cleanupPromise = performOwnedWikiWriteLockRemoval(entry, options);
  entry.cleanupPromise = cleanupPromise;
  try {
    return await cleanupPromise;
  } finally {
    if (entry.cleanupPromise === cleanupPromise) entry.cleanupPromise = null;
  }
};

const processIsActive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
};

const acquireVaultWriteLock = async (vaultPath, {
  retryAfterMissing = true,
  operation = 'wiki-write',
  busyCode = 'wiki-write-busy',
  busyMessage = '另一个 Wiki 写入操作正在更新该知识库，请稍后重试。'
} = {}) => {
  const stagingDir = path.join(vaultPath, '_staging');
  await assertNoWikiRecoveryClearGuard(vaultPath);
  await assertSafeDirectoryChain(vaultPath, stagingDir);
  await fsp.mkdir(stagingDir, { recursive: true });
  await assertSafeDirectoryChain(vaultPath, stagingDir);
  await assertNoWikiRecoveryClearGuard(vaultPath);
  const pendingRecovery = await readWikiRecoveryProtectionAtStaging(vaultPath, stagingDir);
  if (pendingRecovery) {
    throw new WikiBasicError(
      pendingRecovery.type === 'retained-lock' ? 'wiki-write-recovery-required' : 'wiki-recovery-required',
      `知识库仍有未完成的回退，请先从 ${pendingRecovery.archive} 核对人工内容。`
    );
  }
  await assertNoLegacyWikiWriteLocks(stagingDir);
  const lockPath = path.join(stagingDir, WIKI_WRITE_LOCK_NAME);
  const key = normalizedPathKey(lockPath);
  const previousOwner = vaultWriteLockOwners.get(key);
  if (previousOwner) {
    if (previousOwner.state === 'recovery-blocked') {
      throw new WikiBasicError(
        'wiki-write-recovery-required',
        '上一次 Wiki 自动回退无法建立恢复标记；保护锁仍保留。请先按错误中给出的归档路径核对内容。'
      );
    }
    if (previousOwner.state !== 'orphaned') throw new WikiBasicError(busyCode, busyMessage);
    try {
      await removeOwnedWikiWriteLock(previousOwner, { allowMissing: true });
    } catch (error) {
      if (error?.code !== 'wiki-write-lock-lost') throw error;
    }
  }
  await assertNoLegacyWikiWriteLocks(stagingDir);

  const token = randomUUID();
  let handle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let current;
    try {
      current = await readWikiWriteLockRecord(lockPath);
    } catch (readError) {
      if (retryAfterMissing && readError?.code === 'ENOENT') {
        return acquireVaultWriteLock(vaultPath, { retryAfterMissing: false, operation, busyCode, busyMessage });
      }
      throw readError;
    }
    if (current.record.state === 'recovery-required') {
      throw new WikiBasicError(
        'wiki-write-recovery-required',
        `检测到回退保护锁，已停止写入。请先从 ${oneLine(current.record.archive || '错误提示中的恢复归档', 260)} 核对内容。`
      );
    }
    const ownerPid = Number(current.record.pid) || 0;
    const recent = Date.now() - current.info.mtimeMs < WIKI_WRITE_LOCK_STALE_MS;
    if (!processIsActive(ownerPid) && !recent) {
      throw new WikiBasicError(
        'wiki-write-recovery-required',
        '检测到未完成的 Wiki 写入锁，已禁止自动删除以避免并发覆盖。请确认没有 DSH 正在写入后，将 _staging/.dsh-wiki-write.lock 移出知识库再重试。'
      );
    }
    throw new WikiBasicError(busyCode, busyMessage);
  }

  const entry = { key, lockPath, token, operation: oneLine(operation, 48), started: isoNow(), handle, state: 'initializing' };
  vaultWriteLockOwners.set(key, entry);
  try {
    await writeOwnedWikiWriteLockRecord(entry, { state: 'held' });
    entry.state = 'held';
    await assertNoWikiRecoveryClearGuard(vaultPath);
  } catch (error) {
    entry.state = 'orphaned';
    let cleanupError;
    try {
      await removeOwnedWikiWriteLock(entry);
    } catch (failure) {
      cleanupError = failure;
    }
    if (cleanupError) throw new AggregateError([error, cleanupError], '知识库写入锁初始化失败，且未能安全清理锁。');
    throw error;
  }
  return async ({ retainForRecovery = false, recoveryError = null } = {}) => {
    if (vaultWriteLockOwners.get(key) !== entry || entry.state !== 'held') throw wikiWriteLockLost();
    if (retainForRecovery) {
      entry.state = 'recovery-blocked';
      let recordError;
      try {
        await writeOwnedWikiWriteLockRecord(entry, {
          state: 'recovery-required',
          archive: oneLine(recoveryError?.archive || '', 260),
          originalCode: oneLine(recoveryError?.originalCode || recoveryError?.code || 'rollback-incomplete', 80)
        });
      } catch (error) {
        recordError = error;
      }
      await closeOwnedWikiWriteLockHandle(entry);
      if (recordError) throw recordError;
      return;
    }
    entry.state = 'releasing';
    try {
      await removeOwnedWikiWriteLock(entry);
    } catch (error) {
      if (vaultWriteLockOwners.get(key) === entry) entry.state = 'orphaned';
      throw error;
    }
  };
};

const withVaultWriteLock = async (vaultPath, lockOptions, operation, aggregateMessage) => {
  const release = await acquireVaultWriteLock(vaultPath, lockOptions);
  let result;
  let primaryError;
  try {
    result = await operation();
  } catch (error) {
    primaryError = error;
  }
  let releaseError;
  try {
    await release({ retainForRecovery: Boolean(primaryError?.retainWriteLock), recoveryError: primaryError });
  } catch (error) {
    releaseError = error;
  }
  if (primaryError && releaseError) throw new AggregateError([primaryError, releaseError], aggregateMessage);
  if (primaryError) throw primaryError;
  if (releaseError) {
    if (releaseError?.releasedCleanupPending || WIKI_WRITE_LOCK_TRANSIENT_CODES.has(releaseError?.code)) {
      const committed = result && typeof result === 'object' ? result : { ok: true };
      return {
        ...committed,
        committed: true,
        cleanupPending: true,
        lockCleanupPending: true,
        warningCode: 'wiki-write-lock-release-incomplete',
        message: `Wiki 内容已验证保存。${oneLine(committed.message || '', 320)} 写入锁清理暂未完成；下次同一进程会安全重试，请勿重复提交。`
      };
    }
    throw releaseError;
  }
  return result;
};

const appendQueryLog = async (vaultPath, query, resultCount, clock) => withVaultWriteLock(
  vaultPath,
  { operation: 'query-log' },
  async () => {
    const logPath = path.join(vaultPath, 'log.md');
    const line = `- [${isoNow(clock)}] QUERY query=${yamlString(oneLine(query, 180))} result_pages=${resultCount} mode=normal escalated=false\n`;
    await fsp.appendFile(logPath, line, { encoding: 'utf8', mode: 0o600 });
  },
  'Wiki 查询已完成，但查询日志写入或写入锁清理未完成。'
);

const saveCapture = async (vaultPath, capture, options = {}) => {
  const vault = await assertPlainDirectory(vaultPath);
  return withVaultWriteLock(
    vault,
    {
      operation: 'capture',
      busyCode: 'capture-busy',
      busyMessage: '另一个 Wiki 写入操作正在更新该知识库，请稍后再保存结论。'
    },
    () => saveCaptureLocked(vault, capture, options),
    '保存 Wiki 结论失败，且知识库写入锁清理未完成。'
  );
};

const previewProjectSync = async (vaultPath, workspacePath, {
  clock = () => new Date(),
  inspectGit = inspectProjectGit
} = {}) => {
  const vault = await assertPlainDirectory(vaultPath);
  const state = await inspectWikiVault(vault);
  if (state.status !== 'ready') throw new WikiBasicError('vault-not-ready', '知识库尚未初始化，不能同步项目。');
  const inventory = await walkProjectSources(workspacePath);
  const project = projectIdentity(inventory.workspace);
  const manifest = await readManifestStrict(vault);
  const previous = manifest.projects[project.id] || null;
  if (previous?.source_cwd && normalizedPathKey(previous.source_cwd) !== normalizedPathKey(project.sourceCwd)) {
    throw new WikiBasicError('project-identity-conflict', '项目标识与知识库中的来源路径冲突。');
  }
  const previousFiles = previousProjectFiles(previous);
  const delta = projectFileDelta(previousFiles, inventory.files);
  const git = await inspectGit(inventory.workspace, previous?.last_git_commit || '');
  const pageState = await listCurrentProjectPages(vault, project, previous);
  const existingPages = pageState.pages;
  const missingManagedPages = pageState.missingManagedPages;
  const releaseKnowledge = await inspectReleaseKnowledgePages(vault, project, previous, existingPages);
  const sourceUnchanged = Boolean(previous && previous.source_fingerprint === inventory.fingerprint);
  const unchanged = sourceUnchanged
    && missingManagedPages.length === 0
    && (!releaseKnowledge.established || releaseKnowledge.healthy);
  const mode = git?.status === 'ready' ? 'git' : 'inventory';
  const tokenPayload = {
    projectId: project.id,
    sourceCwd: normalizedPathKey(project.sourceCwd),
    sourceFingerprint: inventory.fingerprint,
    previousFingerprint: previous?.source_fingerprint || '',
    pages: existingPages.map(({ path: pagePath, sha256 }) => ({ path: pagePath, sha256 })),
    missingManagedPages,
    releaseKnowledge: {
      mode: releaseKnowledge.mode,
      established: releaseKnowledge.established,
      actualPages: releaseKnowledge.actualPages,
      missingPages: releaseKnowledge.missingPages,
      extraPages: releaseKnowledge.extraPages,
      humanEditedPages: releaseKnowledge.humanEditedPages
    },
    gitHead: git?.head || ''
  };
  return {
    ok: true,
    generatedAt: isoNow(clock),
    mode,
    sourceUnchanged,
    unchanged,
    limited: inventory.limited,
    project,
    sourceFingerprint: inventory.fingerprint,
    sourceFiles: inventory.files,
    scannedFiles: inventory.files.length,
    scannedBytes: inventory.totalBytes,
    delta,
    git,
    existingPages,
    missingManagedPages,
    releaseKnowledge,
    humanEditedPages: existingPages.filter((page) => page.humanEdited).map((page) => page.path),
    previewToken: sha256Text(JSON.stringify(tokenPayload))
  };
};

const allowedProjectPagePath = (project, value) => {
  if (typeof value !== 'string' || value.length > 260 || value.includes('\\') || value.startsWith('/')) return '';
  const relative = value;
  const segments = relative.split('/');
  if (!relative.endsWith('.md')
    || relative.includes('..')
    || relative.includes('//')
    || /[\u0000-\u001f<>:"|?*]/u.test(relative)
    || segments.some((segment) => !segment || /[. ]$/u.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) return '';
  if (policyPathKey(relative) === policyPathKey(project.overviewPath)) return relative === project.overviewPath ? relative : '';
  const allowed = ['concepts', 'skills', 'references'];
  return allowed.some((section) => relative.startsWith(`${project.rootPath}/${section}/`)) ? relative : '';
};

const normalizeProvenance = (value) => {
  const result = {
    extracted: Number(value?.extracted),
    inferred: Number(value?.inferred),
    ambiguous: Number(value?.ambiguous)
  };
  if (Object.values(result).some((item) => !Number.isFinite(item) || item < 0 || item > 1)) {
    throw new WikiBasicError('invalid-provenance', '每个页面都必须提供 0 到 1 之间的来源、推断和存疑比例。');
  }
  const total = result.extracted + result.inferred + result.ambiguous;
  if (Math.abs(total - 1) > 0.011) throw new WikiBasicError('invalid-provenance', '页面来源、推断和存疑比例之和必须为 1。');
  return result;
};

const preservedPageTrust = (existingText, timestamp) => {
  const metadata = parseFrontmatter(existingText || '').metadata;
  const lifecycle = ['reviewed', 'verified', 'disputed'].includes(metadata.lifecycle) ? metadata.lifecycle : 'draft';
  const created = (existingText || '').match(/^created:\s*(.+)$/m)?.[1]?.trim() || timestamp;
  const lifecycleChanged = (existingText || '').match(/^lifecycle_changed:\s*(.+)$/m)?.[1]?.trim() || timestamp.slice(0, 10);
  const tier = (existingText || '').match(/^tier:\s*(.+)$/m)?.[1]?.trim() || 'supporting';
  return { lifecycle, created, lifecycleChanged, tier };
};

const projectPageText = (page, project, timestamp, existingText = '') => {
  const trust = preservedPageTrust(existingText, timestamp);
  const sources = page.sources.map((source) => `  - ${yamlString(`project-file:${source}`)}`).join('\n');
  return `---\ntitle: ${yamlString(page.title)}\ncategory: ${page.path === project.overviewPath ? 'project' : 'project-knowledge'}\ntags: [dsh, project-sync]\nsources:\n${sources}\nsummary: ${yamlString(page.summary)}\nprovenance:\n  extracted: ${page.provenance.extracted.toFixed(2)}\n  inferred: ${page.provenance.inferred.toFixed(2)}\n  ambiguous: ${page.provenance.ambiguous.toFixed(2)}\nbase_confidence: 0.59\nlifecycle: ${trust.lifecycle}\nlifecycle_changed: ${trust.lifecycleChanged}\ntier: ${trust.tier}\nsource_cwd: ${yamlString(project.sourceCwd)}\ncreated: ${trust.created}\nupdated: ${timestamp}\n---\n\n${page.content.trim()}\n`;
};

const buildProjectSyncPlan = async (vaultPath, workspacePath, spec, options = {}) => {
  const preview = await previewProjectSync(vaultPath, workspacePath, options);
  if (!spec || spec.previewToken !== preview.previewToken) throw new WikiBasicError('stale-project-preview', '项目内容或知识库页面已变化，请重新检查增量。');
  const releaseKnowledgeMode = spec.mode === 'release-knowledge';
  if (spec.mode !== undefined && !releaseKnowledgeMode) throw new WikiBasicError('invalid-project-mode', '项目同步模式无效。');
  if (!Array.isArray(spec.pages) || spec.pages.length === 0 || spec.pages.length > MAX_PROJECT_PAGES) {
    throw new WikiBasicError('invalid-project-pages', `每次项目同步必须包含 1 到 ${MAX_PROJECT_PAGES} 个页面。`);
  }
  const releaseRootPrefix = `${policyPathKey(preview.releaseKnowledge.rootPath)}/`;
  const touchesReleaseNamespace = spec.pages.some((page) => typeof page?.path === 'string' && policyPathKey(page.path).startsWith(releaseRootPrefix));
  if (touchesReleaseNamespace && !releaseKnowledgeMode) {
    throw new WikiBasicError('release-mode-required', '版本知识目录只能通过固定六页的 release-knowledge 模式更新。');
  }
  if (preview.missingManagedPages.length > 0) {
    throw new WikiBasicError('managed-pages-missing', `有 ${preview.missingManagedPages.length} 个受管项目页面缺失或不安全，请先从恢复副本核对。`);
  }
  if (!releaseKnowledgeMode && preview.sourceUnchanged) {
    throw new WikiBasicError('project-unchanged', '当前项目自上次同步后没有可识别的源文件变化。');
  }
  const releasePaths = RELEASE_KNOWLEDGE_PAGE_NAMES.map((name) => `${preview.project.rootPath}/references/releases/${name}.md`);
  if (preview.releaseKnowledge.established && preview.releaseKnowledge.extraPages.length > 0) {
    throw new WikiBasicError(
      'release-knowledge-extra-pages',
      `版本知识目录存在 ${preview.releaseKnowledge.extraPages.length} 个固定六页之外的 Markdown 文件。请先人工移出并重新预览；DSH 不会自动删除。`
    );
  }
  if (releaseKnowledgeMode) {
    if (preview.sourceUnchanged && preview.releaseKnowledge.healthy) {
      throw new WikiBasicError('release-knowledge-unchanged', '版本证据与固定六页自上次同步后均未变化。');
    }
    const overviewExists = preview.existingPages.some((page) => page.path === preview.project.overviewPath);
    const requiredPaths = new Set([...releasePaths, ...(!overviewExists ? [preview.project.overviewPath] : [])]);
    const submittedPaths = spec.pages.map((page) => page?.path);
    if (submittedPaths.length !== requiredPaths.size
      || new Set(submittedPaths).size !== submittedPaths.length
      || submittedPaths.some((pagePath) => !requiredPaths.has(pagePath))) {
      throw new WikiBasicError(
        'invalid-release-knowledge-pages',
        `版本知识模式必须在同一事务中提交固定六页${overviewExists ? '' : '以及首次项目总览'}，不能缺页或附加其他页面。`
      );
    }
  }
  if (spec.pages.some((page) => !allowedProjectPagePath(preview.project, page?.path))) {
    throw new WikiBasicError('invalid-project-page-path', '项目页面必须使用唯一规范路径，并位于当前项目的总览、concepts、skills 或 references 目录中。');
  }
  if (!preview.existingPages.length && !spec.pages.some((page) => page?.path === preview.project.overviewPath)) {
    throw new WikiBasicError('overview-required', '首次同步必须创建项目总览页面。');
  }
  const sourcePaths = new Set(preview.sourceFiles.map((item) => item.path));
  const existingPages = new Map(preview.existingPages.map((item) => [policyPathKey(item.path), item]));
  const seen = new Set();
  const writes = [];
  let totalChars = 0;
  for (const candidate of spec.pages) {
    const relative = allowedProjectPagePath(preview.project, candidate?.path);
    const relativeKey = policyPathKey(relative);
    if (!relative || seen.has(relativeKey)) throw new WikiBasicError('invalid-project-page-path', '项目页面必须使用唯一规范路径，并位于当前项目的总览、concepts、skills 或 references 目录中。');
    seen.add(relativeKey);
    const title = oneLine(candidate?.title, MAX_TITLE_CHARS);
    const summary = oneLine(candidate?.summary, 240);
    const content = normalizeText(candidate?.content, MAX_PROJECT_PAGE_CHARS);
    if (!title || !summary || !content || String(candidate?.content || '').length > MAX_PROJECT_PAGE_CHARS) {
      throw new WikiBasicError('invalid-project-page', '项目页面必须包含有效标题、摘要和受限正文。');
    }
    totalChars += content.length;
    if (totalChars > MAX_PROJECT_TOTAL_PAGE_CHARS) throw new WikiBasicError('project-pages-too-large', '本次项目同步页面总量超出限制。');
    if (releaseKnowledgeMode && (!Array.isArray(candidate?.sources)
      || candidate.sources.some((item) => typeof item !== 'string' || !RELEASE_KNOWLEDGE_SOURCE.test(item)))) {
      throw new WikiBasicError('invalid-release-knowledge-source', '版本知识页面只能引用固定范围内、且已被本次预览扫描到的发布证据。');
    }
    const sources = Array.isArray(candidate?.sources)
      ? [...new Set(candidate.sources.filter((item) => typeof item === 'string' && sourcePaths.has(item)))].slice(0, 24)
      : [];
    if (!sources.length) throw new WikiBasicError('invalid-project-sources', '每个项目页面至少需要一个本次扫描到的源文件。');
    const existing = existingPages.get(relativeKey);
    if (existing && existing.path !== relative) throw new WikiBasicError('invalid-project-page-path', `知识页面 ${relative} 必须沿用清单中的规范大小写 ${existing.path}。`);
    if (existing && candidate.expectedSha256 !== existing.sha256) throw new WikiBasicError('stale-project-page', `知识页面 ${relative} 已变化，请重新读取后合并。`);
    if (!existing && candidate.expectedSha256 !== null && candidate.expectedSha256 !== undefined) throw new WikiBasicError('unexpected-project-page', `知识页面 ${relative} 尚不存在，不能按更新处理。`);
    const absolute = path.join(path.resolve(vaultPath), relative);
    if (!pathInside(vaultPath, absolute)) throw new WikiBasicError('path-escape', '项目页面路径越过知识库目录。');
    await assertSafeDirectoryChain(vaultPath, path.dirname(absolute));
    if (!existing) {
      try {
        const info = await fsp.lstat(absolute);
        if (info) throw new WikiBasicError('untracked-project-page', `知识库中已有未纳入项目清单的页面 ${relative}，已停止覆盖。`);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const existingText = existing ? await fsp.readFile(absolute, 'utf8') : '';
    const page = { path: relative, title, summary, content, sources, provenance: normalizeProvenance(candidate.provenance) };
    const text = projectPageText(page, preview.project, isoNow(options.clock || (() => new Date())), existingText);
    writes.push({ ...page, absolute, exists: Boolean(existing), expectedSha256: existing?.sha256 || null, text, sensitive: sensitiveFindings(text) });
  }
  return {
    ok: true,
    preview,
    workflowMode: releaseKnowledgeMode ? 'release-knowledge' : 'project-sync',
    releaseKnowledgeMode,
    releasePaths,
    writes,
    pagesCreated: writes.filter((item) => !item.exists).length,
    pagesUpdated: writes.filter((item) => item.exists).length,
    sensitive: writes.flatMap((item) => item.sensitive.map((finding) => ({ ...finding, path: item.path })))
  };
};

const readProjectWikiPage = async (vaultPath, workspacePath, relativePath, options = {}) => {
  const preview = await previewProjectSync(vaultPath, workspacePath, options);
  const expected = preview.existingPages.find((item) => item.path === relativePath);
  if (!expected || !allowedProjectPagePath(preview.project, relativePath)) throw new WikiBasicError('project-page-not-found', '该页面不属于当前项目或尚不存在。');
  const absolute = path.join(path.resolve(vaultPath), relativePath);
  await assertSafeDirectoryChain(vaultPath, path.dirname(absolute));
  const info = await fsp.lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKDOWN_BYTES) throw new WikiBasicError('unsafe-project-page', '项目知识页面不是受支持的普通 Markdown 文件。');
  const opened = await readBoundedRegularFile(absolute, MAX_MARKDOWN_BYTES);
  if (!opened) throw new WikiBasicError('unsafe-project-page', '项目知识页面不是受支持的普通 Markdown 文件。');
  const content = opened.bytes.toString('utf8');
  const sha256 = sha256Text(content);
  if (sha256 !== expected.sha256) throw new WikiBasicError('stale-project-page', '知识页面在读取期间发生变化，请重试。');
  return { ok: true, path: relativePath, sha256, content };
};

const updateProjectIndexText = (text, project, summary, timestamp) => {
  const link = project.overviewPath.replace(/\.md$/i, '');
  const entry = `- [[${link}|${project.name}]] — ${summary} ( #dsh #project-sync)`;
  let next = text.replace(/\*此索引由 DSH Desktop 维护。最后更新：[^*]+\*/u, `*此索引由 DSH Desktop 维护。最后更新：${timestamp}*`);
  if (next.includes(`[[${link}|`) || next.includes(`[[${link}]]`)) return next;
  const marker = '## Projects';
  return next.includes(marker)
    ? next.replace(marker, `${marker}\n\n${entry}`)
    : `${next.trimEnd()}\n\n${marker}\n\n${entry}\n`;
};

const updateProjectHotText = (text, project, timestamp, changedPages) => {
  const entry = `- [${timestamp}] WIKI_UPDATE — ${project.name}，更新 ${changedPages} 个页面`;
  const marker = '## Recent Activity';
  if (!text.includes(marker)) return `${text.trimEnd()}\n\n${marker}\n\n${entry}\n`;
  return text.replace(marker, `${marker}\n\n${entry}`);
};

const saveProjectSyncLocked = async (vaultPath, workspacePath, spec, {
  confirmed = false,
  confirmedSensitive = false,
  clock = () => new Date(),
  inspectGit = inspectProjectGit,
  afterPageWrites = async () => undefined
} = {}) => {
  if (!confirmed) throw new WikiBasicError('project-confirmation-required', '同步项目知识前需要用户明确确认。');
  const vault = await assertPlainDirectory(vaultPath);
  const plan = await buildProjectSyncPlan(vault, workspacePath, spec, { clock, inspectGit });
  if (plan.sensitive.length && !confirmedSensitive) throw new WikiBasicError('sensitive-confirmation-required', '项目页面可能包含凭据或敏感字段，需要再次确认。');
  const timestamp = isoNow(clock);
  const manifestPath = path.join(vault, '.manifest.json');
  const indexPath = path.join(vault, 'index.md');
  const logPath = path.join(vault, 'log.md');
  const hotPath = path.join(vault, 'hot.md');
  const [originalManifestText, originalIndex, originalLog, originalHot] = await Promise.all([
    fsp.readFile(manifestPath, 'utf8'),
    fsp.readFile(indexPath, 'utf8'),
    fsp.readFile(logPath, 'utf8'),
    fsp.readFile(hotPath, 'utf8')
  ]);
  const originalManifest = JSON.parse(originalManifestText);
  const transactionId = `${timestamp.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const archiveRoot = path.join(vault, '_archives', 'dsh-project-sync', transactionId);
  await assertSafeDirectoryChain(vault, path.dirname(archiveRoot));
  await fsp.mkdir(archiveRoot, { recursive: true });
  await assertSafeDirectoryChain(vault, archiveRoot);
  await registerActiveWikiTransactionArchive(vault, archiveRoot, 'project-sync');
  const pageWriteErrors = {
    staleCode: 'stale-project-page',
    staleMessage: '知识页面在保存前发生变化，请重新读取后合并。',
    untrackedCode: 'untracked-project-page',
    untrackedMessage: '知识库目标位置出现未纳入清单的页面，已停止覆盖。'
  };
  for (const write of plan.writes) {
    if (!write.exists) continue;
    const original = await assertExpectedPageState(write, pageWriteErrors);
    const backup = path.join(archiveRoot, write.path);
    await fsp.mkdir(path.dirname(backup), { recursive: true });
    await atomicWriteText(backup, original);
  }
  for (const [name, value] of [['.manifest.json', originalManifestText], ['index.md', originalIndex], ['log.md', originalLog], ['hot.md', originalHot]]) {
    await atomicWriteText(path.join(archiveRoot, name), value);
  }

  const project = plan.preview.project;
  const previousProject = originalManifest.projects?.[project.id] || {};
  const releaseWorkflowEstablished = previousProject.workflow_mode === 'release-knowledge'
    || previousProject.release_knowledge?.mode === 'release-knowledge';
  const overview = plan.writes.find((item) => item.path === project.overviewPath);
  const summary = overview?.summary || oneLine(originalManifest.projects?.[project.id]?.summary || '项目知识增量同步', 240);
  const pageSet = new Set([
    ...plan.preview.existingPages.map((item) => item.path),
    ...plan.writes.map((item) => item.path)
  ]);
  const committedPageHashes = normalizedPageHashes(originalManifest.projects?.[project.id]?.page_sha256);
  const pageHashes = new Map(plan.preview.existingPages.map((item) => [item.path, committedPageHashes[item.path] || item.sha256]));
  for (const write of plan.writes) pageHashes.set(write.path, sha256Text(write.text));
  const nextManifest = {
    ...originalManifest,
    version: WIKI_SCHEMA_VERSION,
    projects: {
      ...(originalManifest.projects || {}),
      [project.id]: {
        id: project.id,
        name: project.name,
        source_cwd: project.sourceCwd,
        source_fingerprint: plan.preview.sourceFingerprint,
        last_git_commit: plan.preview.git?.head || '',
        mode: plan.preview.mode,
        files: plan.preview.sourceFiles,
        pages_in_vault: [...pageSet].sort(),
        page_sha256: sortedPageHashes(pageHashes),
        workflow_mode: releaseWorkflowEstablished || plan.releaseKnowledgeMode ? 'release-knowledge' : 'project-sync',
        release_knowledge: plan.releaseKnowledgeMode
          ? {
              mode: 'release-knowledge',
              complete: true,
              pages: [...plan.releasePaths],
              updated: timestamp
            }
          : previousProject.release_knowledge,
        summary,
        updated: timestamp
      }
    }
  };
  const nextManifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
  const nextIndex = updateProjectIndexText(originalIndex, project, summary, timestamp);
  const nextHot = updateProjectHotText(originalHot, project, timestamp, plan.writes.length);
  const nextLog = `${originalLog.trimEnd()}\n- [${timestamp}] WIKI_UPDATE project=${yamlString(project.id)} mode=${plan.preview.mode} workflow=${plan.workflowMode} added=${plan.preview.delta.added.length} modified=${plan.preview.delta.modified.length} removed=${plan.preview.delta.removed.length} pages=${plan.writes.length} archive=${yamlString(path.relative(vault, archiveRoot).replace(/\\/g, '/'))}\n`;
  const metadataWriteErrors = {
    staleCode: 'stale-wiki-metadata',
    staleMessage: 'Wiki 清单、索引、日志或热点页在同步期间发生变化，已停止覆盖。',
    untrackedCode: 'stale-wiki-metadata',
    untrackedMessage: 'Wiki 清单、索引、日志或热点页状态异常，已停止覆盖。'
  };
  const metadataWrites = [
    { path: '.manifest.json', absolute: manifestPath, exists: true, expectedSha256: sha256Text(originalManifestText), text: nextManifestText },
    { path: 'index.md', absolute: indexPath, exists: true, expectedSha256: sha256Text(originalIndex), text: nextIndex },
    { path: 'log.md', absolute: logPath, exists: true, expectedSha256: sha256Text(originalLog), text: nextLog },
    { path: 'hot.md', absolute: hotPath, exists: true, expectedSha256: sha256Text(originalHot), text: nextHot }
  ];
  const transactionWrites = [...plan.writes, ...metadataWrites];
  const writtenPaths = new Set();
  try {
    for (const write of plan.writes) {
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await fsp.mkdir(path.dirname(write.absolute), { recursive: true });
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await writeExpectedPage(write, pageWriteErrors, { vaultPath: vault, archiveRoot });
      writtenPaths.add(write.path);
    }
    await afterPageWrites();
    if (plan.releaseKnowledgeMode) {
      const releaseState = await inspectReleaseKnowledgePages(vault, project, previousProject, plan.writes);
      if (!releaseState.complete) throw new WikiBasicError('release-knowledge-directory-changed', '版本知识目录在提交期间发生变化，固定六页未能保持完整，已停止提交。');
    }
    await assertTransactionClaimsStable(plan.writes, 'concurrent-project-page', '检测到项目页面在同步期间被其他程序修改，已停止提交');
    for (const write of metadataWrites) await writeExpectedPage(write, metadataWriteErrors, { vaultPath: vault, archiveRoot });
    await assertTransactionClaimsStable(transactionWrites, 'concurrent-wiki-edit', '检测到 Wiki 文件在事务提交期间被其他程序修改，已停止提交');
    for (const write of plan.writes) {
      if (await fsp.readFile(write.absolute, 'utf8') !== write.text) throw new WikiBasicError('write-verification-failed', `项目页面 ${write.path} 写入后校验失败。`);
    }
    const [verifiedManifest, verifiedIndex, verifiedLog, verifiedHot] = await Promise.all([
      fsp.readFile(manifestPath, 'utf8'), fsp.readFile(indexPath, 'utf8'), fsp.readFile(logPath, 'utf8'), fsp.readFile(hotPath, 'utf8')
    ]);
    if (verifiedManifest !== nextManifestText || verifiedIndex !== nextIndex || verifiedLog !== nextLog || verifiedHot !== nextHot) {
      throw new WikiBasicError('write-verification-failed', '项目清单、索引、日志或热点页写入后校验失败。');
    }
    if (plan.releaseKnowledgeMode) {
      const releaseState = await inspectReleaseKnowledgePages(vault, project, nextManifest.projects[project.id], plan.writes);
      if (!releaseState.complete) throw new WikiBasicError('release-knowledge-directory-changed', '版本知识目录在提交校验期间发生变化，固定六页未能保持完整。');
    }
  } catch (error) {
    await rollbackWikiTransaction({
      vaultPath: vault,
      archiveRoot,
      operation: 'project-sync',
      writes: transactionWrites.filter((write) => write.transactionTouched),
      originalError: error
    });
    throw error;
  }
  return {
    ok: true,
    project,
    pagesCreated: plan.writes.filter((item) => !item.exists).map((item) => item.path),
    pagesUpdated: plan.writes.filter((item) => item.exists).map((item) => item.path),
    archive: path.relative(vault, archiveRoot).replace(/\\/g, '/'),
    message: '项目知识已增量同步，清单、索引、日志和恢复副本均已更新。'
  };
};

const saveProjectSync = async (vaultPath, workspacePath, spec, options = {}) => {
  if (!options.confirmed) return saveProjectSyncLocked(vaultPath, workspacePath, spec, options);
  const vault = await assertPlainDirectory(vaultPath);
  return withVaultWriteLock(
    vault,
    {
      operation: 'project-sync',
      busyCode: 'project-sync-busy',
      busyMessage: '另一个 Wiki 写入操作正在更新该知识库，请稍后再同步项目。'
    },
    () => saveProjectSyncLocked(vault, workspacePath, spec, options),
    '项目同步失败，且知识库写入锁清理未完成。'
  );
};

const historySessionFingerprint = (session) => sha256Text(JSON.stringify({
  sourceId: session.sourceId,
  updatedAt: session.updatedAt,
  messages: session.messages
}));

const normalizeHistoryRedactions = (value) => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).map((finding) => ({
    id: oneLine(finding?.id, 40),
    label: oneLine(finding?.label, 80),
    count: Number.isInteger(finding?.count) && finding.count > 0 && finding.count <= 10000 ? finding.count : 0
  })).filter((finding) => finding.id && finding.label && finding.count > 0);
};

const readDshHistorySource = async (sourcePath, workspacePath, { clock = () => new Date() } = {}) => {
  const resolvedSource = normalizeAbsolutePath(sourcePath, 'DSH 历史导入源路径');
  const workspace = normalizeAbsolutePath(workspacePath, '工作区路径');
  let info;
  try {
    info = await fsp.lstat(resolvedSource);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new WikiBasicError('history-source-missing', '请先在 Wiki 中心选择并准备 DSH 历史。');
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_HISTORY_SOURCE_BYTES) {
    throw new WikiBasicError('unsafe-history-source', 'DSH 历史导入源不是受支持的普通文件。');
  }
  const opened = await readBoundedRegularFile(resolvedSource, MAX_HISTORY_SOURCE_BYTES);
  if (!opened) throw new WikiBasicError('unsafe-history-source', 'DSH 历史导入源超出安全上限。');
  let raw;
  try {
    raw = JSON.parse(opened.bytes.toString('utf8'));
  } catch {
    throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源格式无效。');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== HISTORY_SOURCE_VERSION
    || typeof raw.sourceToken !== 'string' || !/^[a-f0-9]{32}$/u.test(raw.sourceToken)
    || typeof raw.workspacePath !== 'string' || normalizedPathKey(raw.workspacePath) !== normalizedPathKey(workspace)) {
    throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源与当前工作区不匹配。');
  }
  const expiresAt = Date.parse(raw.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= clock().getTime()) {
    throw new WikiBasicError('history-source-expired', 'DSH 历史导入源已过期，请回到 Wiki 中心重新准备。');
  }
  if (!Array.isArray(raw.sessions) || raw.sessions.length < 1 || raw.sessions.length > MAX_HISTORY_SESSIONS) {
    throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源中的会话数量无效。');
  }
  const sessions = [];
  const sourceIds = new Set();
  let totalMessages = 0;
  let totalChars = 0;
  for (const candidate of raw.sessions) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
      || typeof candidate.sourceId !== 'string' || !/^[a-f0-9]{24}$/u.test(candidate.sourceId)
      || sourceIds.has(candidate.sourceId)
      || typeof candidate.fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(candidate.fingerprint)
      || !Number.isInteger(candidate.lastSeq) || candidate.lastSeq < 0
      || !Array.isArray(candidate.messages) || candidate.messages.length < 1 || candidate.messages.length > MAX_HISTORY_MESSAGES_PER_SESSION) {
      throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源包含无效会话。');
    }
    sourceIds.add(candidate.sourceId);
    const messages = [];
    let previousSeq = -1;
    for (const item of candidate.messages) {
      const text = normalizeText(item?.text, MAX_HISTORY_MESSAGE_CHARS);
      if (!item || !Number.isInteger(item.seq) || item.seq < 0 || item.seq <= previousSeq
        || !['user', 'assistant'].includes(item.role) || !text
        || String(item.text || '').length > MAX_HISTORY_MESSAGE_CHARS) {
        throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源包含无效消息。');
      }
      previousSeq = item.seq;
      messages.push({ seq: item.seq, time: Number.isFinite(item.time) ? item.time : null, role: item.role, text });
      totalMessages += 1;
      totalChars += text.length;
      if (totalMessages > MAX_HISTORY_TOTAL_MESSAGES || totalChars > MAX_HISTORY_TOTAL_CHARS) {
        throw new WikiBasicError('history-source-too-large', 'DSH 历史导入源超出本次导入上限。');
      }
    }
    const session = {
      sourceId: candidate.sourceId,
      title: oneLine(candidate.title, MAX_TITLE_CHARS) || '未命名 DSH 会话',
      updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : null,
      lastSeq: candidate.lastSeq,
      fingerprint: candidate.fingerprint,
      messages,
      redactions: normalizeHistoryRedactions(candidate.redactions),
      limited: candidate.limited === true
    };
    if (historySessionFingerprint(session) !== session.fingerprint || session.lastSeq !== messages[messages.length - 1].seq) {
      throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源会话指纹校验失败。');
    }
    sessions.push(session);
  }
  if (raw.totalMessages !== undefined && Number(raw.totalMessages) !== totalMessages) throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源消息计数不一致。');
  if (raw.totalChars !== undefined && Number(raw.totalChars) !== totalChars) throw new WikiBasicError('invalid-history-source', 'DSH 历史导入源文本计数不一致。');
  return {
    sourcePath: resolvedSource,
    sourceFileSha256: sha256Text(opened.bytes),
    sourceToken: raw.sourceToken,
    expiresAt: raw.expiresAt,
    workspacePath: workspace,
    workspaceName: oneLine(raw.workspaceName, MAX_TITLE_CHARS) || path.basename(workspace),
    limited: raw.limited === true,
    totalMessages,
    totalChars,
    redactions: normalizeHistoryRedactions(raw.redactions),
    sessions
  };
};

const previousDshHistoryProject = (manifest, project) => {
  const dsh = manifest.history?.dsh;
  if (dsh !== undefined && (!dsh || typeof dsh !== 'object' || Array.isArray(dsh))) {
    throw new WikiBasicError('invalid-manifest', '知识库历史导入清单损坏。');
  }
  const entry = dsh?.[project.id] || null;
  if (entry?.source_cwd && normalizedPathKey(entry.source_cwd) !== normalizedPathKey(project.sourceCwd)) {
    throw new WikiBasicError('history-project-conflict', '历史导入项目标识与知识库中的来源路径冲突。');
  }
  if (entry?.sessions !== undefined && (!entry.sessions || typeof entry.sessions !== 'object' || Array.isArray(entry.sessions))) {
    throw new WikiBasicError('invalid-manifest', '知识库历史会话清单损坏。');
  }
  return entry;
};

const historyPagePath = (project, value) => {
  if (typeof value !== 'string' || value.length > 260 || value.includes('\\')) return '';
  const relative = value.replace(/^\/+/, '');
  const segments = relative.split('/');
  if (!relative.endsWith('.md') || relative.includes('..') || relative.includes('//')
    || /[\u0000-\u001f<>:"|?*]/u.test(relative)
    || segments.some((segment) => !segment || /[. ]$/u.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) return '';
  return relative.startsWith(`${project.rootPath}/history/`) ? relative : '';
};

const listDshHistoryPages = async (vaultPath, project, entry) => {
  const configured = Array.isArray(entry?.pages_in_vault) ? entry.pages_in_vault.slice(0, 100) : [];
  assertUniquePolicyPaths(configured.filter((item) => typeof item === 'string'));
  assertUniquePolicyPaths(Object.keys(entry?.page_sha256 && typeof entry.page_sha256 === 'object' ? entry.page_sha256 : {}));
  const committedHashes = normalizedPageHashes(entry?.page_sha256);
  const pages = [];
  const missingManagedPages = [];
  for (const relative of new Set(configured)) {
    const normalized = typeof relative === 'string' ? relative.replace(/\\/g, '/') : '';
    if (!historyPagePath(project, normalized)) {
      missingManagedPages.push(normalized.slice(0, 260));
      continue;
    }
    const absolute = path.join(vaultPath, normalized);
    if (!pathInside(vaultPath, absolute)) {
      missingManagedPages.push(normalized);
      continue;
    }
    try {
      const info = await fsp.lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKDOWN_BYTES) {
        missingManagedPages.push(normalized);
        continue;
      }
      const opened = await readBoundedRegularFile(absolute, MAX_MARKDOWN_BYTES);
      if (!opened) {
        missingManagedPages.push(normalized);
        continue;
      }
      const sha256 = sha256Text(opened.bytes);
      const committedSha256 = committedHashes[normalized] || '';
      if (!committedSha256) {
        throw new WikiBasicError('untracked-history-page', `知识库中已有未纳入历史清单哈希的页面 ${normalized}，已停止覆盖。`);
      }
      pages.push({
        path: normalized,
        sha256,
        size: opened.size,
        committedSha256,
        humanEdited: Boolean(committedSha256 && committedSha256 !== sha256)
      });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      missingManagedPages.push(normalized);
    }
  }
  pages.sort((left, right) => left.path.localeCompare(right.path));
  missingManagedPages.sort((left, right) => left.localeCompare(right));
  return { pages, missingManagedPages: [...new Set(missingManagedPages)] };
};

const previewDshHistoryIngest = async (vaultPath, workspacePath, sourcePath, { clock = () => new Date() } = {}) => {
  const vault = await assertPlainDirectory(vaultPath);
  const state = await inspectWikiVault(vault);
  if (state.status !== 'ready') throw new WikiBasicError('vault-not-ready', '知识库尚未初始化，不能导入 DSH 历史。');
  const source = await readDshHistorySource(sourcePath, workspacePath, { clock });
  const project = projectIdentity(source.workspacePath);
  const manifest = await readManifestStrict(vault);
  const previous = previousDshHistoryProject(manifest, project);
  const previousSessions = previous?.sessions || {};
  const sessions = source.sessions.map((session) => {
    const before = previousSessions[session.sourceId];
    const status = !before ? 'added' : before.fingerprint === session.fingerprint ? 'unchanged' : 'modified';
    return {
      sourceId: session.sourceId,
      title: session.title,
      updatedAt: session.updatedAt,
      lastSeq: session.lastSeq,
      fingerprint: session.fingerprint,
      messageCount: session.messages.length,
      redactions: session.redactions,
      limited: session.limited,
      status
    };
  });
  const pageState = await listDshHistoryPages(vault, project, previous);
  const existingPages = pageState.pages;
  const missingManagedPages = pageState.missingManagedPages;
  const delta = {
    added: sessions.filter((session) => session.status === 'added'),
    modified: sessions.filter((session) => session.status === 'modified'),
    unchanged: sessions.filter((session) => session.status === 'unchanged')
  };
  const tokenPayload = {
    projectId: project.id,
    sourceToken: source.sourceToken,
    sourceFileSha256: source.sourceFileSha256,
    sessions: sessions.map(({ sourceId, fingerprint }) => ({ sourceId, fingerprint })),
    pages: existingPages.map(({ path: pagePath, sha256 }) => ({ path: pagePath, sha256 })),
    missingManagedPages
  };
  return {
    ok: true,
    generatedAt: isoNow(clock),
    project,
    sourceToken: source.sourceToken,
    expiresAt: source.expiresAt,
    sourceFileSha256: source.sourceFileSha256,
    limited: source.limited,
    totalMessages: source.totalMessages,
    totalChars: source.totalChars,
    redactions: source.redactions,
    sessions,
    delta,
    existingPages,
    missingManagedPages,
    humanEditedPages: existingPages.filter((page) => page.humanEdited).map((page) => page.path),
    unchanged: delta.added.length === 0 && delta.modified.length === 0 && missingManagedPages.length === 0,
    previewToken: sha256Text(JSON.stringify(tokenPayload))
  };
};

const readDshHistorySession = async (sourcePath, workspacePath, sourceToken, sourceId, options = {}) => {
  const source = await readDshHistorySource(sourcePath, workspacePath, options);
  if (source.sourceToken !== sourceToken) throw new WikiBasicError('stale-history-source', 'DSH 历史导入源已变化，请重新预览。');
  const session = source.sessions.find((item) => item.sourceId === sourceId);
  if (!session) throw new WikiBasicError('history-session-not-found', '所选 DSH 历史会话不在当前导入源中。');
  return {
    ok: true,
    sourceId: session.sourceId,
    title: session.title,
    updatedAt: session.updatedAt,
    lastSeq: session.lastSeq,
    fingerprint: session.fingerprint,
    limited: session.limited,
    redactions: session.redactions,
    messages: session.messages
  };
};

const dshHistoryPageText = (page, project, timestamp, existingText = '') => {
  const trust = preservedPageTrust(existingText, timestamp);
  const sources = page.sources.map((source) => `  - ${yamlString(`dsh-session:${source}`)}`).join('\n');
  return `---\ntitle: ${yamlString(page.title)}\ncategory: project-history\ntags: [dsh, history-ingest]\nsources:\n${sources}\nsummary: ${yamlString(page.summary)}\nprovenance:\n  extracted: ${page.provenance.extracted.toFixed(2)}\n  inferred: ${page.provenance.inferred.toFixed(2)}\n  ambiguous: ${page.provenance.ambiguous.toFixed(2)}\nbase_confidence: 0.42\nlifecycle: ${trust.lifecycle}\nlifecycle_changed: ${trust.lifecycleChanged}\ntier: ${trust.tier}\nsource_cwd: ${yamlString(project.sourceCwd)}\ncreated: ${trust.created}\nupdated: ${timestamp}\n---\n\n${page.content.trim()}\n\n## 来源\n\n${page.sources.map((source) => `- DSH 会话：${source}`).join('\n')}\n- 说明：仅使用用户选中会话的用户/助手文本；原始历史只读，固定凭据模式已在进入 Agent 前遮蔽。\n`;
};

const buildDshHistoryIngestPlan = async (vaultPath, workspacePath, sourcePath, spec, options = {}) => {
  const preview = await previewDshHistoryIngest(vaultPath, workspacePath, sourcePath, options);
  if (preview.unchanged) throw new WikiBasicError('history-unchanged', '选中的 DSH 历史自上次导入后没有变化。');
  if (!spec || spec.previewToken !== preview.previewToken || spec.sourceToken !== preview.sourceToken) {
    throw new WikiBasicError('stale-history-preview', 'DSH 历史、选择或知识库页面已变化，请重新预览。');
  }
  if (preview.missingManagedPages.length > 0) {
    throw new WikiBasicError('managed-pages-missing', `有 ${preview.missingManagedPages.length} 个受管历史页面缺失或不安全，请先从恢复副本核对。`);
  }
  if (!Array.isArray(spec.pages) || spec.pages.length < 1 || spec.pages.length > MAX_HISTORY_PAGES) {
    throw new WikiBasicError('invalid-history-pages', `每次历史导入必须包含 1 到 ${MAX_HISTORY_PAGES} 个页面。`);
  }
  const sourceIds = new Set(preview.sessions.map((session) => session.sourceId));
  const changedSourceIds = new Set([...preview.delta.added, ...preview.delta.modified].map((session) => session.sourceId));
  const existingPages = new Map(preview.existingPages.map((page) => [page.path, page]));
  const writes = [];
  const seen = new Set();
  let totalChars = 0;
  for (const candidate of spec.pages) {
    const relative = historyPagePath(preview.project, candidate?.path);
    if (!relative || seen.has(relative)) throw new WikiBasicError('invalid-history-page-path', '历史知识页面必须位于当前项目的 history 目录中。');
    seen.add(relative);
    const title = oneLine(candidate?.title, MAX_TITLE_CHARS);
    const summary = oneLine(candidate?.summary, 240);
    const content = normalizeText(candidate?.content, MAX_HISTORY_PAGE_CHARS);
    if (!title || !summary || !content || String(candidate?.content || '').length > MAX_HISTORY_PAGE_CHARS) {
      throw new WikiBasicError('invalid-history-page', '历史知识页面必须包含有效标题、摘要和受限正文。');
    }
    totalChars += content.length;
    if (totalChars > MAX_HISTORY_TOTAL_PAGE_CHARS) throw new WikiBasicError('history-pages-too-large', '本次历史导入页面总量超出限制。');
    const sources = Array.isArray(candidate?.sources)
      ? [...new Set(candidate.sources.filter((item) => typeof item === 'string' && sourceIds.has(item)))].slice(0, MAX_HISTORY_SESSIONS)
      : [];
    if (!sources.length || !sources.some((source) => changedSourceIds.has(source))) {
      throw new WikiBasicError('invalid-history-sources', '每个页面至少需要一个本次新增或变化的 DSH 会话来源。');
    }
    const existing = existingPages.get(relative);
    if (existing && candidate.expectedSha256 !== existing.sha256) throw new WikiBasicError('stale-history-page', `知识页面 ${relative} 已变化，请重新读取后合并。`);
    if (!existing && candidate.expectedSha256 !== null && candidate.expectedSha256 !== undefined) throw new WikiBasicError('unexpected-history-page', `知识页面 ${relative} 尚不存在，不能按更新处理。`);
    const absolute = path.join(path.resolve(vaultPath), relative);
    if (!pathInside(vaultPath, absolute)) throw new WikiBasicError('path-escape', '历史知识页面越过知识库目录。');
    await assertSafeDirectoryChain(vaultPath, path.dirname(absolute));
    if (!existing) {
      try {
        const info = await fsp.lstat(absolute);
        if (info) throw new WikiBasicError('untracked-history-page', `知识库中已有未纳入历史清单的页面 ${relative}，已停止覆盖。`);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    const existingText = existing ? await fsp.readFile(absolute, 'utf8') : '';
    const page = { path: relative, title, summary, content, sources, provenance: normalizeProvenance(candidate.provenance) };
    const text = dshHistoryPageText(page, preview.project, isoNow(options.clock || (() => new Date())), existingText);
    writes.push({ ...page, absolute, exists: Boolean(existing), expectedSha256: existing?.sha256 || null, text, sensitive: sensitiveFindings(text) });
  }
  return {
    ok: true,
    preview,
    writes,
    pagesCreated: writes.filter((item) => !item.exists).length,
    pagesUpdated: writes.filter((item) => item.exists).length,
    sensitive: writes.flatMap((item) => item.sensitive.map((finding) => ({ ...finding, path: item.path })))
  };
};

const readDshHistoryWikiPage = async (vaultPath, workspacePath, sourcePath, relativePath, options = {}) => {
  const preview = await previewDshHistoryIngest(vaultPath, workspacePath, sourcePath, options);
  const expected = preview.existingPages.find((item) => item.path === relativePath);
  if (!expected || !historyPagePath(preview.project, relativePath)) throw new WikiBasicError('history-page-not-found', '该页面不属于当前项目的 DSH 历史导入清单。');
  const absolute = path.join(path.resolve(vaultPath), relativePath);
  await assertSafeDirectoryChain(vaultPath, path.dirname(absolute));
  const info = await fsp.lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKDOWN_BYTES) throw new WikiBasicError('unsafe-history-page', '历史知识页面不是受支持的普通 Markdown 文件。');
  const opened = await readBoundedRegularFile(absolute, MAX_MARKDOWN_BYTES);
  if (!opened) throw new WikiBasicError('unsafe-history-page', '历史知识页面不是受支持的普通 Markdown 文件。');
  const content = opened.bytes.toString('utf8');
  const digest = sha256Text(content);
  if (digest !== expected.sha256) throw new WikiBasicError('stale-history-page', '历史知识页面在读取期间发生变化，请重试。');
  return { ok: true, path: relativePath, sha256: digest, content };
};

const updateDshHistoryIndexText = (text, writes, timestamp) => {
  let next = text.replace(/\*此索引由 DSH Desktop 维护。最后更新：[^*]+\*/u, `*此索引由 DSH Desktop 维护。最后更新：${timestamp}*`);
  const entries = writes.filter((write) => {
    const link = write.path.replace(/\.md$/iu, '');
    return !next.includes(`[[${link}|`) && !next.includes(`[[${link}]]`);
  }).map((write) => `- [[${write.path.replace(/\.md$/iu, '')}|${write.title}]] — ${write.summary} ( #dsh #history-ingest)`);
  if (!entries.length) return next;
  const marker = '## Projects';
  return next.includes(marker)
    ? next.replace(marker, `${marker}\n\n${entries.join('\n')}`)
    : `${next.trimEnd()}\n\n${marker}\n\n${entries.join('\n')}\n`;
};

const updateDshHistoryHotText = (text, project, timestamp, sessionCount, pageCount) => {
  const entry = `- [${timestamp}] DSH_HISTORY_INGEST — ${project.name}，导入 ${sessionCount} 个会话，更新 ${pageCount} 个页面`;
  const marker = '## Recent Activity';
  if (!text.includes(marker)) return `${text.trimEnd()}\n\n${marker}\n\n${entry}\n`;
  return text.replace(marker, `${marker}\n\n${entry}`);
};

const clearDshHistorySource = async (sourcePath, sourceToken) => {
  const resolved = normalizeAbsolutePath(sourcePath, 'DSH 历史导入源路径');
  let info;
  try {
    info = await fsp.lstat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, cleared: false };
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_HISTORY_SOURCE_BYTES) throw new WikiBasicError('unsafe-history-source', 'DSH 历史导入源不安全，未执行清理。');
  const opened = await readBoundedRegularFile(resolved, MAX_HISTORY_SOURCE_BYTES);
  let parsed;
  try { parsed = JSON.parse(opened?.bytes.toString('utf8') || '{}'); } catch {}
  if (!parsed || parsed.sourceToken !== sourceToken) throw new WikiBasicError('stale-history-source', 'DSH 历史导入源已变化，未执行清理。');
  const expectedSourceDigest = sha256Text(opened.bytes);
  const claimPath = `${resolved}.consumed-${randomUUID()}`;
  try {
    await fsp.rename(resolved, claimPath);
  } catch (error) {
    const [claimedAfterError, sourceAfterError] = await Promise.all([
      readBoundedRegularFile(claimPath, MAX_HISTORY_SOURCE_BYTES).catch(() => null),
      fsp.lstat(resolved).catch(() => null)
    ]);
    if (!claimedAfterError || sourceAfterError) throw error;
  }
  const claimed = await readBoundedRegularFile(claimPath, MAX_HISTORY_SOURCE_BYTES);
  let claimedSource;
  try { claimedSource = JSON.parse(claimed?.bytes.toString('utf8') || '{}'); } catch {}
  if (!claimed || claimedSource?.sourceToken !== sourceToken || sha256Text(claimed.bytes) !== expectedSourceDigest) {
    if (claimed) {
      try { await writeNewTextAtomically(resolved, claimed.bytes.toString('utf8')); } catch {}
    }
    const stale = new WikiBasicError('stale-history-source', 'DSH 历史导入源在清理边界发生变化；替换内容已保留，未执行删除。');
    stale.retainedClaim = claimPath;
    throw stale;
  }
  try {
    await retryWikiLockTransient(() => fsp.unlink(claimPath));
  } catch (error) {
    const remaining = await fsp.lstat(claimPath).catch(() => null);
    if (!remaining) return { ok: true, cleared: true, cleanupPending: false };
    return { ok: true, cleared: true, cleanupPending: true, retainedClaim: claimPath };
  }
  return { ok: true, cleared: true, cleanupPending: false };
};

const saveDshHistoryIngestLocked = async (vaultPath, workspacePath, sourcePath, spec, {
  confirmed = false,
  confirmedSensitive = false,
  clock = () => new Date(),
  afterPageWrites = async () => undefined
} = {}) => {
  if (!confirmed) throw new WikiBasicError('history-confirmation-required', '导入 DSH 历史前需要用户明确确认。');
  const vault = await assertPlainDirectory(vaultPath);
  const plan = await buildDshHistoryIngestPlan(vault, workspacePath, sourcePath, spec, { clock });
  const sourceRedactions = plan.preview.redactions.length > 0 || plan.preview.sessions.some((session) => session.redactions.length > 0);
  if ((sourceRedactions || plan.sensitive.length > 0) && !confirmedSensitive) {
    throw new WikiBasicError('sensitive-confirmation-required', '历史源曾命中凭据遮蔽或页面仍含敏感字段，需要再次确认。');
  }
  const timestamp = isoNow(clock);
  const manifestPath = path.join(vault, '.manifest.json');
  const indexPath = path.join(vault, 'index.md');
  const logPath = path.join(vault, 'log.md');
  const hotPath = path.join(vault, 'hot.md');
  const [originalManifestText, originalIndex, originalLog, originalHot] = await Promise.all([
    fsp.readFile(manifestPath, 'utf8'), fsp.readFile(indexPath, 'utf8'), fsp.readFile(logPath, 'utf8'), fsp.readFile(hotPath, 'utf8')
  ]);
  const originalManifest = JSON.parse(originalManifestText);
  const previous = previousDshHistoryProject({ history: originalManifest.history || {} }, plan.preview.project);
  const transactionId = `${timestamp.replace(/[:.]/g, '-')}-${randomUUID()}`;
  const archiveRoot = path.join(vault, '_archives', 'dsh-history-ingest', transactionId);
  await assertSafeDirectoryChain(vault, path.dirname(archiveRoot));
  await fsp.mkdir(archiveRoot, { recursive: true });
  await assertSafeDirectoryChain(vault, archiveRoot);
  await registerActiveWikiTransactionArchive(vault, archiveRoot, 'history-ingest');
  const pageWriteErrors = {
    staleCode: 'stale-history-page',
    staleMessage: '历史知识页面在保存前发生变化，请重新读取后合并。',
    untrackedCode: 'untracked-history-page',
    untrackedMessage: '历史知识目标位置出现未纳入清单的页面，已停止覆盖。'
  };
  for (const write of plan.writes) {
    if (!write.exists) continue;
    const original = await assertExpectedPageState(write, pageWriteErrors);
    const backup = path.join(archiveRoot, write.path);
    await fsp.mkdir(path.dirname(backup), { recursive: true });
    await atomicWriteText(backup, original);
  }
  for (const [name, value] of [['.manifest.json', originalManifestText], ['index.md', originalIndex], ['log.md', originalLog], ['hot.md', originalHot]]) {
    await atomicWriteText(path.join(archiveRoot, name), value);
  }

  const pageSet = new Set([...(previous?.pages_in_vault || []), ...plan.writes.map((write) => write.path)]);
  const committedPageHashes = normalizedPageHashes(previous?.page_sha256);
  const pageHashes = new Map(plan.preview.existingPages.map((item) => [item.path, committedPageHashes[item.path] || item.sha256]));
  for (const write of plan.writes) pageHashes.set(write.path, sha256Text(write.text));
  const nextSessions = { ...(previous?.sessions || {}) };
  for (const session of plan.preview.sessions) {
    const usedPages = plan.writes.filter((write) => write.sources.includes(session.sourceId)).map((write) => write.path);
    const existing = nextSessions[session.sourceId] || {};
    nextSessions[session.sourceId] = {
      source_id: session.sourceId,
      title: session.title,
      fingerprint: session.fingerprint,
      last_seq: session.lastSeq,
      updated_at: session.updatedAt,
      pages_in_vault: [...new Set([...(existing.pages_in_vault || []), ...usedPages])].sort(),
      ingested_at: session.status === 'unchanged' && existing.ingested_at ? existing.ingested_at : timestamp
    };
  }
  const project = plan.preview.project;
  const nextManifest = {
    ...originalManifest,
    version: WIKI_SCHEMA_VERSION,
    history: {
      ...(originalManifest.history || {}),
      dsh: {
        ...(originalManifest.history?.dsh || {}),
        [project.id]: {
          id: project.id,
          name: project.name,
          source_cwd: project.sourceCwd,
          sessions: nextSessions,
          pages_in_vault: [...pageSet].filter((item) => historyPagePath(project, item)).sort(),
          page_sha256: sortedPageHashes(pageHashes),
          updated: timestamp
        }
      }
    }
  };
  const nextManifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
  const nextIndex = updateDshHistoryIndexText(originalIndex, plan.writes, timestamp);
  const changedSessions = plan.preview.delta.added.length + plan.preview.delta.modified.length;
  const nextHot = updateDshHistoryHotText(originalHot, project, timestamp, changedSessions, plan.writes.length);
  const nextLog = `${originalLog.trimEnd()}\n- [${timestamp}] DSH_HISTORY_INGEST project=${yamlString(project.id)} sessions=${changedSessions} added=${plan.preview.delta.added.length} modified=${plan.preview.delta.modified.length} pages=${plan.writes.length} archive=${yamlString(path.relative(vault, archiveRoot).replace(/\\/g, '/'))}\n`;
  const metadataWriteErrors = {
    staleCode: 'stale-wiki-metadata',
    staleMessage: 'Wiki 清单、索引、日志或热点页在历史导入期间发生变化，已停止覆盖。',
    untrackedCode: 'stale-wiki-metadata',
    untrackedMessage: 'Wiki 清单、索引、日志或热点页状态异常，已停止覆盖。'
  };
  const metadataWrites = [
    { path: '.manifest.json', absolute: manifestPath, exists: true, expectedSha256: sha256Text(originalManifestText), text: nextManifestText },
    { path: 'index.md', absolute: indexPath, exists: true, expectedSha256: sha256Text(originalIndex), text: nextIndex },
    { path: 'log.md', absolute: logPath, exists: true, expectedSha256: sha256Text(originalLog), text: nextLog },
    { path: 'hot.md', absolute: hotPath, exists: true, expectedSha256: sha256Text(originalHot), text: nextHot }
  ];
  const transactionWrites = [...plan.writes, ...metadataWrites];
  const writtenPaths = new Set();
  try {
    for (const write of plan.writes) {
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await fsp.mkdir(path.dirname(write.absolute), { recursive: true });
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await writeExpectedPage(write, pageWriteErrors, { vaultPath: vault, archiveRoot });
      writtenPaths.add(write.path);
    }
    await afterPageWrites();
    await assertTransactionClaimsStable(plan.writes, 'concurrent-history-page', '检测到历史页面在导入期间被其他程序修改，已停止提交');
    for (const write of metadataWrites) await writeExpectedPage(write, metadataWriteErrors, { vaultPath: vault, archiveRoot });
    await assertTransactionClaimsStable(transactionWrites, 'concurrent-wiki-edit', '检测到 Wiki 文件在事务提交期间被其他程序修改，已停止提交');
    for (const write of plan.writes) {
      if (await fsp.readFile(write.absolute, 'utf8') !== write.text) throw new WikiBasicError('write-verification-failed', `历史知识页面 ${write.path} 写入后校验失败。`);
    }
    const [verifiedManifest, verifiedIndex, verifiedLog, verifiedHot] = await Promise.all([
      fsp.readFile(manifestPath, 'utf8'), fsp.readFile(indexPath, 'utf8'), fsp.readFile(logPath, 'utf8'), fsp.readFile(hotPath, 'utf8')
    ]);
    if (verifiedManifest !== nextManifestText || verifiedIndex !== nextIndex || verifiedLog !== nextLog || verifiedHot !== nextHot) {
      throw new WikiBasicError('write-verification-failed', '历史清单、索引、日志或热点页写入后校验失败。');
    }
  } catch (error) {
    await rollbackWikiTransaction({
      vaultPath: vault,
      archiveRoot,
      operation: 'history-ingest',
      writes: transactionWrites.filter((write) => write.transactionTouched),
      originalError: error
    });
    throw error;
  }
  let sourceCleared = false;
  try {
    sourceCleared = (await clearDshHistorySource(sourcePath, plan.preview.sourceToken)).cleared;
  } catch {}
  return {
    ok: true,
    project,
    sessionsAdded: plan.preview.delta.added.map((session) => session.sourceId),
    sessionsModified: plan.preview.delta.modified.map((session) => session.sourceId),
    pagesCreated: plan.writes.filter((write) => !write.exists).map((write) => write.path),
    pagesUpdated: plan.writes.filter((write) => write.exists).map((write) => write.path),
    archive: path.relative(vault, archiveRoot).replace(/\\/g, '/'),
    sourceCleared,
    message: 'DSH 历史已增量导入，清单、索引、日志和恢复副本均已更新；原始会话保持只读。'
  };
};

const saveDshHistoryIngest = async (vaultPath, workspacePath, sourcePath, spec, options = {}) => {
  if (!options.confirmed) return saveDshHistoryIngestLocked(vaultPath, workspacePath, sourcePath, spec, options);
  const vault = await assertPlainDirectory(vaultPath);
  return withVaultWriteLock(
    vault,
    {
      operation: 'history-ingest',
      busyCode: 'history-ingest-busy',
      busyMessage: '另一个 Wiki 写入操作正在更新该知识库，请稍后再导入 DSH 历史。'
    },
    () => saveDshHistoryIngestLocked(vault, workspacePath, sourcePath, spec, options),
    'DSH 历史导入失败，且知识库写入锁清理未完成。'
  );
};

const readConfiguredVault = async (configPath) => {
  const resolved = normalizeAbsolutePath(configPath, 'Wiki 配置文件路径');
  const settings = normalizeSettings(await readJsonFile(resolved, {}));
  if (!settings.vaultPath) throw new WikiBasicError('vault-unconfigured', '尚未在 DSH Desktop 的 Wiki 中心选择知识库。');
  return assertPlainDirectory(settings.vaultPath);
};

const parseArgs = (argv) => {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) result._.push(item);
    else {
      const name = item.slice(2);
      const next = argv[index + 1];
      if (next && !next.startsWith('--')) {
        result[name] = next;
        index += 1;
      } else result[name] = true;
    }
  }
  return result;
};

const readWorkspaceSpec = async (args) => {
  const workspace = normalizeAbsolutePath(args.workspace || process.env.DSH_CWD, '工作区路径');
  const specPath = normalizeAbsolutePath(args.spec, '保存规格路径');
  if (!pathInside(workspace, specPath)) throw new WikiBasicError('spec-outside-workspace', '保存规格必须位于当前工作区。');
  const specInfo = await fsp.lstat(specPath);
  if (!specInfo.isFile() || specInfo.isSymbolicLink() || specInfo.size > 128 * 1024) throw new WikiBasicError('invalid-spec', '保存规格必须是工作区内的小型普通 JSON 文件。');
  return { workspace, spec: JSON.parse(await fsp.readFile(specPath, 'utf8')) };
};

const runCli = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const command = args._[0];
  const configPath = args.config || process.env.DSH_DESKTOP_WIKI_CONFIG;
  if (!configPath) throw new WikiBasicError('config-missing', 'DSH Desktop 没有提供固定 Wiki 配置路径。');
  const vaultPath = await readConfiguredVault(configPath);
  if (command === 'status') return inspectWikiVault(vaultPath);
  if (command === 'query') return queryWiki(vaultPath, args.query || '', { limit: Number(args.limit) || 8 });
  if (command === 'preview') {
    const { spec } = await readWorkspaceSpec(args);
    const preview = buildCapturePreview(vaultPath, spec);
    return {
      ok: true,
      title: preview.title,
      path: preview.relativePath,
      summary: preview.summary,
      sensitive: preview.sensitive,
      sourceSessionId: preview.sourceSessionId,
      sourceSeq: preview.sourceSeq
    };
  }
  if (command === 'save') {
    const { workspace, spec } = await readWorkspaceSpec(args);
    return saveCapture(vaultPath, spec, {
      confirmedSensitive: args['confirm-sensitive'] === true,
      workspaceName: path.basename(workspace)
    });
  }
  if (command === 'project-preview') {
    const workspace = normalizeAbsolutePath(args.workspace || process.env.DSH_CWD, '工作区路径');
    return previewProjectSync(vaultPath, workspace);
  }
  if (command === 'project-page') {
    const workspace = normalizeAbsolutePath(args.workspace || process.env.DSH_CWD, '工作区路径');
    return readProjectWikiPage(vaultPath, workspace, args.path || '');
  }
  if (command === 'project-validate') {
    const { workspace, spec } = await readWorkspaceSpec(args);
    const plan = await buildProjectSyncPlan(vaultPath, workspace, spec);
    return {
      ok: true,
      project: plan.preview.project,
      pagesCreated: plan.pagesCreated,
      pagesUpdated: plan.pagesUpdated,
      sensitive: plan.sensitive
    };
  }
  if (command === 'project-save') {
    const { workspace, spec } = await readWorkspaceSpec(args);
    return saveProjectSync(vaultPath, workspace, spec, {
      confirmed: args['confirm-project-sync'] === true,
      confirmedSensitive: args['confirm-sensitive'] === true
    });
  }
  if (command === 'history-preview') {
    const workspace = normalizeAbsolutePath(args.workspace || process.env.DSH_CWD, '工作区路径');
    const sourcePath = normalizeAbsolutePath(process.env.DSH_DESKTOP_WIKI_HISTORY_SOURCE, 'DSH 历史导入源路径');
    return previewDshHistoryIngest(vaultPath, workspace, sourcePath);
  }
  if (command === 'history-session') {
    const workspace = normalizeAbsolutePath(args.workspace || process.env.DSH_CWD, '工作区路径');
    const sourcePath = normalizeAbsolutePath(process.env.DSH_DESKTOP_WIKI_HISTORY_SOURCE, 'DSH 历史导入源路径');
    return readDshHistorySession(sourcePath, workspace, args['source-token'] || '', args['source-id'] || '');
  }
  if (command === 'history-page') {
    const workspace = normalizeAbsolutePath(args.workspace || process.env.DSH_CWD, '工作区路径');
    const sourcePath = normalizeAbsolutePath(process.env.DSH_DESKTOP_WIKI_HISTORY_SOURCE, 'DSH 历史导入源路径');
    return readDshHistoryWikiPage(vaultPath, workspace, sourcePath, args.path || '');
  }
  if (command === 'history-validate') {
    const { workspace, spec } = await readWorkspaceSpec(args);
    const sourcePath = normalizeAbsolutePath(process.env.DSH_DESKTOP_WIKI_HISTORY_SOURCE, 'DSH 历史导入源路径');
    const plan = await buildDshHistoryIngestPlan(vaultPath, workspace, sourcePath, spec);
    return {
      ok: true,
      project: plan.preview.project,
      sessionsAdded: plan.preview.delta.added.length,
      sessionsModified: plan.preview.delta.modified.length,
      pagesCreated: plan.pagesCreated,
      pagesUpdated: plan.pagesUpdated,
      sourceRedactions: plan.preview.redactions,
      sensitive: plan.sensitive
    };
  }
  if (command === 'history-save') {
    const { workspace, spec } = await readWorkspaceSpec(args);
    const sourcePath = normalizeAbsolutePath(process.env.DSH_DESKTOP_WIKI_HISTORY_SOURCE, 'DSH 历史导入源路径');
    return saveDshHistoryIngest(vaultPath, workspace, sourcePath, spec, {
      confirmed: args['confirm-history-ingest'] === true,
      confirmedSensitive: args['confirm-sensitive'] === true
    });
  }
  if (command === 'history-clear') {
    const sourcePath = normalizeAbsolutePath(process.env.DSH_DESKTOP_WIKI_HISTORY_SOURCE, 'DSH 历史导入源路径');
    return clearDshHistorySource(sourcePath, args['source-token'] || '');
  }
  throw new WikiBasicError('unknown-command', 'Wiki 工具仅支持 status、query、preview、save、project-* 和 history-* 固定命令。');
};

if (require.main === module) {
  runCli().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error?.code || 'wiki-error', message: error?.message || String(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_CAPTURE_CHARS,
  MAX_HISTORY_MESSAGE_CHARS,
  MAX_HISTORY_MESSAGES_PER_SESSION,
  MAX_HISTORY_SESSIONS,
  MAX_HISTORY_SOURCE_BYTES,
  MAX_HISTORY_TOTAL_CHARS,
  MAX_HISTORY_TOTAL_MESSAGES,
  MAX_MARKDOWN_BYTES,
  MAX_PROJECT_FILES,
  MAX_PROJECT_FILE_BYTES,
  MAX_PROJECT_PAGES,
  MAX_PROJECT_TOTAL_BYTES,
  MAX_PROJECT_TOTAL_PAGE_CHARS,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  MAX_SCAN_FILES,
  WIKI_DIRECTORIES,
  WikiBasicError,
  WikiSettingsStore,
  buildCapturePreview,
  buildDshHistoryIngestPlan,
  buildProjectSyncPlan,
  clearWikiRecoveryMarker,
  initializeWikiVault,
  inspectProjectGit,
  inspectWikiVault,
  parseFrontmatter,
  previewDshHistoryIngest,
  queryWiki,
  readConfiguredVault,
  readWikiRecoveryProtection,
  readWikiRecoveryMarker,
  readDshHistorySession,
  readDshHistorySource,
  readDshHistoryWikiPage,
  readProjectWikiPage,
  runCli,
  saveCapture,
  saveDshHistoryIngest,
  saveProjectSync,
  sensitiveFindings,
  slugify,
  previewProjectSync,
  clearDshHistorySource,
  walkProjectSources
};
