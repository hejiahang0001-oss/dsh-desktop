const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const LATEST_REF = 'refs/dsh/checkpoints/latest';
const ITEM_REF_PREFIX = 'refs/dsh/checkpoints/items/';
const HISTORY_LIMIT = 12;
const HISTORY_SCAN_LIMIT = 25;
const MAX_RESTORE_PATHS = 500;
const CHECKPOINT_ID_PATTERN = /^[0-9]{8}T[0-9]{9}Z-[0-9a-f]{8}$/i;
const RESTRICTED_COMPONENT_PATTERNS = Object.freeze([
  /^\.env(?:\.|$)/i,
  /^\.credentials(?:\.|$)/i,
  /^(?:credentials|secrets?)(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i,
  /^(?:\.npmrc|\.pypirc|\.netrc)$/i,
  /\.(?:pem|key|pfx|p12)$/i
]);
const SENSITIVE_PATHSPECS = Object.freeze([
  ':(exclude,top).env', ':(exclude,glob)**/.env',
  ':(exclude,top).env.*', ':(exclude,glob)**/.env.*',
  ':(exclude,top).credentials*', ':(exclude,glob)**/.credentials*',
  ':(exclude,top)credentials*', ':(exclude,glob)**/credentials*',
  ':(exclude,top)secret*', ':(exclude,glob)**/secret*',
  ':(exclude,top)id_rsa*', ':(exclude,glob)**/id_rsa*',
  ':(exclude,top)id_dsa*', ':(exclude,glob)**/id_dsa*',
  ':(exclude,top)id_ecdsa*', ':(exclude,glob)**/id_ecdsa*',
  ':(exclude,top)id_ed25519*', ':(exclude,glob)**/id_ed25519*',
  ':(exclude,glob)**/*.pem', ':(exclude,glob)**/*.key',
  ':(exclude,glob)**/*.pfx', ':(exclude,glob)**/*.p12',
  ':(exclude,top).npmrc', ':(exclude,glob)**/.npmrc',
  ':(exclude,top).pypirc', ':(exclude,glob)**/.pypirc',
  ':(exclude,top).netrc', ':(exclude,glob)**/.netrc'
]);

const sanitizedEnvironment = () => Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/^DEEPSEEK(?:_|$)/i.test(name))
);

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const isRestrictedGitPath = (value) => String(value || '')
  .replaceAll('\\', '/')
  .split('/')
  .filter(Boolean)
  .some((component) => RESTRICTED_COMPONENT_PATTERNS.some((pattern) => pattern.test(component)));

const statusPaths = (porcelain) => {
  const records = String(porcelain || '').split('\0').filter(Boolean);
  const paths = [];
  for (const record of records) {
    paths.push(/^[ MARCUD?!]{2} /.test(record) ? record.slice(3) : record);
  }
  return paths;
};

const splitNull = (value) => String(value || '').split('\0').filter(Boolean);

const parseTrailer = (body, name) => {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(body || '');
  return match?.[1]?.trim() || '';
};

const checkpointId = (now, random = randomBytes) => (
  `${now.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}-${random(4).toString('hex')}`
);

const isCheckpointId = (value) => CHECKPOINT_ID_PATTERN.test(String(value || ''));

class GitCheckpointManager {
  constructor({ run = execFileAsync, fsPromises = fsp, now = () => new Date(), random = randomBytes } = {}) {
    this.run = run;
    this.fsPromises = fsPromises;
    this.now = now;
    this.random = random;
    this.workspacePath = '';
    this.repoRoot = '';
    this.available = false;
    this.reason = 'not-initialized';
    this.last = null;
    this.pending = null;
  }

  async executeGit(args, { env = sanitizedEnvironment(), cwd = this.repoRoot } = {}) {
    const result = await this.run('git', ['-C', cwd, ...args], {
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env
    });
    return String(result?.stdout || '');
  }

  async optionalGit(args, options) {
    try {
      return (await this.executeGit(args, options)).trim();
    } catch {
      return '';
    }
  }

