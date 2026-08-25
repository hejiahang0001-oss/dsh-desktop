const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_FILES = 50_000;
const CATEGORY_ORDER = Object.freeze(['appAsar', 'harnessRuntime', 'nodeRuntime', 'pnpmRuntime', 'terminalRuntime', 'electronShell']);

const categoryFor = (relativePath) => {
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized === 'resources/app.asar') return 'appAsar';
  if (normalized.startsWith('resources/harness/')) return 'harnessRuntime';
  if (normalized.startsWith('resources/runtime/')) return 'nodeRuntime';
  if (normalized.startsWith('resources/pnpm/')) return 'pnpmRuntime';
  if (normalized.startsWith('resources/terminal/')) return 'terminalRuntime';
  return 'electronShell';
};

const packageSizeBaseline = async (rootPath) => {
  const root = path.resolve(rootPath);
  const categories = Object.fromEntries(CATEGORY_ORDER.map((name) => [name, { files: 0, bytes: 0 }]));
  const queue = [root];
  let totalFiles = 0;
  let totalBytes = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile()) {
        if (totalFiles >= MAX_FILES) throw new Error(`Package baseline exceeded ${MAX_FILES} files.`);
        const info = await fsp.lstat(target);
        const category = categoryFor(path.relative(root, target));
        categories[category].files += 1;
        categories[category].bytes += info.size;
        totalFiles += 1;
        totalBytes += info.size;
      }
    }
  }
  return Object.freeze({
    version: 1,
    root: path.basename(root),
    totalFiles,
    totalBytes,
    categories: Object.freeze(Object.fromEntries(CATEGORY_ORDER.map((name) => [name, Object.freeze(categories[name])])))
  });
};

const readArgument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

if (require.main === module) {
  const root = readArgument('root');
  if (!root) {
    process.stderr.write('Usage: node scripts/package-size-baseline.cjs --root=<unpacked application>\n');
    process.exitCode = 2;
  } else {
    packageSizeBaseline(root)
      .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      });
  }
}

module.exports = { CATEGORY_ORDER, MAX_FILES, categoryFor, packageSizeBaseline };
