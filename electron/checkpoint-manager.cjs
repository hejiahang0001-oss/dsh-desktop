const { execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const LATEST_REF = 'refs/dsh/checkpoints/latest';
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

const parseTrailer = (body, name) => {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(body || '');
  return match?.[1]?.trim() || '';
};

const checkpointId = (now, random = randomBytes) => (
  `${now.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z')}-${random(4).toString('hex')}`
);

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

  async readLatest() {
    const commit = await this.optionalGit(['rev-parse', '--verify', LATEST_REF]);
    if (!commit) return null;
    const [body, tree, createdAt] = await Promise.all([
      this.executeGit(['show', '-s', '--format=%B', commit]),
      this.executeGit(['rev-parse', `${commit}^{tree}`]),
      this.executeGit(['show', '-s', '--format=%cI', commit])
    ]);
    return Object.freeze({
      id: parseTrailer(body, 'DSH-Checkpoint-ID'),
      commit,
      tree: tree.trim(),
      indexTree: parseTrailer(body, 'DSH-Index-Tree'),
      source: parseTrailer(body, 'DSH-Checkpoint-Source') || 'unknown',
      createdAt: createdAt.trim(),
      sensitiveExcludedCount: Number(parseTrailer(body, 'DSH-Sensitive-Excluded')) || 0
    });
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
    this.pending = this.createInternal({ source: source === 'automatic' ? 'automatic' : 'manual' });
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
      const itemRef = `refs/dsh/checkpoints/items/${id}`;
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
}

module.exports = {
  GitCheckpointManager,
  LATEST_REF,
  SENSITIVE_PATHSPECS,
  isRestrictedGitPath,
  statusPaths
};
