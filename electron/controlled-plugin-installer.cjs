const { createHash, randomUUID } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');
const { buildHarnessEnvironment } = require('./harness-supervisor.cjs');
const { inspectThirdPartyCompatibility } = require('./plugin-compatibility.cjs');

const execFileAsync = promisify(execFile);
const BUNDLED_PNPM_VERSION = '11.19.0';
const CONTROLLED_REGISTRY = 'https://registry.npmjs.org';
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_PROFILE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_LIFECYCLE_RECORD_BYTES = 48 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const TRACKED_PROFILE_FILES = Object.freeze(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);
const LIFECYCLE_JOURNAL_NAME = 'package.json.dsh-desktop-plugin-transaction.json';
const LAST_KNOWN_GOOD_NAME = 'package.json.dsh-desktop-plugin-last-known-good.json';
const REVIEWED_PLUGIN_VERSIONS = Object.freeze({
  '0.3.0': Object.freeze({
    version: '0.3.0',
    integrity: 'sha512-87SkXJUZxLsct3Jz/nyFYT9+IBr7Pgs6O5DetJpSzw0/y6HX69XnnNJSUHUNx+cZoCDVoBc9s/HcpKmOdiojew=='
  }),
  '0.3.1': Object.freeze({
    version: '0.3.1',
    integrity: 'sha512-N6ZVm/n23E7M1piBbS29pzfzSfz1vCGaTkT30utyUepoPgpyL3ZOfHkeCDC9VbV8lnlzSleeWJEUf65tAf4hig=='
  })
});
const CONTROLLED_PLUGIN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'catppuccin-0.3.1',
    name: '@nonamelego/dsh-catppuccin',
    displayName: 'Catppuccin 主题扩展',
    version: '0.3.1',
    integrity: REVIEWED_PLUGIN_VERSIONS['0.3.1'].integrity,
    reviewedVersions: Object.freeze(['0.3.0', '0.3.1']),
    profiles: Object.freeze(['web'])
  })
]);

class ControlledPluginInstallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ControlledPluginInstallError';
    this.code = code;
  }
}

const hashBuffer = (value) => createHash('sha256').update(value).digest('hex');

const isInsideOrEqual = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const lstatOrNull = async (target) => {
  try { return await fsp.lstat(target); } catch { return null; }
};

const readBoundedFile = async (target, { required = false, maxBytes = MAX_PROFILE_FILE_BYTES } = {}) => {
  const info = await lstatOrNull(target);
  if (!info) {
    if (required) throw new ControlledPluginInstallError('profile-file-missing', 'Profile 必需文件不存在。');
    return null;
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
    throw new ControlledPluginInstallError('profile-file-invalid', 'Profile 文件未通过范围或大小校验。');
  }
  return fsp.readFile(target);
};

const readJsonObject = async (target) => {
  const bytes = await readBoundedFile(target, { required: true, maxBytes: 1_048_576 });
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch {
    throw new ControlledPluginInstallError('manifest-invalid', 'Profile 或插件清单不是有效 JSON。');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ControlledPluginInstallError('manifest-invalid', 'Profile 或插件清单结构无效。');
  }
  return value;
};

const appendBounded = (current, chunk) => {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  return next.length <= MAX_COMMAND_OUTPUT_BYTES ? next : next.subarray(next.length - MAX_COMMAND_OUTPUT_BYTES);
};

const stopProcessTree = async (child) => {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } catch {
      // The process can exit between timeout detection and taskkill.
    }
    return;
  }
  try { child.kill('SIGKILL'); } catch { /* The process already exited. */ }
};

const runBoundedCommand = (command, args, options = {}) => new Promise((resolve) => {
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let settled = false;
  let timedOut = false;
  let timer;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(Object.freeze({
      ...value,
      timedOut,
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8')
    }));
  };
  child.stdout?.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr?.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
  child.once('error', (error) => finish({ code: null, error }));
  child.once('close', (code, signal) => finish({ code, signal, error: null }));
  timer = setTimeout(() => {
    timedOut = true;
    void stopProcessTree(child);
  }, options.timeoutMs || INSTALL_TIMEOUT_MS);
});

const resolveControlledPnpmRuntime = ({ rootDir, resourcesPath, isPackaged }) => {
  if (process.platform !== 'win32') throw new ControlledPluginInstallError('platform-unsupported', '受控插件安装当前只支持 Windows。');
  const packageCandidate = isPackaged
    ? path.join(resourcesPath, 'pnpm', 'package')
    : path.join(rootDir, 'node_modules', 'pnpm');
  const packageDir = !isPackaged && fs.existsSync(packageCandidate)
    ? fs.realpathSync(packageCandidate)
    : packageCandidate;
  const shimDir = isPackaged ? path.join(resourcesPath, 'pnpm') : path.join(rootDir, 'node_modules', '.bin');
  return Object.freeze({
    packageDir: path.resolve(packageDir),
    binPath: path.resolve(packageDir, 'bin', 'pnpm.mjs'),
    shimDir: path.resolve(shimDir),
    shimPath: path.resolve(shimDir, 'pnpm.cmd'),
    emptyConfigPath: path.resolve(isPackaged ? path.join(resourcesPath, 'pnpm', 'empty.npmrc') : path.join(rootDir, 'build', 'pnpm', 'empty.npmrc'))
  });
};

const controlledCatalog = () => CONTROLLED_PLUGIN_CATALOG.map((entry) => Object.freeze({
  id: entry.id,
  name: entry.name,
  displayName: entry.displayName,
  version: entry.version,
  profiles: [...entry.profiles],
  registry: 'registry.npmjs.org',
  scriptsIgnored: true
}));

