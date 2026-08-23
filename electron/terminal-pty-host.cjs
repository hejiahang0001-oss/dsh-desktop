'use strict';

const path = require('node:path');

const MAX_PROTOCOL_CHARS = 128 * 1024;
const MAX_INPUT_CHARS = 8192;
const INTERNAL_ENVIRONMENT = new Set([
  'DEEPSEEK_API_KEY',
  'DSH_PTY_MODULE',
  'DSH_PTY_SHELL',
  'DSH_PTY_COLS',
  'DSH_PTY_ROWS'
]);

const send = (message, callback) => {
  const line = `${JSON.stringify(message)}\n`;
  process.stdout.write(line, callback);
};

const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const modulePath = process.env.DSH_PTY_MODULE || path.join(__dirname, 'node_modules', 'node-pty');
const shellPath = process.env.DSH_PTY_SHELL || 'powershell.exe';
const workspacePath = path.resolve(process.env.DSH_CWD || process.cwd());
const cols = boundedInteger(process.env.DSH_PTY_COLS, 100, 20, 300);
const rows = boundedInteger(process.env.DSH_PTY_ROWS, 30, 5, 120);
const childEnvironment = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', DSH_CWD: workspacePath };
for (const name of Object.keys(childEnvironment)) {
  if (INTERNAL_ENVIRONMENT.has(name.toUpperCase())) delete childEnvironment[name];
}
childEnvironment.DSH_CWD = workspacePath;

let terminal;
let protocolBuffer = '';
let exiting = false;

const fail = (code, error) => {
  if (exiting) return;
  exiting = true;
  send({ type: 'error', code, message: error?.message || String(error) }, () => process.exit(1));
};

const stopTerminal = () => {
  if (!terminal) return;
  try {
    terminal.kill();
  } catch {
    // The shell may already have exited.
  }
};

const handleMessage = (message) => {
  if (!terminal || !message || typeof message !== 'object') return;
  if (message.type === 'input') {
    if (typeof message.data !== 'string' || message.data.length > MAX_INPUT_CHARS || message.data.includes('\0')) return;
    terminal.write(message.data);
    return;
  }
  if (message.type === 'resize') {
    const nextCols = boundedInteger(message.cols, 0, 20, 300);
    const nextRows = boundedInteger(message.rows, 0, 5, 120);
    if (nextCols && nextRows) terminal.resize(nextCols, nextRows);
    return;
  }
  if (message.type === 'stop') stopTerminal();
};

const handleProtocolData = (chunk) => {
  protocolBuffer += chunk;
  if (protocolBuffer.length > MAX_PROTOCOL_CHARS) return fail('PTY_PROTOCOL_OVERFLOW', new Error('PTY 输入协议超过安全上限。'));
  let newline = protocolBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = protocolBuffer.slice(0, newline).trim();
    protocolBuffer = protocolBuffer.slice(newline + 1);
    if (line) {
      try {
        handleMessage(JSON.parse(line));
      } catch {
        // Ignore malformed renderer input instead of forwarding it to the shell.
      }
    }
    newline = protocolBuffer.indexOf('\n');
  }
};

process.on('uncaughtException', (error) => fail('PTY_HOST_CRASH', error));
process.on('unhandledRejection', (error) => fail('PTY_HOST_REJECTION', error));
process.on('SIGTERM', stopTerminal);
process.on('SIGINT', stopTerminal);

try {
  const pty = require(modulePath);
  terminal = pty.spawn(shellPath, ['-NoLogo', '-NoProfile'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workspacePath,
    env: childEnvironment
  });
  terminal.onData((data) => send({ type: 'data', data }));
  terminal.onExit(({ exitCode, signal }) => {
    if (exiting) return;
    exiting = true;
    send({ type: 'exit', exitCode, signal }, () => process.exit(0));
  });
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', handleProtocolData);
  process.stdin.on('end', stopTerminal);
  send({ type: 'ready', pid: terminal.pid || null, cols, rows });
} catch (error) {
  fail('PTY_START_FAILED', error);
}
