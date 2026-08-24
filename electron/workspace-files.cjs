const fsp = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');
const { isRestrictedPath } = require('./sensitive-path-policy.cjs');

const MAX_RELATIVE_PATH_CHARS = 2048;
const MAX_DIRECTORY_ENTRIES = 500;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 24 * 1024 * 1024;
const MAX_PDF_PREVIEW_BYTES = 40 * 1024 * 1024;
const MAX_SEARCH_QUERY_CHARS = 128;
const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_DIRECTORIES = 2000;
const MAX_SEARCH_ENTRIES = 20000;
const MAX_SEARCH_DEPTH = 16;
const MAX_SEARCH_MS = 1500;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);
const BINARY_EXTENSIONS = new Set([
  '.7z', '.avi', '.bmp', '.class', '.dll', '.doc', '.docx', '.eot', '.exe', '.gif', '.gz',
  '.ico', '.jar', '.jpeg', '.jpg', '.mov', '.mp3', '.mp4', '.otf', '.pdf', '.png', '.ppt',
  '.pptx', '.pyc', '.rar', '.so', '.tar', '.ttf', '.wav', '.webm', '.webp', '.woff', '.woff2',
  '.xls', '.xlsx', '.zip'
]);
const MEDIA_PREVIEW_TYPES = Object.freeze({
  '.gif': Object.freeze({ kind: 'image', mimeType: 'image/gif', signature: (buffer) => ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii')) }),
  '.jpeg': Object.freeze({ kind: 'image', mimeType: 'image/jpeg', signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }),
  '.jpg': Object.freeze({ kind: 'image', mimeType: 'image/jpeg', signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }),
  '.pdf': Object.freeze({ kind: 'pdf', mimeType: 'application/pdf', signature: (buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-' }),
  '.png': Object.freeze({ kind: 'image', mimeType: 'image/png', signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }),
  '.webp': Object.freeze({ kind: 'image', mimeType: 'image/webp', signature: (buffer) => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' })
});
const detectMediaPreviewType = (buffer) => Object.values(MEDIA_PREVIEW_TYPES)
  .find((candidate, index, all) => all.findIndex((item) => item.mimeType === candidate.mimeType) === index && candidate.signature(buffer));

class WorkspaceFilesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkspaceFilesError';
    this.code = code;
  }
}

const normalizeRelativePath = (value, { allowEmpty = false } = {}) => {
  if (typeof value !== 'string') {
    throw new WorkspaceFilesError('path-invalid', '文件路径必须是文本。');
  }
  if (value.length > MAX_RELATIVE_PATH_CHARS || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new WorkspaceFilesError('path-invalid', '文件路径包含不允许的字符或长度超出限制。');
  }
  const candidate = value.replaceAll('\\', '/');
  if (!candidate) {
    if (allowEmpty) return '';
    throw new WorkspaceFilesError('path-empty', '请选择工作区中的文件。');
  }
  if (path.posix.isAbsolute(candidate) || path.win32.isAbsolute(value)) {
    throw new WorkspaceFilesError('path-absolute', '只接受当前工作区内的相对路径。');
  }
  const segments = candidate.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new WorkspaceFilesError('path-traversal', '文件路径不能包含空段、点段或父目录跳转。');
  }
  return segments.join('/');
};

const isInside = (rootPath, targetPath) => {
  const relative = path.relative(rootPath, targetPath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

const isRestrictedWorkspaceFile = (relativePath) => isRestrictedPath(relativePath);

const languageForPath = (relativePath) => ({
  '.c': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cjs': 'JavaScript',
  '.css': 'CSS',
  '.csv': 'CSV',
  '.go': 'Go',
  '.h': 'C/C++ Header',
  '.html': 'HTML',
  '.java': 'Java',
  '.js': 'JavaScript',
  '.json': 'JSON',
  '.jsx': 'JavaScript JSX',
  '.kt': 'Kotlin',
  '.md': 'Markdown',
  '.mjs': 'JavaScript',
  '.ps1': 'PowerShell',
  '.py': 'Python',
  '.rs': 'Rust',
  '.scss': 'SCSS',
  '.sh': 'Shell',
  '.sql': 'SQL',
  '.toml': 'TOML',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript JSX',
  '.txt': 'Text',
  '.xml': 'XML',
  '.yaml': 'YAML',
  '.yml': 'YAML'
}[path.posix.extname(relativePath).toLowerCase()] || 'Text');

const kindForDirent = (entry) => {
  if (entry.isSymbolicLink()) return 'link';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  return 'other';
};

const sortEntries = (entries) => entries.sort((left, right) => {
  const leftRank = left.kind === 'directory' ? 0 : left.kind === 'file' ? 1 : 2;
  const rightRank = right.kind === 'directory' ? 0 : right.kind === 'file' ? 1 : 2;
  return leftRank - rightRank || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
});

class WorkspaceFiles {
  constructor({ workspacePath } = {}) {
    this.workspacePath = '';
    this.workspaceRealPath = '';
    if (workspacePath) this.workspacePath = path.resolve(workspacePath);
  }

  async activate(workspacePath = this.workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new WorkspaceFilesError('workspace-invalid', '文件面板工作区必须是绝对目录。');
    }
    const resolved = path.resolve(workspacePath);
    const state = await fsp.stat(resolved);
    if (!state.isDirectory()) throw new WorkspaceFilesError('workspace-invalid', '文件面板工作区不是目录。');
    this.workspacePath = resolved;
    this.workspaceRealPath = await fsp.realpath(resolved);
    return this.getState();
  }

  getState() {
    return { workspacePath: this.workspacePath };
  }

  _resolve(relativePath, { allowRoot = false } = {}) {
    if (!this.workspaceRealPath) throw new WorkspaceFilesError('workspace-unavailable', '文件面板尚未绑定工作区。');
    const normalized = normalizeRelativePath(relativePath, { allowEmpty: allowRoot });
    if (!normalized) return { relativePath: '', absolutePath: this.workspaceRealPath };
    const absolutePath = path.resolve(this.workspaceRealPath, ...normalized.split('/'));
    if (!isInside(this.workspaceRealPath, absolutePath)) {
      throw new WorkspaceFilesError('outside-workspace', '文件路径超出当前工作区。');
    }
    return { relativePath: normalized, absolutePath };
  }

  async _assertNoLinkTraversal(resolved) {
    let current = this.workspaceRealPath;
    for (const segment of resolved.relativePath.split('/').filter(Boolean)) {
      current = path.join(current, segment);
      const state = await fsp.lstat(current);
      if (state.isSymbolicLink()) {
        throw new WorkspaceFilesError('link', '符号链接或目录联接不在文件面板中跟随读取。');
      }
    }
    const realPath = await fsp.realpath(resolved.absolutePath);
    if (realPath !== this.workspaceRealPath && !isInside(this.workspaceRealPath, realPath)) {
      throw new WorkspaceFilesError('outside-workspace', '解析后的文件路径超出当前工作区。');
    }
  }

  async listDirectory(relativePath = '', { maxEntries = MAX_DIRECTORY_ENTRIES } = {}) {
    const resolved = this._resolve(relativePath, { allowRoot: true });
    if (resolved.relativePath && isRestrictedWorkspaceFile(resolved.relativePath)) {
      return Object.freeze({
        available: false,
        reason: 'restricted',
        path: resolved.relativePath,
        entries: Object.freeze([]),
        truncated: false,
        message: '疑似凭据或私钥目录默认不在桌面面板中浏览。'
      });
    }
    await this._assertNoLinkTraversal(resolved);
    const state = await fsp.lstat(resolved.absolutePath);
    if (state.isSymbolicLink() || !state.isDirectory()) {
      throw new WorkspaceFilesError('not-directory', '所选路径不是可浏览目录。');
    }
    const limit = Math.min(MAX_DIRECTORY_ENTRIES, Math.max(1, Math.round(maxEntries)));
    const entries = [];
    let truncated = false;
    const directory = await fsp.opendir(resolved.absolutePath);
    for await (const entry of directory) {
      const kind = kindForDirent(entry);
      if (kind === 'directory' && IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (/[\u0000-\u001f\u007f]/.test(entry.name)) continue;
      if (entries.length >= limit) {
        truncated = true;
        break;
      }
      const entryPath = resolved.relativePath ? `${resolved.relativePath}/${entry.name}` : entry.name;
      entries.push(Object.freeze({
        name: entry.name,
        path: entryPath,
        kind,
        restricted: isRestrictedWorkspaceFile(entryPath)
      }));
    }
    sortEntries(entries);
    return Object.freeze({
      available: true,
      path: resolved.relativePath,
      entries: Object.freeze(entries),
      truncated
    });
  }

  async readFile(relativePath, { maxBytes = MAX_FILE_BYTES } = {}) {
    const resolved = this._resolve(relativePath);
    if (isRestrictedWorkspaceFile(resolved.relativePath)) {
      return Object.freeze({
        available: false,
        reason: 'restricted',
        path: resolved.relativePath,
        message: '疑似凭据或私钥文件默认不在桌面面板中显示。'
      });
    }
    try {
      await this._assertNoLinkTraversal(resolved);
    } catch (error) {
      if (error instanceof WorkspaceFilesError && error.code === 'link') {
        return Object.freeze({ available: false, reason: 'link', path: resolved.relativePath, message: error.message });
      }
      throw error;
    }
    const state = await fsp.lstat(resolved.absolutePath);
    if (state.isSymbolicLink()) {
      return Object.freeze({ available: false, reason: 'link', path: resolved.relativePath, message: '符号链接文件不在面板中跟随读取。' });
    }
    if (!state.isFile()) {
      return Object.freeze({ available: false, reason: 'not-file', path: resolved.relativePath, message: '所选路径不是普通文件。' });
    }
    const limit = Math.min(MAX_FILE_BYTES, Math.max(1, Math.round(maxBytes)));
    if (state.size > limit) {
      return Object.freeze({
        available: false,
        reason: 'too-large',
        path: resolved.relativePath,
        size: state.size,
        maxBytes: limit,
        message: `文件超过 ${limit} 字节的只读预览上限。`
      });
    }
    if (BINARY_EXTENSIONS.has(path.extname(resolved.absolutePath).toLowerCase())) {
      return Object.freeze({ available: false, reason: 'binary', path: resolved.relativePath, size: state.size, message: '二进制文件暂不提供文本预览。' });
    }
    const buffer = await fsp.readFile(resolved.absolutePath);
    if (buffer.length > limit) {
      return Object.freeze({ available: false, reason: 'too-large', path: resolved.relativePath, size: buffer.length, maxBytes: limit, message: `文件超过 ${limit} 字节的只读预览上限。` });
    }
    if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
      return Object.freeze({ available: false, reason: 'binary', path: resolved.relativePath, size: buffer.length, message: '检测到二进制内容，暂不提供文本预览。' });
    }
    let content;
    let encoding = 'UTF-8';
    try {
      if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        content = new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
        encoding = 'UTF-16 LE';
      } else {
        const start = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
        content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(start));
      }
    } catch {
      return Object.freeze({ available: false, reason: 'encoding', path: resolved.relativePath, size: buffer.length, message: '当前只读预览支持 UTF-8 和 UTF-16 LE 文本。' });
    }
    return Object.freeze({
      available: true,
      path: resolved.relativePath,
      size: buffer.length,
      encoding,
      language: languageForPath(resolved.relativePath),
      lineCount: content ? content.split('\n').length : 0,
      content
    });
  }

  async readPreviewFile(relativePath) {
    const resolved = this._resolve(relativePath);
    if (isRestrictedWorkspaceFile(resolved.relativePath)) {
      return Object.freeze({ available: false, reason: 'restricted', path: resolved.relativePath, message: '疑似凭据或私钥文件默认不在桌面面板中显示。' });
    }
    const declaredType = MEDIA_PREVIEW_TYPES[path.extname(resolved.absolutePath).toLowerCase()];
    if (!declaredType) {
      return Object.freeze({ available: false, reason: 'unsupported', path: resolved.relativePath, message: '专用预览支持 PNG、JPEG、WebP、GIF 和 PDF。' });
    }
    try {
      await this._assertNoLinkTraversal(resolved);
    } catch (error) {
      if (error instanceof WorkspaceFilesError && error.code === 'link') {
        return Object.freeze({ available: false, reason: 'link', path: resolved.relativePath, message: error.message });
      }
      throw error;
    }
    const state = await fsp.lstat(resolved.absolutePath);
    if (state.isSymbolicLink() || !state.isFile()) {
      return Object.freeze({ available: false, reason: 'not-file', path: resolved.relativePath, message: '所选路径不是可预览的普通文件。' });
    }
    const maxBytes = declaredType.kind === 'pdf' ? MAX_PDF_PREVIEW_BYTES : MAX_IMAGE_PREVIEW_BYTES;
    if (state.size > maxBytes) {
      return Object.freeze({
        available: false,
        reason: 'too-large',
        path: resolved.relativePath,
        size: state.size,
        maxBytes,
        message: `${declaredType.kind === 'pdf' ? 'PDF' : '图片'}超过 ${Math.round(maxBytes / (1024 * 1024))} MB 的专用预览上限。`
      });
    }
    const buffer = await fsp.readFile(resolved.absolutePath);
    const detectedType = detectMediaPreviewType(buffer);
    if (!detectedType || detectedType.kind !== declaredType.kind) {
      return Object.freeze({ available: false, reason: 'invalid-media', path: resolved.relativePath, size: buffer.length, message: '文件内容与扩展名不一致，已阻止加载。' });
    }
    return Object.freeze({
      available: true,
      path: resolved.relativePath,
      size: buffer.length,
      kind: detectedType.kind,
      mimeType: detectedType.mimeType,
      extensionMismatch: detectedType.mimeType !== declaredType.mimeType,
      base64: buffer.toString('base64')
    });
  }

  async search(query, {
    maxResults = MAX_SEARCH_RESULTS,
    maxDirectories = MAX_SEARCH_DIRECTORIES,
    maxEntries = MAX_SEARCH_ENTRIES,
    maxDepth = MAX_SEARCH_DEPTH,
    maxMs = MAX_SEARCH_MS
  } = {}) {
    if (typeof query !== 'string') throw new WorkspaceFilesError('query-invalid', '搜索词必须是文本。');
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > MAX_SEARCH_QUERY_CHARS || /[\u0000-\u001f\u007f]/.test(normalizedQuery)) {
      throw new WorkspaceFilesError('query-invalid', `搜索词应为 1–${MAX_SEARCH_QUERY_CHARS} 个普通字符。`);
    }
    if (!this.workspaceRealPath) throw new WorkspaceFilesError('workspace-unavailable', '文件面板尚未绑定工作区。');
    const resultLimit = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.round(maxResults)));
    const directoryLimit = Math.min(MAX_SEARCH_DIRECTORIES, Math.max(1, Math.round(maxDirectories)));
    const entryLimit = Math.min(MAX_SEARCH_ENTRIES, Math.max(1, Math.round(maxEntries)));
    const depthLimit = Math.min(MAX_SEARCH_DEPTH, Math.max(0, Math.round(maxDepth)));
    const deadline = Date.now() + Math.min(MAX_SEARCH_MS, Math.max(50, Math.round(maxMs)));
    const needle = normalizedQuery.toLocaleLowerCase();
    const queue = [{ absolutePath: this.workspaceRealPath, relativePath: '', depth: 0 }];
    const results = [];
    let directoriesVisited = 0;
    let entriesVisited = 0;
    let truncated = false;

    while (queue.length && results.length < resultLimit) {
      if (directoriesVisited >= directoryLimit || entriesVisited >= entryLimit || Date.now() >= deadline) {
        truncated = true;
        break;
      }
      const current = queue.shift();
      directoriesVisited += 1;
      let directory;
      try {
        directory = await fsp.opendir(current.absolutePath);
      } catch {
        continue;
      }
      for await (const entry of directory) {
        entriesVisited += 1;
        if (entriesVisited >= entryLimit || Date.now() >= deadline) {
          truncated = true;
          break;
        }
        const kind = kindForDirent(entry);
        if (kind === 'link' || kind === 'other') continue;
        if (kind === 'directory' && IGNORED_DIRECTORIES.has(entry.name)) continue;
        const relativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name;
        if (kind === 'directory') {
          if (!isRestrictedWorkspaceFile(relativePath) && current.depth < depthLimit) {
            queue.push({
              absolutePath: path.join(current.absolutePath, entry.name),
              relativePath,
              depth: current.depth + 1
            });
          }
          continue;
        }
        if (relativePath.toLocaleLowerCase().includes(needle)) {
          results.push(Object.freeze({
            name: entry.name,
            path: relativePath,
            kind: 'file',
            restricted: isRestrictedWorkspaceFile(relativePath)
          }));
          if (results.length >= resultLimit) {
            truncated = queue.length > 0;
            break;
          }
        }
      }
    }
    results.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' }));
    return Object.freeze({
      available: true,
      query: normalizedQuery,
      results: Object.freeze(results),
      truncated,
      directoriesVisited,
      entriesVisited
    });
  }
}

module.exports = {
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_BYTES,
  MAX_IMAGE_PREVIEW_BYTES,
  MAX_PDF_PREVIEW_BYTES,
  MAX_SEARCH_RESULTS,
  WorkspaceFiles,
  WorkspaceFilesError,
  isRestrictedWorkspaceFile,
  languageForPath,
  normalizeRelativePath
};
