'use strict';

const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const WIKI_SCHEMA_VERSION = 1;
const MAX_QUERY_LENGTH = 300;
const MAX_RESULTS = 12;
const MAX_SCAN_FILES = 2000;
const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_CAPTURE_CHARS = 20000;
const MAX_TITLE_CHARS = 120;
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

const assertPlainDirectory = async (directory, { create = false } = {}) => {
  const resolved = normalizeAbsolutePath(directory, '知识库路径');
  if (create) await fsp.mkdir(resolved, { recursive: true });
  let info;
  try {
    info = await fsp.lstat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new WikiBasicError('vault-missing', '所选知识库目录不存在。');
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new WikiBasicError('unsafe-vault', '知识库必须是普通本地目录，不能是文件、符号链接或目录联接。');
  }
  return resolved;
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
  throw new WikiBasicError('unknown-command', 'Wiki 工具仅支持 status、query、preview 和 save。');
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
  MAX_MARKDOWN_BYTES,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  MAX_SCAN_FILES,
  WIKI_DIRECTORIES,
  WikiBasicError,
  WikiSettingsStore,
  buildCapturePreview,
  initializeWikiVault,
  inspectWikiVault,
  parseFrontmatter,
  queryWiki,
  readConfiguredVault,
  runCli,
  saveCapture,
  sensitiveFindings,
  slugify
};