const buildControlledInstallEnvironment = ({
  baseEnv = process.env,
  harnessHome,
  workspacePath,
  proxyEnvironment = {},
  nodePath,
  pnpmRuntime
}) => {
  const environment = buildHarnessEnvironment({
    baseEnv,
    overrides: proxyEnvironment,
    homeDir: harnessHome,
    workspaceDir: workspacePath
  });
  for (const name of Object.keys(environment)) {
    const normalized = name.toUpperCase();
    if (normalized === 'PATH'
      || normalized === 'COMSPEC'
      || normalized === 'PATHEXT'
      || normalized === 'NODE_OPTIONS'
      || normalized === 'NODE_PATH'
      || normalized === 'NODE_EXTRA_CA_CERTS'
      || normalized === 'NODE_TLS_REJECT_UNAUTHORIZED'
      || normalized.startsWith('NPM_CONFIG_')
      || normalized.startsWith('PNPM_')
      || normalized.startsWith('COREPACK_')) delete environment[name];
  }
  const windowsRoot = baseEnv.SystemRoot || baseEnv.SYSTEMROOT || 'C:\\Windows';
  environment.ComSpec = path.join(windowsRoot, 'System32', 'cmd.exe');
  environment.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  environment.Path = [
    pnpmRuntime.shimDir,
    path.dirname(nodePath),
    path.join(windowsRoot, 'System32'),
    windowsRoot
  ].join(path.delimiter);
  environment.CI = '1';
  environment.COREPACK_ENABLE_DOWNLOAD_PROMPT = '0';
  environment.NPM_CONFIG_REGISTRY = CONTROLLED_REGISTRY;
  environment.NPM_CONFIG_IGNORE_SCRIPTS = 'true';
  environment.NPM_CONFIG_SAVE_EXACT = 'true';
  environment.NPM_CONFIG_USERCONFIG = pnpmRuntime.emptyConfigPath;
  environment.NPM_CONFIG_GLOBALCONFIG = pnpmRuntime.emptyConfigPath;
  environment.NPM_CONFIG_STORE_DIR = path.join(harnessHome, '.pnpm-store');
  environment.NPM_CONFIG_STRICT_SSL = 'true';
  environment.DSH_DESKTOP_BUNDLED_PNPM = BUNDLED_PNPM_VERSION;
  return environment;
};

const snapshotProfileFiles = async (profileDir) => {
  const files = new Map();
  for (const name of TRACKED_PROFILE_FILES) {
    const bytes = await readBoundedFile(path.join(profileDir, name), { required: name === 'package.json' });
    files.set(name, bytes === null ? null : Object.freeze({ bytes, sha256: hashBuffer(bytes) }));
  }
  return files;
};

const replaceFile = async (target, bytes) => {
  const token = `${process.pid}-${randomUUID()}`;
  const temporary = `${target}.${token}.tmp`;
  try {
    await fsp.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    if (hashBuffer(await fsp.readFile(temporary)) !== hashBuffer(bytes)) throw new Error('pending-hash-mismatch');
    await fsp.rename(temporary, target);
  } finally {
    try { await fsp.unlink(temporary); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
};

const restoreProfileFiles = async (profileDir, snapshot) => {
  for (const name of TRACKED_PROFILE_FILES) {
    const target = path.join(profileDir, name);
    const before = snapshot.get(name);
    if (before === null) {
      const current = await lstatOrNull(target);
      if (!current) continue;
      if (!current.isFile() || current.isSymbolicLink()) throw new Error('restore-target-invalid');
      await fsp.unlink(target);
      continue;
    }
    await replaceFile(target, before.bytes);
    if (hashBuffer(await fsp.readFile(target)) !== before.sha256) throw new Error('restore-hash-mismatch');
  }
};

const unlinkIfPresent = async (target) => {
  try { await fsp.unlink(target); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
};

const snapshotDigestMap = (snapshot) => Object.fromEntries(TRACKED_PROFILE_FILES.map((name) => [
  name,
  snapshot.get(name)?.sha256 || null
]));

const snapshotMatches = async (profileDir, expected) => {
  const current = await snapshotProfileFiles(profileDir);
  return TRACKED_PROFILE_FILES.every((name) => (current.get(name)?.sha256 || null) === expected[name]);
};

const serializeSnapshot = (snapshot) => {
  let totalBytes = 0;
  const files = {};
  for (const name of TRACKED_PROFILE_FILES) {
    const entry = snapshot.get(name);
    if (entry === null) {
      files[name] = null;
      continue;
    }
    totalBytes += entry.bytes.length;
    if (totalBytes > MAX_SNAPSHOT_BYTES) throw new ControlledPluginInstallError('snapshot-too-large', 'Profile 事务快照超过安全上限。');
    files[name] = Object.freeze({
      bytes: entry.bytes.length,
      sha256: entry.sha256,
      base64: entry.bytes.toString('base64')
    });
  }
  return Object.freeze({ files: Object.freeze(files), totalBytes });
};

const validSnapshotRecord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0 || value.totalBytes > MAX_SNAPSHOT_BYTES) return false;
  if (!value.files || typeof value.files !== 'object' || Array.isArray(value.files)) return false;
  let totalBytes = 0;
  for (const name of TRACKED_PROFILE_FILES) {
    const entry = value.files[name];
    if (entry === null) continue;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_PROFILE_FILE_BYTES
      || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || typeof entry.base64 !== 'string' || entry.base64.length > Math.ceil(MAX_PROFILE_FILE_BYTES / 3) * 4 + 4) return false;
    const bytes = Buffer.from(entry.base64, 'base64');
    if (bytes.length !== entry.bytes || hashBuffer(bytes) !== entry.sha256 || bytes.toString('base64') !== entry.base64) return false;
    totalBytes += bytes.length;
  }
  return totalBytes === value.totalBytes;
};

