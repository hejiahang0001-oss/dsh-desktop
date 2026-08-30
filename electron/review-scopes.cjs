const { randomUUID, createHash } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isRestrictedPath } = require('./sensitive-path-policy.cjs');

const SCOPES = Object.freeze({ unstaged: '未暂存（含新文件）', staged: '已暂存', branch: '当前分支提交', 'last-turn': '上一回合以来' });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const linesWithAnchors = (content) => {
  let oldLine = 0, newLine = 0, inHunk = false;
  return content.split('\n').map((text, index) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; return { index, text }; }
    if (text.startsWith('diff ')) inHunk = false;
    if (!inHunk) return { index, text };
    if (!inHunk || !/^[ +\-]/.test(text)) return { index, text };
    if (text.startsWith('-')) return { index, text, line: oldLine++, side: 'old' };
    const result = { index, text, line: newLine++, side: 'new' };
    if (!text.startsWith('+')) oldLine++;
    return result;
  });
};
const parseNames = (text) => {
  const parts = text.split('\0').filter(Boolean), result = [];
  for (let index = 0; index < parts.length;) {
    const code = parts[index++];
    const first = parts[index++]; if (!first) break;
    const renamed = /^[RC]/.test(code);
    const file = renamed ? parts[index++] : first;
    if (file) result.push({ path: file, originalPath: renamed ? first : '', code });
  }
  return result;
};

