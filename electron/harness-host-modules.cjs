const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const CLI = '@deepseek-ai/dsh';
const TOOLS = '@deepseek-ai/dsh-tools';
const LOCAL = '@deepseek-ai/dsh-credentials-local';
const CREDENTIALS = '@deepseek-ai/dsh-credentials';
const fail = () => { const error = new Error('Harness host modules have an invalid runtime identity or dependency boundary.'); error.code = 'HARNESS_HOST_MODULE_INVALID'; throw error; };
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};
const checkedFile = (file, root, realRoot) => {
  if (!inside(root, file)) fail();
  const real = fs.realpathSync(file);
  if (!inside(realRoot, real) || !fs.statSync(real).isFile()) fail();
  return real;
};
const manifest = (file, root, realRoot, name, version) => {
  const real = checkedFile(file, root, realRoot);
  if (fs.statSync(real).size > 128 * 1024) fail();
  const data = JSON.parse(fs.readFileSync(real, 'utf8'));
  if (data.name !== name || typeof data.version !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(data.version)
    || (version !== undefined && data.version !== version)) fail();
  return { real, version: data.version };
};

// Only layouts created by the official workspace or our fixed deployment are
// accepted. Never broaden to the project root or search ancestors on failure.
const runtimeBoundary = (bin) => {
  if (typeof bin !== 'string' || !path.isAbsolute(bin) || bin.includes('\0')
    || bin.slice(path.parse(bin).root.length).includes(':')) fail();
  const absolute = path.normalize(bin);
  if (path.basename(absolute) !== 'bin.js' || path.basename(path.dirname(absolute)) !== 'lib') fail();
  const cliDir = path.dirname(path.dirname(absolute));
  let root;
  if (path.basename(cliDir) === 'cli' && path.basename(path.dirname(cliDir)) === 'apps') {
    root = path.dirname(path.dirname(cliDir));
  } else if (path.basename(cliDir) === 'dsh' && path.basename(path.dirname(cliDir)) === '@deepseek-ai'
    && path.basename(path.dirname(path.dirname(cliDir))) === 'node_modules') {
    const modules = path.dirname(path.dirname(cliDir));
    const holder = path.dirname(modules), store = path.dirname(holder), outer = path.dirname(store);
    root = path.basename(store) === '.pnpm' && path.basename(outer) === 'node_modules'
      ? path.dirname(outer) : path.dirname(modules);
  } else fail();
  const realRoot = fs.realpathSync(root);
  checkedFile(absolute, root, realRoot);
  const identity = manifest(path.join(cliDir, 'package.json'), root, realRoot, CLI);
  // Reject a redirected executable even when its target is elsewhere in this runtime.
  if (!inside(path.dirname(identity.real), fs.realpathSync(absolute))) fail();
  return { bin: absolute, root, realRoot, version: identity.version };
};

const resolveHarnessHostModules = ({ dshBinPath, tools = true, credentials = false }) => {
  try {
    const boundary = runtimeBoundary(dshBinPath);
    const resolve = (anchor, name) => {
      const scoped = createRequire(anchor);
      const entry = scoped.resolve(name);
      const metadata = scoped.resolve(`${name}/package.json`);
      const realEntry = checkedFile(entry, boundary.root, boundary.realRoot);
      const identity = manifest(metadata, boundary.root, boundary.realRoot, name, boundary.version);
      if (!inside(path.dirname(metadata), entry) || !inside(path.dirname(identity.real), realEntry)) fail();
      return realEntry;
    };
    const result = {};
    if (tools) result.toolsModule = resolve(boundary.bin, TOOLS);
    if (credentials) {
      result.localModule = resolve(boundary.bin, LOCAL);
      // The abstract credential interface is a dependency of the provider,
      // not necessarily a direct dependency of the CLI under strict pnpm.
      result.providerModule = resolve(result.localModule, CREDENTIALS);
    }
    return Object.freeze(result);
  } catch {
    // Do not leak host paths or module search candidates through diagnostics.
    fail();
  }
};

module.exports = { resolveHarnessHostModules };
