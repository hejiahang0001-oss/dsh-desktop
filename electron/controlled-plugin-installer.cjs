const { createHash, randomUUID } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { buildHarnessEnvironment } = require('./harness-supervisor.cjs');
const { inspectThirdPartyCompatibility } = require('./plugin-compatibility.cjs');

const execFileAsync = promisify(execFile);
const BUNDLED_PNPM_VERSION = '11.19.0';
const CONTROLLED_REGISTRY = 'https://registry.npmjs.org';
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_PROFILE_FILE_BYTES = 8 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const TRACKED_PROFILE_FILES = Object.freeze(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);
const CONTROLLED_PLUGIN_CATALOG = Object.freeze([
  Object.freeze({
    id: 'catppuccin-0.3.1',
    name: '@nonamelego/dsh-catppuccin',
    displayName: 'Catppuccin 主题扩展',
    version: '0.3.1',
    integrity: 'sha512-N6ZVm/n23E7M1piBbS29pzfzSfz1vCGaTkT30utyUepoPgpyL3ZOfHkeCDC9VbV8lnlzSleeWJEUf65tAf4hig==',
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

  async _verifyInstalled(profileDir, plugin) {
    const manifest = await readJsonObject(path.join(profileDir, 'package.json'));
    if (manifest.dependencies?.[plugin.name] !== plugin.version || !manifest.dsh?.profile?.bundles?.includes(plugin.name)) {
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

  async _restore({ profileDir, profileName, plugin, snapshot, workspacePath, proxyEnvironment }) {
    const packageLink = path.join(profileDir, 'node_modules', ...plugin.name.split('/'));
    const manifest = await readJsonObject(path.join(profileDir, 'package.json')).catch(() => ({}));
    if (manifest.dependencies?.[plugin.name] || await lstatOrNull(packageLink)) {
      const removal = await this._runPluginCommand({ profileName, plugin, action: 'remove', workspacePath, proxyEnvironment });
      if (removal.error || removal.timedOut || removal.code !== 0) throw new Error('plugin-remove-failed');
    }
    const prune = await this._pruneProfile({ profileDir, workspacePath, proxyEnvironment });
    if (prune.error || prune.timedOut || prune.code !== 0) throw new Error('plugin-prune-failed');
    await restoreProfileFiles(profileDir, snapshot);
    if (await lstatOrNull(packageLink)) throw new Error('plugin-link-remains');
  }

  async install({ profileDir, catalogId, workspacePath, proxyEnvironment = {} }) {
    const plugin = this._catalogEntry(catalogId);
    if (!plugin) throw new ControlledPluginInstallError('catalog-not-allowed', '扩展不在已验证安装目录中。');
    const directory = await this._profileDirectory(profileDir, plugin);
    if (this.activeProfiles.has(directory)) throw new ControlledPluginInstallError('profile-busy', '此 Profile 已有插件任务正在处理。');
    if ((await this.inspectRuntime()).status !== 'ready') throw new ControlledPluginInstallError('pnpm-unavailable', '软件随附 pnpm 未通过版本或文件校验。');
    const manifest = await readJsonObject(path.join(directory, 'package.json'));
    if (Object.hasOwn(manifest.dependencies || {}, plugin.name)) throw new ControlledPluginInstallError('already-installed', '该扩展已经安装；升级将在 V0.5.15 提供。');
    if (!Array.isArray(manifest.dsh?.profile?.bundles)) throw new ControlledPluginInstallError('profile-invalid', 'Profile 扩展层清单无效。');
    const snapshot = await snapshotProfileFiles(directory);
    const profileName = path.basename(directory);
    this.activeProfiles.add(directory);
    try {
      const result = await this._runPluginCommand({ profileName, plugin, action: 'add', workspacePath, proxyEnvironment });
      if (result.error || result.timedOut || result.code !== 0) {
        throw new ControlledPluginInstallError(result.timedOut ? 'install-timeout' : 'install-command-failed', result.timedOut ? '插件安装超时。' : '固定插件安装命令失败。');
      }
      const installed = await this._verifyInstalled(directory, plugin);
      const id = randomUUID();
      this.transactions.set(id, { directory, profileName, plugin, snapshot, workspacePath, proxyEnvironment });
      return Object.freeze({ changed: true, id, plugin: installed, pnpmVersion: BUNDLED_PNPM_VERSION, scriptsIgnored: true });
    } catch (error) {
      try {
        await this._restore({ profileDir: directory, profileName, plugin, snapshot, workspacePath, proxyEnvironment });
      } catch {
        // Keep the Profile blocked for this process when rollback cannot be verified.
        throw new ControlledPluginInstallError('install-rollback-failed', '插件安装失败，且未能确认 Profile 已恢复；请勿继续变更此 Profile。');
      }
      this.activeProfiles.delete(directory);
      throw error;
    }
  }

  async commit(id) {
    const context = this.transactions.get(id);
    if (!context) throw new ControlledPluginInstallError('transaction-missing', '插件安装事务不存在。');
    await this._verifyInstalled(context.directory, context.plugin);
    this.transactions.delete(id);
    this.activeProfiles.delete(context.directory);
    return Object.freeze({ ok: true });
  }

  async rollback(id) {
    const context = this.transactions.get(id);
    if (!context) throw new ControlledPluginInstallError('transaction-missing', '插件安装事务不存在。');
    await this._restore({
      profileDir: context.directory,
      profileName: context.profileName,
      plugin: context.plugin,
      snapshot: context.snapshot,
      workspacePath: context.workspacePath,
      proxyEnvironment: context.proxyEnvironment
    });
    this.transactions.delete(id);
    this.activeProfiles.delete(context.directory);
    return Object.freeze({ ok: true });
  }
}

module.exports = {
  BUNDLED_PNPM_VERSION,
  CONTROLLED_PLUGIN_CATALOG,
  CONTROLLED_REGISTRY,
  ControlledPluginInstallError,
  ControlledPluginInstaller,
  buildControlledInstallEnvironment,
  controlledCatalog,
  resolveControlledPnpmRuntime,
  runBoundedCommand
};
