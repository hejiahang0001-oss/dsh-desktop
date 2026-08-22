const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

class ChangeReviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChangeReviewError';
    this.code = code;
  }
}

const splitNull = (value) => String(value || '').split('\0').filter(Boolean);
const toGitPath = (value) => value.split(path.sep).join('/');
const pathKey = (value) => process.platform === 'win32' ? value.toLowerCase() : value;

const parsePorcelainEntries = (output) => {
  const records = splitNull(output);
  const entries = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const code = record.slice(0, 2);
    const entryPath = record.slice(3);
    if (!entryPath) continue;
    let originalPath = '';
    if (code !== '??' && /[RC]/.test(code)) {
      originalPath = records[index + 1] || '';
      index += 1;
    }
    entries.push({ code, path: entryPath, originalPath });
  }
  return entries;
};

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const resolveReportedPath = (workspacePath, reportedPath) => {
  if (typeof reportedPath !== 'string' || reportedPath.length === 0 || reportedPath.length > 2048 || reportedPath.includes('\0')) {
    throw new ChangeReviewError('invalid-path', 'Harness 返回的文件路径无效。');
  }
  if (path.isAbsolute(reportedPath)) {
    throw new ChangeReviewError('invalid-path', '仅允许审查当前工作区内的相对路径。');
  }
  const absolutePath = path.resolve(workspacePath, reportedPath);
  if (!isInside(workspacePath, absolutePath) || absolutePath === path.resolve(workspacePath)) {
    throw new ChangeReviewError('outside-workspace', '文件路径超出当前工作区。');
  }
  return absolutePath;
};

const classifyPorcelain = (output) => {
  const entries = parsePorcelainEntries(output);
  const untracked = entries.some((entry) => entry.code === '??');
  const staged = entries.some((entry) => entry.code !== '??' && entry.code[0] !== ' ');
  const unstaged = entries.some((entry) => entry.code !== '??' && entry.code[1] !== ' ');
  return { entries, untracked, staged, unstaged };
};

const emptyChangeList = (reason = 'no-change') => Object.freeze({
  available: reason === 'no-change',
  reason,
  total: 0,
  pendingCount: 0,
  protectedCount: 0,
  acceptedCount: 0,
  canAcceptCount: 0,
  canRejectCount: 0,
  truncated: false,
  items: Object.freeze([])
});

const boundDiff = (content, { maxChars = 50000, truncated = false } = {}) => {
  const value = String(content || '').replaceAll('\r\n', '\n');
  const clipped = value.length > maxChars;
  return Object.freeze({
    content: clipped ? `${value.slice(0, maxChars)}\n… Diff 已截断，请在仓库工具中查看完整内容。` : value,
    truncated: Boolean(truncated || clipped)
  });
};

class GitChangeReviewer {
  constructor({ run = execFileAsync, trashItem, fsPromises = fsp } = {}) {
    this.run = run;
    this.trashItem = trashItem;
    this.fsPromises = fsPromises;
    this.workspacePath = '';
    this.repoRoot = '';
    this.available = false;
    this.reason = 'not-initialized';
    this.protectedPaths = new Set();
  }

  async executeGit(args, cwd = this.repoRoot) {
    const result = await this.run('git', ['-C', cwd, ...args], {
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024
    });
    return result?.stdout ?? '';
  }

  async activate(workspacePath) {
    this.workspacePath = path.resolve(workspacePath || '.');
    this.repoRoot = '';
    this.available = false;
    this.reason = 'not-a-git-repository';
    this.protectedPaths = new Set();
    try {
      const root = (await this.executeGit(['rev-parse', '--show-toplevel'], this.workspacePath)).trim();
      if (!root) throw new Error('Git did not return a repository root.');
      this.repoRoot = path.resolve(root);
      if (!isInside(this.repoRoot, this.workspacePath)) throw new Error('Workspace is outside the Git repository.');
      this.available = true;
      this.reason = 'ready';
      await this.captureBaseline();
    } catch (error) {
      this.repoRoot = '';
      this.available = false;
      this.reason = error?.code === 'ENOENT' ? 'git-unavailable' : 'not-a-git-repository';
    }
    return this.getAvailability();
  }

  getAvailability() {
    return Object.freeze({
      available: this.available,
      reason: this.reason,
      workspacePath: this.workspacePath,
      repoRoot: this.repoRoot,
      protectedCount: this.protectedPaths.size
    });
  }

  async captureBaseline() {
    if (!this.available) return this.getAvailability();
    const [unstaged, untracked] = await Promise.all([
      this.executeGit(['diff', '--name-only', '-z', '--']),
      this.executeGit(['ls-files', '--others', '--exclude-standard', '-z', '--'])
    ]);
    this.protectedPaths = new Set([...splitNull(unstaged), ...splitNull(untracked)].map(pathKey));
    return this.getAvailability();
  }

