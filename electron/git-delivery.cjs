'use strict';

const { createHash } = require('node:crypto');
const path = require('node:path');

const { runGitCommand } = require('./worktree-manager.cjs');

const MAX_COMMIT_MESSAGE = 200;
const MAX_REMOTE_BYTES = 512 * 1024;
const MAX_PULL_REQUESTS = 5;
const MAX_CHECKS = 24;

class GitDeliveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitDeliveryError';
    this.code = code;
  }
}

const oneLine = (value, limit = 160) => String(value || '')
  .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim()
  .slice(0, limit);

const exactPathLine = (value) => {
  const normalized = String(value || '').replace(/[\r\n]+$/gu, '');
  if (!normalized || /[\u0000\r\n]/u.test(normalized)) return '';
  return normalized.slice(0, 1024);
};

const normalizeCommitMessage = (value) => {
  if (typeof value !== 'string' || value.length > MAX_COMMIT_MESSAGE || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new GitDeliveryError('invalid-message', `提交说明必须是 1–${MAX_COMMIT_MESSAGE} 个可见字符的单行文本。`);
  }
  const normalized = value.trim();
  if (!normalized) throw new GitDeliveryError('invalid-message', '请输入提交说明。');
  return normalized;
};

const parseStatus = (value) => {
  const records = String(value || '').split('\0').filter(Boolean);
  const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  let changed = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!/^[ MARCUD?!]{2} /u.test(record)) continue;
    const code = record.slice(0, 2);
    changed += 1;
    if (code === '??') untracked += 1;
    else {
      if (code[0] !== ' ') staged += 1;
      if (code[1] !== ' ') unstaged += 1;
      if (conflicts.has(code)) conflicted += 1;
    }
    if (/[RC]/u.test(code)) index += 1;
  }
  return Object.freeze({ changed, staged, unstaged, untracked, conflicted, clean: changed === 0 });
};

const parseRecentCommits = (value) => Object.freeze(String(value || '').split('\x1e')
  .map((record) => record.trim())
  .filter(Boolean)
  .slice(0, 8)
  .map((record) => {
    const [hash = '', shortHash = '', subject = '', author = '', authoredAt = ''] = record.split('\x1f');
    return Object.freeze({
      hash: /^[0-9a-f]{40,64}$/iu.test(hash) ? hash : '',
      shortHash: /^[0-9a-f]{7,16}$/iu.test(shortHash) ? shortHash : '',
      subject: oneLine(subject, 180),
      author: oneLine(author, 80),
      authoredAt: Number.isNaN(Date.parse(authoredAt)) ? '' : new Date(authoredAt).toISOString()
    });
  })
  .filter((item) => item.hash && item.shortHash));

const parseGitHubRemote = (value) => {
  const remote = oneLine(value, 500);
  let owner = '';
  let repository = '';
  let match = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(remote);
  if (match) [, owner, repository] = match;
  if (!owner) {
    try {
      const url = new URL(remote);
      if (url.hostname.toLocaleLowerCase('en-US') !== 'github.com' || url.password || (url.username && url.username !== 'git')) return null;
      const segments = url.pathname.replace(/^\/+|\/+$/gu, '').split('/');
      if (segments.length !== 2) return null;
      [owner, repository] = segments;
      repository = repository.replace(/\.git$/u, '');
    } catch { return null; }
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/u.test(repository)) return null;
  return Object.freeze({ owner, repository, webUrl: `https://github.com/${owner}/${repository}` });
};

