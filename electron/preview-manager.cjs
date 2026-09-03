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
const DEFAULT_CLOSE_TIMEOUT_MS = 2500;
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
    createServer = http.createServer,
    closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
    monitorIntervalMs = DEFAULT_MONITOR_INTERVAL_MS,
    maxStaticFileBytes = MAX_STATIC_FILE_BYTES
  } = {}) {
    super();
    this.workspacePath = '';
    this.workspaceRealPath = '';
    this.server = null;
    this.serverClose = null;
    this.monitor = null;
    this.monitorBusy = null;
    this.generation = 0;
    this.probe = probe;
    this.createServer = createServer;
    this.closeTimeoutMs = Math.max(25, Math.min(10000, Number(closeTimeoutMs) || DEFAULT_CLOSE_TIMEOUT_MS));
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
    return Boolean(this.server) || ['starting', 'ready', 'offline'].includes(this.state.status);
  }

  _isCurrentGeneration(generation) {
    return this.generation === generation;
  }

  async _closeOwnedServer(server) {
    if (!server) return;
    if (this.serverClose?.server === server) return this.serverClose.promise;
    let operation;
    operation = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          server.closeAllConnections?.();
        } catch {
          // The server is already closing; the bounded failure below remains authoritative.
        }
        reject(new PreviewError(
          'PREVIEW_CLOSE_TIMEOUT',
          `本机预览服务未能在 ${this.closeTimeoutMs} 毫秒内关闭，已强制断开其连接。`
        ));
      }, this.closeTimeoutMs);
      const onClosed = (error) => {
        if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') {
          finish(resolve);
          return;
        }
        finish(
          reject,
          new PreviewError('PREVIEW_CLOSE_FAILED', `本机预览服务关闭失败：${error.message || error}`)
        );
      };
      try {
        server.close(onClosed);
        try {
          server.closeIdleConnections?.();
        } catch {
          // A concurrent close can make this optional acceleration unavailable.
        }
      } catch (error) {
        onClosed(error);
      }
    }).finally(() => {
      if (this.serverClose?.promise === operation) this.serverClose = null;
    });
    this.serverClose = { server, promise: operation };
    return operation;
  }

  async _stopGeneration(generation) {
    const monitor = this.monitor;
    this.monitor = null;
    if (monitor) clearInterval(monitor);
    this.monitorBusy = null;
    const server = this.server;
    try {
      await this._closeOwnedServer(server);
    } catch (error) {
      if (this._isCurrentGeneration(generation) && this.server === server) {
        this._setState({
          status: 'failed',
          owned: true,
          checkedAt: new Date().toISOString(),
          error: error.message
        });
      }
      throw error;
    }
    if (this.server === server) this.server = null;
    if (!this._isCurrentGeneration(generation)) return this.getState();
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

  async activate(workspacePath = this.workspacePath) {
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath)) {
      throw new PreviewError('PREVIEW_WORKSPACE_INVALID', '应用预览工作区必须是绝对目录。');
    }
    const generation = this.generation + 1;
    this.generation = generation;
    await this._stopGeneration(generation);
    if (!this._isCurrentGeneration(generation)) return this.getState();
    const resolved = path.resolve(workspacePath);
    const state = await fsp.stat(resolved);
    if (!this._isCurrentGeneration(generation)) return this.getState();
    if (!state.isDirectory()) throw new PreviewError('PREVIEW_WORKSPACE_INVALID', '应用预览工作区不是目录。');
    const realPath = await fsp.realpath(resolved);
    if (!this._isCurrentGeneration(generation)) return this.getState();
    this.workspacePath = resolved;
    this.workspaceRealPath = realPath;
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
    const generation = this.generation + 1;
    this.generation = generation;
    await this._stopGeneration(generation);
    if (!this._isCurrentGeneration(generation)) return this.getState();
    const resolved = this._resolve(relativePath);
    await this._assertNoLinkTraversal(resolved);
    if (!this._isCurrentGeneration(generation)) return this.getState();
    const fileState = await fsp.lstat(resolved.absolutePath);
    if (!this._isCurrentGeneration(generation)) return this.getState();
    if (!fileState.isFile()) throw new PreviewError('PREVIEW_NOT_FILE', '所选 HTML 路径不是普通文件。');
    this._setState({ status: 'starting', mode: 'static', source: 'workspace-html', filePath: resolved.relativePath, owned: true, error: '' });
    const server = this.createServer((request, response) => { void this._serve(request, response); });
    this.server = server;
    server.on('error', (error) => {
      if (!this._isCurrentGeneration(generation) || this.server !== server) return;
      this._setState({ status: 'failed', error: error.message, owned: true });
    });
    const listening = await new Promise((resolve, reject) => {
      const cleanup = () => {
        server.off('listening', onListening);
        server.off('error', onError);
        server.off('close', onClose);
      };
      const onListening = () => {
        cleanup();
        resolve(true);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        if (!this._isCurrentGeneration(generation) || this.server !== server) resolve(false);
        else reject(new PreviewError('PREVIEW_LISTEN_CLOSED', '本机预览端口在启动完成前关闭。'));
      };
      server.once('listening', onListening);
      server.once('error', onError);
      server.once('close', onClose);
      server.listen(0, '127.0.0.1');
    });
    if (!listening || !this._isCurrentGeneration(generation) || this.server !== server) return this.getState();
    const address = server.address();
    if (!address || typeof address === 'string') {
      await this._closeOwnedServer(server);
      if (this.server === server) this.server = null;
      throw new PreviewError('PREVIEW_PORT_FAILED', '无法取得本机预览端口。');
    }
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
    const generation = this.generation + 1;
    this.generation = generation;
    await this._stopGeneration(generation);
    if (!this._isCurrentGeneration(generation)) return this.getState();
    const url = normalizeLoopbackUrl(value, { reservedOrigins });
    const operationReservedOrigins = [...reservedOrigins];
    this.reservedOrigins = operationReservedOrigins;
    this._setState({ status: 'starting', mode: 'external', source: 'local-server', url, displayUrl: url, owned: false, error: '' });
    const result = await this.probe(url, { reservedOrigins: operationReservedOrigins });
    if (!this._isCurrentGeneration(generation)) return this.getState();
    if (!result.ok) {
      return this._setState({ status: 'offline', checkedAt: new Date().toISOString(), error: result.error?.message || '本机服务当前不可访问。' });
    }
    const state = this._setState({ status: 'ready', checkedAt: new Date().toISOString(), error: '' });
    this.monitor = setInterval(() => { void this._monitorExternal(generation); }, this.monitorIntervalMs);
    this.monitor.unref?.();
    return state;
  }

  async _monitorExternal(generation = this.generation) {
    if (!this._isCurrentGeneration(generation) || this.monitorBusy === generation || this.state.mode !== 'external' || !this.state.url) return;
    const url = this.state.url;
    const reservedOrigins = [...this.reservedOrigins];
    this.monitorBusy = generation;
    try {
      const result = await this.probe(url, { reservedOrigins });
      if (!this._isCurrentGeneration(generation) || this.state.mode !== 'external' || this.state.url !== url) return;
      const status = result.ok ? 'ready' : 'offline';
      const error = result.ok ? '' : result.error?.message || '本机服务当前不可访问。';
      if (status !== this.state.status || error !== this.state.error) {
        this._setState({ status, checkedAt: new Date().toISOString(), error });
      }
    } finally {
      if (this.monitorBusy === generation) this.monitorBusy = null;
    }
  }

  async stop() {
    const generation = this.generation + 1;
    this.generation = generation;
    return this._stopGeneration(generation);
  }
}

module.exports = {
  DEFAULT_CLOSE_TIMEOUT_MS,
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