const deserializeSnapshot = (value) => {
  if (!validSnapshotRecord(value)) throw new ControlledPluginInstallError('snapshot-invalid', 'Profile 事务快照无效。');
  return new Map(TRACKED_PROFILE_FILES.map((name) => {
    const entry = value.files[name];
    return [name, entry === null ? null : Object.freeze({ bytes: Buffer.from(entry.base64, 'base64'), sha256: entry.sha256 })];
  }));
};

const validLifecycleState = (value) => Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && (value.version === null || Object.hasOwn(REVIEWED_PLUGIN_VERSIONS, value.version))
  && typeof value.enabled === 'boolean'
  && (value.version !== null || value.enabled === false);

const validTransactionId = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

const validCreatedAt = (value) => typeof value === 'string'
  && value.length >= 20
  && value.length <= 32
  && !Number.isNaN(Date.parse(value));

const validLifecycleJournal = (value) => Boolean(value)
  && value.version === 1
  && validTransactionId(value.id)
  && ['prepared', 'running', 'applied', 'committed'].includes(value.phase)
  && ['install', 'upgrade', 'uninstall', 'rollback'].includes(value.action)
  && value.packageName === CONTROLLED_PLUGIN_CATALOG[0].name
  && value.profileName === 'web'
  && validLifecycleState(value.previous)
  && validLifecycleState(value.target)
  && validSnapshotRecord(value.previousSnapshot)
  && (value.targetSnapshot === null || validSnapshotRecord(value.targetSnapshot))
  && (value.appliedSnapshot === null || validSnapshotRecord(value.appliedSnapshot))
  && validCreatedAt(value.createdAt);

const validLastKnownGood = (value) => Boolean(value)
  && value.version === 1
  && validTransactionId(value.transactionId)
  && value.packageName === CONTROLLED_PLUGIN_CATALOG[0].name
  && value.profileName === 'web'
  && validLifecycleState(value.current)
  && validLifecycleState(value.restore)
  && validSnapshotRecord(value.currentSnapshot)
  && validSnapshotRecord(value.restoreSnapshot)
  && validCreatedAt(value.createdAt);

const readLifecycleRecord = async (target, validator) => {
  const bytes = await readBoundedFile(target, { maxBytes: MAX_LIFECYCLE_RECORD_BYTES });
  if (bytes === null) return null;
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    return validator(value) ? value : null;
  } catch {
    return null;
  }
};

const readLifecycleRecordWithBackup = async (target, validator) => (
  await readLifecycleRecord(target, validator) || await readLifecycleRecord(`${target}.bak`, validator)
);

const lifecycleRecordExists = async (target) => Boolean(await lstatOrNull(target) || await lstatOrNull(`${target}.bak`));

const writeLifecycleRecord = async (target, value, validator) => {
  const store = new AtomicJsonFile({ filePath: target, validator });
  await store.write(value);
  const written = await readLifecycleRecord(target, validator);
  if (!written || (Object.hasOwn(value, 'id') && written.id !== value.id)) throw new Error('lifecycle-record-write-failed');
};

const createLifecycleRecord = async (target, value, validator) => {
  if (!validator(value)) throw new TypeError('Lifecycle record must pass validation.');
  const text = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  let created = false;
  try {
    handle = await fsp.open(target, 'wx', 0o600);
    created = true;
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } catch (error) {
    if (created) error.lifecycleRecordCreated = true;
    throw error;
  } finally {
    await handle?.close();
  }
  const written = await readLifecycleRecord(target, validator);
  if (!written || written.id !== value.id) {
    const error = new Error('lifecycle-record-create-failed');
    error.lifecycleRecordCreated = true;
    throw error;
  }
};

const normalizedManifestWithoutPlugin = (manifest, packageName) => {
  const clone = JSON.parse(JSON.stringify(manifest));
  if (clone.dependencies && typeof clone.dependencies === 'object') {
    delete clone.dependencies[packageName];
    if (Object.keys(clone.dependencies).length === 0) delete clone.dependencies;
  }
  if (Array.isArray(clone.dsh?.profile?.bundles)) clone.dsh.profile.bundles = clone.dsh.profile.bundles.filter((name) => name !== packageName);
  return JSON.stringify(clone);
};

class ControlledPluginInstaller {
  constructor({
    profilesRoot,
    harnessHome,
    nodePath,
    dshBinPath,
    runtimeModulesDir,
    pnpmRuntime,
    baseEnv = process.env,
    runCommand = runBoundedCommand
  }) {
    this.profilesRoot = path.resolve(profilesRoot);
    this.harnessHome = path.resolve(harnessHome);
    this.nodePath = path.resolve(nodePath);
    this.dshBinPath = path.resolve(dshBinPath);
    this.runtimeModulesDir = path.resolve(runtimeModulesDir);
    this.pnpmRuntime = pnpmRuntime;
    this.baseEnv = baseEnv;
    this.runCommand = runCommand;
    this.transactions = new Map();
    this.activeProfiles = new Set();
    this.runtimeStatus = Object.freeze({ status: 'unavailable', version: '', registry: 'registry.npmjs.org' });
  }