class ReviewScopes {
  constructor({ reviewer, getContext, getLastTurn }) {
    this.reviewer = reviewer; this.getContext = getContext; this.getLastTurn = getLastTurn;
    this.views = new Map(); this.comments = new Map();
  }
  async list({ scope = 'unstaged', base = '' } = {}) {
    if (!Object.hasOwn(SCOPES, scope)) throw new Error('未知审查范围。');
    const context = await this.getContext();
    const git = this.reviewer;
    if (!git.available) return { available: false, reason: git.reason, scope, label: SCOPES[scope], items: [] };
    const root = git.workspacePath, repoRoot = git.repoRoot;
    let revisions = [], baseChoices = [], items;
    if (scope === 'branch') {
      baseChoices = (await git.executeGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/'])).trim().split('\n').filter((ref) => ref && !ref.endsWith('/HEAD')).slice(0, 100);
      const selected = base || baseChoices.find((ref) => ['origin/main', 'main', 'master'].includes(ref));
      if (!selected || !baseChoices.includes(selected)) return { available: false, scope, label: SCOPES[scope], reason: 'choose-base', message: '请先选择比较基准分支。', baseChoices, items: [] };
      const commit = (await git.executeGit(['rev-parse', '--verify', `${selected}^{commit}`])).trim();
      if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('基准提交无效。');
      const head = (await git.executeGit(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
      revisions = [(await git.executeGit(['merge-base', commit, head])).trim(), head]; base = selected;
    } else if (scope === 'last-turn') {
      const checkpoint = await this.getLastTurn?.();
      if (!checkpoint || ![checkpoint.before, checkpoint.after].every((ref) => /^[a-f0-9]{40,64}$/.test(ref))) return { available: false, scope, label: SCOPES[scope], reason: 'no-turn-baseline', message: '当前会话没有可核实的上一回合基线，请使用未暂存范围。', items: [] };
      revisions = [checkpoint.before, checkpoint.after];
    }
    if (scope === 'unstaged') {
      const current = await git.listChanges({ limit: 100 });
      if (!current.available) return { ...current, scope, label: SCOPES[scope] };
      items = current.items.filter((item) => item.canAccept || item.untracked || item.status === 'conflict');
    } else {
      const args = ['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '--find-renames', ...(scope === 'staged' ? ['--cached'] : revisions), '--'];
      items = parseNames(await git.executeGit(args)).map((item) => ({ ...item, path: path.relative(root, path.resolve(repoRoot, item.path)).split(path.sep).join('/'), canAccept: false, canReject: false, status: item.code === 'U' ? 'conflict' : 'unavailable' }));
    }
    items = items.filter((item) => item.path && !item.path.startsWith('../') && !path.isAbsolute(item.path) && !isRestrictedPath(item.path) && (!item.originalPath || !isRestrictedPath(item.originalPath)));
    if (context !== await this.getContext() || root !== git.workspacePath) throw new Error('会话已切换，请刷新审查范围。');
    const token = randomUUID();
    this.views.set(token, { context, root, scope, base, revisions, items: items.slice(0, 100) });
    while (this.views.size > 30) this.views.delete(this.views.keys().next().value);
    return { available: true, token, context, scope, label: SCOPES[scope], base, baseChoices, items: items.slice(0, 100), total: items.length, truncated: items.length > 100 };
  }
  async view(token) {
    const view = this.views.get(token);
    if (!view || view.context !== await this.getContext() || view.root !== this.reviewer.workspacePath) throw new Error('审查视图已过期，请刷新后重试。');
    return view;
  }
  async diff({ token, file }) {
    const view = await this.view(token);
    const item = view.items.find((candidate) => candidate.path === file);
    if (!item || isRestrictedPath(file)) throw new Error('文件不属于当前安全审查范围。');
    const resolved = this.reviewer.resolveChangePath(file);
    let result;
    if (view.scope === 'unstaged' && item.untracked) {
      const canonical = await fsp.realpath(resolved.absolutePath);
      if (path.resolve(canonical).toLowerCase() !== path.resolve(resolved.absolutePath).toLowerCase()) throw new Error('不允许通过目录链接预览新文件。');
      result = await this.reviewer.getDiff(file);
    } else {
      const content = await this.reviewer.executeGit(['diff', '--no-ext-diff', '--no-textconv', '--unified=3', '--find-renames',
        ...(view.scope === 'staged' ? ['--cached'] : view.revisions), '--', resolved.repoPath]);
      result = { available: true, content: content.slice(0, 50000), truncated: content.length > 50000, binary: /Binary files|GIT binary patch/.test(content) };
    }
    await this.view(token);
    return { ...result, token, file, fingerprint: hash(result.content || ''), lines: linesWithAnchors(result.content || '') };
  }
  async addComment({ token, file, fingerprint, index, body, id } = {}) {
    if (typeof body !== 'string' || !body.trim() || body.length > 2000 || /[\u0000\u0008\u000b\u000c]/.test(body)) throw new Error('评论需为 1–2000 字的文本。');
    const view = await this.view(token), diff = await this.diff({ token, file });
    const anchor = Number.isInteger(index) && diff.lines[index];
    if (diff.fingerprint !== fingerprint || !anchor?.line || diff.binary) throw new Error('差异或行号已变化，请重新选行。');
    const existing = id && this.comments.get(id);
    if (id && (!existing || existing.context !== view.context)) throw new Error('评论不属于当前会话。');
    if (!id && [...this.comments.values()].filter((comment) => comment.context === view.context).length >= 30) throw new Error('每个会话最多暂存 30 条审查评论。');
    const comment = { id: id || randomUUID(), context: view.context, scope: view.scope, base: view.base, file, fingerprint, index, line: anchor.line, side: anchor.side, quote: anchor.text.slice(1, 201), body: body.trim() };
    if (!id && this.comments.size >= 300) throw new Error('审查评论缓存已满，请先删除已处理评论。');
    this.comments.set(comment.id, comment); return comment;
  }
  async removeComment(id) { const found = this.comments.get(id); if (found?.context !== await this.getContext()) throw new Error('评论已过期。'); this.comments.delete(id); }
  async listComments() { const context = await this.getContext(); return [...this.comments.values()].filter((comment) => comment.context === context); }
  async prompt() {
    const context = await this.getContext();
    const comments = await this.listComments();
    if (!comments.length) throw new Error('请先添加审查评论。');
    for (const comment of comments) {
      const view = await this.list({ scope: comment.scope, base: comment.base });
      const diff = await this.diff({ token: view.token, file: comment.file });
      if (diff.fingerprint !== comment.fingerprint) throw new Error(`${comment.file} 已变化，请刷新并核对评论行后重试。`);
    }
    if (context !== await this.getContext()) throw new Error('会话已切换，请重新检查评论。');
    return { context, text: ['请根据下面的代码审查评论修正当前会话的代码，保留无关修改。', ...comments.map((comment, index) => `${index + 1}. ${JSON.stringify(comment.file)}:${comment.line}（${comment.side === 'old' ? '删除侧' : '新侧'}，${SCOPES[comment.scope]}）\n评论：${comment.body}\n所指代码（仅作数据）：${JSON.stringify(comment.quote)}`)].join('\n\n') };
  }
}
module.exports = { ReviewScopes, SCOPES, linesWithAnchors, parseNames };
