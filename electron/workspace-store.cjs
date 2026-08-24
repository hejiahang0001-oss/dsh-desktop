const fsp = require('node:fs/promises');
const path = require('node:path');
const { AtomicJsonFile } = require('./atomic-json-store.cjs');

const pathKey = (value) => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;

class WorkspaceStore {
  constructor({ filePath, fallbackDir, maxRecent = 8 }) {
    this.filePath = filePath;
    this.fallbackDir = fallbackDir;
    this.maxRecent = maxRecent;
    this.state = null;
    this.storage = new AtomicJsonFile({ filePath });
    this.recoverySource = 'uninitialized';
  }

  async _canonicalize(candidate) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
      const error = new Error('工作区必须是本机绝对目录。');
      error.code = 'WORKSPACE_PATH_INVALID';
      throw error;
    }
    const canonical = await fsp.realpath(candidate);
    const stats = await fsp.stat(canonical);
    if (!stats.isDirectory()) {
      const error = new Error('所选工作区不是目录。');
      error.code = 'WORKSPACE_NOT_DIRECTORY';
      throw error;
    }
    return canonical;
  }

  async _canonicalizeIfAvailable(candidate) {
    try {
      return await this._canonicalize(candidate);
    } catch {
      return null;
    }
  }

  async _persist() {
    await this.storage.write({
      version: 1,
      activePath: this.state.isFallback ? null : this.state.activePath,
      recentPaths: this.state.recentPaths
    });
  }

  async init() {
    await fsp.mkdir(this.fallbackDir, { recursive: true });
    const fallbackPath = await this._canonicalize(this.fallbackDir);
    const loaded = await this.storage.read({ fallback: {} });
    const stored = loaded.value;
    this.recoverySource = loaded.source;

    const activePath = await this._canonicalizeIfAvailable(stored.activePath) || fallbackPath;
    const candidates = Array.isArray(stored.recentPaths) ? stored.recentPaths : [];
    const recentPaths = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const canonical = await this._canonicalizeIfAvailable(candidate);
      if (!canonical || pathKey(canonical) === pathKey(fallbackPath)) continue;
      const key = pathKey(canonical);
      if (seen.has(key)) continue;
      seen.add(key);
      recentPaths.push(canonical);
      if (recentPaths.length === this.maxRecent) break;
    }
    if (pathKey(activePath) !== pathKey(fallbackPath) && !seen.has(pathKey(activePath))) {
      recentPaths.unshift(activePath);
      if (recentPaths.length > this.maxRecent) recentPaths.length = this.maxRecent;
    }

    this.state = {
      activePath,
      fallbackPath,
      isFallback: pathKey(activePath) === pathKey(fallbackPath),
      recentPaths
    };
    await this._persist();
    return this.getState();
  }

  async activate(candidate) {
    if (!this.state) throw new Error('工作区状态尚未初始化。');
    const activePath = await this._canonicalize(candidate);
    const activeKey = pathKey(activePath);
    const recentPaths = [
      activePath,
      ...this.state.recentPaths.filter((item) => pathKey(item) !== activeKey)
    ].slice(0, this.maxRecent);
    this.state = { ...this.state, activePath, isFallback: false, recentPaths };
    await this._persist();
    return this.getState();
  }

  getState() {
    if (!this.state) throw new Error('工作区状态尚未初始化。');
    const displayName = this.state.isFallback
      ? '未选择仓库'
      : path.basename(this.state.activePath) || path.parse(this.state.activePath).root;
    return {
      activePath: this.state.activePath,
      displayName,
      isFallback: this.state.isFallback,
      recentPaths: [...this.state.recentPaths]
    };
  }
}

module.exports = { WorkspaceStore, pathKey };
