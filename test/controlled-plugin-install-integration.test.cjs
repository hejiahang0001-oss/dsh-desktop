const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('controlled plugin lifecycle is fixed-catalog, native-confirmed, busy-gated, and crash-recoverable', () => {
  const main = read('electron/main.cjs');
  const installer = read('electron/controlled-plugin-installer.cjs');
  const preload = read('electron/plugin-health-preload.cjs');
  const wrapper = read('build/pnpm/pnpm.cmd');
  const manifest = JSON.parse(read('package.json'));

  assert.match(main, /ipcMain\.handle\('plugin-health:install'/);
  assert.match(main, /ipcMain\.handle\('plugin-health:lifecycle'/);
  assert.match(main, /if \(!pluginHealthIpcAllowed\(event\)\)/);
  assert.match(main, /pluginTogglePromise \|\| pluginInstallPromise/);
  assert.match(main, /\['install', 'upgrade', 'uninstall', 'rollback'\]\.includes\(action\)/);
  assert.match(main, /buttons: \['取消', `\$\{selectedAction\.verb\}并重启 Harness`\]/);
  assert.match(main, /defaultId: 0/);
  assert.match(main, /cancelId: 0/);
  assert.match(main, /controlledPluginInstaller\[selectedAction\.method\]/);
  assert.match(main, /controlledPluginInstaller\.commit/);
  assert.match(main, /controlledPluginInstaller\.rollback/);
  assert.match(main, /verifiedDependency\?\.compatibility\?\.status === 'verified'/);
  assert.match(preload, /install: \(profileId, catalogId\)/);
  assert.match(preload, /lifecycle: \(profileId, catalogId, action\)/);
  assert.doesNotMatch(preload, /packageSpec|pnpmArgs|command/);

  assert.match(installer, /id: 'catppuccin-0\.3\.1'/);
  assert.match(installer, /name: '@nonamelego\/dsh-catppuccin'/);
  assert.match(installer, /version: '0\.3\.1'/);
  assert.match(installer, /'0\.3\.0': Object\.freeze/);
  assert.match(installer, /LIFECYCLE_JOURNAL_NAME = 'package\.json\.dsh-desktop-plugin-transaction\.json'/);
  assert.match(installer, /LAST_KNOWN_GOOD_NAME = 'package\.json\.dsh-desktop-plugin-last-known-good\.json'/);
  assert.match(installer, /async recoverPending/);
  assert.match(installer, /rollbackLastKnownGood/);
  assert.match(installer, /BUNDLED_PNPM_VERSION = '11\.19\.0'/);
  assert.match(installer, /'--save-exact'/);
  assert.match(installer, /'--ignore-scripts'/);
  assert.match(installer, /--registry=\$\{CONTROLLED_REGISTRY\}/);
  assert.match(installer, /NPM_CONFIG_IGNORE_SCRIPTS = 'true'/);
  assert.match(installer, /NPM_CONFIG_STORE_DIR = path\.join\(harnessHome, '\.pnpm-store'\)/);
  assert.match(installer, /normalized === 'NODE_OPTIONS'/);
  assert.match(installer, /environment\.ComSpec = path\.join\(windowsRoot, 'System32', 'cmd\.exe'\)/);
  assert.match(installer, /\[this\.pnpmRuntime\.binPath, 'prune'\]/);
  assert.match(main, /error\?\.code === 'install-rollback-failed'/);
  assert.match(main, /本次运行已封锁该 Profile/);
  assert.match(installer, /buildHarnessEnvironment/);
  assert.doesNotMatch(installer, /allowUnknownOption|passThroughOptions|shell: true/);

  assert.match(wrapper, /\.\.\\runtime\\node\.exe/);
  assert.match(wrapper, /package\\bin\\pnpm\.mjs/);
  assert.equal(manifest.devDependencies.pnpm, '11.19.0');
  const pnpmResources = manifest.build.extraResources.find((entry) => entry.to === 'pnpm/package');
  assert.equal(pnpmResources.from, 'node_modules/pnpm');
});
