const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_COMMAND_CHARS = 4096;
const MAX_OUTPUT_CHARS = 200000;
const MAX_OUTPUT_EVENT_CHARS = 8192;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_SECRET_ENVIRONMENT = new Set(['DEEPSEEK_API_KEY']);

class TerminalRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TerminalRunnerError';
    this.code = code;
  }
}

const normalizeTerminalCommand = (value) => {
  if (typeof value !== 'string') {
    throw new TerminalRunnerError('TERMINAL_COMMAND_INVALID', '终端命令必须是文本。');
  }
  const command = value.trim();
  if (!command) throw new TerminalRunnerError('TERMINAL_COMMAND_EMPTY', '请输入要运行的命令。');
  if (command.length > MAX_COMMAND_CHARS) {
    throw new TerminalRunnerError('TERMINAL_COMMAND_TOO_LONG', `单次命令最多 ${MAX_COMMAND_CHARS} 个字符。`);
  }
  if (/[\u0000-\u001f\u007f]/.test(command)) {
    throw new TerminalRunnerError('TERMINAL_COMMAND_CONTROL_CHARACTER', '终端命令不能包含换行或控制字符。');
  }
  return command;
};

const sanitizeTerminalOutput = (value) => String(value || '')
  .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
  .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, '')
  .replaceAll('\r\n', '\n')
  .replaceAll('\r', '\n')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

const buildTerminalEnvironment = ({ baseEnv = process.env, workspacePath } = {}) => {
  const environment = { ...baseEnv };
  for (const name of Object.keys(environment)) {
    if (TERMINAL_SECRET_ENVIRONMENT.has(name.toUpperCase())) delete environment[name];
  }
  environment.DSH_CWD = workspacePath;
  environment.NO_COLOR = '1';
  environment.TERM = 'dumb';
  return environment;
};

const encodePowerShellCommand = (command) => {
  const script = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [Console]::OutputEncoding',
    '$ProgressPreference = "SilentlyContinue"',
    `& { ${command} }`
  ].join('; ');
  return Buffer.from(script, 'utf16le').toString('base64');
};

const resolveWindowsPowerShell = ({ env = process.env, exists = fs.existsSync } = {}) => {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  const candidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!exists(candidate)) {
    throw new TerminalRunnerError('TERMINAL_SHELL_MISSING', '找不到 Windows PowerShell，无法启动集成终端。');
  }
  return candidate;
};

const defaultKillTree = async (child) => {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      return;
    } catch {
      // The process may have exited between the state check and taskkill.
    }
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // The process is already gone.
  }
};

const publicState = (state) => Object.freeze({ ...state });

class TerminalRunner extends EventEmitter {
  constructor({
    workspacePath,
    spawnImpl,
    shellPath,
    baseEnv = process.env,
    killTree = defaultKillTree,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputChars = MAX_OUTPUT_CHARS
  } = {}) {
    super();
    this.spawnImpl = spawnImpl || require('node:child_process').spawn;
    this.shellPath = shellPath || resolveWindowsPowerShell();
    this.baseEnv = baseEnv;
    this.killTree = killTree;
    this.timeoutMs = timeoutMs;
    this.maxOutputChars = maxOutputChars;
    this.workspacePath = '';
    this.child = null;
    this.runId = 0;
    this.stopRequested = false;
    this.outputChars = 0;
    this.outputTruncated = false;
    this.timeout = null;
    this.finalized = false;
    this.state = publicState({
      status: 'idle',
      runId: 0,
      cwd: '',
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      signal: null,
      truncated: false,
      shell: 'Windows PowerShell'
    });
    if (workspacePath) this.setWorkspace(workspacePath);
  }

  getState() {
    return { ...this.state };
  }

  isActive() {
    return Boolean(this.child);
  }

