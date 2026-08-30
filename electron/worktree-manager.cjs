const { createHash, randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');
const { GitCheckpointManager } = require('./checkpoint-manager.cjs');

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_WORKTREES = 32;
const MAX_MANAGED_WORKTREES = 12;
const MAX_OWNERSHIP_RECORDS = 192;
const GIT_TIMEOUT_MS = 30_000;

class GitWorktreeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GitWorktreeError';
    this.code = code;
  }
}

const pathKey = (value) => process.platform === 'win32'
  ? path.resolve(value).toLocaleLowerCase('en-US')
  : path.resolve(value);

const isInsideOrEqual = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const sanitizedGitEnvironment = (baseEnv = process.env) => ({
  ...Object.fromEntries(Object.entries(baseEnv).filter(([name]) => {
    const normalized = name.toUpperCase();
    return !/^DEEPSEEK(?:_|$)/.test(normalized)
      && ![
        'GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_EXEC_PATH', 'GIT_TEMPLATE_DIR', 'GIT_CONFIG',
        'GIT_CONFIG_COUNT', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_SSH', 'GIT_SSH_COMMAND',
        'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_TERMINAL_PROMPT'
      ].includes(normalized)
      && !/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(normalized);
  })),
  GIT_TERMINAL_PROMPT: '0',
  // Read-only status polling must not refresh and lock the user's index.
  // Required locks for add/read-tree/worktree mutations remain enforced.
  GIT_OPTIONAL_LOCKS: '0'
});

const runGitCommand = async (gitPath, cwd, args, { baseEnv = process.env, timeoutMs = GIT_TIMEOUT_MS } = {}) => {
  try {
    const result = await execFileAsync(gitPath, ['-C', cwd, ...args], {
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      timeout: timeoutMs,
      env: sanitizedGitEnvironment(baseEnv)
    });
    return String(result.stdout || '');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new GitWorktreeError('git-unavailable', '系统中未找到 Git，无法管理隔离工作树。');
    if (error?.killed || error?.signal) throw new GitWorktreeError('git-timeout', 'Git 工作树操作超时。');
    const detail = String(error?.stderr || error?.message || '').trim().slice(0, 500);
    throw new GitWorktreeError('git-failed', detail || 'Git 工作树操作失败。');
  }
};

const parseWorktreePorcelain = (value) => {
  const entries = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    if (typeof current.path !== 'string' || !path.isAbsolute(current.path)) {
      throw new GitWorktreeError('worktree-output-invalid', 'Git 返回了无效的工作树路径。');
    }
    if (current.head && !/^[0-9a-f]{40,64}$/i.test(current.head)) {
      throw new GitWorktreeError('worktree-output-invalid', 'Git 返回了无效的工作树提交。');
    }
    entries.push(Object.freeze(current));
    current = null;
  };
  for (const token of String(value || '').split('\0')) {
    if (token === '') {
      finish();
      continue;
    }
    const separator = token.indexOf(' ');
    const key = separator === -1 ? token : token.slice(0, separator);
    const body = separator === -1 ? '' : token.slice(separator + 1);
    if (key === 'worktree') {
      finish();
      current = { path: path.resolve(body), head: '', branch: '', detached: false, bare: false, locked: false, lockReason: '', prunable: false, pruneReason: '' };
      continue;
    }
    if (!current) throw new GitWorktreeError('worktree-output-invalid', 'Git 工作树列表缺少路径记录。');
    if (key === 'HEAD') current.head = body;
    else if (key === 'branch') current.branch = body.startsWith('refs/heads/') ? body.slice('refs/heads/'.length) : '';
    else if (key === 'detached') current.detached = true;
    else if (key === 'bare') current.bare = true;
    else if (key === 'locked') { current.locked = true; current.lockReason = body.slice(0, 200); }
    else if (key === 'prunable') { current.prunable = true; current.pruneReason = body.slice(0, 200); }
  }
  finish();
  if (entries.length > MAX_WORKTREES) throw new GitWorktreeError('worktree-limit', '仓库工作树数量超过安全显示上限。');
  return Object.freeze(entries);
};

