const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('fixed runtime plugin bundles include every relative module import', () => {
  const manifest = JSON.parse(read('package.json'));
  for (const resource of manifest.build.extraResources.filter((entry) => entry.to.startsWith('harness-plugins/'))) {
    for (const file of resource.filter.filter((file) => file.endsWith('.mjs'))) {
      const source = read(path.join(resource.from, file));
      for (const match of source.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)) {
        assert.ok(resource.filter.includes(match[1]), `${resource.from}/${file} requires bundled ${match[1]}`);
        assert.ok(fs.existsSync(path.join(root, resource.from, match[1])));
      }
    }
  }
});

test('release-facing files follow the package version', () => {
  const manifest = JSON.parse(read('package.json'));
  const version = manifest.version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(fs.existsSync(path.join(root, 'docs', `RELEASE_NOTES_v${version}.md`)), true);
  assert.match(read('README.md'), new RegExp(`DSH-Desktop-Setup-${version.replaceAll('.', '\\.')}`));
  assert.match(read('PROGRESS.md'), new RegExp(`V${version.replaceAll('.', '\\.')}`));
});

test('Windows executable resources show lulu while retaining the legacy executable identity', () => {
  const manifest = JSON.parse(read('package.json'));
  const verifier = read('scripts/verify-windows-version-info.ps1');
  const governance = read('scripts/release-governance.cjs');
  const payloadBinding = read('scripts/release-payload-binding.cjs');
  const lifecycleSmoke = read('scripts/smoke-packaged-lifecycle.cjs');
  const safeExitSmoke = read('scripts/smoke-packaged-safe-exit.cjs');
  assert.equal(manifest.build.productName, 'lulu');
  assert.equal(manifest.build.win.executableName, 'DSH Desktop');
  assert.equal(manifest.build.nsis.shortcutName, 'lulu');
  assert.equal(manifest.devDependencies['electron-builder'], '26.11.1');
  assert.equal(manifest.devDependencies['7zip-bin'], '5.2.0');
  assert.equal(manifest.build.toolsets, undefined);
  assert.equal(manifest.build.afterPack, 'scripts/after-pack.cjs');
  assert.equal(manifest.build.win.signAndEditExecutable, true);
  assert.equal(manifest.build.win.signExecutable, false);
  assert.match(manifest.author, /DSH Desktop/u);
  assert.match(manifest.copyright, /DSH Desktop/u);
  assert.match(manifest.build.win.legalTrademarks, /Independent community project/u);
  assert.ok(manifest.build.extraResources.some((entry) => (
    entry.from === 'electron/harness-process-host.cjs'
      && entry.to === 'harness-host/harness-process-host.cjs'
  )));
  assert.equal(manifest.scripts['smoke:packaged-lifecycle'], 'node scripts/smoke-packaged-lifecycle.cjs');
  assert.equal(manifest.scripts['smoke:packaged-safe-exit'], 'node scripts/smoke-packaged-safe-exit.cjs');
  assert.match(manifest.scripts['verify:windows-identity'], /verify-windows-version-info\.ps1/);
  assert.match(verifier, /ExpectedProductName = 'lulu'/);
  assert.match(verifier, /ExpectedExecutableName = 'DSH Desktop'/);
  assert.match(verifier, /ProductName -eq \$ExpectedProductName/);
  assert.match(verifier, /FileDescription -eq \$ExpectedProductName/);
  assert.match(verifier, /InternalName -eq \$ExpectedExecutableName/);
  assert.match(verifier, /expectedOriginalFilename = "\$ExpectedExecutableName\.exe"/);
  assert.match(verifier, /OriginalFilename -ne 'electron\.exe'/);
  assert.match(governance, /requiredExecutableIdentityReady: executableIdentity\.ok === true/);
  assert.match(governance, /readArgument\('portable'\)/);
  assert.match(governance, /payloadBinding\.accepted === true/);
  assert.match(governance, /manifestBinding\.matches/);
  assert.match(payloadBinding, /payloadTrees\.installer\?\.matches === true/);
  assert.match(payloadBinding, /payloadTrees\.portable\?\.matches === true/);
  assert.match(payloadBinding, /executablesValid/);
  assert.match(payloadBinding, /Object\.values\(stability\)\.every/);
  assert.match(payloadBinding, /release-extractor-identity-mismatch/);
  assert.match(governance, /&& packageLayout\.requiredExecutableIdentityReady/);
  assert.doesNotMatch(lifecycleSmoke, /spawn\(executable,[^\n]+windowsHide: true/);
  assert.match(safeExitSmoke, /--safe-exit-smoke-file=/);
  assert.match(safeExitSmoke, /inspectPackagedBuild/);
  assert.match(safeExitSmoke, /readyState\.version !== buildEvidence\.package\.version/);
  assert.match(safeExitSmoke, /lifecycle\.status === 'clean'/);
  assert.match(safeExitSmoke, /harnessDescendantsBefore\.length < 1/);
  assert.match(safeExitSmoke, /terminalDescendantsBefore\.some/);
  assert.match(safeExitSmoke, /ownedPortResidueAfterExit\.length === 0/);
  assert.match(safeExitSmoke, /reusedPortsAfterExit/);
});

test('update dialog does not hard-code a superseded Stable version', () => {
  const main = read('electron/main.cjs');
  const dialog = main.slice(main.indexOf('const checkForUpdatesFromUser ='), main.indexOf('const checkForUpdatesFromUser =') + 4000);
  assert.match(dialog, /Stable 通道保持独立，仅在明确确认后更新/);
  assert.doesNotMatch(dialog, /V\d+\.\d+\.\d+ Stable/);
});

test('lulu display branding retains existing profile, update and backup compatibility identities', () => {
  const manifest = JSON.parse(read('package.json'));
  const main = read('electron/main.cjs');
  const update = read('electron/release-update.cjs');
  const backup = read('electron/support-backup.cjs');
  assert.equal(manifest.name, 'dsh-desktop');
  assert.equal(manifest.build.appId, 'com.dsh.desktop');
  assert.equal(manifest.build.win.artifactName, 'DSH-Desktop-Setup-${version}.${ext}');
  assert.equal(manifest.build.portable.artifactName, 'DSH-Desktop-Portable-${version}.${ext}');
  assert.match(main, /app\.setName\('DSH Desktop'\)/);
  assert.match(main, /app\.setAppUserModelId\('com\.dsh\.desktop'\)/);
  assert.match(main, /mainWindow\.setTitle\(`lulu — \$\{workspace\.displayName\}`\)/);
  assert.match(main, /appTray\.setToolTip\(`lulu · /);
  assert.match(main, /label: `关于 lulu V\$\{app\.getVersion\(\)\}/);
  assert.match(update, /api\.github\.com\/repos\/hejiahang0001-oss\/dsh-desktop\/releases/);
  assert.match(backup, /product: 'DSH Desktop'/);
  assert.match(backup, /manifest\.product !== 'DSH Desktop'/);
});

test('the current release pins the reviewed Electron 43 runtime and reports it in packaged smoke', () => {
  const manifest = JSON.parse(read('package.json'));
  const fetchScript = read('scripts/fetch-electron-runtime.ps1');
  const main = read('electron/main.cjs');

  assert.equal(manifest.devDependencies.electron, '43.5.0');
  assert.equal(manifest.build.electronDist, 'build/electron-v43.5.0-win32-x64.zip');
  assert.match(fetchScript, /Version = 'v43\.5\.0'/);
  assert.match(fetchScript, /ExpectedSha256 = '1fc131e62cafa02f0c94b5ec730c4eb1e8ce75e5f5b84f3c52a3443d86058184'/);
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
