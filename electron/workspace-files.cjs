const fsp = require('node:fs/promises');
const path = require('node:path');
const { isRestrictedPath } = require('./sensitive-path-policy.cjs');

const MAX_RELATIVE_PATH_CHARS = 2048;
const MAX_SEARCH_QUERY_CHARS = 128;
const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_DIRECTORIES = 2000;
const MAX_SEARCH_ENTRIES = 20000;
const MAX_SEARCH_DEPTH = 16;
const MAX_SEARCH_MS = 1500;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);

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

const kindForDirent = (entry) => {
  if (entry.isSymbolicLink()) return 'link';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  return 'other';
};

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

  async describeFile(relativePath) {
    const resolved = this._resolve(relativePath);
    if (isRestrictedWorkspaceFile(resolved.relativePath)) {
      throw new WorkspaceFilesError('restricted', '疑似凭据或私钥文件不从桌面搜索入口打开。');
    }
    await this._assertNoLinkTraversal(resolved);
    if (!(await fsp.lstat(resolved.absolutePath)).isFile()) {
      throw new WorkspaceFilesError('not-file', '请选择普通文件。');
    }
    return Object.freeze({ path: resolved.relativePath });
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
  MAX_SEARCH_RESULTS,
  WorkspaceFiles,
  WorkspaceFilesError,
  isRestrictedWorkspaceFile,
  normalizeRelativePath
};