const summarizeStatus = (porcelain) => {
  const records = String(porcelain || '').split('\0').filter(Boolean);
  let changed = 0;
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!/^[ MARCUD?!]{2} /.test(record)) continue;
    changed += 1;
    const left = record[0];
    const right = record[1];
    if (left === '?' && right === '?') untracked += 1;
    else {
      if (left !== ' ') staged += 1;
      if (right !== ' ') unstaged += 1;
    }
    if (['R', 'C'].includes(left) || ['R', 'C'].includes(right)) index += 1;
  }
  return Object.freeze({
    changed,
    staged,
    unstaged,
    untracked,
    clean: changed === 0,
    digest: createHash('sha256').update(String(porcelain || '')).digest('hex')
  });
};

const worktreeId = (commonDir, worktreePath) => createHash('sha256')
  .update(`dsh-worktree-v1\0${pathKey(commonDir)}\0${pathKey(worktreePath)}`)
  .digest('hex')
  .slice(0, 24);

const recoveryFingerprint = (item) => createHash('sha256')
  .update([item.id, item.head, item.branch, item.status.digest, item.path].join('\0'))
  .digest('hex');

const validOwnershipRecord = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && typeof value.repositoryKey === 'string'
  && /^[0-9a-f]{16}$/.test(value.repositoryKey)
  && typeof value.path === 'string'
  && value.path.length <= 1024
  && path.isAbsolute(value.path)
  && /^worktree-\d{8}-\d{6}-[0-9a-f]{6}$/.test(path.basename(value.path))
  && typeof value.branch === 'string'
  && /^dsh\/worktree-\d{8}-\d{6}-[0-9a-f]{6}$/.test(value.branch)
  && typeof value.createdAt === 'string'
  && value.createdAt.length <= 64
  && Number.isFinite(Date.parse(value.createdAt))
  && ['owned', 'removing'].includes(value.state);

const validOwnershipState = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1
    || !Array.isArray(value.worktrees) || value.worktrees.length > MAX_OWNERSHIP_RECORDS
    || !value.worktrees.every(validOwnershipRecord)) return false;
  const identities = value.worktrees.map((item) => `${item.repositoryKey}\0${pathKey(item.path)}`);
  return new Set(identities).size === identities.length;
};

