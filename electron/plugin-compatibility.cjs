const { createRequire } = require('node:module');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_PEERS = 128;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall'];

const isInsideOrEqual = (root, candidate) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const lstatOrNull = async (target) => {
  try { return await fsp.lstat(target); } catch { return null; }
};

const realpathOrNull = async (target) => {
  try { return await fsp.realpath(target); } catch { return null; }
};

const readManifest = async (directory) => {
  const target = path.join(directory, 'package.json');
  const info = await lstatOrNull(target);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) throw new Error('manifest-unavailable');
  const value = JSON.parse(await fsp.readFile(target, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manifest-invalid');
  return value;
};

const classifyDependencySource = (value) => {
  const spec = typeof value === 'string' ? value.trim() : '';
  if (EXACT_VERSION_PATTERN.test(spec)) return 'registry-exact';
  if (/^(?:file|link|workspace):/i.test(spec) || /^(?:\.{1,2}[\\/]|[a-z]:[\\/])/i.test(spec)) return 'local';
  if (/^(?:git\+|git:|github:|ssh:|git@|https?:\/\/.*(?:\.git(?:#|$)|github\.com))/i.test(spec)) return 'git';
  if (/^(?:[~^<>=*]|\d+\.x(?:\.x)?$)/i.test(spec) || /\s|\|\|/.test(spec)) return 'registry-range';
  return 'registry-tag';
};

const parseVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value || '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
};

const compareVersion = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
};

const satisfiesSingleRange = (version, rawRange) => {
  const range = rawRange.trim();
  if (range === '' || range === '*' || /^x(?:\.x){0,2}$/i.test(range)) return true;
  const exact = parseVersion(range);
  if (exact) return compareVersion(version, exact) === 0;
  const prefixed = /^(\^|~)(\d+\.\d+\.\d+)$/.exec(range);
  if (prefixed) {
    const base = parseVersion(prefixed[2]);
    if (compareVersion(version, base) < 0) return false;
    if (prefixed[1] === '~') return version[0] === base[0] && version[1] === base[1];
    if (base[0] > 0) return version[0] === base[0];
    if (base[1] > 0) return version[0] === 0 && version[1] === base[1];
    return version[0] === 0 && version[1] === 0 && version[2] === base[2];
  }
  const comparators = range.split(/\s+/).filter(Boolean);
  if (comparators.length > 0 && comparators.every((item) => /^(?:>=|<=|>|<)\d+\.\d+\.\d+$/.test(item))) {
    return comparators.every((item) => {
      const match = /^(>=|<=|>|<)(\d+\.\d+\.\d+)$/.exec(item);
      const compared = compareVersion(version, parseVersion(match[2]));
      return match[1] === '>=' ? compared >= 0
        : match[1] === '<=' ? compared <= 0
          : match[1] === '>' ? compared > 0
            : compared < 0;
    });
  }
  return null;
};

const satisfiesSupportedRange = (versionValue, rangeValue) => {
  const version = parseVersion(versionValue);
  if (!version || typeof rangeValue !== 'string') return null;
  let unknown = false;
  for (const candidate of rangeValue.split('||')) {
    const result = satisfiesSingleRange(version, candidate);
    if (result === true) return true;
    if (result === null) unknown = true;
  }
  return unknown ? null : false;
};

const resolvePeer = async ({ packageDir, profileDir, runtimeModulesDir, packageName }) => {
  if (!PACKAGE_NAME_PATTERN.test(packageName)) return null;
  const anchor = path.join(packageDir, 'package.json');
  const profileModules = path.join(profileDir, 'node_modules');
  const fallbackModules = path.join(path.dirname(profileDir), 'node_modules');
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) || []) {
    const candidate = path.join(searchPath, packageName);
    if (!isInsideOrEqual(profileModules, candidate) && !isInsideOrEqual(fallbackModules, candidate)) continue;
    const real = await realpathOrNull(candidate);
    const allowedRuntime = runtimeModulesDir && isInsideOrEqual(runtimeModulesDir, real || '');
    if (!real || (!isInsideOrEqual(profileModules, real) && !isInsideOrEqual(fallbackModules, real) && !allowedRuntime)) continue;
    try {
      const manifest = await readManifest(real);
      return typeof manifest.version === 'string' ? manifest.version : '';
    } catch {
      return null;
    }
  }
  return null;
};

const inspectPatch = async (packageDir, manifest) => {
  const declared = manifest.dsh?.bundle?.patch;
  if (typeof declared !== 'string' || declared.length === 0 || declared.length > 512 || path.isAbsolute(declared) || declared.includes('\0')) return 'blocked';
  const target = path.resolve(packageDir, declared);
  if (!isInsideOrEqual(packageDir, target)) return 'blocked';
  const info = await lstatOrNull(target);
  if (!info?.isFile() || info.isSymbolicLink()) return info ? 'blocked' : 'missing';
  const real = await realpathOrNull(target);
  return real && isInsideOrEqual(packageDir, real) ? 'ready' : 'blocked';
};

const clientPlatform = (manifest) => {
  if (!manifest.dsh?.client) return 'host';
  const value = manifest.dsh.client.platform;
  if (value === 'web' || (Array.isArray(value) && value.includes('web'))) return 'web';
  return 'unsupported';
};

const inspectPeers = async ({ packageDir, profileDir, runtimeModulesDir, manifest }) => {
  const entries = Object.entries(manifest.peerDependencies || {})
    .filter(([name, range]) => PACKAGE_NAME_PATTERN.test(name) && typeof range === 'string')
    .slice(0, MAX_PEERS);
  let healthy = 0;
  let missing = 0;
  let mismatched = 0;
  let unverified = 0;
  for (const [name, range] of entries) {
    const version = await resolvePeer({ packageDir, profileDir, runtimeModulesDir, packageName: name });
    if (!version) {
      missing += 1;
      continue;
    }
    const satisfied = satisfiesSupportedRange(version, range);
    if (satisfied === true) healthy += 1;
    else if (satisfied === false) mismatched += 1;
    else unverified += 1;
  }
  const status = missing > 0 ? 'missing'
    : mismatched > 0 ? 'mismatched'
      : unverified > 0 ? 'unverified'
        : 'ready';
  return { status, expected: entries.length, healthy, missing, mismatched, unverified };
};

const inspectThirdPartyCompatibility = async ({ packageDir, profileDir, runtimeModulesDir, dependencySpec }) => {
  let manifest;
  try { manifest = await readManifest(packageDir); } catch {
    return {
      status: 'blocked',
      sourceType: classifyDependencySource(dependencySpec),
      bundlePatch: 'blocked',
      clientPlatform: 'unsupported',
      peers: { status: 'missing', expected: 0, healthy: 0, missing: 0, mismatched: 0, unverified: 0 },
      installHooks: []
    };
  }
  const sourceType = classifyDependencySource(dependencySpec);
  const bundlePatch = await inspectPatch(packageDir, manifest);
  const platform = clientPlatform(manifest);
  const peers = await inspectPeers({ packageDir, profileDir, runtimeModulesDir, manifest });
  const installHooks = INSTALL_HOOKS.filter((name) => typeof manifest.scripts?.[name] === 'string' && manifest.scripts[name].trim() !== '');
  const blocked = bundlePatch !== 'ready'
    || platform === 'unsupported'
    || ['missing', 'mismatched'].includes(peers.status)
    || installHooks.length > 0;
  const review = sourceType !== 'registry-exact' || peers.status === 'unverified';
  return {
    status: blocked ? 'blocked' : review ? 'review' : 'verified',
    sourceType,
    bundlePatch,
    clientPlatform: platform,
    peers,
    installHooks
  };
};

module.exports = {
  classifyDependencySource,
  inspectThirdPartyCompatibility,
  satisfiesSupportedRange
};
