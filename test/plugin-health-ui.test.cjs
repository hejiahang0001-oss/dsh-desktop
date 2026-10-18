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
  assert.match(main, /authenticatedHarnessRemote\(harnessOrigin, 'pluginInventory', 'list'/);
  assert.match(main, /ipcMain\.handle\('extensions:open-window'/);
  assert.match(main, /--plugin-health-smoke-file=/);
  assert.match(main, /runPluginHealthSmoke/);
  assert.match(main, /rendered\.toggleButtons === 0/);
  assert.match(main, /rendered\.catalogRows === 0/);
  assert.match(main, /rendered\.installButtons === 0/);
  assert.match(main, /rendered\.officialButtons === 1/);
  assert.match(main, /rendered\.historicalSections === 1/);
  assert.match(main, /rendered\.historicalButtons === 0/);
  assert.match(main, /JSON\.stringify\(\['getState', 'openOfficial', 'refresh', 'reveal', 'rollbackHistory'\]\)/);
  assert.match(main, /rendered\.surfaceRows === 4/);
  assert.match(main, /Date\.now\(\) \+ 15000/);
  assert.match(main, /plugin-health-smoke-timeout/);
  assert.match(main, /pluginSurface\?\.failed === 0/);
  assert.match(main, /runtimeState\.runtime\?\.status === 'healthy'/);
  for (const packageName of [
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-api-workspace-controller',
    '@deepseek-ai/dsh-session-log-export'
  ]) assert.ok(main.includes(packageName), packageName);
  assert.match(main, /!rendered\.text\.includes\('hidden-plugin-config-marker'\)/);
  assert.match(main, /!rendered\.text\.includes\('兼容已验证'\)/);
  assert.match(preload, /plugin-health:get-state/);
  assert.match(preload, /plugin-health:refresh/);
  assert.match(preload, /plugin-health:reveal/);
  assert.match(preload, /plugin-health:open-official/);
  assert.doesNotMatch(preload, /plugin-health:(toggle|install|lifecycle)/);
  assert.doesNotMatch(preload, /readFile|writeFile|shell|ipcRenderer\.send/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /renderExtensionCenter\(state\.extensionCenter/);
  assert.match(renderer, /Skills/);
  assert.match(renderer, /MCP/);
  assert.match(page, /Skills、Plugins、Hooks、MCP/);
  assert.match(renderer, /pnpm 只管理 Profile 自己声明的外部依赖/);
  assert.match(renderer, /api\.openOfficial\(\)/);
  assert.doesNotMatch(renderer, /compatibilityText|api\.(toggle|install|lifecycle)\(/);
  assert.match(page, /本地只读检查/);
  assert.match(page, /不重复裁决兼容性/);
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