  async readCheckpoint(commit, expectedId = '') {
    if (!/^[0-9a-f]{40,64}$/i.test(commit || '')) throw new Error('Invalid checkpoint commit.');
    const raw = await this.executeGit(['show', '-s', '--format=%H%x00%T%x00%cI%x00%B', commit]);
    const [reportedCommit, tree, createdAt, ...bodyParts] = raw.split('\0');
    const body = bodyParts.join('\0');
    const id = parseTrailer(body, 'DSH-Checkpoint-ID');
    const indexTree = parseTrailer(body, 'DSH-Index-Tree');
    if (reportedCommit.trim() !== commit || !isCheckpointId(id) || (expectedId && id !== expectedId)) {
      throw new Error('Checkpoint metadata did not match its private ref.');
    }
    if (!/^[0-9a-f]{40,64}$/i.test(tree.trim()) || !/^[0-9a-f]{40,64}$/i.test(indexTree)) {
      throw new Error('Checkpoint tree metadata is invalid.');
    }
    const source = parseTrailer(body, 'DSH-Checkpoint-Source');
    return Object.freeze({
      id,
      commit,
      tree: tree.trim(),
      indexTree,
      source: ['automatic', 'manual', 'safety'].includes(source) ? source : 'unknown',
      createdAt: createdAt.trim(),
      sensitiveExcludedCount: Number(parseTrailer(body, 'DSH-Sensitive-Excluded')) || 0
    });
  }

  async readLatest() {
    const commit = await this.optionalGit(['rev-parse', '--verify', LATEST_REF]);
    if (!commit) return null;
    try {
      return await this.readCheckpoint(commit);
    } catch {
      return null;
    }
  }

  async resolveCheckpoint(id) {
    if (!isCheckpointId(id)) return null;
    const commit = await this.optionalGit(['rev-parse', '--verify', `${ITEM_REF_PREFIX}${id}`]);
    if (!commit) return null;
    try {
      return await this.readCheckpoint(commit, id);
    } catch {
      return null;
    }
  }

  async activate(workspacePath) {
    this.workspacePath = path.resolve(workspacePath || '.');
    this.repoRoot = '';
    this.available = false;
    this.reason = 'not-a-git-repository';
    this.last = null;
    try {
      const root = (await this.executeGit(['rev-parse', '--show-toplevel'], { cwd: this.workspacePath })).trim();
      if (!root) throw new Error('Git did not return a repository root.');
      this.repoRoot = path.resolve(root);
      if (!isInside(this.repoRoot, this.workspacePath)) throw new Error('Workspace is outside the Git repository.');
      if (path.relative(this.repoRoot, this.workspacePath) !== '') {
        this.reason = 'workspace-is-subdirectory';
        return this.getState();
      }
      this.available = true;
      this.reason = 'ready';
      this.last = await this.readLatest();
    } catch (error) {
      this.repoRoot = '';
      this.available = false;
      this.reason = error?.code === 'ENOENT' ? 'git-unavailable' : 'not-a-git-repository';
    }
    return this.getState();
  }

  getState(extra = {}) {
    return Object.freeze({
      available: this.available,
      reason: this.reason,
      status: this.pending ? 'creating' : (this.last ? 'ready' : 'empty'),
      last: this.last ? { ...this.last } : null,
      ...extra
    });
  }

