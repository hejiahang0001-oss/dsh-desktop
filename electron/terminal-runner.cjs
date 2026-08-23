'use strict';

const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_INPUT_CHARS = 8192;
const MAX_OUTPUT_BUFFER_CHARS = 200000;
const MAX_OUTPUT_EVENT_CHARS = 8192;
const MAX_PROTOCOL_BUFFER_CHARS = 1024 * 1024;
const TERMINAL_SECRET_ENVIRONMENT = new Set(['DEEPSEEK_API_KEY']);

class TerminalRunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TerminalRunnerError';
    this.code = code;
  }
}

const boundedPtySize = (cols, rows) => Object.freeze({
  cols: Math.min(300, Math.max(20, Math.round(Number(cols) || 100))),
  rows: Math.min(120, Math.max(5, Math.round(Number(rows) || 30)))
});

const normalizePtyInput = (value) => {
  if (typeof value !== 'string') throw new TerminalRunnerError('TERMINAL_INPUT_INVALID', '终端输入必须是文本。');
  if (value.length > MAX_INPUT_CHARS) {
    throw new TerminalRunnerError('TERMINAL_INPUT_TOO_LONG', `单次终端输入最多 ${MAX_INPUT_CHARS} 个字符。`);
  }
  if (value.includes('\0')) throw new TerminalRunnerError('TERMINAL_INPUT_CONTROL_CHARACTER', '终端输入不能包含空字符。');
  return value;
};

const sanitizePtyOutput = (value) => String(value || '')
  .replace(/\u001b\]52;[^\u0007]*(?:\u0007|\u001b\\)/g, '')
  .replaceAll('\0', '');

const buildTerminalEnvironment = ({
  baseEnv = process.env,
  workspacePath,
  ptyModulePath,
  shellPath,
  cols,
  rows
} = {}) => {
  const environment = { ...baseEnv };
  for (const name of Object.keys(environment)) {
    if (TERMINAL_SECRET_ENVIRONMENT.has(name.toUpperCase())) delete environment[name];
  }
  const size = boundedPtySize(cols, rows);
  environment.DSH_CWD = workspacePath;
  environment.DSH_PTY_MODULE = ptyModulePath;
  environment.DSH_PTY_SHELL = shellPath;
  environment.DSH_PTY_COLS = String(size.cols);
  environment.DSH_PTY_ROWS = String(size.rows);
  environment.TERM = 'xterm-256color';
  environment.COLORTERM = 'truecolor';
  return environment;
};

const resolveWindowsPowerShell = ({ env = process.env, exists = fs.existsSync } = {}) => {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  const candidate = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!exists(candidate)) {
    throw new TerminalRunnerError('TERMINAL_SHELL_MISSING', '找不到 Windows PowerShell，无法启动集成终端。');
  }
  return candidate;
};

const resolveTerminalRuntime = ({
  rootDir = path.resolve(__dirname, '..'),
  resourcesPath = rootDir,
  isPackaged = false
} = {}) => Object.freeze(isPackaged ? {
  nodePath: path.join(resourcesPath, 'runtime', 'node.exe'),
  helperScriptPath: path.join(resourcesPath, 'terminal', 'terminal-pty-host.cjs'),
  ptyModulePath: path.join(resourcesPath, 'terminal', 'node_modules', 'node-pty')
} : {
  nodePath: path.join(rootDir, 'vendor', 'runtime', 'win32-x64', 'node.exe'),
  helperScriptPath: path.join(rootDir, 'electron', 'terminal-pty-host.cjs'),
  ptyModulePath: path.join(rootDir, 'node_modules', 'node-pty')
});