  getRuntimeStatus() {
    return { ...this.runtimeStatus };
  }

  async inspectRuntime() {
    try {
      for (const target of [this.nodePath, this.dshBinPath, this.pnpmRuntime.binPath, this.pnpmRuntime.shimPath, this.pnpmRuntime.emptyConfigPath]) {
        const info = await lstatOrNull(target);
        if (!info?.isFile() || info.isSymbolicLink()) throw new Error('runtime-file-invalid');
      }
      const packageInfo = await lstatOrNull(this.pnpmRuntime.packageDir);
      if (!packageInfo?.isDirectory() || packageInfo.isSymbolicLink()) throw new Error('runtime-package-invalid');
      const manifest = await readJsonObject(path.join(this.pnpmRuntime.packageDir, 'package.json'));
      if (manifest.name !== 'pnpm' || manifest.version !== BUNDLED_PNPM_VERSION) throw new Error('runtime-version-invalid');
      const environment = buildControlledInstallEnvironment({
        baseEnv: this.baseEnv,
        harnessHome: this.harnessHome,
        workspacePath: this.harnessHome,
        nodePath: this.nodePath,
        pnpmRuntime: this.pnpmRuntime
      });
      const result = await this.runCommand(this.nodePath, [this.pnpmRuntime.binPath, '--version'], {
        cwd: this.harnessHome,
        env: environment,
        timeoutMs: 15_000
      });
      if (result.error || result.timedOut || result.code !== 0 || result.stdout.trim() !== BUNDLED_PNPM_VERSION) throw new Error('runtime-probe-failed');
      this.runtimeStatus = Object.freeze({ status: 'ready', version: BUNDLED_PNPM_VERSION, registry: 'registry.npmjs.org' });
    } catch {
      this.runtimeStatus = Object.freeze({ status: 'unavailable', version: '', registry: 'registry.npmjs.org' });
    }
    return this.getRuntimeStatus();
  }

  _catalogEntry(id) {
    return CONTROLLED_PLUGIN_CATALOG.find((entry) => entry.id === id) || null;
  }

  async _profileDirectory(profileDir, plugin) {
    const target = path.resolve(profileDir);
    if (!isInsideOrEqual(this.profilesRoot, target) || path.dirname(target) !== this.profilesRoot || !plugin.profiles.includes(path.basename(target))) {
      throw new ControlledPluginInstallError('profile-not-allowed', '该扩展不能安装到此 Profile。');
    }
    const info = await lstatOrNull(target);
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new ControlledPluginInstallError('profile-unavailable', 'Profile 目录不可用。');
    return target;
  }

  _environment({ workspacePath, proxyEnvironment }) {
    return buildControlledInstallEnvironment({
      baseEnv: this.baseEnv,
      harnessHome: this.harnessHome,
      workspacePath,
      proxyEnvironment,
      nodePath: this.nodePath,
      pnpmRuntime: this.pnpmRuntime
    });
  }

  async _runPluginCommand({ profileName, plugin, action, workspacePath, proxyEnvironment }) {
    const args = [
      this.dshBinPath,
      'plugin',
      '--profile', profileName,
      action,
      ...(action === 'add'
        ? [`${plugin.name}@${plugin.version}`, '--save-exact', '--ignore-scripts', `--registry=${CONTROLLED_REGISTRY}`]
        : [plugin.name])
    ];
    return this.runCommand(this.nodePath, args, {
      cwd: workspacePath,
      env: this._environment({ workspacePath, proxyEnvironment }),
      timeoutMs: INSTALL_TIMEOUT_MS
    });
  }

  async _pruneProfile({ profileDir, workspacePath, proxyEnvironment }) {
    return this.runCommand(this.nodePath, [this.pnpmRuntime.binPath, 'prune'], {
      cwd: profileDir,
      env: this._environment({ workspacePath, proxyEnvironment }),
      timeoutMs: INSTALL_TIMEOUT_MS
    });
  }

  async _verifyInstalled(profileDir, plugin, { enabled = true } = {}) {
    const manifest = await readJsonObject(path.join(profileDir, 'package.json'));
    const bundleEnabled = Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(plugin.name);
    if (manifest.dependencies?.[plugin.name] !== plugin.version || bundleEnabled !== enabled) {
      throw new ControlledPluginInstallError('install-not-pinned', '安装结果没有保留固定版本或扩展层声明。');
    }
    const packageLink = path.join(profileDir, 'node_modules', ...plugin.name.split('/'));
    const linkInfo = await lstatOrNull(packageLink);
    const realPackage = linkInfo ? await fsp.realpath(packageLink).catch(() => null) : null;
    const profileModules = path.join(profileDir, 'node_modules');
    if (!linkInfo || !realPackage || !isInsideOrEqual(profileModules, realPackage)) {
      throw new ControlledPluginInstallError('install-path-invalid', '安装包没有解析到 Profile 的受控依赖目录。');
    }
    const installedManifest = await readJsonObject(path.join(realPackage, 'package.json'));
    if (installedManifest.name !== plugin.name || installedManifest.version !== plugin.version) {
      throw new ControlledPluginInstallError('install-version-mismatch', '安装目录中的扩展版本不一致。');
    }
    const lockfile = await readBoundedFile(path.join(profileDir, 'pnpm-lock.yaml'), { required: true });
    if (!lockfile.toString('utf8').includes(plugin.integrity)) {
      throw new ControlledPluginInstallError('install-integrity-missing', 'pnpm 锁文件缺少已审核的完整性摘要。');
    }
    const compatibility = await inspectThirdPartyCompatibility({
      packageDir: realPackage,
      profileDir,
      runtimeModulesDir: this.runtimeModulesDir,
      dependencySpec: plugin.version
    });
    if (compatibility.status !== 'verified') {
      throw new ControlledPluginInstallError('install-compatibility-blocked', '安装后的扩展未通过兼容健康检查。');
    }
    return Object.freeze({ name: plugin.name, version: plugin.version, compatibility: compatibility.status });
  }