  async create({ source = 'manual' } = {}) {
    if (!this.available) return this.getState({ created: false });
    if (this.pending) return this.pending;
    const normalizedSource = ['automatic', 'safety'].includes(source) ? source : 'manual';
    this.pending = this.createInternal({ source: normalizedSource });
    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  async createInternal({ source }) {
    const tempRoot = await this.fsPromises.mkdtemp(path.join(os.tmpdir(), 'dsh-checkpoint-'));
    const tempIndex = path.join(tempRoot, 'index');
    const baseEnv = {
      ...sanitizedEnvironment(),
      GIT_AUTHOR_NAME: 'DSH Desktop',
      GIT_AUTHOR_EMAIL: 'checkpoint@dsh-desktop.local',
      GIT_COMMITTER_NAME: 'DSH Desktop',
      GIT_COMMITTER_EMAIL: 'checkpoint@dsh-desktop.local'
    };
    const indexEnv = { ...baseEnv, GIT_INDEX_FILE: tempIndex };
    try {
      const head = await this.optionalGit(['rev-parse', '--verify', 'HEAD'], { env: baseEnv });
      const indexTree = await this.optionalGit(['write-tree'], { env: baseEnv });
      const porcelain = await this.executeGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { env: baseEnv });
      const sensitiveExcludedCount = new Set(statusPaths(porcelain).filter(isRestrictedGitPath)).size;

      if (head) await this.executeGit(['read-tree', head], { env: indexEnv });
      else await this.executeGit(['read-tree', '--empty'], { env: indexEnv });
      await this.executeGit(['add', '-A', '--', '.', ...SENSITIVE_PATHSPECS], { env: indexEnv });
      const tree = (await this.executeGit(['write-tree'], { env: indexEnv })).trim();
      const effectiveIndexTree = indexTree || (head ? (await this.executeGit(['rev-parse', `${head}^{tree}`], { env: baseEnv })).trim() : tree);
      const latest = await this.readLatest();
      if (latest?.tree === tree && latest?.indexTree === effectiveIndexTree) {
        this.last = latest;
        return this.getState({ status: 'ready', created: false, unchanged: true });
      }

      const createdAt = this.now();
      const id = checkpointId(createdAt, this.random);
      const message = [
        'DSH Desktop code checkpoint',
        '',
        `DSH-Checkpoint-ID: ${id}`,
        `DSH-Checkpoint-Source: ${source}`,
        `DSH-Index-Tree: ${effectiveIndexTree}`,
        `DSH-Sensitive-Excluded: ${sensitiveExcludedCount}`
      ].join('\n');
      const commitArgs = ['commit-tree', tree];
      if (head) commitArgs.push('-p', head);
      commitArgs.push('-m', message);
      const commit = (await this.executeGit(commitArgs, { env: baseEnv })).trim();
      const itemRef = `${ITEM_REF_PREFIX}${id}`;
      await this.executeGit(['update-ref', itemRef, commit], { env: baseEnv });
      await this.executeGit(['update-ref', LATEST_REF, commit], { env: baseEnv });
      this.last = Object.freeze({
        id,
        commit,
        tree,
        indexTree: effectiveIndexTree,
        source,
        createdAt: createdAt.toISOString(),
        sensitiveExcludedCount
      });
      return this.getState({ status: 'ready', created: true, unchanged: false });
    } catch (error) {
      this.reason = error?.code === 'ENOENT' ? 'git-unavailable' : 'checkpoint-failed';
      return this.getState({ status: 'error', created: false, error: '无法建立代码检查点。请检查 Git 状态后重试。' });
    } finally {
      await this.fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  }

  async captureCurrentState() {
    const tempRoot = await this.fsPromises.mkdtemp(path.join(os.tmpdir(), 'dsh-restore-preview-'));
    const tempIndex = path.join(tempRoot, 'index');
    const indexEnv = { ...sanitizedEnvironment(), GIT_INDEX_FILE: tempIndex };
    try {
      const head = await this.optionalGit(['rev-parse', '--verify', 'HEAD']);
      if (head) await this.executeGit(['read-tree', head], { env: indexEnv });
      else await this.executeGit(['read-tree', '--empty'], { env: indexEnv });
      await this.executeGit(['add', '-A', '--', '.', ...SENSITIVE_PATHSPECS], { env: indexEnv });
      const tree = (await this.executeGit(['write-tree'], { env: indexEnv })).trim();
      const [indexTree, untrackedOutput, porcelain] = await Promise.all([
        this.executeGit(['write-tree']),
        this.executeGit(['ls-files', '--others', '--exclude-standard', '-z', '--']),
        this.executeGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      ]);
      return Object.freeze({
        tree,
        indexTree: indexTree.trim(),
        untracked: splitNull(untrackedOutput).filter((entry) => !isRestrictedGitPath(entry)),
        sensitiveExcludedCount: new Set(statusPaths(porcelain).filter(isRestrictedGitPath)).size
      });
    } finally {
      await this.fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  }

  async compareSnapshot(snapshot, current) {
    const [changedOutput, indexOutput] = await Promise.all([
      this.executeGit(['diff', '--name-only', '-z', snapshot.tree, current.tree, '--', '.', ...SENSITIVE_PATHSPECS]),
      this.executeGit(['diff', '--name-only', '-z', current.indexTree, snapshot.indexTree, '--', '.', ...SENSITIVE_PATHSPECS])
    ]);
    const changed = splitNull(changedOutput);
    const indexChanges = splitNull(indexOutput);
    const changedSet = new Set(changed);
    return Object.freeze({
      changed,
      untrackedChanged: current.untracked.filter((entry) => changedSet.has(entry)),
      sensitiveExcludedCount: current.sensitiveExcludedCount,
      indexWillChange: indexChanges.length > 0,
      unchanged: changed.length === 0 && indexChanges.length === 0
    });
  }

  async inspectWorktree(snapshot) {
    const current = await this.captureCurrentState();
    const comparison = await this.compareSnapshot(snapshot, current);
    return Object.freeze({
      ...comparison,
      currentIndexTree: current.indexTree
    });
  }

  async listHistory({ limit = HISTORY_LIMIT } = {}) {
    const boundedLimit = Math.min(HISTORY_LIMIT, Math.max(1, Number(limit) || HISTORY_LIMIT));
    if (!this.available) return Object.freeze({ available: false, reason: this.reason, items: [] });
    if (this.pending) return Object.freeze({ available: false, reason: 'checkpoint-busy', items: [] });
    try {
      const output = await this.executeGit([
        'for-each-ref', `--count=${HISTORY_SCAN_LIMIT}`, '--sort=-refname',
        '--format=%(refname)%09%(objectname)', ITEM_REF_PREFIX
      ]);
      const rows = output.split(/\r?\n/).filter(Boolean);
      const snapshots = [];
      let invalidCount = 0;
      for (const row of rows) {
        if (snapshots.length >= boundedLimit) break;
        const [refName, commit] = row.split('\t');
        const id = refName?.startsWith(ITEM_REF_PREFIX) ? refName.slice(ITEM_REF_PREFIX.length) : '';
        if (!isCheckpointId(id)) {
          invalidCount += 1;
          continue;
        }
        try {
          snapshots.push(await this.readCheckpoint(commit, id));
        } catch {
          invalidCount += 1;
        }
      }
      if (snapshots.length === 0) {
        return Object.freeze({ available: true, reason: 'empty', items: [], truncated: false, invalidCount });
      }
      const current = await this.captureCurrentState();
      const items = [];
      for (const snapshot of snapshots) {
        try {
          const comparison = await this.compareSnapshot(snapshot, current);
          items.push(Object.freeze({
            id: snapshot.id,
            source: snapshot.source,
            createdAt: snapshot.createdAt,
            isLatest: snapshot.commit === this.last?.commit,
            available: comparison.changed.length <= MAX_RESTORE_PATHS,
            reason: comparison.changed.length > MAX_RESTORE_PATHS ? 'too-many-paths' : 'ready',
            affectedCount: comparison.changed.length,
            untrackedTrashCount: comparison.untrackedChanged.length,
            sensitiveExcludedCount: comparison.sensitiveExcludedCount,
            indexWillChange: comparison.indexWillChange,
            unchanged: comparison.unchanged
          }));
        } catch {
          items.push(Object.freeze({
            id: snapshot.id,
            source: snapshot.source,
            createdAt: snapshot.createdAt,
            isLatest: snapshot.commit === this.last?.commit,
            available: false,
            reason: 'invalid-checkpoint',
            affectedCount: 0,
            untrackedTrashCount: 0,
            sensitiveExcludedCount: current.sensitiveExcludedCount,
            indexWillChange: false,
            unchanged: false
          }));
        }
      }
      return Object.freeze({
        available: true,
        reason: 'ready',
        items,
        truncated: rows.length > boundedLimit,
        invalidCount
      });
    } catch {
      return Object.freeze({ available: false, reason: 'history-failed', items: [] });
    }
  }

  async previewRestore(target = this.last) {
    if (!this.available || !target?.commit || !target?.tree || !target?.indexTree) {
      return Object.freeze({ available: false, reason: this.reason || 'no-checkpoint' });
    }
    try {
      const worktree = await this.inspectWorktree(target);
      return Object.freeze({
        available: worktree.changed.length <= MAX_RESTORE_PATHS,
        reason: worktree.changed.length > MAX_RESTORE_PATHS ? 'too-many-paths' : 'ready',
        targetId: target.id,
        targetCommit: target.commit,
        targetCreatedAt: target.createdAt,
        affectedCount: worktree.changed.length,
        untrackedTrashCount: worktree.untrackedChanged.length,
        sensitiveExcludedCount: worktree.sensitiveExcludedCount,
        indexWillChange: worktree.indexWillChange,
        unchanged: worktree.unchanged
      });
    } catch {
      return Object.freeze({ available: false, reason: 'restore-preview-failed' });
    }
  }

  async previewCheckpoint(id) {
    const target = await this.resolveCheckpoint(id);
    return target
      ? this.previewRestore(target)
      : Object.freeze({ available: false, reason: 'checkpoint-changed' });
  }

  async applySnapshot(snapshot, { trashItem }) {
    if (!/^[0-9a-f]{40,64}$/i.test(snapshot?.commit || '')
      || !/^[0-9a-f]{40,64}$/i.test(snapshot?.tree || '')
      || !/^[0-9a-f]{40,64}$/i.test(snapshot?.indexTree || '')) {
      throw new Error('Invalid checkpoint objects.');
    }
    await this.executeGit(['cat-file', '-e', `${snapshot.commit}^{commit}`]);
    await this.executeGit(['cat-file', '-e', `${snapshot.tree}^{tree}`]);
    await this.executeGit(['cat-file', '-e', `${snapshot.indexTree}^{tree}`]);
    const worktree = await this.inspectWorktree(snapshot);
    const currentIndexTree = worktree.currentIndexTree;
    const [currentTreePaths, targetTreePaths] = await Promise.all([
      this.executeGit(['ls-tree', '-r', '--name-only', '-z', currentIndexTree]),
      this.executeGit(['ls-tree', '-r', '--name-only', '-z', snapshot.indexTree])
    ]);
    const currentSensitive = splitNull(currentTreePaths).filter(isRestrictedGitPath);
    const targetSensitive = splitNull(targetTreePaths).filter(isRestrictedGitPath);
    const sensitivePaths = [...new Set([...currentSensitive, ...targetSensitive])];
    if (sensitivePaths.length > MAX_RESTORE_PATHS) throw new Error('Too many sensitive index paths.');

    if (worktree.changed.length > MAX_RESTORE_PATHS) throw new Error('Too many restore paths.');
    if (worktree.untrackedChanged.length > 0 && typeof trashItem !== 'function') throw new Error('Trash integration is unavailable.');
    for (const relativePath of worktree.untrackedChanged) {
      const absolutePath = path.resolve(this.repoRoot, relativePath);
      if (!isInside(this.repoRoot, absolutePath) || absolutePath === this.repoRoot) throw new Error('Unsafe restore path.');
      await trashItem(absolutePath);
    }
    await this.executeGit(['restore', `--source=${snapshot.commit}`, '--worktree', '--', '.', ...SENSITIVE_PATHSPECS]);
    if (sensitivePaths.length === 0) {
      await this.executeGit(['read-tree', snapshot.indexTree]);
      return;
    }

    const tempRoot = await this.fsPromises.mkdtemp(path.join(os.tmpdir(), 'dsh-restore-index-'));
    const tempIndex = path.join(tempRoot, 'index');
    const indexEnv = { ...sanitizedEnvironment(), GIT_INDEX_FILE: tempIndex };
    try {
      await this.executeGit(['read-tree', snapshot.indexTree], { env: indexEnv });
      if (currentSensitive.length > 0) {
        await this.executeGit(['restore', `--source=${currentIndexTree}`, '--staged', '--', ...currentSensitive], { env: indexEnv });
      }
      const currentSensitiveSet = new Set(currentSensitive);
      const targetOnly = targetSensitive.filter((entry) => !currentSensitiveSet.has(entry));
      if (targetOnly.length > 0) {
        await this.executeGit(['rm', '--cached', '--ignore-unmatch', '--', ...targetOnly], { env: indexEnv });
      }
      const mergedIndexTree = (await this.executeGit(['write-tree'], { env: indexEnv })).trim();
      await this.executeGit(['read-tree', mergedIndexTree]);
    } finally {
      await this.fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  }

  async restoreCheckpoint({ id = '', expectedCommit = '', trashItem } = {}) {
    const target = id ? await this.resolveCheckpoint(id) : (this.last ? { ...this.last } : null);
    if (!target || (expectedCommit && target.commit !== expectedCommit)) {
      return this.getState({ status: 'error', restored: false, restoreReason: 'checkpoint-changed' });
    }
    const preview = await this.previewRestore(target);
    if (!preview.available) return this.getState({ status: 'error', restored: false, restoreReason: preview.reason });
    if (preview.unchanged) return this.getState({ status: 'ready', restored: false, unchanged: true, preview });

    const safetyResult = await this.create({ source: 'safety' });
    const safety = safetyResult.last ? { ...safetyResult.last } : null;
    if (!safety || safety.commit === target.commit) {
      return this.getState({ status: 'error', restored: false, restoreReason: 'safety-checkpoint-failed' });
    }
    try {
      await this.applySnapshot(target, { trashItem });
      this.last = Object.freeze(safety);
      return this.getState({
        status: 'ready',
        restored: true,
        restoredTo: { id: target.id, createdAt: target.createdAt, commit: target.commit },
        safety: { id: safety.id, createdAt: safety.createdAt, commit: safety.commit },
        preview
      });
    } catch {
      try {
        await this.applySnapshot(safety, { trashItem });
        this.last = Object.freeze(safety);
        return this.getState({ status: 'error', restored: false, rolledBack: true, restoreReason: 'restore-failed' });
      } catch {
        this.last = Object.freeze(safety);
        return this.getState({ status: 'error', restored: false, rolledBack: false, restoreReason: 'restore-and-rollback-failed' });
      }
    }
  }

  async restoreLatest({ trashItem } = {}) {
    return this.restoreCheckpoint({ trashItem });
  }
}

module.exports = {
  GitCheckpointManager,
  HISTORY_LIMIT,
  ITEM_REF_PREFIX,
  LATEST_REF,
  MAX_RESTORE_PATHS,
  SENSITIVE_PATHSPECS,
  isRestrictedGitPath,
  isCheckpointId,
  statusPaths
};