const defaultKillTree = async (child) => {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      return;
    } catch {
      // The helper may have exited while taskkill was resolving its process tree.
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
    nodePath,
    helperScriptPath,
    ptyModulePath,
    shellPath,
    baseEnv = process.env,
    killTree = defaultKillTree,
    maxOutputBufferChars = MAX_OUTPUT_BUFFER_CHARS
  } = {}) {
    super();
    const runtime = resolveTerminalRuntime();
    this.spawnImpl = spawnImpl || require('node:child_process').spawn;
    this.nodePath = nodePath || runtime.nodePath;
    this.helperScriptPath = helperScriptPath || runtime.helperScriptPath;
    this.ptyModulePath = ptyModulePath || runtime.ptyModulePath;
    this.shellPath = shellPath || resolveWindowsPowerShell();
    this.baseEnv = baseEnv;
    this.killTree = killTree;
    this.maxOutputBufferChars = maxOutputBufferChars;
    this.workspacePath = '';
    this.child = null;
    this.runId = 0;
    this.stopRequested = false;
    this.protocolBuffer = '';
    this.outputBuffer = '';
    this.finalized = true;
    this.state = publicState({
      status: 'idle',
      mode: 'pty',
      runId: 0,
      cwd: '',
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      signal: null,
      pid: null,
      cols: 100,
      rows: 30,
      shell: 'Windows PowerShell',
      recoverable: false
    });
    if (workspacePath) this.setWorkspace(workspacePath);
  }

  getState() {
    return { ...this.state };
  }

  getSnapshot() {
    return { state: this.getState(), output: this.outputBuffer };
  }

  isActive() {
    return Boolean(this.child);
  }

  setWorkspace(workspacePath) {
    if (this.isActive()) throw new TerminalRunnerError('TERMINAL_BUSY', '交互式终端运行中，无法切换工作区。');
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new TerminalRunnerError('TERMINAL_WORKSPACE_INVALID', '终端工作区必须是绝对目录。');
    }
    this.workspacePath = path.resolve(workspacePath);
    this.outputBuffer = '';
    this._setState({
      status: 'idle',
      cwd: this.workspacePath,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      signal: null,
      pid: null,
      recoverable: false
    });
    return this.getState();
  }

  _setState(next) {
    this.state = publicState({ ...this.state, ...next });
    this.emit('state', this.getState());
  }

  _recordOutput(value, stream = 'pty') {
    const sanitized = sanitizePtyOutput(value);
    if (!sanitized) return;
    this.outputBuffer = `${this.outputBuffer}${sanitized}`.slice(-this.maxOutputBufferChars);
    for (let offset = 0; offset < sanitized.length; offset += MAX_OUTPUT_EVENT_CHARS) {
      this.emit('output', Object.freeze({
        runId: this.runId,
        stream,
        text: sanitized.slice(offset, offset + MAX_OUTPUT_EVENT_CHARS)
      }));
    }
    if (!this.state.recoverable) this._setState({ recoverable: true });
  }

  _finish(status, exitCode = null, signal = null) {
    if (this.finalized) return;
    this.finalized = true;
    this.child = null;
    this.protocolBuffer = '';
    this._setState({
      status,
      finishedAt: new Date().toISOString(),
      exitCode: Number.isInteger(exitCode) ? exitCode >>> 0 : null,
      signal: signal || null,
      pid: null,
      recoverable: this.outputBuffer.length > 0
    });
  }

  _handleHostMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      const size = boundedPtySize(message.cols, message.rows);
      this._setState({ status: 'running', pid: Number.isInteger(message.pid) ? message.pid : null, ...size });
      return;
    }
    if (message.type === 'data') {
      this._recordOutput(message.data, 'pty');
      return;
    }
    if (message.type === 'error') {
      this._recordOutput(`\r\n[终端] ${message.message || 'PTY 宿主发生错误。'}\r\n`, 'system');
      this._finish('failed');
      return;
    }
    if (message.type === 'exit') {
      const status = this.stopRequested ? 'stopped' : message.exitCode === 0 ? 'completed' : 'failed';
      this._finish(status, message.exitCode, message.signal);
    }
  }

  _handleProtocolData(chunk) {
    this.protocolBuffer += chunk;
    if (this.protocolBuffer.length > MAX_PROTOCOL_BUFFER_CHARS) {
      this._recordOutput('\r\n[终端] PTY 输出协议超过安全上限。\r\n', 'system');
      this._finish('failed');
      return;
    }
    let newline = this.protocolBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.protocolBuffer.slice(0, newline).trim();
      this.protocolBuffer = this.protocolBuffer.slice(newline + 1);
      if (line) {
        try {
          this._handleHostMessage(JSON.parse(line));
        } catch {
          this._recordOutput('\r\n[终端] 忽略了无效的 PTY 输出帧。\r\n', 'system');
        }
      }
      newline = this.protocolBuffer.indexOf('\n');
    }
  }

  _send(message) {
    if (!this.child?.stdin?.writable) return false;
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch {
      return false;
    }
  }

  start({ cols, rows } = {}) {
    if (this.isActive()) throw new TerminalRunnerError('TERMINAL_BUSY', '交互式终端已经在运行。');
    if (!this.workspacePath) throw new TerminalRunnerError('TERMINAL_WORKSPACE_INVALID', '终端尚未绑定工作区。');
    for (const target of [this.nodePath, this.helperScriptPath, this.ptyModulePath]) {
      if (!fs.existsSync(target)) throw new TerminalRunnerError('TERMINAL_RUNTIME_MISSING', `终端运行时不完整：${target}`);
    }
    const size = boundedPtySize(cols, rows);
    this.runId += 1;
    this.stopRequested = false;
    this.protocolBuffer = '';
    this.outputBuffer = '';
    this.finalized = false;
    const startedAt = new Date().toISOString();
    let child;
    try {
      child = this.spawnImpl(this.nodePath, [this.helperScriptPath], {
        cwd: this.workspacePath,
        env: buildTerminalEnvironment({
          baseEnv: this.baseEnv,
          workspacePath: this.workspacePath,
          ptyModulePath: this.ptyModulePath,
          shellPath: this.shellPath,
          ...size
        }),
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      this.finalized = true;
      this._setState({
        status: 'failed',
        runId: this.runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        pid: null,
        ...size
      });
      throw new TerminalRunnerError('TERMINAL_START_FAILED', `无法启动交互式终端：${error.message}`);
    }
    this.child = child;
    this._setState({
      status: 'starting',
      runId: this.runId,
      cwd: this.workspacePath,
      startedAt,
      finishedAt: null,
      exitCode: null,
      signal: null,
      pid: null,
      recoverable: false,
      ...size
    });
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on('data', (chunk) => this._handleProtocolData(String(chunk)));
    child.stderr?.on('data', (chunk) => this._recordOutput(`\r\n[PTY 宿主] ${String(chunk).trim()}\r\n`, 'system'));
    child.once('error', (error) => {
      this._recordOutput(`\r\n[终端] 无法启动 PTY 宿主：${error.message}\r\n`, 'system');
      this._finish('failed');
    });
    child.once('exit', (code, signal) => {
      if (this.finalized) return;
      const status = this.stopRequested ? 'stopped' : code === 0 ? 'completed' : 'failed';
      this._finish(status, code, signal);
    });
    return this.getState();
  }

  write(value) {
    const input = normalizePtyInput(value);
    if (this.state.status !== 'running') return false;
    return this._send({ type: 'input', data: input });
  }

  resize(cols, rows) {
    const size = boundedPtySize(cols, rows);
    if (!['starting', 'running'].includes(this.state.status)) return this.getState();
    this._setState(size);
    this._send({ type: 'resize', ...size });
    return this.getState();
  }

  async stop() {
    const child = this.child;
    if (!child) return this.getState();
    this.stopRequested = true;
    this._setState({ status: 'stopping' });
    this._send({ type: 'stop' });
    await this.killTree(child);
    if (this.child === child) this._finish('stopped');
    return this.getState();
  }
}

module.exports = {
  MAX_INPUT_CHARS,
  MAX_OUTPUT_BUFFER_CHARS,
  TerminalRunner,
  TerminalRunnerError,
  boundedPtySize,
  buildTerminalEnvironment,
  normalizePtyInput,
  resolveTerminalRuntime,
  resolveWindowsPowerShell,
  sanitizePtyOutput
};