  _pluginAtVersion(plugin, version) {
    const reviewed = REVIEWED_PLUGIN_VERSIONS[version];
    if (!reviewed || !plugin.reviewedVersions.includes(version)) {
      throw new ControlledPluginInstallError('version-not-reviewed', '插件版本不在已审核生命周期中。');
    }
    return Object.freeze({ ...plugin, version, integrity: reviewed.integrity });
  }

  _journalPath(profileDir) {
    return path.join(profileDir, LIFECYCLE_JOURNAL_NAME);
  }

  _lastKnownGoodPath(profileDir) {
    return path.join(profileDir, LAST_KNOWN_GOOD_NAME);
  }

  async _cleanupRecord(target) {
    await unlinkIfPresent(target);
    await unlinkIfPresent(`${target}.bak`);
  }

  async _readState(profileDir, plugin) {
    const manifest = await readJsonObject(path.join(profileDir, 'package.json'));
    if ((manifest.dependencies !== undefined && (typeof manifest.dependencies !== 'object' || manifest.dependencies === null || Array.isArray(manifest.dependencies)))
      || !Array.isArray(manifest.dsh?.profile?.bundles)) {
      throw new ControlledPluginInstallError('profile-invalid', 'Profile 扩展层或依赖清单无效。');
    }
    const dependencies = manifest.dependencies || {};
    const spec = Object.hasOwn(dependencies, plugin.name) ? dependencies[plugin.name] : null;
    const packageLink = path.join(profileDir, 'node_modules', ...plugin.name.split('/'));
    const linkInfo = await lstatOrNull(packageLink);
    if (spec === null) {
      if (linkInfo) throw new ControlledPluginInstallError('plugin-residue', 'Profile 中存在未声明的插件残留目录。');
      return Object.freeze({ version: null, enabled: false });
    }
    if (typeof spec !== 'string' || !Object.hasOwn(REVIEWED_PLUGIN_VERSIONS, spec) || !plugin.reviewedVersions.includes(spec)) {
      throw new ControlledPluginInstallError('version-not-reviewed', '当前插件版本不在已审核生命周期中。');
    }
    if (!linkInfo) throw new ControlledPluginInstallError('plugin-missing', 'Profile 声明了插件，但安装目录缺失。');
    const realPackage = await fsp.realpath(packageLink).catch(() => null);
    if (!realPackage || !isInsideOrEqual(path.join(profileDir, 'node_modules'), realPackage)) {
      throw new ControlledPluginInstallError('install-path-invalid', '插件目录超出 Profile 的受控依赖边界。');
    }
    const installed = await readJsonObject(path.join(realPackage, 'package.json'));
    if (installed.name !== plugin.name || installed.version !== spec) {
      throw new ControlledPluginInstallError('install-version-mismatch', 'Profile 声明与插件目录版本不一致。');
    }
    return Object.freeze({ version: spec, enabled: manifest.dsh.profile.bundles.includes(plugin.name) });
  }

  async _stateMatches(profileDir, plugin, expected) {
    try {
      const current = await this._readState(profileDir, plugin);
      return current.version === expected.version && current.enabled === expected.enabled;
    } catch {
      return false;
    }
  }