  resolveChangePath(reportedPath) {
    if (!this.available) {
      throw new ChangeReviewError(this.reason, this.reason === 'git-unavailable'
        ? '未检测到 Git，当前只能查看 Harness Diff。'
        : '当前工作区不是 Git 仓库，只能查看 Harness Diff。');
    }
    const absolutePath = resolveReportedPath(this.workspacePath, reportedPath);
    if (!isInside(this.repoRoot, absolutePath)) {
      throw new ChangeReviewError('outside-repository', '文件路径超出当前 Git 仓库。');
    }
    const repoPath = toGitPath(path.relative(this.repoRoot, absolutePath));
    return { absolutePath, repoPath };
  }

  async inspect(reportedPath) {
    let resolved;
    try {
      resolved = this.resolveChangePath(reportedPath);
    } catch (error) {
      return Object.freeze({
        status: 'unavailable',
        path: reportedPath || '',
        repoPath: '',
        canAccept: false,
        canReject: false,
        protected: false,
        untracked: false,
        staged: false,
        reason: error.code || 'unavailable'
      });
    }
    try {
      const output = await this.executeGit(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', resolved.repoPath]);
      const parsed = classifyPorcelain(output);
      const protectedPath = this.protectedPaths.has(pathKey(resolved.repoPath));
      const pending = parsed.untracked || parsed.unstaged;
      const status = pending
        ? protectedPath ? 'protected' : 'pending'
        : parsed.staged ? 'accepted' : 'clean';
      return Object.freeze({
        status,
        path: reportedPath,
        repoPath: resolved.repoPath,
        canAccept: pending,
        canReject: pending && !protectedPath,
        protected: protectedPath,
        untracked: parsed.untracked,
        staged: parsed.staged,
        reason: protectedPath && pending ? 'preexisting-unstaged-change' : status
      });
    } catch (error) {
      return Object.freeze({
        status: 'unavailable',
        path: reportedPath,
        repoPath: resolved.repoPath,
        canAccept: false,
        canReject: false,
        protected: false,
        untracked: false,
        staged: false,
        reason: error?.code || 'git-status-failed'
      });
    }
  }

  async getDiff(reportedPath, { maxChars = 50000, maxFileBytes = 256 * 1024 } = {}) {
    const state = await this.inspect(reportedPath);
    if (state.status === 'unavailable') {
      return Object.freeze({ ...state, available: false, binary: false, truncated: false, content: '' });
    }
    if (!['pending', 'protected', 'accepted'].includes(state.status)) {
      return Object.freeze({ ...state, available: false, binary: false, truncated: false, content: '', reason: 'no-diff' });
    }
    try {
      let content = '';
      let fileTruncated = false;
      let binary = false;
      if (state.untracked) {
        const resolved = this.resolveChangePath(reportedPath);
        const stats = await this.fsPromises.lstat(resolved.absolutePath);
        if (!stats.isFile()) {
          content = stats.isSymbolicLink()
            ? `Symbolic link preview disabled: ${state.repoPath}`
            : `Non-regular file preview disabled: ${state.repoPath}`;
        } else {
          const bytesToRead = Math.min(stats.size, maxFileBytes + 1);
          const handle = await this.fsPromises.open(resolved.absolutePath, 'r');
          let buffer;
          try {
            buffer = Buffer.alloc(bytesToRead);
            const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
            buffer = buffer.subarray(0, bytesRead);
          } finally {
            await handle.close();
          }
          binary = buffer.includes(0);
          if (binary) {
            content = `Binary file: ${state.repoPath}`;
          } else {
            const text = buffer.subarray(0, maxFileBytes).toString('utf8').replaceAll('\r\n', '\n');
            const lines = text.length === 0 ? [] : text.split('\n');
            const body = lines.map((line) => `+${line}`).join('\n');
            content = [
              `diff --git a/${state.repoPath} b/${state.repoPath}`,
              'new file',
              '--- /dev/null',
              `+++ b/${state.repoPath}`,
              `@@ -0,0 +1,${lines.length} @@`,
              body
            ].join('\n');
          }
          fileTruncated = stats.size > maxFileBytes;
        }
      } else {
        const args = state.status === 'accepted'
          ? ['diff', '--cached', '--no-ext-diff', '--unified=3', '--', state.repoPath]
          : ['diff', '--no-ext-diff', '--unified=3', '--', state.repoPath];
        content = await this.executeGit(args);
        binary = /(?:Binary files .* differ|GIT binary patch)/i.test(content);
      }
      const bounded = boundDiff(content, { maxChars, truncated: fileTruncated });
      return Object.freeze({
        ...state,
        available: bounded.content.length > 0,
        binary,
        truncated: bounded.truncated,
        content: bounded.content,
        reason: bounded.content.length > 0 ? 'ready' : 'no-diff'
      });
    } catch (error) {
      return Object.freeze({
        ...state,
        available: false,
        binary: false,
        truncated: false,
        content: '',
        reason: error?.code || 'diff-read-failed'
      });
    }
  }

  async listChanges({ limit = 30 } = {}) {
    if (!this.available) return emptyChangeList(this.reason);
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 30;
    try {
      const workspaceRepoPath = toGitPath(path.relative(this.repoRoot, this.workspacePath));
      const pathspec = workspaceRepoPath ? ['--', workspaceRepoPath] : ['--'];
      const output = await this.executeGit(['status', '--porcelain=v1', '-z', '--untracked-files=all', ...pathspec]);
      const allItems = parsePorcelainEntries(output)
        .map((entry) => {
          const absolutePath = path.resolve(this.repoRoot, entry.path);
          if (!isInside(this.workspacePath, absolutePath) || absolutePath === this.workspacePath) return null;
          const reportedPath = toGitPath(path.relative(this.workspacePath, absolutePath));
          const untracked = entry.code === '??';
          const staged = !untracked && entry.code[0] !== ' ';
          const unstaged = !untracked && entry.code[1] !== ' ';
          const protectedPath = this.protectedPaths.has(pathKey(entry.path))
            || (entry.originalPath && this.protectedPaths.has(pathKey(entry.originalPath)));
          const pending = untracked || unstaged;
          const status = pending
            ? protectedPath ? 'protected' : 'pending'
            : staged ? 'accepted' : 'clean';
          return Object.freeze({
            status,
            path: reportedPath,
            repoPath: entry.path,
            canAccept: pending,
            canReject: pending && !protectedPath,
            protected: protectedPath,
            untracked,
            staged,
            reason: protectedPath && pending ? 'preexisting-unstaged-change' : status
          });
        })
        .filter(Boolean)
        .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN'));
      const items = allItems.slice(0, safeLimit);
      return Object.freeze({
        available: true,
        reason: allItems.length > 0 ? 'ready' : 'no-change',
        total: allItems.length,
        pendingCount: allItems.filter((item) => item.status === 'pending').length,
        protectedCount: allItems.filter((item) => item.status === 'protected').length,
        acceptedCount: allItems.filter((item) => item.status === 'accepted').length,
        canAcceptCount: allItems.filter((item) => item.canAccept && !item.protected).length,
        canRejectCount: allItems.filter((item) => item.canReject).length,
        truncated: allItems.length > items.length,
        items: Object.freeze(items)
      });
    } catch (error) {
      return emptyChangeList(error?.code || 'git-status-failed');
    }
  }

  async accept(reportedPath) {
    const state = await this.inspect(reportedPath);
    if (!state.canAccept) return state;
    await this.executeGit(['add', '--', state.repoPath]);
    this.protectedPaths.delete(pathKey(state.repoPath));
    return this.inspect(reportedPath);
  }

  async reject(reportedPath) {
    const state = await this.inspect(reportedPath);
    if (state.protected) {
      throw new ChangeReviewError('preexisting-unstaged-change', '该文件在打开仓库时已有未暂存修改，已禁止一键拒绝。');
    }
    if (!state.canReject) return state;
    const resolved = this.resolveChangePath(reportedPath);
    if (state.untracked) {
      if (typeof this.trashItem !== 'function') throw new ChangeReviewError('trash-unavailable', '系统回收站不可用。');
      await this.trashItem(resolved.absolutePath);
    } else {
      await this.executeGit(['restore', '--worktree', '--', state.repoPath]);
    }
    return this.inspect(reportedPath);
  }

  async processMany(action, reportedPaths) {
    if (!['accept', 'reject'].includes(action)) {
      throw new ChangeReviewError('invalid-action', '不支持的批量变更操作。');
    }
    if (!Array.isArray(reportedPaths)) {
      throw new ChangeReviewError('invalid-paths', '批量变更路径无效。');
    }
    const paths = [...new Set(reportedPaths)].filter((value) => typeof value === 'string' && value.length > 0);
    if (paths.length > 100) throw new ChangeReviewError('too-many-paths', '单次最多处理 100 个文件。');
    const states = await Promise.all(paths.map((reportedPath) => this.inspect(reportedPath)));
    const protectedState = states.find((state) => state.protected);
    if (protectedState) {
      throw new ChangeReviewError(
        'preexisting-unstaged-change',
        `批量操作包含打开仓库前已有修改的文件：${protectedState.path}`
      );
    }
    const unavailableState = states.find((state) => state.status === 'unavailable');
    if (unavailableState) {
      throw new ChangeReviewError('batch-path-unavailable', `无法安全处理文件：${unavailableState.path}`);
    }
    const actionable = states.filter((state) => action === 'accept' ? state.canAccept : state.canReject);
    const results = [];
    for (const state of actionable) {
      results.push(action === 'accept' ? await this.accept(state.path) : await this.reject(state.path));
    }
    return Object.freeze({
      action,
      requested: paths.length,
      processed: results.length,
      items: Object.freeze(results)
    });
  }

  async acceptMany(reportedPaths) {
    return this.processMany('accept', reportedPaths);
  }

  async rejectMany(reportedPaths) {
    return this.processMany('reject', reportedPaths);
  }
}

module.exports = {
  ChangeReviewError,
  GitChangeReviewer,
  classifyPorcelain,
  emptyChangeList,
  parsePorcelainEntries,
  resolveReportedPath
};
