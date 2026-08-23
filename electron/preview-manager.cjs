'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const {
  isRestrictedWorkspaceFile,
  normalizeRelativePath
} = require('./workspace-files.cjs');

const MAX_PREVIEW_URL_CHARS = 2048;
const MAX_STATIC_FILE_BYTES = 32 * 1024 * 1024;
const DEFAULT_PROBE_TIMEOUT_MS = 1800;
const DEFAULT_MONITOR_INTERVAL_MS = 2500;
const BLOCKED_STATIC_DIRECTORIES = new Set(['.git', 'node_modules']);
const HTML_EXTENSIONS = new Set(['.htm', '.html']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8'
});

class PreviewError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PreviewError';
    this.code = code;
  }
}

const isInside = (rootPath, targetPath) => {
  const relative = path.relative(rootPath, targetPath);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const normalizeLoopbackUrl = (value, { reservedOrigins = [], allowedOrigins } = {}) => {
  if (typeof value !== 'string') throw new PreviewError('PREVIEW_URL_INVALID', '预览地址必须是文本。');
  let candidate = value.trim();
  if (!candidate || candidate.length > MAX_PREVIEW_URL_CHARS || /[\u0000-\u001f\u007f]/.test(candidate)) {
    throw new PreviewError('PREVIEW_URL_INVALID', `请输入不超过 ${MAX_PREVIEW_URL_CHARS} 个字符的本机地址。`);
  }
  if (/^\d{1,5}$/.test(candidate)) candidate = `http://127.0.0.1:${candidate}/`;
  else if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(candidate)) candidate = `http://${candidate}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new PreviewError('PREVIEW_URL_INVALID', '请输入例如 http://127.0.0.1:3000 的本机地址。');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new PreviewError('PREVIEW_URL_NOT_LOOPBACK', '应用预览只连接 127.0.0.1、localhost 或 ::1 本机服务。');
  }
  if (url.username || url.password) throw new PreviewError('PREVIEW_URL_CREDENTIALS', '预览地址不能包含用户名或密码。');
  const reserved = new Set(reservedOrigins.filter(Boolean));
  if (reserved.has(url.origin)) throw new PreviewError('PREVIEW_URL_RESERVED', '不能把 Harness 自身端口作为应用预览。');
  if (Array.isArray(allowedOrigins)) {
    const allowed = new Set(allowedOrigins.filter(Boolean));
    if (!allowed.has(url.origin)) throw new PreviewError('PREVIEW_URL_ORIGIN_CHANGED', '应用预览不能跳转到另一个本机服务。');
  }
  return url.href;
};

const isSafePreviewNavigation = (value, options = {}) => {
  if (value === 'about:blank') return true;
  try {
    normalizeLoopbackUrl(value, options);
    return true;
  } catch {
    return false;
  }
};

const probeLoopback = (value, {
  reservedOrigins = [],
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS
} = {}) => new Promise((resolve) => {
  let normalized;
  try {
    normalized = normalizeLoopbackUrl(value, { reservedOrigins });
  } catch (error) {
    resolve({ ok: false, error });
    return;
  }
  const target = new URL(normalized);
  const client = target.protocol === 'https:' ? https : http;
  const request = client.request(target, {
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
    rejectUnauthorized: false
  }, (response) => {
    response.resume();
    resolve({
      ok: Number(response.statusCode) > 0 && Number(response.statusCode) < 500,
      statusCode: response.statusCode || null,
      url: normalized
    });
  });
  request.setTimeout(Math.max(250, Math.min(10000, Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS)), () => {
    request.destroy(new Error('本机服务连接超时。'));
  });
  request.on('error', (error) => resolve({ ok: false, error, url: normalized }));
  request.end();
});

const publicState = (value = {}) => Object.freeze({
  status: value.status || 'idle',
  mode: value.mode || 'none',
  source: value.source || '',
  url: value.url || '',
  displayUrl: value.displayUrl || '',
  filePath: value.filePath || '',
  port: Number.isInteger(value.port) ? value.port : null,
  owned: Boolean(value.owned),
  workspacePath: value.workspacePath || '',
  checkedAt: value.checkedAt || null,
  error: value.error || ''
});

class PreviewManager extends EventEmitter {
  constructor({
    workspacePath,
    probe = probeLoopback,
    monitorIntervalMs = DEFAULT_MONITOR_INTERVAL_MS,
    maxStaticFileBytes = MAX_STATIC_FILE_BYTES
  } = {}) {
    super();
    this.workspacePath = '';
    this.workspaceRealPath = '';
    this.server = null;
    this.monitor = null;
    this.monitorBusy = false;
    this.probe = probe;
    this.reservedOrigins = [];
    this.monitorIntervalMs = Math.max(500, Number(monitorIntervalMs) || DEFAULT_MONITOR_INTERVAL_MS);
    this.maxStaticFileBytes = Math.max(1024, Number(maxStaticFileBytes) || MAX_STATIC_FILE_BYTES);
    this.state = publicState();
    if (workspacePath) this.workspacePath = path.resolve(workspacePath);
  }

  _setState(next) {
    this.state = publicState({ ...this.state, ...next, workspacePath: this.workspacePath });
    this.emit('state', this.getState());
    return this.getState();
  }

  getState() {
    return { ...this.state };
  }

  isActive() {
    return ['starting', 'ready', 'offline'].includes(this.state.status);
  }

  async activate(workspacePath = this.workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new PreviewError('PREVIEW_WORKSPACE_INVALID', '应用预览工作区必须是绝对目录。');
    }
    await this.stop();
    const resolved = path.resolve(workspacePath);
    const state = await fsp.stat(resolved);
    if (!state.isDirectory()) throw new PreviewError('PREVIEW_WORKSPACE_INVALID', '应用预览工作区不是目录。');
    this.workspacePath = resolved;
    this.workspaceRealPath = await fsp.realpath(resolved);
    return this._setState({ status: 'idle', workspacePath: resolved, error: '' });
  }

  _resolve(relativePath, { allowDirectory = false } = {}) {
    if (!this.workspaceRealPath) throw new PreviewError('PREVIEW_WORKSPACE_UNAVAILABLE', '应用预览尚未绑定工作区。');
    const normalized = normalizeRelativePath(relativePath);
    const absolutePath = path.resolve(this.workspaceRealPath, ...normalized.split('/'));
    if (!isInside(this.workspaceRealPath, absolutePath)) throw new PreviewError('PREVIEW_OUTSIDE_WORKSPACE', '预览路径超出当前工作区。');
    const segments = normalized.split('/');
    if (segments.some((segment) => BLOCKED_STATIC_DIRECTORIES.has(segment) || isRestrictedWorkspaceFile(segment))) {
      throw new PreviewError('PREVIEW_RESTRICTED', '凭据、私钥和生成依赖目录不会由预览服务器提供。');
    }
    if (!allowDirectory && !HTML_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
      throw new PreviewError('PREVIEW_NOT_HTML', 'V0.4.5 只直接启动工作区中的 HTML 文件。');
    }
    return { relativePath: normalized, absolutePath };
  }

  async _assertNoLinkTraversal(resolved) {
    let current = this.workspaceRealPath;
    for (const segment of resolved.relativePath.split('/')) {
      current = path.join(current, segment);
      const state = await fsp.lstat(current);
      if (state.isSymbolicLink()) throw new PreviewError('PREVIEW_LINK', '应用预览不会跟随符号链接或目录联接。');
    }
    const realPath = await fsp.realpath(resolved.absolutePath);
    if (realPath !== this.workspaceRealPath && !isInside(this.workspaceRealPath, realPath)) {
      throw new PreviewError('PREVIEW_OUTSIDE_WORKSPACE', '解析后的预览路径超出当前工作区。');
    }
  }

  async _serve(request, response) {
    const fail = (statusCode, message) => {
      if (response.headersSent) return response.destroy();
      response.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(message);
    };
    if (!['GET', 'HEAD'].includes(request.method || '')) return fail(405, 'Method not allowed');
    let relativePath;
    try {
      const target = new URL(request.url || '/', 'http://127.0.0.1');
      relativePath = decodeURIComponent(target.pathname).replace(/^\/+/, '');
      if (!relativePath) relativePath = 'index.html';
      else if (target.pathname.endsWith('/')) relativePath = `${relativePath.replace(/\/$/, '')}/index.html`;
      let resolved = this._resolve(relativePath, { allowDirectory: true });
      await this._assertNoLinkTraversal(resolved);
      let state = await fsp.lstat(resolved.absolutePath);
      if (state.isDirectory()) {
        relativePath = `${resolved.relativePath}/index.html`;
        resolved = this._resolve(relativePath, { allowDirectory: true });
        await this._assertNoLinkTraversal(resolved);
        state = await fsp.lstat(resolved.absolutePath);
      }
      if (!state.isFile() || state.size > this.maxStaticFileBytes) return fail(404, 'Preview resource unavailable');
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(resolved.absolutePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': state.size,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff'
      });
      if (request.method === 'HEAD') return response.end();
      const stream = fs.createReadStream(resolved.absolutePath);
      stream.on('error', () => fail(500, 'Preview resource failed'));
      stream.pipe(response);
    } catch (error) {
      return fail(error?.code === 'ENOENT' ? 404 : error instanceof PreviewError ? 403 : 400, 'Preview resource unavailable');
    }
  }

  async openFile(relativePath) {
    await this.stop();
    const resolved = this._resolve(relativePath);
    await this._assertNoLinkTraversal(resolved);
    const fileState = await fsp.lstat(resolved.absolutePath);
    if (!fileState.isFile()) throw new PreviewError('PREVIEW_NOT_FILE', '所选 HTML 路径不是普通文件。');
    this._setState({ status: 'starting', mode: 'static', source: 'workspace-html', filePath: resolved.relativePath, owned: true, error: '' });
    const server = http.createServer((request, response) => { void this._serve(request, response); });
    this.server = server;
    server.on('error', (error) => {
      if (this.server !== server) return;
      this.server = null;
      this._setState({ status: 'failed', error: error.message, owned: false });
    });
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
      server.listen(0, '127.0.0.1');
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new PreviewError('PREVIEW_PORT_FAILED', '无法取得本机预览端口。');
    const encodedPath = resolved.relativePath.split('/').map(encodeURIComponent).join('/');
    const url = `http://127.0.0.1:${address.port}/${encodedPath}`;
    return this._setState({
      status: 'ready',
      mode: 'static',
      source: 'workspace-html',
      url,
      displayUrl: resolved.relativePath,
      filePath: resolved.relativePath,
      port: address.port,
      owned: true,
      checkedAt: new Date().toISOString(),
      error: ''
    });
  }

  async connect(value, { reservedOrigins = [] } = {}) {
    await this.stop();
    const url = normalizeLoopbackUrl(value, { reservedOrigins });
    this.reservedOrigins = [...reservedOrigins];
    this._setState({ status: 'starting', mode: 'external', source: 'local-server', url, displayUrl: url, owned: false, error: '' });
    const result = await this.probe(url, { reservedOrigins: this.reservedOrigins });
    if (!result.ok) {
      return this._setState({ status: 'offline', checkedAt: new Date().toISOString(), error: result.error?.message || '本机服务当前不可访问。' });
    }
    const state = this._setState({ status: 'ready', checkedAt: new Date().toISOString(), error: '' });
    this.monitor = setInterval(() => { void this._monitorExternal(); }, this.monitorIntervalMs);
    this.monitor.unref?.();
    return state;
  }

  async _monitorExternal() {
    if (this.monitorBusy || this.state.mode !== 'external' || !this.state.url) return;
    this.monitorBusy = true;
    try {
      const result = await this.probe(this.state.url, { reservedOrigins: this.reservedOrigins });
      const status = result.ok ? 'ready' : 'offline';
      const error = result.ok ? '' : result.error?.message || '本机服务当前不可访问。';
      if (status !== this.state.status || error !== this.state.error) {
        this._setState({ status, checkedAt: new Date().toISOString(), error });
      }
    } finally {
      this.monitorBusy = false;
    }
  }

  async stop() {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    this.monitorBusy = false;
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise((resolve) => server.close(() => resolve()));
    }
    return this._setState({
      status: this.state.status === 'idle' ? 'idle' : 'stopped',
      mode: 'none',
      source: '',
      url: '',
      displayUrl: '',
      filePath: '',
      port: null,
      owned: false,
      checkedAt: new Date().toISOString(),
      error: ''
    });
  }
}

module.exports = {
  DEFAULT_MONITOR_INTERVAL_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  MAX_PREVIEW_URL_CHARS,
  MAX_STATIC_FILE_BYTES,
  PreviewError,
  PreviewManager,
  isSafePreviewNavigation,
  normalizeLoopbackUrl,
  probeLoopback
};