const checkSummary = (checkRuns = [], statuses = []) => {
  const items = [];
  const counts = { passed: 0, pending: 0, failed: 0, neutral: 0 };
  const add = (name, state, detailsUrl = '') => {
    if (items.length >= MAX_CHECKS) return;
    counts[state] += 1;
    items.push(Object.freeze({ name: oneLine(name, 120) || '未命名检查', state, detailsUrl }));
  };
  for (const check of checkRuns.slice(0, MAX_CHECKS)) {
    const status = String(check?.status || '');
    const conclusion = String(check?.conclusion || '');
    const state = status !== 'completed' ? 'pending'
      : ['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(conclusion) ? 'failed'
        : ['success'].includes(conclusion) ? 'passed' : 'neutral';
    add(check?.name, state, check?.details_url);
  }
  for (const status of statuses.slice(0, Math.max(0, MAX_CHECKS - items.length))) {
    const raw = String(status?.state || 'pending');
    const state = ['error', 'failure'].includes(raw) ? 'failed' : raw === 'success' ? 'passed' : 'pending';
    add(status?.context, state, status?.target_url);
  }
  return Object.freeze({ counts: Object.freeze(counts), items: Object.freeze(items) });
};

const fetchBoundedJson = async (fetchFn, url, signal) => {
  const response = await fetchFn(url, {
    method: 'GET',
    redirect: 'error',
    signal,
    headers: Object.freeze({ Accept: 'application/vnd.github+json', 'User-Agent': 'DSH-Desktop' })
  });
  const length = Number(response.headers?.get?.('content-length') || 0);
  if (length > MAX_REMOTE_BYTES) throw new GitDeliveryError('remote-too-large', 'GitHub 返回内容超过显示上限。');
  const text = await response.text();
  if (text.length > MAX_REMOTE_BYTES) throw new GitDeliveryError('remote-too-large', 'GitHub 返回内容超过显示上限。');
  if (!response.ok) throw new GitDeliveryError(`github-${response.status}`, `GitHub PR 状态不可用（HTTP ${response.status}）。`);
  try { return JSON.parse(text); } catch { throw new GitDeliveryError('remote-invalid', 'GitHub 返回了无效状态。'); }
};

class GitDeliveryManager {
  constructor({ gitPath = 'git', runGit = runGitCommand, fetchFn = globalThis.fetch, baseEnv = process.env } = {}) {
    this.gitPath = gitPath;
    this.runGit = runGit;
    this.fetchFn = fetchFn;
    this.baseEnv = baseEnv;
    this.workspacePath = '';
    this.repoRoot = '';
    this.links = new Map();
  }

  activate(workspacePath) {
    this.workspacePath = path.resolve(workspacePath || '.');
    this.repoRoot = '';
    this.links.clear();
  }

  async _git(args, cwd = this.repoRoot || this.workspacePath) {
    try { return await this.runGit(this.gitPath, cwd, args, { baseEnv: this.baseEnv }); }
    catch (error) {
      if (error?.code === 'git-unavailable') throw new GitDeliveryError('git-unavailable', '系统中未找到 Git；聊天、Office 和 Wiki 功能仍可使用。');
      throw new GitDeliveryError('git-failed', oneLine(error?.message, 300) || 'Git 交付状态读取失败。');
    }
  }

  async _optionalGit(args) {
    try { return await this._git(args); } catch (error) { if (error?.code === 'git-unavailable') throw error; return ''; }
  }

  _cacheLink(url, kind) {
    const id = createHash('sha256').update(`${kind}\0${url}`).digest('hex').slice(0, 24);
    this.links.set(id, url);
    return id;
  }

  async _remoteState(github, branch) {
    if (!github) return Object.freeze({ available: false, status: 'not-github', message: 'origin 不是受支持的 GitHub 地址。', pullRequests: Object.freeze([]), canCreate: false });
    if (!branch) return Object.freeze({ available: false, status: 'detached', message: 'detached HEAD 不能关联分支 PR。', pullRequests: Object.freeze([]), canCreate: false });
    if (typeof this.fetchFn !== 'function') return Object.freeze({ available: false, status: 'offline', message: '当前运行时不能读取 GitHub 公共 PR 状态。', pullRequests: Object.freeze([]), canCreate: true, createLinkId: this._cacheLink(`${github.webUrl}/compare/${encodeURIComponent(branch)}?expand=1`, 'create') });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const baseApi = `https://api.github.com/repos/${github.owner}/${github.repository}`;
      const pulls = await fetchBoundedJson(this.fetchFn, `${baseApi}/pulls?state=all&head=${encodeURIComponent(`${github.owner}:${branch}`)}&per_page=${MAX_PULL_REQUESTS}`, controller.signal);
      if (!Array.isArray(pulls)) throw new GitDeliveryError('remote-invalid', 'GitHub PR 列表格式无效。');
      const pullRequests = [];
      for (const pull of pulls.slice(0, MAX_PULL_REQUESTS)) {
        const number = Number(pull?.number);
        const headSha = String(pull?.head?.sha || '');
        if (!Number.isInteger(number) || number < 1 || number > 1_000_000_000 || !/^[0-9a-f]{40}$/iu.test(headSha)) continue;
        let checks = checkSummary();
        try {
          const [runs, status] = await Promise.all([
            fetchBoundedJson(this.fetchFn, `${baseApi}/commits/${headSha}/check-runs?per_page=${MAX_CHECKS}`, controller.signal),
            fetchBoundedJson(this.fetchFn, `${baseApi}/commits/${headSha}/status`, controller.signal)
          ]);
          const githubPath = `/${github.owner}/${github.repository}/`;
          const safeDetails = (url) => {
            try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'github.com' && parsed.pathname.startsWith(githubPath) ? parsed.href : ''; } catch { return ''; }
          };
          checks = checkSummary(Array.isArray(runs?.check_runs) ? runs.check_runs : [], Array.isArray(status?.statuses) ? status.statuses : []);
          checks = Object.freeze({
            counts: checks.counts,
            items: Object.freeze(checks.items.map((item) => Object.freeze({
              name: item.name,
              state: item.state,
              linkId: safeDetails(item.detailsUrl) ? this._cacheLink(safeDetails(item.detailsUrl), 'check') : ''
            })))
          });
        } catch { /* PR remains visible when checks are unavailable. */ }
        pullRequests.push(Object.freeze({
          id: this._cacheLink(`${github.webUrl}/pull/${number}`, 'pull'),
          number,
          title: oneLine(pull?.title, 180) || `PR #${number}`,
          state: ['open', 'closed'].includes(pull?.state) ? pull.state : 'unknown',
          draft: pull?.draft === true,
          updatedAt: Number.isNaN(Date.parse(pull?.updated_at)) ? '' : new Date(pull.updated_at).toISOString(),
          checks
        }));
      }
      return Object.freeze({
        available: true,
        status: 'ready',
        message: pullRequests.length ? `找到 ${pullRequests.length} 个当前分支 PR。` : '当前分支没有 PR，可在 GitHub 打开新建页面。',
        pullRequests: Object.freeze(pullRequests),
        canCreate: true,
        createLinkId: this._cacheLink(`${github.webUrl}/compare/${encodeURIComponent(branch)}?expand=1`, 'create')
      });
    } catch (error) {
      const message = error?.name === 'AbortError' ? 'GitHub PR 状态读取超时。' : (error?.message || 'GitHub PR 状态不可用。');
      return Object.freeze({ available: false, status: 'unavailable', message: oneLine(message, 200), pullRequests: Object.freeze([]), canCreate: true, createLinkId: this._cacheLink(`${github.webUrl}/compare/${encodeURIComponent(branch)}?expand=1`, 'create') });
    } finally { clearTimeout(timer); }
  }

  async inspect({ includeRemote = true } = {}) {
    this.links.clear();
    let root;
    try { root = exactPathLine(await this._git(['rev-parse', '--show-toplevel'], this.workspacePath)); }
    catch (error) {
      return Object.freeze({ available: false, reason: error?.code || 'not-a-git-repository', message: error?.message || '当前工作区不是 Git 仓库。', repository: Object.freeze({ root: this.workspacePath, branch: '', head: '', headShort: '' }), status: parseStatus(''), recentCommits: Object.freeze([]), remote: Object.freeze({ available: false, status: 'unavailable', message: 'Git 仓库不可用。', pullRequests: Object.freeze([]), canCreate: false }) });
    }
    if (!path.isAbsolute(root)) return Object.freeze({ available: false, reason: 'invalid-root', message: 'Git 返回的仓库路径无效。', repository: Object.freeze({ root: this.workspacePath, branch: '', head: '', headShort: '' }), status: parseStatus(''), recentCommits: Object.freeze([]), remote: Object.freeze({ available: false, status: 'unavailable', message: 'Git 仓库不可用。', pullRequests: Object.freeze([]), canCreate: false }) });
    this.repoRoot = path.resolve(root);
    const [branchRaw, headRaw, statusRaw, stagedRaw, logRaw, remoteRaw] = await Promise.all([
      this._git(['branch', '--show-current']),
      this._git(['rev-parse', 'HEAD']),
      this._git(['status', '--porcelain=v1', '-z']),
      this._git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z']),
      this._git(['log', '-n', '8', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e']),
      this._optionalGit(['remote', 'get-url', 'origin'])
    ]);
    const branch = oneLine(branchRaw, 240);
    const head = oneLine(headRaw, 64);
    const status = parseStatus(statusRaw);
    const upstream = branch ? oneLine(await this._optionalGit(['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`]), 240) : '';
    let ahead = 0;
    let behind = 0;
    if (upstream) {
      const counts = oneLine(await this._optionalGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]), 80).split(/\s+/u).map(Number);
      if (counts.length === 2 && counts.every(Number.isInteger)) [ahead, behind] = counts;
    }
    const github = parseGitHubRemote(remoteRaw);
    const remote = includeRemote ? await this._remoteState(github, branch) : Object.freeze({
      available: Boolean(github), status: github ? 'not-refreshed' : 'not-github', message: github ? '点击刷新读取 GitHub 公共 PR 状态。' : 'origin 不是受支持的 GitHub 地址。', pullRequests: Object.freeze([]), canCreate: Boolean(github), ...(github && branch ? { createLinkId: this._cacheLink(`${github.webUrl}/compare/${encodeURIComponent(branch)}?expand=1`, 'create') } : {})
    });
    const fingerprint = createHash('sha256').update(`${head}\0${stagedRaw}`).digest('hex');
    return Object.freeze({
      available: true,
      reason: 'ready',
      message: status.clean ? '工作区干净。' : `当前有 ${status.changed} 项改动。`,
      repository: Object.freeze({ root: this.repoRoot, branch, detached: !branch, head, headShort: head.slice(0, 8), upstream, ahead, behind }),
      status: Object.freeze({ ...status, fingerprint }),
      recentCommits: parseRecentCommits(logRaw),
      remote
    });
  }

  async commit(message, expectedFingerprint) {
    const normalized = normalizeCommitMessage(message);
    const before = await this.inspect({ includeRemote: false });
    if (!before.available) throw new GitDeliveryError('repository-unavailable', before.message);
    if (before.status.conflicted > 0) throw new GitDeliveryError('conflicts', '存在未解决冲突，不能创建提交。');
    if (before.status.staged < 1) throw new GitDeliveryError('nothing-staged', '没有已暂存改动；本窗口不会自动暂存文件。');
    if (typeof expectedFingerprint !== 'string' || before.status.fingerprint !== expectedFingerprint) throw new GitDeliveryError('state-changed', '暂存区在确认期间已变化，请刷新后重新确认。');
    const previousHead = before.repository.head;
    await this._git(['commit', '-m', normalized]);
    const after = await this.inspect({ includeRemote: false });
    if (!after.available || after.repository.head === previousHead) throw new GitDeliveryError('commit-verification-failed', 'Git 提交完成状态未通过复核。');
    return Object.freeze({ ok: true, message: `已创建提交 ${after.repository.headShort}。`, state: after });
  }

  openLink(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/u.test(id) || !this.links.has(id)) throw new GitDeliveryError('invalid-link', '交付链接已失效，请刷新后重试。');
    return this.links.get(id);
  }
}

module.exports = {
  GitDeliveryError,
  GitDeliveryManager,
  MAX_COMMIT_MESSAGE,
  checkSummary,
  normalizeCommitMessage,
  parseGitHubRemote,
  parseRecentCommits,
  parseStatus
};