  async _setEnabled(profileDir, plugin, enabled) {
    const manifestPath = path.join(profileDir, 'package.json');
    const manifest = await readJsonObject(manifestPath);
    if (!Array.isArray(manifest.dsh?.profile?.bundles) || manifest.dependencies?.[plugin.name] !== plugin.version) {
      throw new Error('plugin-enable-state-invalid');
    }
    const currentlyEnabled = manifest.dsh.profile.bundles.includes(plugin.name);
    if (currentlyEnabled === enabled) return;
    manifest.dsh.profile.bundles = enabled
      ? [...manifest.dsh.profile.bundles, plugin.name]
      : manifest.dsh.profile.bundles.filter((name) => name !== plugin.name);
    await replaceFile(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  }

  async _removeCurrent({ profileDir, profileName, plugin, workspacePath, proxyEnvironment }) {
    const packageLink = path.join(profileDir, 'node_modules', ...plugin.name.split('/'));
    const manifest = await readJsonObject(path.join(profileDir, 'package.json')).catch(() => ({}));
    if (manifest.dependencies?.[plugin.name] || await lstatOrNull(packageLink)) {
      const removal = await this._runPluginCommand({ profileName, plugin, action: 'remove', workspacePath, proxyEnvironment });
      if (removal.error || removal.timedOut || removal.code !== 0) throw new Error('plugin-remove-failed');
    }
    const prune = await this._pruneProfile({ profileDir, workspacePath, proxyEnvironment });
    if (prune.error || prune.timedOut || prune.code !== 0) throw new Error('plugin-prune-failed');
  }

  async _applyTarget({ profileDir, profileName, plugin, current, target, targetSnapshot = null, workspacePath, proxyEnvironment }) {
    if (target.version === null) {
      await this._removeCurrent({ profileDir, profileName, plugin, workspacePath, proxyEnvironment });
      if (targetSnapshot) await restoreProfileFiles(profileDir, targetSnapshot);
      let observed;
      try { observed = await this._readState(profileDir, plugin); } catch (error) {
        throw new Error(`plugin-uninstall-verification-failed:${error.code || error.message}`);
      }
      if (observed.version !== target.version || observed.enabled !== target.enabled) {
        throw new Error(`plugin-uninstall-verification-failed:${observed.version || 'absent'}:${observed.enabled ? 'enabled' : 'disabled'}`);
      }
      return Object.freeze({ name: plugin.name, version: '', compatibility: 'absent', enabled: false });
    }

    const targetPlugin = this._pluginAtVersion(plugin, target.version);
    if (current.version !== target.version) {
      const result = await this._runPluginCommand({ profileName, plugin: targetPlugin, action: 'add', workspacePath, proxyEnvironment });
      if (result.error || result.timedOut || result.code !== 0) {
        throw new ControlledPluginInstallError(result.timedOut ? 'install-timeout' : 'install-command-failed', result.timedOut ? '插件生命周期命令超时。' : '固定插件生命周期命令失败。');
      }
    }
    await this._setEnabled(profileDir, targetPlugin, target.enabled);
    if (targetSnapshot) await restoreProfileFiles(profileDir, targetSnapshot);
    const installed = await this._verifyInstalled(profileDir, targetPlugin, { enabled: target.enabled });
    return Object.freeze({ ...installed, enabled: target.enabled });
  }

  async _restorePrevious(context) {
    if (await snapshotMatches(context.directory, snapshotDigestMap(context.previousSnapshot))
      && await this._stateMatches(context.directory, context.plugin, context.previous)) return;
    if (context.previous.version !== null) {
      await this._removeCurrent({
        profileDir: context.directory,
        profileName: context.profileName,
        plugin: context.plugin,
        workspacePath: context.workspacePath,
        proxyEnvironment: context.proxyEnvironment
      });
    }
    await this._applyTarget({
      profileDir: context.directory,
      profileName: context.profileName,
      plugin: context.plugin,
      current: context.previous.version === null ? context.target : { version: null, enabled: false },
      target: context.previous,
      targetSnapshot: context.previousSnapshot,
      workspacePath: context.workspacePath,
      proxyEnvironment: context.proxyEnvironment
    });
    if (!await snapshotMatches(context.directory, snapshotDigestMap(context.previousSnapshot))
      || !await this._stateMatches(context.directory, context.plugin, context.previous)) throw new Error('plugin-restore-verification-failed');
  }

  async inspectLifecycle({ profileDir, catalogId }) {
    const plugin = this._catalogEntry(catalogId);
    if (!plugin) return Object.freeze({ status: 'blocked', reason: 'catalog-not-allowed' });
    let directory;
    try { directory = await this._profileDirectory(profileDir, plugin); } catch { return Object.freeze({ status: 'blocked', reason: 'profile-not-allowed' }); }
    const journalPath = this._journalPath(directory);
    if (await lifecycleRecordExists(journalPath)) {
      const journal = await readLifecycleRecordWithBackup(journalPath, validLifecycleJournal);
      return Object.freeze({ status: 'blocked', reason: journal ? 'recovery-pending' : 'journal-invalid' });
    }
    let current;
    try { current = await this._readState(directory, plugin); } catch (error) {
      return Object.freeze({ status: 'blocked', reason: error.code || 'profile-invalid' });
    }
    let canRollback = false;
    const lkgPath = this._lastKnownGoodPath(directory);
    if (await lifecycleRecordExists(lkgPath)) {
      const lkg = await readLifecycleRecordWithBackup(lkgPath, validLastKnownGood);
      canRollback = Boolean(lkg)
        && lkg.packageName === plugin.name
        && lkg.current.version === current.version
        && lkg.current.enabled === current.enabled
        && await snapshotMatches(directory, snapshotDigestMap(deserializeSnapshot(lkg.currentSnapshot)));
    }
    return Object.freeze({
      status: this.activeProfiles.has(directory) ? 'busy' : 'ready',
      installedVersion: current.version || '',
      enabled: current.enabled,
      canInstall: current.version === null,
      canUpgrade: current.version !== null && current.version !== plugin.version,
      canUninstall: current.version !== null,
      canRollback
    });
  }

  async _mutate({ profileDir, catalogId, action, workspacePath, proxyEnvironment = {} }) {
    const plugin = this._catalogEntry(catalogId);
    if (!plugin) throw new ControlledPluginInstallError('catalog-not-allowed', '扩展不在已验证安装目录中。');
    const directory = await this._profileDirectory(profileDir, plugin);
    if (this.activeProfiles.has(directory)) throw new ControlledPluginInstallError('profile-busy', '此 Profile 已有插件任务正在处理。');
    const journalPath = this._journalPath(directory);
    if (await lifecycleRecordExists(journalPath)) throw new ControlledPluginInstallError('recovery-pending', '此 Profile 存在待恢复的插件事务。');
    if ((await this.inspectRuntime()).status !== 'ready') throw new ControlledPluginInstallError('pnpm-unavailable', '软件随附 pnpm 未通过版本或文件校验。');
    const previous = await this._readState(directory, plugin);
    let target;
    let targetSnapshot = null;
    if (action === 'install') {
      if (previous.version !== null) throw new ControlledPluginInstallError('already-installed', '该扩展已经安装。');
      target = Object.freeze({ version: plugin.version, enabled: true });
    } else if (action === 'upgrade') {
      if (previous.version === null || previous.version === plugin.version) throw new ControlledPluginInstallError('upgrade-not-available', '当前没有可用的已审核升级。');
      target = Object.freeze({ version: plugin.version, enabled: previous.enabled });
    } else if (action === 'uninstall') {
      if (previous.version === null) throw new ControlledPluginInstallError('not-installed', '该扩展尚未安装。');
      target = Object.freeze({ version: null, enabled: false });
    } else if (action === 'rollback') {
      const lkg = await readLifecycleRecordWithBackup(this._lastKnownGoodPath(directory), validLastKnownGood);
      const currentSnapshot = lkg ? deserializeSnapshot(lkg.currentSnapshot) : null;
      if (!lkg || lkg.packageName !== plugin.name || lkg.current.version !== previous.version || lkg.current.enabled !== previous.enabled
        || !await snapshotMatches(directory, snapshotDigestMap(currentSnapshot))) {
        throw new ControlledPluginInstallError('rollback-not-available', '最近可用版本已变化，不能安全回退。');
      }
      target = Object.freeze({ ...lkg.restore });
      targetSnapshot = deserializeSnapshot(lkg.restoreSnapshot);
    } else {
      throw new ControlledPluginInstallError('action-not-allowed', '插件生命周期操作不受支持。');
    }

    const previousSnapshot = await snapshotProfileFiles(directory);
    const profileName = path.basename(directory);
    const id = randomUUID();
    let journal = Object.freeze({
      version: 1,
      id,
      phase: 'prepared',
      action,
      packageName: plugin.name,
      profileName,
      previous,
      target,
      previousSnapshot: serializeSnapshot(previousSnapshot),
      targetSnapshot: targetSnapshot ? serializeSnapshot(targetSnapshot) : null,
      appliedSnapshot: null,
      createdAt: new Date().toISOString()
    });
    const context = { id, directory, profileName, plugin, previous, target, previousSnapshot, targetSnapshot, workspacePath, proxyEnvironment, journalPath };
    this.activeProfiles.add(directory);
    try {
      await createLifecycleRecord(journalPath, journal, validLifecycleJournal);
      const claimedStateMatches = await this._stateMatches(directory, plugin, previous);
      const claimedFilesMatch = await snapshotMatches(directory, snapshotDigestMap(previousSnapshot));
      if (!claimedStateMatches || !claimedFilesMatch) {
        const error = new ControlledPluginInstallError('profile-changed-after-claim', 'Profile 在事务占用前已变化，请刷新后重试。');
        error.skipLifecycleRollback = true;
        throw error;
      }
      journal = Object.freeze({ ...journal, phase: 'running' });
      await writeLifecycleRecord(journalPath, journal, validLifecycleJournal);
      const current = await this._readState(directory, plugin);
      const changed = await this._applyTarget({ profileDir: directory, profileName, plugin, current, target, targetSnapshot, workspacePath, proxyEnvironment });
      const appliedSnapshot = await snapshotProfileFiles(directory);
      journal = Object.freeze({ ...journal, phase: 'applied', appliedSnapshot: serializeSnapshot(appliedSnapshot) });
      await writeLifecycleRecord(journalPath, journal, validLifecycleJournal);
      context.appliedSnapshot = appliedSnapshot;
      context.journal = journal;
      this.transactions.set(id, context);
      return Object.freeze({
        changed: true,
        id,
        action,
        plugin: changed,
        previous: { ...previous },
        target: { ...target },
        pnpmVersion: BUNDLED_PNPM_VERSION,
        scriptsIgnored: true
      });
    } catch (error) {
      if (error?.code === 'EEXIST' && !error.lifecycleRecordCreated) {
        this.activeProfiles.delete(directory);
        throw new ControlledPluginInstallError('recovery-pending', '此 Profile 已被另一个持久插件事务占用。');
      }
      if (error?.skipLifecycleRollback) {
        await this._cleanupRecord(journalPath);
        this.activeProfiles.delete(directory);
        throw error;
      }
      try {
        await this._restorePrevious(context);
        await this._cleanupRecord(journalPath);
        this.activeProfiles.delete(directory);
      } catch {
        throw new ControlledPluginInstallError('install-rollback-failed', '插件生命周期操作失败，且未能确认 Profile 已恢复；下次启动将继续恢复。');
      }
      throw error;
    }
  }

  install(options) {
    return this._mutate({ ...options, action: 'install' });
  }

  upgrade(options) {
    return this._mutate({ ...options, action: 'upgrade' });
  }

  uninstall(options) {
    return this._mutate({ ...options, action: 'uninstall' });
  }

  rollbackLastKnownGood(options) {
    return this._mutate({ ...options, action: 'rollback' });
  }

  async commit(id) {
    const context = this.transactions.get(id);
    if (!context) throw new ControlledPluginInstallError('transaction-missing', '插件生命周期事务不存在。');
    if (!await this._stateMatches(context.directory, context.plugin, context.target)) throw new Error('plugin-commit-state-mismatch');
    const currentSnapshot = await snapshotProfileFiles(context.directory);
    if (!await snapshotMatches(context.directory, snapshotDigestMap(context.appliedSnapshot))) throw new Error('plugin-commit-files-changed');
    const lkg = Object.freeze({
      version: 1,
      transactionId: id,
      packageName: context.plugin.name,
      profileName: context.profileName,
      current: context.target,
      restore: context.previous,
      currentSnapshot: serializeSnapshot(currentSnapshot),
      restoreSnapshot: serializeSnapshot(context.previousSnapshot),
      createdAt: new Date().toISOString()
    });
    await writeLifecycleRecord(this._lastKnownGoodPath(context.directory), lkg, validLastKnownGood);
    const committedJournal = Object.freeze({ ...context.journal, phase: 'committed' });
    await writeLifecycleRecord(context.journalPath, committedJournal, validLifecycleJournal);
    await this._cleanupRecord(context.journalPath);
    this.transactions.delete(id);
    this.activeProfiles.delete(context.directory);
    return Object.freeze({ ok: true });
  }

  async rollback(id) {
    const context = this.transactions.get(id);
    if (!context) throw new ControlledPluginInstallError('transaction-missing', '插件生命周期事务不存在。');
    await this._restorePrevious(context);
    await this._cleanupRecord(context.journalPath);
    this.transactions.delete(id);
    this.activeProfiles.delete(context.directory);
    return Object.freeze({ ok: true });
  }

  async recoverPending({ workspacePath, proxyEnvironment = {} } = {}) {
    let entries = [];
    try { entries = await fsp.readdir(this.profilesRoot, { withFileTypes: true }); } catch { return Object.freeze([]); }
    const outcomes = [];
    for (const entry of entries.filter((item) => item.isDirectory() && !item.isSymbolicLink() && item.name !== 'node_modules').slice(0, 16)) {
      const directory = path.join(this.profilesRoot, entry.name);
      const journalPath = this._journalPath(directory);
      if (!await lifecycleRecordExists(journalPath)) continue;
      const journal = await readLifecycleRecordWithBackup(journalPath, validLifecycleJournal);
      const plugin = CONTROLLED_PLUGIN_CATALOG.find((item) => item.name === journal?.packageName && item.profiles.includes(entry.name));
      if (!journal || !plugin) {
        this.activeProfiles.add(directory);
        outcomes.push(Object.freeze({ profile: entry.name, kind: 'plugin-lifecycle', status: 'failed' }));
        continue;
      }
      const previousSnapshot = deserializeSnapshot(journal.previousSnapshot);
      const previousMatches = await snapshotMatches(directory, snapshotDigestMap(previousSnapshot))
        && await this._stateMatches(directory, plugin, journal.previous);
      if (previousMatches) {
        await this._cleanupRecord(journalPath);
        outcomes.push(Object.freeze({ profile: entry.name, kind: 'plugin-lifecycle', status: 'cleaned' }));
        continue;
      }
      const appliedSnapshot = journal.appliedSnapshot ? deserializeSnapshot(journal.appliedSnapshot) : null;
      const lkg = await readLifecycleRecordWithBackup(this._lastKnownGoodPath(directory), validLastKnownGood);
      const committed = Boolean(lkg)
        && lkg.transactionId === journal.id
        && appliedSnapshot
        && await snapshotMatches(directory, snapshotDigestMap(appliedSnapshot))
        && await this._stateMatches(directory, plugin, journal.target);
      if (committed) {
        await this._cleanupRecord(journalPath);
        outcomes.push(Object.freeze({ profile: entry.name, kind: 'plugin-lifecycle', status: 'committed' }));
        continue;
      }
      let ownedMutation = Boolean(appliedSnapshot) && await snapshotMatches(directory, snapshotDigestMap(appliedSnapshot));
      if (!ownedMutation && journal.phase === 'running') {
        try {
          const currentManifest = await readJsonObject(path.join(directory, 'package.json'));
          const previousManifestEntry = previousSnapshot.get('package.json');
          const previousManifest = previousManifestEntry ? JSON.parse(previousManifestEntry.bytes.toString('utf8')) : null;
          const currentState = await this._readState(directory, plugin);
          ownedMutation = Boolean(previousManifest)
            && [journal.previous.version, journal.target.version].includes(currentState.version)
            && normalizedManifestWithoutPlugin(currentManifest, plugin.name) === normalizedManifestWithoutPlugin(previousManifest, plugin.name);
        } catch {
          ownedMutation = false;
        }
      }
      if (!ownedMutation) {
        this.activeProfiles.add(directory);
        outcomes.push(Object.freeze({ profile: entry.name, kind: 'plugin-lifecycle', status: 'conflict' }));
        continue;
      }
      const context = {
        directory,
        profileName: entry.name,
        plugin,
        previous: journal.previous,
        target: journal.target,
        previousSnapshot,
        workspacePath,
        proxyEnvironment
      };
      try {
        await this._restorePrevious(context);
        await this._cleanupRecord(journalPath);
        outcomes.push(Object.freeze({ profile: entry.name, kind: 'plugin-lifecycle', status: 'rolled-back' }));
      } catch {
        this.activeProfiles.add(directory);
        outcomes.push(Object.freeze({ profile: entry.name, kind: 'plugin-lifecycle', status: 'failed' }));
      }
    }
    return Object.freeze(outcomes);
  }
}

module.exports = {
  BUNDLED_PNPM_VERSION,
  CONTROLLED_PLUGIN_CATALOG,
  CONTROLLED_REGISTRY,
  LAST_KNOWN_GOOD_NAME,
  LIFECYCLE_JOURNAL_NAME,
  REVIEWED_PLUGIN_VERSIONS,
  ControlledPluginInstallError,
  ControlledPluginInstaller,
  buildControlledInstallEnvironment,
  controlledCatalog,
  deserializeSnapshot,
  resolveControlledPnpmRuntime,
  runBoundedCommand,
  serializeSnapshot,
  validLastKnownGood,
  validLifecycleJournal
};