class GitWorktreeManager {
  constructor({
    managedRoot,
    gitPath = 'git',
    baseEnv = process.env,
    now = () => new Date(),
    random = randomBytes,
    runGit = runGitCommand,
    checkpointFactory = () => new GitCheckpointManager(),
    ownershipStore
  }) {
    if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)) throw new TypeError('managedRoot must be absolute.');
    this.managedRoot = path.resolve(managedRoot);
    this.gitPath = gitPath;
    this.baseEnv = baseEnv;
    this.now = now;
    this.random = random;
    this.runGit = runGit;
    this.checkpointFactory = checkpointFactory;
    this.ownershipStore = ownershipStore || new AtomicJsonFile({
      filePath: path.join(this.managedRoot, 'ownership.json'),
      validator: validOwnershipState
    });
    this.pending = null;
  }

  async _ownershipRecords() {
    const loaded = await this.ownershipStore.read({ fallback: { version: 1, worktrees: [] } });
    return loaded.value.worktrees;
  }

  async _claimOwnership(context, item, knownPaths) {
    const existing = await this._ownershipRecords();
    const worktrees = existing.filter((record) => (
      record.repositoryKey !== context.repositoryKey
      || (knownPaths.has(pathKey(record.path)) && pathKey(record.path) !== pathKey(item.path))
    ));
    worktrees.push(Object.freeze({
      repositoryKey: context.repositoryKey,
      path: item.path,
      branch: item.branch,
      createdAt: this.now().toISOString(),
      state: 'owned'
    }));
    if (worktrees.length > MAX_OWNERSHIP_RECORDS) {
      throw new GitWorktreeError('ownership-limit', '软件工作树所有权记录已达到安全上限。');
    }
    await this.ownershipStore.write({ version: 1, worktrees });
  }

  async _releaseOwnership(context, item) {
    const existing = await this._ownershipRecords();
    const worktrees = existing.filter((record) => !(
      record.repositoryKey === context.repositoryKey
      && pathKey(record.path) === pathKey(item.path)
      && record.branch === item.branch
    ));
    if (worktrees.length === existing.length) return true;
    await this.ownershipStore.write({ version: 1, worktrees });
    return true;
  }

  async _setOwnershipState(context, item, state) {
    const existing = await this._ownershipRecords();
    let matched = false;
    const worktrees = existing.map((record) => {
      if (record.repositoryKey !== context.repositoryKey
        || pathKey(record.path) !== pathKey(item.path)
        || record.branch !== item.branch) return record;
      matched = true;
      return Object.freeze({ ...record, state });
    });
    if (!matched) throw new GitWorktreeError('ownership-changed', '软件工作树所有权记录已变化。');
    await this.ownershipStore.write({ version: 1, worktrees });
  }

  _git(cwd, args, options = {}) {
    return this.runGit(this.gitPath, cwd, [
      '-c', 'core.hooksPath=NUL',
      '-c', 'core.fsmonitor=false',
      '-c', 'core.untrackedCache=false',
      ...args
    ], { baseEnv: this.baseEnv, ...options });
  }

  async _repositoryContext(workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new GitWorktreeError('workspace-invalid', '请先打开一个 Git 仓库根目录。');
    }
    let workspace;
    try {
      const requestedPath = path.resolve(workspacePath);
      const requestedInfo = await fsp.lstat(requestedPath);
      if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) throw new Error('workspace-link');
      workspace = await fsp.realpath(requestedPath);
      const info = await fsp.lstat(workspace);
      if (!info.isDirectory() || info.isSymbolicLink() || pathKey(workspace) !== pathKey(requestedPath)) throw new Error('workspace-link');
    } catch {
      throw new GitWorktreeError('workspace-invalid', '当前工作区目录不可用。');
    }
    const inside = (await this._git(workspace, ['rev-parse', '--is-inside-work-tree'])).trim();
    if (inside !== 'true') throw new GitWorktreeError('not-a-git-repository', '当前工作区不是 Git 仓库。');
    const rootReported = (await this._git(workspace, ['rev-parse', '--show-toplevel'])).trim();
    const root = await fsp.realpath(path.resolve(rootReported));
    if (pathKey(root) !== pathKey(workspace)) {
      throw new GitWorktreeError('workspace-is-subdirectory', '请打开 Git 仓库根目录后再管理工作树。');
    }
    let commonReported;
    try {
      commonReported = (await this._git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
    } catch {
      commonReported = (await this._git(root, ['rev-parse', '--git-common-dir'])).trim();
    }
    const commonCandidate = path.isAbsolute(commonReported) ? commonReported : path.resolve(root, commonReported);
    const commonDir = await fsp.realpath(commonCandidate);
    const repositoryKey = createHash('sha256').update(pathKey(commonDir)).digest('hex').slice(0, 16);
    return Object.freeze({ workspace, root, commonDir, repositoryKey, managedRepositoryRoot: path.join(this.managedRoot, repositoryKey) });
  }

  async _status(worktreePath) {
    const porcelain = await this._git(worktreePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    return summarizeStatus(porcelain);
  }

  async _state(workspacePath) {
    const context = await this._repositoryContext(workspacePath);
    const parsed = parseWorktreePorcelain(await this._git(context.root, ['worktree', 'list', '--porcelain', '-z']));
    const ownershipRecords = await this._ownershipRecords();
    const owned = new Map(ownershipRecords
      .filter((record) => record.repositoryKey === context.repositoryKey)
      .map((record) => [pathKey(record.path), record]));
    const managedRootKey = pathKey(context.managedRepositoryRoot);
    const worktrees = [];
    for (let index = 0; index < parsed.length; index += 1) {
      const entry = parsed[index];
      let status = Object.freeze({ changed: 0, staged: 0, unstaged: 0, untracked: 0, clean: true, digest: '', available: false });
      let pathSafe = false;
      if (!entry.bare && !entry.prunable) {
        try {
          const info = await fsp.lstat(entry.path);
          const real = await fsp.realpath(entry.path);
          pathSafe = info.isDirectory() && !info.isSymbolicLink() && pathKey(real) === pathKey(entry.path);
          if (pathSafe) status = Object.freeze({ ...(await this._status(entry.path)), available: true });
        } catch { /* Show the worktree as unavailable without hiding it. */ }
      }
      const parentKey = pathKey(path.dirname(entry.path));
      const ownership = owned.get(pathKey(entry.path));
      const managed = Boolean(ownership)
        && ownership.state === 'owned'
        && ownership.branch === entry.branch
        && parentKey === managedRootKey
        && isInsideOrEqual(context.managedRepositoryRoot, entry.path);
      const current = pathKey(entry.path) === pathKey(context.root);
      worktrees.push(Object.freeze({
        id: worktreeId(context.commonDir, entry.path),
        path: entry.path,
        directoryName: path.basename(entry.path) || entry.path,
        branch: entry.branch,
        head: entry.head,
        headShort: entry.head.slice(0, 10),
        detached: entry.detached,
        bare: entry.bare,
        locked: entry.locked,
        lockReason: entry.lockReason,
        prunable: entry.prunable,
        pruneReason: entry.pruneReason,
        pathSafe,
        main: index === 0,
        current,
        managed,
        owner: managed ? 'DSH Desktop' : '外部 Git',
        status,
        canActivate: pathSafe && !current && !entry.bare && !entry.prunable && status.available,
        canRemove: pathSafe && managed && !current && !entry.locked && !entry.prunable && status.available
      }));
    }
    const current = worktrees.find((item) => item.current) || null;
    return Object.freeze({
      available: true,
      reason: 'ready',
      status: this.pending ? 'busy' : 'ready',
      repository: Object.freeze({
        root: context.root,
        commonDir: context.commonDir,
        branch: current?.branch || '',
        head: current?.head || '',
        headShort: current?.headShort || '',
        detached: current?.detached || false
      }),
      limits: Object.freeze({ total: MAX_WORKTREES, managed: MAX_MANAGED_WORKTREES }),
      counts: Object.freeze({
        total: worktrees.length,
        managed: worktrees.filter((item) => item.managed).length,
        dirty: worktrees.filter((item) => item.status.available && !item.status.clean).length,
        unavailable: worktrees.filter((item) => !item.status.available).length
      }),
      worktrees: Object.freeze(worktrees),
      context
    });
  }

  async inspect(workspacePath) {
    try {
      const state = await this._state(workspacePath);
      const { context: _context, ...publicState } = state;
      return Object.freeze(publicState);
    } catch (error) {
      return Object.freeze({
        available: false,
        reason: error?.code || 'unavailable',
        status: this.pending ? 'busy' : 'unavailable',
        message: error?.message || 'Git 工作树管理暂时不可用。',
        repository: Object.freeze({ root: '', commonDir: '', branch: '', head: '', headShort: '', detached: false }),
        limits: Object.freeze({ total: MAX_WORKTREES, managed: MAX_MANAGED_WORKTREES }),
        counts: Object.freeze({ total: 0, managed: 0, dirty: 0, unavailable: 0 }),
        worktrees: Object.freeze([])
      });
    }
  }

  async _prepareManagedRoot(context) {
    await fsp.mkdir(this.managedRoot, { recursive: true });
    const managedInfo = await fsp.lstat(this.managedRoot);
    const managedReal = await fsp.realpath(this.managedRoot);
    if (!managedInfo.isDirectory() || managedInfo.isSymbolicLink() || pathKey(managedReal) !== pathKey(this.managedRoot)) {
      throw new GitWorktreeError('managed-root-invalid', '软件工作树根目录未通过边界校验。');
    }
    await fsp.mkdir(context.managedRepositoryRoot, { recursive: false }).catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
    const repositoryInfo = await fsp.lstat(context.managedRepositoryRoot);
    const repositoryReal = await fsp.realpath(context.managedRepositoryRoot);
    if (!repositoryInfo.isDirectory() || repositoryInfo.isSymbolicLink()
      || pathKey(repositoryReal) !== pathKey(context.managedRepositoryRoot)
      || !isInsideOrEqual(managedReal, repositoryReal)) {
      throw new GitWorktreeError('managed-root-invalid', '仓库工作树目录未通过边界校验。');
    }
    return repositoryReal;
  }

  _serialize(operation) {
    if (this.pending) throw new GitWorktreeError('worktree-busy', '另一个工作树操作仍在进行。');
    this.pending = Promise.resolve().then(operation);
    return this.pending.finally(() => { this.pending = null; });
  }

  create({ workspacePath }) {
    return this._serialize(async () => {
      const before = await this._state(workspacePath);
      if (before.counts.total >= MAX_WORKTREES) throw new GitWorktreeError('worktree-limit', '已达到仓库工作树总数上限。');
      if (before.counts.managed >= MAX_MANAGED_WORKTREES) throw new GitWorktreeError('managed-limit', '已达到软件管理工作树数量上限。');
      const managedRepositoryRoot = await this._prepareManagedRoot(before.context);
      const stamp = this.now().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const suffix = this.random(3).toString('hex');
      const leaf = `worktree-${stamp}-${suffix}`;
      const branch = `dsh/${leaf}`;
      const target = path.join(managedRepositoryRoot, leaf);
      if (!isInsideOrEqual(managedRepositoryRoot, target) || path.dirname(target) !== managedRepositoryRoot) {
        throw new GitWorktreeError('target-invalid', '生成的工作树路径超出软件管理范围。');
      }
      try {
        await fsp.lstat(target);
        throw new GitWorktreeError('target-exists', '生成的工作树目录已经存在，请重试。');
      } catch (error) {
        if (error instanceof GitWorktreeError) throw error;
        if (error?.code !== 'ENOENT') throw error;
      }
      await this._git(before.context.root, ['-c', 'core.hooksPath=NUL', 'worktree', 'add', '--no-track', '-b', branch, target, 'HEAD']);
      const after = await this._state(workspacePath);
      const created = after.worktrees.find((item) => pathKey(item.path) === pathKey(target));
      if (!created || !created.pathSafe || created.branch !== branch) {
        throw new GitWorktreeError('create-verification-failed', 'Git 没有确认新工作树的路径和分支。');
      }
      await this._claimOwnership(before.context, created, new Set(after.worktrees.map((item) => pathKey(item.path))));
      const verified = await this._state(workspacePath);
      const ownedWorktree = verified.worktrees.find((item) => item.id === created.id);
      if (!ownedWorktree?.managed) {
        throw new GitWorktreeError('create-verification-failed', '软件所有权记录没有通过最终校验。');
      }
      const { context: _context, ...publicState } = verified;
      return Object.freeze({ ok: true, createdId: ownedWorktree.id, branch, path: ownedWorktree.path, state: Object.freeze(publicState) });
    });
  }

  async resolve({ workspacePath, id }) {
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) throw new GitWorktreeError('worktree-id-invalid', '工作树标识无效。');
    const state = await this._state(workspacePath);
    const item = state.worktrees.find((candidate) => candidate.id === id);
    if (!item) throw new GitWorktreeError('worktree-changed', '工作树列表已变化，请刷新后重试。');
    return Object.freeze({ item, state });
  }

  async previewRemove({ workspacePath, id }) {
    const resolved = await this.resolve({ workspacePath, id });
    const item = resolved.item;
    if (!item.canRemove) throw new GitWorktreeError('remove-not-allowed', '只能回收软件创建且当前未打开的健康工作树。');
    return Object.freeze({
      id: item.id,
      branch: item.branch,
      head: item.head,
      headShort: item.headShort,
      path: item.path,
      status: { ...item.status },
      recovery: item.status.clean ? 'branch-head' : 'private-checkpoint',
      fingerprint: recoveryFingerprint(item)
    });
  }

  remove({ workspacePath, id, expectedFingerprint }) {
    return this._serialize(async () => {
      let preview = await this.previewRemove({ workspacePath, id });
      if (typeof expectedFingerprint !== 'string' || preview.fingerprint !== expectedFingerprint) {
        throw new GitWorktreeError('remove-state-changed', '工作树状态在确认前已变化，未执行回收。');
      }
      let checkpoint = null;
      if (!preview.status.clean) {
        const checkpointManager = this.checkpointFactory();
        const activated = await checkpointManager.activate(preview.path);
        if (!activated.available) throw new GitWorktreeError('checkpoint-unavailable', '无法为未提交修改建立恢复点。');
        const created = await checkpointManager.create({ source: 'safety' });
        if ((!created.created && !created.unchanged) || !created.last?.id || !created.last?.commit) {
          throw new GitWorktreeError('checkpoint-failed', '未提交修改的恢复点创建失败，工作树未移除。');
        }
        checkpoint = Object.freeze({
          id: created.last.id,
          commit: created.last.commit,
          commitShort: created.last.commit.slice(0, 10),
          reused: created.unchanged === true
        });
        preview = await this.previewRemove({ workspacePath, id });
        if (preview.fingerprint !== expectedFingerprint) {
          throw new GitWorktreeError('remove-state-changed', '建立恢复点期间工作树状态发生变化，未执行回收。');
        }
      }
      const currentState = await this._state(workspacePath);
      const context = currentState.context;
      const item = currentState.worktrees.find((candidate) => candidate.id === id);
      if (!item || !item.canRemove || recoveryFingerprint(item) !== expectedFingerprint) {
        throw new GitWorktreeError('remove-state-changed', '回收前最终状态校验失败。');
      }
      const args = ['worktree', 'remove'];
      if (!item.status.clean) args.push('--force');
      args.push(item.path);
      await this._setOwnershipState(context, item, 'removing');
      try {
        await this._git(context.root, args);
        try {
          await fsp.lstat(item.path);
          throw new GitWorktreeError('remove-verification-failed', 'Git 命令完成后工作树目录仍然存在。');
        } catch (error) {
          if (error instanceof GitWorktreeError) throw error;
          if (error?.code !== 'ENOENT') throw error;
        }
      } catch (error) {
        let pathStillExists = false;
        try { pathStillExists = (await fsp.lstat(item.path)).isDirectory(); } catch { /* Missing paths stay fail-closed in removing state. */ }
        if (pathStillExists) await this._setOwnershipState(context, item, 'owned').catch(() => {});
        throw error;
      }
      const branchRef = item.branch ? (await this._git(context.root, ['show-ref', '--verify', `refs/heads/${item.branch}`])).trim() : '';
      if (item.branch && !branchRef.endsWith(` refs/heads/${item.branch}`)) {
        throw new GitWorktreeError('branch-verification-failed', '工作树已移除，但保留分支验证失败。');
      }
      const ownershipReleased = await this._releaseOwnership(context, item).catch(() => false);
      const after = await this._state(workspacePath);
      if (after.worktrees.some((candidate) => candidate.id === id)) {
        throw new GitWorktreeError('remove-verification-failed', 'Git 列表中仍存在已回收的工作树。');
      }
      const { context: _context, ...publicState } = after;
      return Object.freeze({ ok: true, removedId: id, branch: item.branch, head: item.head, checkpoint, ownershipReleased, state: Object.freeze(publicState) });
    });
  }
}

module.exports = {
  GitWorktreeError,
  GitWorktreeManager,
  MAX_MANAGED_WORKTREES,
  MAX_OWNERSHIP_RECORDS,
  MAX_WORKTREES,
  parseWorktreePorcelain,
  recoveryFingerprint,
  runGitCommand,
  sanitizedGitEnvironment,
  summarizeStatus,
  validOwnershipState
};
