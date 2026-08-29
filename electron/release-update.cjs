const { AtomicJsonFile } = require('./atomic-json-store.cjs');

const RELEASES_API = 'https://api.github.com/repos/hejiahang0001-oss/dsh-desktop/releases?per_page=20';
const RELEASE_BASE = 'https://github.com/hejiahang0001-oss/dsh-desktop/releases/tag/';
const MAX_RELEASE_RESPONSE_BYTES = 512 * 1024;
const RELEASE_TIMEOUT_MS = 10_000;
const VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

const parseVersion = (value) => {
  const match = VERSION_PATTERN.exec(String(value || '').trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 9999)) return null;
  return Object.freeze({ major: parts[0], minor: parts[1], patch: parts[2], text: parts.join('.') });
};

const compareVersions = (left, right) => {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  if (!a || !b) throw new TypeError('Version must be a bounded three-part semantic version.');
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
};

const normalizeRelease = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.draft === true) return null;
  const version = parseVersion(value.tag_name);
  if (!version) return null;
  const tag = `v${version.text}`;
  const url = `${RELEASE_BASE}${tag}`;
  if (value.html_url !== url) return null;
  const publishedAt = typeof value.published_at === 'string' && value.published_at.length <= 64
    ? value.published_at
    : '';
  return Object.freeze({
    version: version.text,
    tag,
    url,
    prerelease: value.prerelease === true,
    publishedAt
  });
};

const selectLatestProductRelease = (values) => {
  if (!Array.isArray(values) || values.length > 100) throw new TypeError('Release inventory is invalid.');
  const releases = values.slice(0, 20).map(normalizeRelease).filter(Boolean);
  releases.sort((left, right) => compareVersions(right.version, left.version));
  return releases[0] || null;
};

const readBoundedText = async (response, maximum = MAX_RELEASE_RESPONSE_BYTES) => {
  const declared = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new Error('GitHub 发布信息超过安全上限。');
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel().catch(() => undefined);
        throw new Error('GitHub 发布信息超过安全上限。');
      }
      chunks.push(Buffer.from(item.value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maximum) throw new Error('GitHub 发布信息超过安全上限。');
  return text;
};

const checkForProductUpdate = async ({ currentVersion, fetchImpl = globalThis.fetch } = {}) => {
  const current = parseVersion(currentVersion);
  if (!current || typeof fetchImpl !== 'function') throw new TypeError('Update check input is invalid.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELEASE_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetchImpl(RELEASES_API, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'DSH-Desktop-Update-Check',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response || response.status !== 200) throw new Error(`GitHub 更新检查失败（HTTP ${response?.status || 'unknown'}）。`);
    const text = await readBoundedText(response);
    let values;
    try { values = JSON.parse(text); } catch { throw new Error('GitHub 发布信息不是有效 JSON。'); }
    const release = selectLatestProductRelease(values);
    return Object.freeze({
      currentVersion: current.text,
      updateAvailable: Boolean(release && compareVersions(release.version, current) > 0),
      release,
      automaticDownload: false,
      automaticInstall: false
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('GitHub 更新检查超时。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const normalizePreferences = (value = {}) => Object.freeze({
  skippedVersion: parseVersion(value.skippedVersion)?.text || ''
});

class UpdatePreferenceStore {
  constructor({ filePath }) {
    this.storage = new AtomicJsonFile({ filePath });
    this.state = normalizePreferences();
  }

  async init() {
    const loaded = await this.storage.read({ fallback: {} });
    this.state = normalizePreferences(loaded.value);
    await this._persist();
    return this.getState();
  }

  async skip(version) {
    const parsed = parseVersion(version);
    if (!parsed) throw new TypeError('Skipped version is invalid.');
    this.state = normalizePreferences({ skippedVersion: parsed.text });
    await this._persist();
    return this.getState();
  }

  async clearSkip() {
    this.state = normalizePreferences();
    await this._persist();
    return this.getState();
  }

  async _persist() {
    await this.storage.write({ version: 1, ...this.state });
  }

  getState() {
    return { ...this.state };
  }
}

module.exports = {
  MAX_RELEASE_RESPONSE_BYTES,
  RELEASES_API,
  RELEASE_TIMEOUT_MS,
  UpdatePreferenceStore,
  checkForProductUpdate,
  compareVersions,
  normalizeRelease,
  parseVersion,
  selectLatestProductRelease
};
