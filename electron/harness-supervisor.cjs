const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const READY_PATTERN = /dsh web:\s*(http:\/\/127\.0\.0\.1:\d+)/i;
const SOFTWARE_MANAGED_CREDENTIALS = new Set(['DEEPSEEK_API_KEY']);
const SOFTWARE_MANAGED_NETWORK = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY']);
const SOFTWARE_MANAGED_RUNTIME = new Set(['DSH_BUNDLED_SKILL_DIR', 'DSH_DESKTOP_DOCX_TOOL', 'DSH_DESKTOP_NODE']);
const HARNESS_VERSION = '0.1.1-rc.2';

const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '');

const parseHarnessUrl = (value) => {
  const match = stripAnsi(value).match(READY_PATTERN);
  if (!match) return null;
  try {
    const url = new URL(match[1]);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) return null;
    return url.origin;
  } catch {
    return null;
  }
};

const isSafeHarnessUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port);
  } catch {
    return false;
  }
};

const firstExistingFile = (candidates) => candidates.find((candidate) => candidate && fs.existsSync(candidate));

const buildHarnessEnvironment = ({ baseEnv = process.env, overrides = {}, homeDir, workspaceDir }) => {
  const environment = { ...baseEnv };
  for (const name of Object.keys(environment)) {
    const normalizedName = name.toUpperCase();
    if (SOFTWARE_MANAGED_CREDENTIALS.has(normalizedName) || SOFTWARE_MANAGED_NETWORK.has(normalizedName) || SOFTWARE_MANAGED_RUNTIME.has(normalizedName)) {
      delete environment[name];
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!SOFTWARE_MANAGED_CREDENTIALS.has(name.toUpperCase()) && !SOFTWARE_MANAGED_RUNTIME.has(name.toUpperCase())) environment[name] = value;
  }
  environment.DSH_HOME = homeDir;
  if (workspaceDir) environment.DSH_CWD = workspaceDir;
  environment.NO_COLOR = '1';
  return environment;
};

const resolvePnpmDshBin = (nodeModulesDir) => {
  const pnpmDir = path.join(nodeModulesDir, '.pnpm');
  try {
    const packageDir = fs.readdirSync(pnpmDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`@deepseek-ai+dsh@${HARNESS_VERSION}_`))
      .sort((left, right) => left.name.localeCompare(right.name))[0];
    if (!packageDir) return null;
    const candidate = path.join(
      pnpmDir,
      packageDir.name,
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'lib',
      'bin.js'
    );
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
};