  setWorkspace(workspacePath) {
    if (this.isActive()) {
      throw new TerminalRunnerError('TERMINAL_BUSY', '终端命令运行中，无法切换工作区。');
    }
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new TerminalRunnerError('TERMINAL_WORKSPACE_INVALID', '终端工作区必须是绝对目录。');
    }
    this.workspacePath = path.resolve(workspacePath);
    this._setState({ status: 'idle', cwd: this.workspacePath, exitCode: null, signal: null, truncated: false });
    return this.getState();
  }

  _setState(next) {
    this.state = publicState({ ...this.state, ...next });
    this.emit('state', this.getState());
  }

  _emitOutput(stream, value) {
    if (this.outputTruncated) return;
    const sanitized = sanitizeTerminalOutput(value);
    if (!sanitized) return;
    const remaining = this.maxOutputChars - this.outputChars;
    if (remaining <= 0) return;
    const clipped = sanitized.slice(0, remaining);
    this.outputChars += clipped.length;
    for (let offset = 0; offset < clipped.length; offset += MAX_OUTPUT_EVENT_CHARS) {
      this.emit('output', Object.freeze({
        runId: this.runId,
        stream,
        text: clipped.slice(offset, offset + MAX_OUTPUT_EVENT_CHARS)
      }));
    }
    if (sanitized.length > clipped.length || this.outputChars >= this.maxOutputChars) {
      this.outputTruncated = true;
      this.emit('output', Object.freeze({
        runId: this.runId,
        stream: 'system',
        text: `\n… 终端输出已达到 ${this.maxOutputChars} 字符上限，后续内容不再显示。\n`
      }));
      this._setState({ truncated: true });
    }
  }

  _finish(status, exitCode = null, signal = null) {
    if (this.finalized) return;
    this.finalized = true;
    clearTimeout(this.timeout);
    this.timeout = null;
    this.child = null;
    this._setState({
      status,
      finishedAt: new Date().toISOString(),
      exitCode: Number.isInteger(exitCode) ? exitCode >>> 0 : null,
      signal: signal || null,
      truncated: this.outputTruncated
    });
  }

  start(value) {
    if (this.isActive()) throw new TerminalRunnerError('TERMINAL_BUSY', '已有终端命令正在运行。');
    if (!this.workspacePath) throw new TerminalRunnerError('TERMINAL_WORKSPACE_INVALID', '终端尚未绑定工作区。');
    const command = normalizeTerminalCommand(value);
    const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShellCommand(command)];

    this.runId += 1;
    this.stopRequested = false;
    this.outputChars = 0;
    this.outputTruncated = false;
    this.finalized = false;
    const startedAt = new Date().toISOString();
    let child;
    try {
      child = this.spawnImpl(this.shellPath, args, {
        cwd: this.workspacePath,
        env: buildTerminalEnvironment({ baseEnv: this.baseEnv, workspacePath: this.workspacePath }),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      this.finalized = true;
      this._setState({
        status: 'failed',
        runId: this.runId,
        cwd: this.workspacePath,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        truncated: false
      });
      throw new TerminalRunnerError('TERMINAL_START_FAILED', `无法启动终端命令：${error.message}`);
    }
    this.child = child;
    this._setState({
      status: 'running',
      runId: this.runId,
      cwd: this.workspacePath,
      startedAt,
      finishedAt: null,
      exitCode: null,
      signal: null,
      truncated: false
    });

    child.stdout?.on('data', (chunk) => this._emitOutput('stdout', chunk.toString('utf8')));
    child.stderr?.on('data', (chunk) => this._emitOutput('stderr', chunk.toString('utf8')));
    child.once('error', (error) => {
      this._emitOutput('system', `无法启动终端命令：${error.message}\n`);
      this._finish('failed');
    });
    child.once('exit', (code, signal) => {
      const status = this.stopRequested ? 'stopped' : code === 0 ? 'completed' : 'failed';
      this._finish(status, code, signal);
    });
    this.timeout = setTimeout(() => {
      if (!this.child) return;
      const minutes = Math.max(1, Math.round(this.timeoutMs / 60000));
      this._emitOutput('system', `\n命令运行超过 ${minutes} 分钟，已请求停止。\n`);
      void this.stop();
    }, this.timeoutMs);
    this.timeout.unref?.();
    return this.getState();
  }

  async stop() {
    const child = this.child;
    if (!child) return this.getState();
    this.stopRequested = true;
    this._setState({ status: 'stopping' });
    await this.killTree(child);
    if (this.child === child) this._finish('stopped');
    return this.getState();
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_COMMAND_CHARS,
  MAX_OUTPUT_CHARS,
  TerminalRunner,
  TerminalRunnerError,
  buildTerminalEnvironment,
  encodePowerShellCommand,
  normalizeTerminalCommand,
  resolveWindowsPowerShell,
  sanitizeTerminalOutput
};
