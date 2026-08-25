const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { inspectThirdPartyCompatibility } = require('./plugin-compatibility.cjs');

const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_PROFILES = 16;
const MAX_PACKAGES = 1_024;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

const immutable = (value) => Object.freeze(value);

const isInsideOrEqual = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const normalizePath = (value) => (
  process.platform === 'win32' ? path.resolve(value).toLocaleLowerCase() : path.resolve(value)
);

const samePath = (left, right) => normalizePath(left) === normalizePath(right);

const validPackageName = (value) => typeof value === 'string'
  && value.length <= 214
  && PACKAGE_NAME_PATTERN.test(value);

const pathId = (value) => createHash('sha256')
  .update(normalizePath(value))
  .digest('hex')
  .slice(0, 20);

const lstatOrNull = async (target) => {
  try { return await fsp.lstat(target); } catch { return null; }
};

const realpathOrNull = async (target) => {
  try { return await fsp.realpath(target); } catch { return null; }
};

const readJsonObject = async (target) => {
  const info = await lstatOrNull(target);
  if (!info?.isFile() || info.isSymbolicLink()) throw new Error('manifest-unavailable');
  if (info.size > MAX_MANIFEST_BYTES) throw new Error('manifest-oversized');
  const parsed = JSON.parse(await fsp.readFile(target, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('manifest-invalid');
  return parsed;
};

const packageDirFromAnchor = async (anchor, packageName) => {
  if (!validPackageName(packageName)) return null;
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) || []) {
    const candidate = path.join(searchPath, packageName);
    if (await lstatOrNull(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
};

const sourceForRealPath = ({ realDir, installRoot, profileModules }) => {
  if (isInsideOrEqual(installRoot, realDir)) return 'runtime';
  if (isInsideOrEqual(profileModules, realDir)) return 'profile';
  return 'outside';
};

const inspectResolvedPackage = async ({ candidate, installRoot, profileModules, profileDir, dependencySpec }) => {
  if (!candidate) return immutable({ status: 'missing', source: 'none', version: '', declaresBundle: false });
  const realDir = await realpathOrNull(candidate);
  if (!realDir) return immutable({ status: 'missing', source: 'none', version: '', declaresBundle: false });
  const source = sourceForRealPath({ realDir, installRoot, profileModules });
  if (source === 'outside') return immutable({ status: 'blocked', source, version: '', declaresBundle: false });
  try {
    const manifest = await readJsonObject(path.join(realDir, 'package.json'));
    const compatibility = source === 'profile'
      ? await inspectThirdPartyCompatibility({ packageDir: realDir, profileDir, runtimeModulesDir: installRoot, dependencySpec })
      : null;
    return immutable({
      status: 'ready',
      source,
      version: typeof manifest.version === 'string' ? manifest.version : '',
      declaresBundle: typeof manifest.dsh?.bundle?.patch === 'string',
      ...(compatibility ? { compatibility: immutable(compatibility) } : {})
    });
  } catch {
    return immutable({ status: 'invalid', source, version: '', declaresBundle: false });
  }
};

const uniquePackageNames = (values) => {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    if (!validPackageName(value) || seen.has(value) || result.length >= MAX_PACKAGES) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
};

const runtimeClosure = async (dshPackageDir, installRoot) => {
  const anchor = path.join(dshPackageDir, 'package.json');
  const rootManifest = await readJsonObject(anchor);
  const packages = new Map([[rootManifest.name || '@deepseek-ai/dsh', dshPackageDir]]);
  const queue = [{ anchor, manifest: rootManifest }];
  while (queue.length > 0 && packages.size < MAX_PACKAGES) {
    const current = queue.shift();
    const names = uniquePackageNames([
      ...Object.keys(current.manifest.dependencies || {}),
      ...Object.keys(current.manifest.peerDependencies || {})
    ]);
    for (const name of names) {
      if (packages.has(name) || packages.size >= MAX_PACKAGES) continue;
      const candidate = await packageDirFromAnchor(current.anchor, name);
      const realDir = candidate ? await realpathOrNull(candidate) : null;
      if (!realDir || !isInsideOrEqual(installRoot, realDir)) continue;
      let manifest;
      try { manifest = await readJsonObject(path.join(realDir, 'package.json')); } catch { continue; }
      packages.set(name, realDir);
      queue.push({ anchor: path.join(realDir, 'package.json'), manifest });
    }
  }
  return packages;
};

const inspectFallback = async ({ fallbackRoot, expected }) => {
  let healthy = 0;
  let missing = 0;
  let misdirected = 0;
  const issues = [];
  for (const [name, expectedTarget] of expected) {
    const link = path.join(fallbackRoot, name);
    const info = await lstatOrNull(link);
    if (!info) {
      missing += 1;
      if (issues.length < 12) issues.push(immutable({ name, status: 'missing' }));
      continue;
    }
    const actualTarget = await realpathOrNull(link);
    const expectedReal = await realpathOrNull(expectedTarget);
    if (!info.isSymbolicLink() || !actualTarget || !expectedReal || !samePath(actualTarget, expectedReal)) {
      misdirected += 1;
      if (issues.length < 12) issues.push(immutable({ name, status: 'misdirected' }));
      continue;
    }
    healthy += 1;
  }
  return immutable({
    status: missing === 0 && misdirected === 0 ? 'healthy' : 'degraded',
    expected: expected.size,
    healthy,
    missing,
    misdirected,
    issues: immutable(issues),
    limited: expected.size >= MAX_PACKAGES
  });
};

class PluginHealthCatalog {
  constructor({ harnessHome, dshPackageDir }) {
    this.harnessHome = path.resolve(harnessHome);
    this.profilesRoot = path.join(this.harnessHome, 'profiles');
    this.fallbackRoot = path.join(this.profilesRoot, 'node_modules');
    this.dshPackageDir = path.resolve(dshPackageDir);
    this.installRoot = path.resolve(this.dshPackageDir, '..', '..');
    this.profilePaths = new Map();
  }

  async _resolveForProfile(name, profileDir, { bundle = false, dependencySpec } = {}) {
    const anchors = bundle
      ? [path.join(this.dshPackageDir, 'package.json'), path.join(profileDir, 'package.json')]
      : [path.join(profileDir, 'package.json')];
    let candidate = null;
    for (const anchor of anchors) {
      candidate = await packageDirFromAnchor(anchor, name);
      if (candidate) break;
    }
    return inspectResolvedPackage({
      candidate,
      installRoot: this.installRoot,
      profileModules: path.join(profileDir, 'node_modules'),
      profileDir,
      dependencySpec
    });
  }

  async _profile(entry) {
    const profileDir = path.join(this.profilesRoot, entry.name);
    const id = pathId(profileDir);
    this.profilePaths.set(id, profileDir);
    let manifest;
    try { manifest = await readJsonObject(path.join(profileDir, 'package.json')); } catch (error) {
      return immutable({
        id,
        name: entry.name,
        status: 'invalid',
        manifestName: '',
        workspaceReady: Boolean(await lstatOrNull(path.join(profileDir, 'pnpm-workspace.yaml'))),
        bundles: immutable([]),
        dependencies: immutable([]),
        message: error.message === 'manifest-oversized' ? 'Profile 清单超过 1 MiB。' : '缺少或无法读取 package.json。'
      });
    }

    const rawBundles = manifest.dsh?.profile?.bundles;
    if (!Array.isArray(rawBundles) || rawBundles.some((name) => !validPackageName(name))) {
      return immutable({
        id,
        name: entry.name,
        status: 'invalid',
        manifestName: typeof manifest.name === 'string' ? manifest.name : '',
        workspaceReady: Boolean(await lstatOrNull(path.join(profileDir, 'pnpm-workspace.yaml'))),
        bundles: immutable([]),
        dependencies: immutable([]),
        message: 'dsh.profile.bundles 不是有效的包名数组。'
      });
    }

    const bundles = [];
    const dependencyNames = uniquePackageNames(Object.keys(manifest.dependencies || {}));
    const dependencySet = new Set(dependencyNames);
    for (const name of uniquePackageNames(rawBundles)) {
      const resolved = await this._resolveForProfile(name, profileDir, {
        bundle: true,
        dependencySpec: dependencySet.has(name) ? manifest.dependencies[name] : undefined
      });
      bundles.push(immutable({
        name,
        ...resolved,
        status: resolved.status === 'ready' && !resolved.declaresBundle ? 'not-bundle' : resolved.status,
        profileManaged: dependencySet.has(name)
      }));
    }
    const dependencies = [];
    for (const name of dependencyNames) {
      const resolved = await this._resolveForProfile(name, profileDir, { dependencySpec: manifest.dependencies[name] });
      dependencies.push(immutable({
        name,
        ...resolved,
        enabled: rawBundles.includes(name),
        toggleable: resolved.status === 'ready'
          && resolved.declaresBundle
          && resolved.compatibility?.status !== 'blocked'
      }));
    }
    const workspaceReady = Boolean(await lstatOrNull(path.join(profileDir, 'pnpm-workspace.yaml')));
    const degraded = !workspaceReady
      || bundles.some(({ status }) => status !== 'ready')
      || dependencies.some(({ status, compatibility }) => status !== 'ready' || compatibility?.status === 'blocked');
    return immutable({
      id,
      name: entry.name,
      status: degraded ? 'degraded' : 'healthy',
      manifestName: typeof manifest.name === 'string' ? manifest.name : '',
      workspaceReady,
      bundles: immutable(bundles),
      dependencies: immutable(dependencies),
      message: degraded ? '存在未解析的扩展层或 pnpm Profile 配置缺口。' : '扩展层、声明依赖和 pnpm Profile 配置一致。'
    });
  }

  async scan() {
    this.profilePaths = new Map();
    let dshManifest;
    let closure;
    try {
      dshManifest = await readJsonObject(path.join(this.dshPackageDir, 'package.json'));
      closure = await runtimeClosure(this.dshPackageDir, this.installRoot);
    } catch {
      return immutable({
        available: false,
        profilesRoot: '$DSH_HOME/profiles',
        runtime: immutable({ status: 'unavailable', version: '', expected: 0, healthy: 0, missing: 0, misdirected: 0, issues: immutable([]) }),
        profiles: immutable([]),
        message: '无法读取当前固定 Harness 运行时。'
      });
    }
    const runtime = await inspectFallback({ fallbackRoot: this.fallbackRoot, expected: closure });
    let entries = [];
    try {
      entries = (await fsp.readdir(this.profilesRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== 'node_modules')
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, MAX_PROFILES);
    } catch {
      entries = [];
    }
    const profiles = [];
    for (const entry of entries) profiles.push(await this._profile(entry));
    return immutable({
      available: true,
      profilesRoot: '$DSH_HOME/profiles',
      runtime: immutable({ ...runtime, version: typeof dshManifest.version === 'string' ? dshManifest.version : '' }),
      profiles: immutable(profiles),
      profileLimitReached: entries.length >= MAX_PROFILES,
      message: '只读取包名、版本、解析结果和链接元数据；不会读取插件配置、补丁正文、凭据或会话内容。'
    });
  }

  async resolveProfilePath(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{20}$/.test(id)) return null;
    const target = this.profilePaths.get(id);
    if (!target) return null;
    const info = await lstatOrNull(target);
    return info?.isDirectory() && !info.isSymbolicLink() ? target : null;
  }
}

module.exports = {
  MAX_MANIFEST_BYTES,
  MAX_PACKAGES,
  MAX_PROFILES,
  PluginHealthCatalog,
  inspectFallback,
  runtimeClosure,
  validPackageName
};
