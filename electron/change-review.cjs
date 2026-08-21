const { execFile } = require('node:child_process');
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
  const entries = splitNull(output).map((entry) => ({
    code: entry.slice(0, 2),
    path: entry.slice(3)
  })).filter((entry) => entry.path);
  const untracked = entries.some((entry) => entry.code === '??');
  const staged = entries.some((entry) => entry.code !== '??' && entry.code[0] !== ' ');
  const unstaged = entries.some((entry) => entry.code !== '??' && entry.code[1] !== ' ');
  return { entries, untracked, staged, unstaged };
};

class GitChangeReviewer {
  constructor({ run = execFileAsync, trashItem } = {}) {
    this.run = run;
    this.trashItem = trashItem;
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
        reason: error?.code || 'git-status-failed'
      });
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
}

module.exports = {
  ChangeReviewError,
  GitChangeReviewer,
  classifyPorcelain,
  resolveReportedPath
};
