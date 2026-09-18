const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KIT_VERSION = '0.0.1';
const ENGINE_NAME = '@deepseek-ai/libreoffice-kit-win32-x64';
const PREBUILDS_SHA256 = '2c669a9406303b8ba37e8b59885b2cc295f25fa7487488af830f0be887ddd8c3';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const regularPath = (root, relative, directory = false) => {
  const segments = relative.split('/');
  if (!relative || /[\\:\0<>"|?*]/.test(relative) || segments.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe Office asset path: ${relative}`);
  }
  let current = path.resolve(root);
  if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked Office root: ${root}`);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink()) throw new Error(`Linked Office asset: ${relative}`);
    const expectDirectory = index < segments.length - 1 || directory;
    if (expectDirectory ? !info.isDirectory() : !info.isFile()) throw new Error(`Invalid Office asset: ${relative}`);
  }
  return current;
};

const verifyEngineFiles = (engineRoot, files) => {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new Error('Invalid Office file inventory.');
  const entries = Object.entries(files);
  if (entries.length === 0 || entries.length > 10_000) throw new Error('Invalid Office inventory size.');
  let bytes = 0;
  for (const [relative, expected] of entries) {
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid Office asset digest.');
    const content = fs.readFileSync(regularPath(engineRoot, relative));
    if (sha256(content) !== expected) throw new Error(`Office asset digest mismatch: ${relative}`);
    bytes += content.length;
  }
  return { files: entries.length, bytes };
};

// Read-only: the Windows installer carries the complete native npm package,
// including sources/licenses. Never silently fall back to WASM or trim it.
const inspectOfficeEngine = (nodeModules) => {
  const scope = regularPath(nodeModules, '@deepseek-ai', true);
  const kitRoot = regularPath(scope, 'libreoffice-kit', true);
  const readJson = (root, relative) => JSON.parse(fs.readFileSync(regularPath(root, relative), 'utf8'));
  const kit = readJson(kitRoot, 'package.json');
  if (kit.name !== '@deepseek-ai/libreoffice-kit' || kit.version !== KIT_VERSION || kit.license !== 'MPL-2.0'
    || kit.optionalDependencies?.[ENGINE_NAME] !== KIT_VERSION) throw new Error('Office kit identity differs from the reviewed release.');
  for (const entry of fs.readdirSync(scope)) {
    if (entry.startsWith('libreoffice-kit-') && `@deepseek-ai/${entry}` !== ENGINE_NAME) {
      throw new Error(`Unexpected Office engine in Windows runtime: ${entry}`);
    }
  }
  const enginePath = path.join(scope, 'libreoffice-kit-win32-x64');
  if (!fs.existsSync(enginePath)) throw new Error('Required Windows native engine is missing; WASM fallback is forbidden.');
  const engineRoot = regularPath(scope, 'libreoffice-kit-win32-x64', true);
  const manifest = readJson(engineRoot, 'package.json');
  if (manifest.name !== ENGINE_NAME || manifest.version !== KIT_VERSION || manifest.license !== 'MPL-2.0') {
    throw new Error('Office native engine identity differs from the reviewed release.');
  }
  const prebuildBytes = fs.readFileSync(regularPath(engineRoot, 'prebuilds.json'));
  if (sha256(prebuildBytes) !== PREBUILDS_SHA256) throw new Error('Office prebuild manifest digest differs from the reviewed npm archive.');
  const prebuilds = JSON.parse(prebuildBytes);
  const assets = verifyEngineFiles(engineRoot, prebuilds.files);
  for (const file of ['LICENSE', 'NOTICE', 'lib/index.js', 'lib/worker.js']) regularPath(kitRoot, file);
  return {
    kit: `${kit.name}@${KIT_VERSION}`, engine: `${ENGINE_NAME}@${KIT_VERSION}`,
    platform: prebuilds.platform, prebuildsSha256: PREBUILDS_SHA256,
    source: { repository: prebuilds.source.repository, revision: prebuilds.source.revision },
    ...assets
  };
};

module.exports = { inspectOfficeEngine, verifyEngineFiles };