const resolveHarnessRuntimePaths = ({ rootDir, resourcesPath, isPackaged, env = process.env }) => {
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'bin/node';
  const nodePath = firstExistingFile([
    env.DSH_DESKTOP_NODE,
    isPackaged && path.join(resourcesPath, 'runtime', nodeName),
    path.join(rootDir, 'vendor', 'runtime', `${process.platform}-${process.arch}`, nodeName)
  ]);

  const dshRelative = path.join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const packagedNodeModules = path.join(resourcesPath, 'harness', 'node_modules');
  const hoistedNodeModules = path.join(rootDir, 'vendor', `harness-hoisted-${HARNESS_VERSION}`, 'node_modules');
  const vendorNodeModules = path.join(rootDir, 'vendor', `harness-${HARNESS_VERSION}`, 'node_modules');
  const dshBinPath = firstExistingFile([
    env.DSH_DESKTOP_DSH_BIN,
    isPackaged && resolvePnpmDshBin(packagedNodeModules),
    isPackaged && path.join(resourcesPath, 'harness', dshRelative),
    path.join(hoistedNodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    resolvePnpmDshBin(vendorNodeModules),
    path.join(rootDir, 'vendor', `harness-${HARNESS_VERSION}`, dshRelative),
    path.join(rootDir, dshRelative)
  ]);
  const patchPath = firstExistingFile([
    env.DSH_DESKTOP_PATCH,
    isPackaged && path.join(resourcesPath, 'harness-config', 'dsh-desktop.patch.yml'),
    path.join(rootDir, 'config', 'dsh-desktop.patch.yml')
  ]);
  const bundledSkillDir = firstExistingFile([
    isPackaged && path.join(resourcesPath, 'skills'),
    path.join(rootDir, 'resources', 'skills')
  ]);
  const docxToolPath = bundledSkillDir && firstExistingFile([
    path.join(bundledSkillDir, 'word-docx', 'scripts', 'word-docx.cjs')
  ]);

  if (!nodePath) {
    const error = new Error('找不到 DSH Desktop 固定的 Node 运行时。请先执行 pnpm runtime:fetch。');
    error.code = 'NODE_RUNTIME_MISSING';
    throw error;
  }
  if (!dshBinPath) {
    const error = new Error('找不到固定版本的 DeepSeek Harness。请先执行 pnpm runtime:deploy。');
    error.code = 'HARNESS_RUNTIME_MISSING';
    throw error;
  }
  if (!patchPath) {
    const error = new Error('找不到 DSH Desktop 的 Harness 中文语言补丁。请重新安装应用。');
    error.code = 'HARNESS_PATCH_MISSING';
    throw error;
  }
  if (!bundledSkillDir || !docxToolPath) {
    const error = new Error('找不到 DSH Desktop 内置的 Word DOCX Skill。请重新安装应用。');
    error.code = 'BUNDLED_WORD_SKILL_MISSING';
    throw error;
  }
  return { nodePath, dshBinPath, patchPath, bundledSkillDir, docxToolPath };
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const probeHarness = async (url, { attempts = 30, intervalMs = 250, fetchImpl = globalThis.fetch } = {}) => {
  if (!isSafeHarnessUrl(url)) throw new Error('Harness 返回了不受信任的地址。');
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetchImpl(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        const html = await response.text();
        const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || '';
        return { status: response.status, title, contentType: response.headers.get('content-type') || '' };
      }
      lastError = new Error(`Harness 健康检查返回 HTTP ${response.status}。`);
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw lastError || new Error('Harness 健康检查失败。');
};

class HarnessSupervisor extends EventEmitter {
  constructor(options) {
    super();
    this.options = { startTimeoutMs: 45000, stopTimeoutMs: 5000, ...options };
    this.child = null;
    this.outputBuffer = '';
    this.readyPromise = null;
    this.resolveReady = null;
    this.rejectReady = null;
    this.startTimer = null;
    this.stopRequested = false;
    this.state = Object.freeze({ status: 'idle', url: null, pid: null, error: null });
  }

  getState() {
    return { ...this.state, logFile: this.options.logFile, workspacePath: this.options.launchDir };
  }

  isActive() {
    return Boolean(this.child);
  }

  setLaunchDir(launchDir) {
    if (typeof launchDir !== 'string' || !path.isAbsolute(launchDir)) {
      throw new Error('Harness 工作目录必须是绝对路径。');
    }
    this.options.launchDir = launchDir;
  }

  setEnvironment(environment = {}) {
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      throw new Error('Harness 环境配置无效。');
    }
    this.options.env = { ...environment };
  }

  _setState(next) {
    this.state = Object.freeze({ ...this.state, ...next });
    this.emit('state', this.getState());
  }

  async _appendLog(source, chunk) {
    const line = `[${new Date().toISOString()}] [${source}] ${stripAnsi(chunk)}`;
    try {
      await fsp.appendFile(this.options.logFile, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
    } catch {
      // Logging must never crash the supervised process.
    }
  }

  _handleOutput(source, chunk) {
    const text = chunk.toString('utf8');
    void this._appendLog(source, text);
    this.outputBuffer = `${this.outputBuffer}${text}`.slice(-16384);
    const url = parseHarnessUrl(this.outputBuffer);
    if (!url || this.state.status === 'running') return;
    clearTimeout(this.startTimer);
    this._setState({ status: 'running', url, pid: this.child?.pid || null, error: null });
    this.resolveReady?.(url);
    this.resolveReady = null;
    this.rejectReady = null;
  }

  _fail(error) {
    clearTimeout(this.startTimer);
    const message = error?.message || String(error);
    this._setState({ status: 'failed', url: null, pid: this.child?.pid || null, error: message });
    this.rejectReady?.(error instanceof Error ? error : new Error(message));
    this.resolveReady = null;
    this.rejectReady = null;
  }

  reportFailure(error) {
    this._fail(error);
  }

  async start() {
    if (this.state.status === 'running') return this.state.url;
    if (this.readyPromise && this.state.status === 'starting') return this.readyPromise;

    await fsp.mkdir(this.options.homeDir, { recursive: true });
    await fsp.mkdir(this.options.launchDir, { recursive: true });
    await fsp.mkdir(path.dirname(this.options.logFile), { recursive: true });
    const { nodePath, dshBinPath, patchPath, bundledSkillDir, docxToolPath } = resolveHarnessRuntimePaths(this.options);

    this.stopRequested = false;
    this.outputBuffer = '';
    this._setState({ status: 'starting', url: null, pid: null, error: null });
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    try {
      const environment = buildHarnessEnvironment({
        overrides: this.options.env,
        homeDir: this.options.homeDir,
        workspaceDir: this.options.launchDir
      });
      environment.DSH_BUNDLED_SKILL_DIR = bundledSkillDir;
      environment.DSH_DESKTOP_DOCX_TOOL = docxToolPath;
      environment.DSH_DESKTOP_NODE = nodePath;
      this.child = spawn(nodePath, [dshBinPath, 'web', '--patch', patchPath, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
        cwd: this.options.launchDir,
        env: environment,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      this._fail(error);
      return this.readyPromise;
    }

    this._setState({ pid: this.child.pid || null });
    this.child.stdout.on('data', (chunk) => this._handleOutput('stdout', chunk));
    this.child.stderr.on('data', (chunk) => this._handleOutput('stderr', chunk));
    this.child.once('error', (error) => this._fail(error));
    this.child.once('exit', (code, signal) => {
      clearTimeout(this.startTimer);
      const wasStopping = this.stopRequested;
      this.child = null;
      if (wasStopping) {
        this._setState({ status: 'stopped', url: null, pid: null, error: null });
        return;
      }
      const error = new Error(`Harness 已退出（code=${code ?? 'null'}, signal=${signal || 'none'}）。`);
      this._fail(error);
      this._setState({ pid: null });
    });

    this.startTimer = setTimeout(() => {
      const error = new Error(`Harness 在 ${this.options.startTimeoutMs / 1000} 秒内未就绪。`);
      this._fail(error);
      void this.stop();
    }, this.options.startTimeoutMs);
    this.startTimer.unref?.();
    return this.readyPromise;
  }

  async stop() {
    clearTimeout(this.startTimer);
    const child = this.child;
    if (!child) {
      this._setState({ status: 'stopped', url: null, pid: null, error: null });
      return;
    }

    this.stopRequested = true;
    this._setState({ status: 'stopping', url: null, pid: child.pid || null, error: null });
    await new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        resolve();
      };
      child.once('exit', done);
      try {
        child.kill('SIGTERM');
      } catch {
        done();
        return;
      }
      const forceTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process may already be gone.
        }
        setTimeout(done, 500).unref?.();
      }, this.options.stopTimeoutMs);
      forceTimer.unref?.();
    });
  }

  async restart() {
    await this.stop();
    this.readyPromise = null;
    return this.start();
  }
}

module.exports = {
  HarnessSupervisor,
  buildHarnessEnvironment,
  isSafeHarnessUrl,
  parseHarnessUrl,
  probeHarness,
  resolvePnpmDshBin,
  resolveHarnessRuntimePaths,
  stripAnsi
};
