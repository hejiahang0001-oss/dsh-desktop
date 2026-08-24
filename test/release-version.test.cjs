const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('release-facing files follow the package version', () => {
  const manifest = JSON.parse(read('package.json'));
  const version = manifest.version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(fs.existsSync(path.join(root, 'docs', `RELEASE_NOTES_v${version}.md`)), true);
  assert.match(read('README.md'), new RegExp(`DSH-Desktop-Setup-${version.replaceAll('.', '\\.')}`));
  assert.match(read('PROGRESS.md'), new RegExp(`V${version.replaceAll('.', '\\.')}`));
});

test('V0.5.6 pins the reviewed Electron 43 runtime and reports it in packaged smoke', () => {
  const manifest = JSON.parse(read('package.json'));
  const fetchScript = read('scripts/fetch-electron-runtime.ps1');
  const main = read('electron/main.cjs');

  assert.equal(manifest.version, '0.5.6');
  assert.equal(manifest.devDependencies.electron, '43.4.1');
  assert.equal(manifest.build.electronDist, 'build/electron-v43.4.1-win32-x64.zip');
  assert.match(fetchScript, /Version = 'v43\.4\.1'/);
  assert.match(fetchScript, /ExpectedSha256 = 'c2ef9a5f65472c34d14bd3e67b7d14e66b0c01f124aba45263d6a4232160e13a'/);
  assert.match(fetchScript, /\$partial = "\$target\.partial"/);
  assert.match(fetchScript, /for \(\$attempt = 1; \$attempt -le \$MaxAttempts;/);
  assert.match(fetchScript, /Move-Item -LiteralPath \$partial -Destination \$target -Force/);
  assert.match(main, /electronVersion: process\.versions\.electron/);
  assert.match(main, /--pdf-smoke-file=/);
  assert.match(main, /const runPdfSmoke = async \(target\) =>/);
  assert.match(main, /type="application\/pdf"/);
  assert.match(main, /preload: path\.join\(__dirname, 'preload\.cjs'\),\s+contextIsolation: true,\s+nodeIntegration: false,\s+plugins: true,\s+sandbox: true/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /viewerDarkPixelRatio > 0\.08/);
  assert.match(main, /screenshotSize\.width > 0/);
});
