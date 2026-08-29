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
  for (const directory of WIKI_DIRECTORIES) {
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
    const target = path.join(resolved, relative);
    if (!pathInside(resolved, target)) throw new WikiBasicError('path-escape', '知识库初始化路径越界。');
    (await writeIfMissing(target, text) ? created : preserved).push(relative.replace(/\\/g, '/'));
  }
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
        if (QUERY_EXCLUDED_DIRECTORIES.has(entry.name)) continue;
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
  return {
    configured: true,
    status: missing.length === 0 ? 'ready' : 'needs-init',
    vaultPath: resolved,
    missing,
    pageCount: scan.files.length,
    limited: scan.limited,
    message: missing.length === 0 ? '知识库结构完整。' : `还缺少 ${missing.length} 个基础目录或文件。`
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

const appendQueryLog = async (vaultPath, query, resultCount, clock) => {
  const logPath = path.join(vaultPath, 'log.md');
  const line = `- [${isoNow(clock)}] QUERY query=${yamlString(oneLine(query, 180))} result_pages=${resultCount} mode=normal escalated=false\n`;
  await fsp.appendFile(logPath, line, { encoding: 'utf8', mode: 0o600 });
};

const queryWiki = async (vaultPath, query, { limit = 8, clock = () => new Date(), log = true } = {}) => {
  const resolved = await assertPlainDirectory(vaultPath);
  const state = await inspectWikiVault(resolved);
  if (state.status !== 'ready') throw new WikiBasicError('vault-not-ready', '知识库尚未初始化，不能执行查询。');
  const terms = queryTerms(query);
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
      score
    });
  }
  results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const boundedLimit = Math.min(MAX_RESULTS, Math.max(1, Number.isInteger(limit) ? limit : 8));
  const selected = results.slice(0, boundedLimit);
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

const saveCapture = async (vaultPath, capture, {
  confirmedSensitive = false,
  workspaceName = '',
  clock = () => new Date()
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
  let pageCreated = false;
  try {
    const handle = await fsp.open(preview.absolutePath, 'wx', 0o600);
    try {
      await handle.writeFile(pageText, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    pageCreated = true;
    await atomicWriteText(indexPath, nextIndex);
    await atomicWriteText(logPath, `${originalLog.trimEnd()}\n${logLine}`);
    const [verifiedPage, verifiedIndex, verifiedLog] = await Promise.all([
      fsp.readFile(preview.absolutePath, 'utf8'),
      fsp.readFile(indexPath, 'utf8'),
      fsp.readFile(logPath, 'utf8')
    ]);
    if (verifiedPage !== pageText || verifiedIndex !== nextIndex || verifiedLog !== `${originalLog.trimEnd()}\n${logLine}`) {
      throw new WikiBasicError('write-verification-failed', '结论页面、索引或日志写入后校验失败。');
    }
  } catch (error) {
    if (pageCreated) await fsp.unlink(preview.absolutePath).catch(() => undefined);
    await atomicWriteText(indexPath, originalIndex).catch(() => undefined);
    await atomicWriteText(logPath, originalLog).catch(() => undefined);
    if (error?.code === 'EEXIST') throw new WikiBasicError('page-exists', '知识库中已有同名页面，请修改标题后再保存。');
    throw error;
  }
  return {
    ok: true,
    title: preview.title,
    path: preview.relativePath,
    vaultPath: resolved,
    sensitive: preview.sensitive,
    message: '结论页面、索引和日志已更新；原始会话未修改。'
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
  const candidates = new Set([...configured, project.overviewPath]);
  const pages = [];
  for (const relative of candidates) {
    if (typeof relative !== 'string' || !relative.startsWith(`${project.rootPath}/`) || !relative.endsWith('.md')) continue;
    const absolute = path.join(vaultPath, relative);
    if (!pathInside(vaultPath, absolute)) continue;
    try {
      const info = await fsp.lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKDOWN_BYTES) continue;
      const opened = await readBoundedRegularFile(absolute, MAX_MARKDOWN_BYTES);
      if (!opened) continue;
      const text = opened.bytes.toString('utf8');
      pages.push({ path: relative.replace(/\\/g, '/'), sha256: sha256Text(text), size: opened.size });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  pages.sort((left, right) => left.path.localeCompare(right.path));
  return pages;
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

const acquireProjectSyncLock = async (vaultPath, allowReclaim = true) => {
  const stagingDir = path.join(vaultPath, '_staging');
  await assertSafeDirectoryChain(vaultPath, stagingDir);
  await fsp.mkdir(stagingDir, { recursive: true });
  await assertSafeDirectoryChain(vaultPath, stagingDir);
  const lockPath = path.join(stagingDir, '.dsh-wiki-project-sync.lock');
  let handle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const info = await fsp.lstat(lockPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) {
      throw new WikiBasicError('unsafe-project-sync-lock', '项目同步锁不是安全的普通文件，已停止写入。');
    }
    let opened;
    try {
      opened = await readBoundedRegularFile(lockPath, 1024);
    } catch (readError) {
      if (allowReclaim && readError?.code === 'ENOENT') return acquireProjectSyncLock(vaultPath, false);
      throw readError;
    }
    let ownerPid = 0;
    try { ownerPid = Number(JSON.parse(opened?.bytes.toString('utf8') || '{}').pid) || 0; } catch {}
    let ownerActive = false;
    if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0);
        ownerActive = true;
      } catch (probeError) {
        ownerActive = probeError?.code !== 'ESRCH';
      }
    }
    const recent = Date.now() - info.mtimeMs < 5 * 60 * 1000;
    if (allowReclaim && !ownerActive && !recent) {
      await fsp.unlink(lockPath);
      return acquireProjectSyncLock(vaultPath, false);
    }
    throw new WikiBasicError('project-sync-busy', '另一个项目知识同步正在写入该知识库，请稍后重试。');
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, started: isoNow() })}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fsp.unlink(lockPath).catch(() => undefined);
    throw error;
  }
  return async () => {
    await handle.close();
    await fsp.unlink(lockPath);
  };
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
  const existingPages = await listCurrentProjectPages(vault, project, previous);
  const unchanged = Boolean(previous && previous.source_fingerprint === inventory.fingerprint);
  const mode = git?.status === 'ready' ? 'git' : 'inventory';
  const tokenPayload = {
    projectId: project.id,
    sourceCwd: normalizedPathKey(project.sourceCwd),
    sourceFingerprint: inventory.fingerprint,
    previousFingerprint: previous?.source_fingerprint || '',
    pages: existingPages.map(({ path: pagePath, sha256 }) => ({ path: pagePath, sha256 })),
    gitHead: git?.head || ''
  };
  return {
    ok: true,
    generatedAt: isoNow(clock),
    mode,
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
    previewToken: sha256Text(JSON.stringify(tokenPayload))
  };
};

