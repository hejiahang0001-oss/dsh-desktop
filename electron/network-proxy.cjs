const fsp = require('node:fs/promises');
const path = require('node:path');

const PROXY_MODES = new Set(['direct', 'system', 'custom']);
const LOOPBACK_BYPASS = '127.0.0.1,localhost,::1';
const MAX_PROXY_URL_LENGTH = 512;

class ProxySettingsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProxySettingsError';
    this.code = code;
  }
}

const normalizeProxyUrl = (value) => {
  const text = String(value || '').trim();
  if (!text || text.length > MAX_PROXY_URL_LENGTH) {
    throw new ProxySettingsError('invalid-url', '请输入有效的 HTTP 或 HTTPS 代理地址。');
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new ProxySettingsError('invalid-url', '代理地址格式无效。示例：http://127.0.0.1:7890');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new ProxySettingsError('unsupported-protocol', '当前仅支持 HTTP 或 HTTPS 代理。');
  }
  if (url.username || url.password) {
    throw new ProxySettingsError('credentials-not-supported', '当前版本不在代理地址中保存用户名或密码。');
  }
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new ProxySettingsError('invalid-url', '代理地址只能包含协议、主机和端口。');
  }
  return url.origin;
};

const normalizeProxySettings = (value = {}) => {
  const mode = PROXY_MODES.has(value.mode) ? value.mode : 'direct';
  return Object.freeze({
    mode,
    proxyUrl: mode === 'custom' ? normalizeProxyUrl(value.proxyUrl) : ''
  });
};

const parseResolvedProxy = (value) => {
  const entries = String(value || '').split(';').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (/^DIRECT$/i.test(entry)) return '';
    const match = /^(PROXY|HTTPS)\s+(.+)$/i.exec(entry);
    if (match) {
      const protocol = match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http';
      return normalizeProxyUrl(`${protocol}://${match[2]}`);
    }
    if (/^SOCKS/i.test(entry)) {
      throw new ProxySettingsError('unsupported-system-proxy', 'Windows 当前解析为 SOCKS 代理；本版 Harness 网络链仅支持 HTTP(S) 代理。');
    }
  }
  throw new ProxySettingsError('unresolved-system-proxy', '无法从 Windows 系统设置解析可用代理。');
};

const sessionProxyConfig = (settings) => {
  const normalized = normalizeProxySettings(settings);
  if (normalized.mode === 'direct') return Object.freeze({ mode: 'direct' });
  if (normalized.mode === 'system') return Object.freeze({ mode: 'system' });
  return Object.freeze({
    mode: 'fixed_servers',
    proxyRules: normalized.proxyUrl,
    proxyBypassRules: '127.0.0.1;localhost;[::1]'
  });
};

const buildHarnessProxyEnvironment = (effectiveProxyUrl) => {
  if (!effectiveProxyUrl) return Object.freeze({});
  const proxyUrl = normalizeProxyUrl(effectiveProxyUrl);
  return Object.freeze({
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: LOOPBACK_BYPASS,
    NODE_USE_ENV_PROXY: '1'
  });
};

const proxySettingsEqual = (left, right) => {
  const normalizedLeft = normalizeProxySettings(left);
  const normalizedRight = normalizeProxySettings(right);
  return normalizedLeft.mode === normalizedRight.mode && normalizedLeft.proxyUrl === normalizedRight.proxyUrl;
};

const proxySettingsDescription = (settings) => {
  const normalized = normalizeProxySettings(settings);
  if (normalized.mode === 'custom') return `自定义代理 ${normalized.proxyUrl}`;
  if (normalized.mode === 'system') return 'Windows 系统代理';
  return '直连';
};

const confirmProxySettingsChange = async ({ dialog, parentWindow, previous, proposed }) => {
  const settings = normalizeProxySettings(proposed);
  if (proxySettingsEqual(previous, settings)) {
    return Object.freeze({ changed: false, confirmed: true, settings });
  }
  const options = {
    type: 'question',
    title: '确认修改网络与代理',
    message: '保存新的 Harness 网络设置？',
    detail: `当前：${proxySettingsDescription(previous)}\n修改为：${proxySettingsDescription(settings)}\n\n确认后将保存设置并重启 Harness；集成终端和本机回环地址不受影响。`,
    buttons: ['保存并重启', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
  const result = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  return Object.freeze({ changed: true, confirmed: result.response === 0, settings });
};

class ProxySettingsStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = normalizeProxySettings();
  }

  async init() {
    let stored = {};
    try {
      stored = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
    } catch {
      stored = {};
    }
    try {
      this.state = normalizeProxySettings(stored);
    } catch {
      this.state = normalizeProxySettings();
    }
    await this._persist();
    return this.getState();
  }

  async set(settings) {
    this.state = normalizeProxySettings(settings);
    await this._persist();
    return this.getState();
  }

  async _persist() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await fsp.writeFile(this.filePath, `${JSON.stringify({ version: 1, ...this.state }, null, 2)}\n`, 'utf8');
  }

  getState() {
    return { ...this.state };
  }
}

module.exports = {
  LOOPBACK_BYPASS,
  MAX_PROXY_URL_LENGTH,
  ProxySettingsError,
  ProxySettingsStore,
  buildHarnessProxyEnvironment,
  confirmProxySettingsChange,
  normalizeProxySettings,
  normalizeProxyUrl,
  parseResolvedProxy,
  sessionProxyConfig
};
