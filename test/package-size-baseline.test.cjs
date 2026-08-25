const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { categoryFor, packageSizeBaseline } = require('../scripts/package-size-baseline.cjs');

test('package size baseline separates fixed runtime categories without following links', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-package-size-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'DSH Desktop.exe': 5,
    'resources/app.asar': 7,
    'resources/harness/node_modules/pkg/index.js': 11,
    'resources/runtime/node.exe': 13,
    'resources/pnpm/package/bin/pnpm.mjs': 23,
    'resources/terminal/host.cjs': 17,
    'resources/other.txt': 19
  };
  for (const [relativePath, bytes] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.alloc(bytes));
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-package-size-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'hidden.bin'), Buffer.alloc(23));
  fs.symlinkSync(outside, path.join(root, 'resources', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

  const result = await packageSizeBaseline(root);
  assert.equal(result.totalFiles, 7);
  assert.equal(result.totalBytes, 95);
  assert.deepEqual(result.categories, {
    appAsar: { files: 1, bytes: 7 },
    harnessRuntime: { files: 1, bytes: 11 },
    nodeRuntime: { files: 1, bytes: 13 },
    pnpmRuntime: { files: 1, bytes: 23 },
    terminalRuntime: { files: 1, bytes: 17 },
    electronShell: { files: 2, bytes: 24 }
  });
});

test('package category mapping is stable for Windows and POSIX separators', () => {
  assert.equal(categoryFor('resources\\harness\\node_modules\\pkg'), 'harnessRuntime');
  assert.equal(categoryFor('resources/app.asar'), 'appAsar');
  assert.equal(categoryFor('resources\\pnpm\\package\\bin\\pnpm.mjs'), 'pnpmRuntime');
  assert.equal(categoryFor('resources/app-update.yml'), 'electronShell');
});
