const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('extension center is local-only, official-inventory-backed, metadata-only, and packaged', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/plugin-health-preload.cjs');
  const renderer = read('assets/plugin-health.js');
  const page = read('plugin-health.html');
  const catalog = read('electron/plugin-health.cjs');
  const center = read('electron/extension-center.cjs');
  const desktopPreload = read('electron/preload.cjs');
  const command = read('assets/workbench-command.js');
  const manifest = JSON.parse(read('package.json'));
  assert.match(main, /pluginHealthIpcAllowed/);
  assert.match(
    main,
    /isTrustedMainFrameEvent\(\s*event,\s*pluginHealthWindow\?\.webContents,\s*pluginHealthUrlAllowed\s*\)/
  );
  assert.match(main, /label: '扩展中心…'/);
  assert.match(main, /callHarnessRemote\(harnessOrigin, 'pluginInventory', 'list'/);
  assert.match(main, /ipcMain\.handle\('extensions:open-window'/);
  assert.match(main, /--plugin-health-smoke-file=/);
  assert.match(main, /runPluginHealthSmoke/);
  assert.match(main, /rendered\.toggleButtons === 1/);
  assert.match(main, /rendered\.catalogRows === 1/);
  assert.match(main, /rendered\.installButtons === 1/);
  assert.match(main, /rendered\.surfaceRows === 4/);
  assert.match(main, /Date\.now\(\) \+ 15000/);
  assert.match(main, /plugin-health-smoke-timeout/);
  assert.match(main, /!rendered\.text\.includes\('hidden-plugin-config-marker'\)/);
  assert.match(main, /rendered\.text\.includes\('兼容已验证'\)/);
  assert.match(preload, /plugin-health:get-state/);
  assert.match(preload, /plugin-health:refresh/);
  assert.match(preload, /plugin-health:reveal/);
  assert.match(preload, /plugin-health:toggle/);
  assert.match(preload, /plugin-health:install/);
  assert.match(preload, /plugin-health:lifecycle/);
  assert.doesNotMatch(preload, /readFile|writeFile|shell|ipcRenderer\.send/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /renderExtensionCenter\(state\.extensionCenter/);
  assert.match(renderer, /Skills/);
  assert.match(renderer, /MCP/);
  assert.match(page, /Skills、Plugins、Hooks、MCP/);
  assert.match(renderer, /pnpm 只管理 Profile 自己声明的外部依赖/);
  assert.match(renderer, /固定 registry/);
  assert.match(renderer, /compatibilityText\(item\.compatibility\)/);
  assert.match(renderer, /makeBadge\(item\.compatibility\.status\)/);
  assert.match(renderer, /api\.toggle\(profile\.id, item\.name, !item\.enabled\)/);
  assert.match(renderer, /api\.lifecycle\(target\.profileId, item\.id, action\)/);
  for (const action of ['install', 'upgrade', 'uninstall', 'rollback']) {
    assert.match(renderer, new RegExp(`addLifecycleButton\\('${action}'`));
  }
  assert.match(renderer, /安装脚本已禁止/);
  assert.match(renderer, /软件随附 pnpm/);
  assert.doesNotMatch(renderer, /document\.createElement\(['"]input['"]\)/);
  assert.doesNotMatch(renderer, /innerHTML|eval\(/);
  assert.doesNotMatch(catalog, /cordis\.patch\.yml.*readFile|\.credentials/);
  assert.match(center, /source: 'pluginInventory\.list'/);
  assert.match(center, /status: 'unsupported'/);
  assert.doesNotMatch(center, /readFile|writeFile|child_process|exec\(/);
  assert.match(desktopPreload, /extensions: Object\.freeze/);
  assert.match(desktopPreload, /extensions:open-window/);
  assert.match(command, /extensions\.open/);
  for (const asset of ['plugin-health.html', 'assets/plugin-health.css', 'assets/plugin-health.js']) {
    assert.ok(manifest.build.files.includes(asset), asset);
  }
  assert.ok(manifest.build.files.includes('electron/extension-center.cjs'));
});