const allowedProjectPagePath = (project, value) => {
  if (typeof value !== 'string' || value.length > 260 || value.includes('\\')) return '';
  const relative = value.replace(/^\/+/, '');
  const segments = relative.split('/');
  if (!relative.endsWith('.md')
    || relative.includes('..')
    || relative.includes('//')
    || /[\u0000-\u001f<>:"|?*]/u.test(relative)
    || segments.some((segment) => !segment || /[. ]$/u.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) return '';
  if (relative === project.overviewPath) return relative;
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
  if (preview.unchanged) throw new WikiBasicError('project-unchanged', '当前项目自上次同步后没有可识别的源文件变化。');
  if (!spec || spec.previewToken !== preview.previewToken) throw new WikiBasicError('stale-project-preview', '项目内容或知识库页面已变化，请重新检查增量。');
  if (!Array.isArray(spec.pages) || spec.pages.length === 0 || spec.pages.length > MAX_PROJECT_PAGES) {
    throw new WikiBasicError('invalid-project-pages', `每次项目同步必须包含 1 到 ${MAX_PROJECT_PAGES} 个页面。`);
  }
  if (!preview.existingPages.length && !spec.pages.some((page) => page?.path === preview.project.overviewPath)) {
    throw new WikiBasicError('overview-required', '首次同步必须创建项目总览页面。');
  }
  const sourcePaths = new Set(preview.sourceFiles.map((item) => item.path));
  const existingPages = new Map(preview.existingPages.map((item) => [item.path, item]));
  const seen = new Set();
  const writes = [];
  let totalChars = 0;
  for (const candidate of spec.pages) {
    const relative = allowedProjectPagePath(preview.project, candidate?.path);
    if (!relative || seen.has(relative)) throw new WikiBasicError('invalid-project-page-path', '项目页面必须位于当前项目的总览、concepts、skills 或 references 目录中。');
    seen.add(relative);
    const title = oneLine(candidate?.title, MAX_TITLE_CHARS);
    const summary = oneLine(candidate?.summary, 240);
    const content = normalizeText(candidate?.content, MAX_PROJECT_PAGE_CHARS);
    if (!title || !summary || !content || String(candidate?.content || '').length > MAX_PROJECT_PAGE_CHARS) {
      throw new WikiBasicError('invalid-project-page', '项目页面必须包含有效标题、摘要和受限正文。');
    }
    totalChars += content.length;
    if (totalChars > MAX_PROJECT_TOTAL_PAGE_CHARS) throw new WikiBasicError('project-pages-too-large', '本次项目同步页面总量超出限制。');
    const sources = Array.isArray(candidate?.sources)
      ? [...new Set(candidate.sources.filter((item) => typeof item === 'string' && sourcePaths.has(item)))].slice(0, 24)
      : [];
    if (!sources.length) throw new WikiBasicError('invalid-project-sources', '每个项目页面至少需要一个本次扫描到的源文件。');
    const existing = existingPages.get(relative);
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
  const originals = new Map();
  for (const write of plan.writes) {
    if (!write.exists) continue;
    const original = await fsp.readFile(write.absolute, 'utf8');
    originals.set(write.path, original);
    const backup = path.join(archiveRoot, write.path);
    await fsp.mkdir(path.dirname(backup), { recursive: true });
    await atomicWriteText(backup, original);
  }
  for (const [name, value] of [['.manifest.json', originalManifestText], ['index.md', originalIndex], ['log.md', originalLog], ['hot.md', originalHot]]) {
    await atomicWriteText(path.join(archiveRoot, name), value);
  }

  const project = plan.preview.project;
  const overview = plan.writes.find((item) => item.path === project.overviewPath);
  const summary = overview?.summary || oneLine(originalManifest.projects?.[project.id]?.summary || '项目知识增量同步', 240);
  const pageSet = new Set([
    ...plan.preview.existingPages.map((item) => item.path),
    ...plan.writes.map((item) => item.path)
  ]);
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
        summary,
        updated: timestamp
      }
    }
  };
  const nextManifestText = `${JSON.stringify(nextManifest, null, 2)}\n`;
  const nextIndex = updateProjectIndexText(originalIndex, project, summary, timestamp);
  const nextHot = updateProjectHotText(originalHot, project, timestamp, plan.writes.length);
  const nextLog = `${originalLog.trimEnd()}\n- [${timestamp}] WIKI_UPDATE project=${yamlString(project.id)} mode=${plan.preview.mode} added=${plan.preview.delta.added.length} modified=${plan.preview.delta.modified.length} removed=${plan.preview.delta.removed.length} pages=${plan.writes.length} archive=${yamlString(path.relative(vault, archiveRoot).replace(/\\/g, '/'))}\n`;
  try {
    for (const write of plan.writes) {
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await fsp.mkdir(path.dirname(write.absolute), { recursive: true });
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await atomicWriteText(write.absolute, write.text);
    }
    await afterPageWrites();
    await atomicWriteText(manifestPath, nextManifestText);
    await atomicWriteText(indexPath, nextIndex);
    await atomicWriteText(logPath, nextLog);
    await atomicWriteText(hotPath, nextHot);
    for (const write of plan.writes) {
      if (await fsp.readFile(write.absolute, 'utf8') !== write.text) throw new WikiBasicError('write-verification-failed', `项目页面 ${write.path} 写入后校验失败。`);
    }
    const [verifiedManifest, verifiedIndex, verifiedLog, verifiedHot] = await Promise.all([
      fsp.readFile(manifestPath, 'utf8'), fsp.readFile(indexPath, 'utf8'), fsp.readFile(logPath, 'utf8'), fsp.readFile(hotPath, 'utf8')
    ]);
    if (verifiedManifest !== nextManifestText || verifiedIndex !== nextIndex || verifiedLog !== nextLog || verifiedHot !== nextHot) {
      throw new WikiBasicError('write-verification-failed', '项目清单、索引、日志或热点页写入后校验失败。');
    }
  } catch (error) {
    for (const write of plan.writes) {
      if (originals.has(write.path)) await atomicWriteText(write.absolute, originals.get(write.path)).catch(() => undefined);
      else await fsp.unlink(write.absolute).catch(() => undefined);
    }
    await Promise.all([
      atomicWriteText(manifestPath, originalManifestText),
      atomicWriteText(indexPath, originalIndex),
      atomicWriteText(logPath, originalLog),
      atomicWriteText(hotPath, originalHot)
    ]).catch(() => undefined);
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
  const release = await acquireProjectSyncLock(vault);
  let result;
  let primaryError;
  try {
    result = await saveProjectSyncLocked(vault, workspacePath, spec, options);
  } catch (error) {
    primaryError = error;
  }
  let releaseError;
  try {
    await release();
  } catch (error) {
    releaseError = error;
  }
  if (primaryError && releaseError) throw new AggregateError([primaryError, releaseError], '项目同步失败，且同步锁清理未完成。');
  if (primaryError) throw primaryError;
  if (releaseError) throw releaseError;
  return result;
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
  const pages = [];
  for (const relative of new Set(configured)) {
    if (!historyPagePath(project, relative)) continue;
    const absolute = path.join(vaultPath, relative);
    if (!pathInside(vaultPath, absolute)) continue;
    try {
      const info = await fsp.lstat(absolute);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MARKDOWN_BYTES) continue;
      const opened = await readBoundedRegularFile(absolute, MAX_MARKDOWN_BYTES);
      if (!opened) continue;
      pages.push({ path: relative, sha256: sha256Text(opened.bytes), size: opened.size });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  pages.sort((left, right) => left.path.localeCompare(right.path));
  return pages;
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
  const existingPages = await listDshHistoryPages(vault, project, previous);
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
    pages: existingPages.map(({ path: pagePath, sha256 }) => ({ path: pagePath, sha256 }))
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
    unchanged: delta.added.length === 0 && delta.modified.length === 0,
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

const acquireHistoryIngestLock = async (vaultPath, allowReclaim = true) => {
  const stagingDir = path.join(vaultPath, '_staging');
  await assertSafeDirectoryChain(vaultPath, stagingDir);
  await fsp.mkdir(stagingDir, { recursive: true });
  await assertSafeDirectoryChain(vaultPath, stagingDir);
  const lockPath = path.join(stagingDir, '.dsh-wiki-history-ingest.lock');
  let handle;
  try {
    handle = await fsp.open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const info = await fsp.lstat(lockPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) throw new WikiBasicError('unsafe-history-lock', '历史导入锁不是安全的普通文件。');
    let opened;
    try {
      opened = await readBoundedRegularFile(lockPath, 1024);
    } catch (readError) {
      if (allowReclaim && readError?.code === 'ENOENT') return acquireHistoryIngestLock(vaultPath, false);
      throw readError;
    }
    let ownerPid = 0;
    try { ownerPid = Number(JSON.parse(opened?.bytes.toString('utf8') || '{}').pid) || 0; } catch {}
    let ownerActive = false;
    if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
      try {
        process.kill(ownerPid, 0);
        ownerActive = true;
      } catch (probeError) {
        ownerActive = probeError?.code !== 'ESRCH';
      }
    }
    const recent = Date.now() - info.mtimeMs < 5 * 60 * 1000;
    if (allowReclaim && !ownerActive && !recent) {
      await fsp.unlink(lockPath);
      return acquireHistoryIngestLock(vaultPath, false);
    }
    throw new WikiBasicError('history-ingest-busy', '另一个 DSH 历史导入正在写入该知识库，请稍后重试。');
  }
  try {
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, started: isoNow() })}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fsp.unlink(lockPath).catch(() => undefined);
    throw error;
  }
  return async () => {
    await handle.close();
    await fsp.unlink(lockPath);
  };
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
  await fsp.unlink(resolved);
  return { ok: true, cleared: true };
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
  const originals = new Map();
  for (const write of plan.writes) {
    if (!write.exists) continue;
    const original = await fsp.readFile(write.absolute, 'utf8');
    originals.set(write.path, original);
    const backup = path.join(archiveRoot, write.path);
    await fsp.mkdir(path.dirname(backup), { recursive: true });
    await atomicWriteText(backup, original);
  }
  for (const [name, value] of [['.manifest.json', originalManifestText], ['index.md', originalIndex], ['log.md', originalLog], ['hot.md', originalHot]]) {
    await atomicWriteText(path.join(archiveRoot, name), value);
  }

  const pageSet = new Set([...(previous?.pages_in_vault || []), ...plan.writes.map((write) => write.path)]);
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
  try {
    for (const write of plan.writes) {
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await fsp.mkdir(path.dirname(write.absolute), { recursive: true });
      await assertSafeDirectoryChain(vault, path.dirname(write.absolute));
      await atomicWriteText(write.absolute, write.text);
    }
    await afterPageWrites();
    await atomicWriteText(manifestPath, nextManifestText);
    await atomicWriteText(indexPath, nextIndex);
    await atomicWriteText(logPath, nextLog);
    await atomicWriteText(hotPath, nextHot);
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
    for (const write of plan.writes) {
      if (originals.has(write.path)) await atomicWriteText(write.absolute, originals.get(write.path)).catch(() => undefined);
      else await fsp.unlink(write.absolute).catch(() => undefined);
    }
    await Promise.all([
      atomicWriteText(manifestPath, originalManifestText), atomicWriteText(indexPath, originalIndex),
      atomicWriteText(logPath, originalLog), atomicWriteText(hotPath, originalHot)
    ]).catch(() => undefined);
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
  const release = await acquireHistoryIngestLock(vault);
  let result;
  let primaryError;
  try {
    result = await saveDshHistoryIngestLocked(vault, workspacePath, sourcePath, spec, options);
  } catch (error) {
    primaryError = error;
  }
  let releaseError;
  try {
    await release();
  } catch (error) {
    releaseError = error;
  }
  if (primaryError && releaseError) throw new AggregateError([primaryError, releaseError], 'DSH 历史导入失败，且写入锁清理未完成。');
  if (primaryError) throw primaryError;
  if (releaseError) throw releaseError;
  return result;
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
  initializeWikiVault,
  inspectProjectGit,
  inspectWikiVault,
  parseFrontmatter,
  previewDshHistoryIngest,
  queryWiki,
  readConfiguredVault,
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
