const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { openOfficialPlugins, openPluginsPanel, readOnlyPluginState, registerRetiredPluginMutations } = require('../electron/official-plugins.cjs');

const host = () => {
  const calls = [];
  let url = 'http://127.0.0.1:39271/';
  const window = { isDestroyed: () => false, isMinimized: () => false, show: () => calls.push('show'), focus: () => calls.push('focus'),
    webContents: { getURL: () => url, executeJavaScript: async () => { calls.push('navigate'); return true; } } };
  return { calls, window, navigate: value => { url = value; }, options: { getWindow: () => window, getOrigin: () => 'http://127.0.0.1:39271', ready: () => true, collapse: async () => {} } };
};

test('official plugin entry navigates only the current ready loopback window', async () => {
  const h = host();
  assert.equal((await openOfficialPlugins(h.options)).ok, true);
  assert.deepEqual(h.calls, ['navigate', 'show', 'focus']);
  for (const origin of ['https://example.org', 'http://localhost:39271', 'http://127.0.0.1:39272']) {
    const other = host(); other.navigate(origin);
    assert.equal((await openOfficialPlugins(other.options)).ok, false);
    assert.deepEqual(other.calls, []);
  }
  const changed = host();
  changed.options.collapse = async () => changed.navigate('file:///local-error.html');
  assert.equal((await openOfficialPlugins(changed.options)).ok, false);
  assert.deepEqual(changed.calls, []);
  const stopped = host(); stopped.options.ready = () => false;
  assert.equal((await openOfficialPlugins(stopped.options)).ok, false);
  const absent = host(); absent.window.webContents.executeJavaScript = async () => false;
  assert.equal((await openOfficialPlugins(absent.options)).ok, false);
});

test('official panel navigation clicks one visible public control and verifies selection', async () => {
  const run = async (buttons) => vm.runInNewContext(`(${openPluginsPanel.toString()})()`, {
    document: { querySelectorAll: (selector) => {
      assert.equal(selector, 'nav[aria-label="全局面板"] button[aria-label="插件"], nav[aria-label="Global panels"] button[aria-label="Plugins"]');
      return buttons;
    } }, setTimeout, Date
  });
  let clicks = 0, selected = false;
  const button = { disabled: false, getClientRects: () => [{}], click: () => { clicks += 1; selected = true; }, getAttribute: () => selected ? 'page' : null, isConnected: true };
  assert.equal(await run([button]), true);
  assert.equal(clicks, 1);
  assert.equal(await run([]), false);
  assert.equal(await run([button, button]), false);
  assert.equal(await run([{ ...button, disabled: true }]), false);
  assert.equal(await run([{ ...button, getClientRects: () => [] }]), false);
  assert.equal(await run([{ ...button, isConnected: false }]), false);
});

test('official navigation rejects a changed window or origin after the public click', async () => {
  for (const kind of ['origin', 'window', 'error']) {
    const h = host();
    h.window.webContents.executeJavaScript = async () => {
      if (kind === 'origin') h.navigate('https://example.org');
      if (kind === 'window') h.options.getWindow = () => null;
      if (kind === 'error') throw new Error('renderer gone');
      return true;
    };
    // getWindow is captured by the navigator, so use a mutable owner instead.
    let owner = h.window;
    h.options.getWindow = () => owner;
    if (kind === 'window') h.window.webContents.executeJavaScript = async () => { owner = null; return true; };
    assert.equal((await openOfficialPlugins(h.options)).ok, false);
    assert.deepEqual(h.calls, []);
  }
});

test('retired mutation IPC rejects even trusted requests without executing a write', async () => {
  const handlers = new Map();
  registerRetiredPluginMutations({ handle: (name, handler) => handlers.set(name, handler) }, event => event.trusted);
  assert.deepEqual([...handlers.keys()].sort(), ['plugin-health:install', 'plugin-health:lifecycle', 'plugin-health:toggle']);
  for (const handler of handlers.values()) {
    assert.equal((await handler({ trusted: false }, 'web', 'arbitrary-package')).ok, false);
    const result = await handler({ trusted: true }, 'web', 'arbitrary-package', 'install');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'official-plugin-manager-required');
    assert.match(result.message, /官方插件页/);
  }
});

test('read-only health projection does not expose local compatibility verdicts or mutation capabilities', () => {
  const input = { available: true, catalog: [{ targets: [{ canInstall: true }] }], profiles: [{ id: 'p', status: 'degraded', workspaceReady: true,
    bundles: [{ name: 'bundle', status: 'ready', compatibility: { status: 'blocked' } }],
    dependencies: [{ name: 'bundle', status: 'ready', toggleable: true, compatibility: { status: 'verified' }, version: '1.2.3' }] }] };
  const result = readOnlyPluginState(input);
  assert.equal(result.management, 'official');
  assert.deepEqual(result.catalog, []);
  assert.equal(result.profiles[0].status, 'healthy');
  assert.equal(result.profiles[0].dependencies[0].version, '1.2.3');
  assert.equal(Object.hasOwn(result.profiles[0].dependencies[0], 'compatibility'), false);
  assert.equal(result.profiles[0].dependencies[0].toggleable, false);
  assert.equal(input.profiles[0].dependencies[0].toggleable, true);
  assert.equal(readOnlyPluginState({ profiles: [{ status: 'invalid' }] }).profiles[0].status, 'invalid');
});

test('desktop registers the retired boundary and exposes only official navigation plus read-only health', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron/plugin-health-preload.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'assets/plugin-health.js'), 'utf8');
  assert.match(main, /registerRetiredPluginMutations\(ipcMain, pluginHealthIpcAllowed\)/);
  assert.match(main, /ipcMain\.handle\('plugin-health:open-official', \(event\) => \(\s*pluginHealthIpcAllowed\(event\)/);
  assert.doesNotMatch(main, /const performPlugin(?:Install|Toggle)\b/);
  assert.match(main, /controlledPluginInstaller\.recoverPending/);
  assert.match(main, /profileBundleManager\.recoverPending/);
  assert.doesNotMatch(preload, /plugin-health:(?:install|lifecycle|toggle)/);
  assert.match(preload, /openOfficial: \(\) => ipcRenderer\.invoke\('plugin-health:open-official'\)/);
  assert.doesNotMatch(renderer, /api\.(?:install|lifecycle|toggle)\(/);
  assert.doesNotMatch(renderer, /compatibilityText|兼容已验证/);
});

test('preload exposes no stale mutators, and the health renderer ignores old mutation capabilities', async () => {
  const root = path.resolve(__dirname, '..'), calls = [];
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/plugin-health-preload.cjs'), 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'pluginHealthAPI'); api = value; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return {}; } } };
    }
  });
  assert.deepEqual(Object.keys(api).sort(), ['getState', 'openOfficial', 'refresh', 'reveal', 'rollbackHistory']);
  await api.openOfficial();
  assert.deepEqual(calls, [['plugin-health:open-official']]);

  const nodes = new Map(), created = [];
  const make = (id = '') => {
    const node = { id, children: [], listeners: {}, disabled: false, textContent: '',
      append: (...items) => node.children.push(...items), addEventListener: (event, handler) => { node.listeners[event] = handler; },
      get firstChild() { return null; } };
    created.push(node); return node;
  };
  const document = { getElementById: id => { if (!nodes.has(id)) nodes.set(id, make(id)); return nodes.get(id); }, createElement: tag => ({ ...make(), tag }), addEventListener: () => {} };
  let opened = 0, rolledBack = 0;
  const state = { available: true, runtime: { status: 'healthy' }, extensionCenter: { surfaces: [] },
    historicalRollback: { items: [{ profileId: 'legacy', catalogId: 'known', displayName: 'Historical theme', profileName: 'web', canRollback: true }] },
    catalog: [{ targets: [{ canInstall: true, canUpgrade: true, canUninstall: true, canRollback: true }] }],
    profiles: [{ id: 'legacy', dependencies: [{ name: 'legacy-plugin', toggleable: true, enabled: false, compatibility: { status: 'verified' } }] }] };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/plugin-health.js'), 'utf8'), { document,
    window: { close: () => {}, pluginHealthAPI: { getState: async () => state, refresh: async () => state, reveal: async () => ({}), openOfficial: async () => { opened += 1; throw new Error('not ready'); },
      rollbackHistory: async (profileId, catalogId) => { assert.equal(profileId, 'legacy'); assert.equal(catalogId, 'known'); rolledBack += 1; throw new Error('changed'); } } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes.get('status').textContent, '扩展状态检查完成。');
  assert.equal(created.some(node => /toggle-button|lifecycle-button|install-button/.test(node.className || '')), false);
  await nodes.get('open-official').listeners.click();
  assert.equal(opened, 1);
  assert.equal(nodes.get('open-official').disabled, false);
  assert.match(nodes.get('status').textContent, /没有安装或更改插件/);
  const historyButton = nodes.get('history-rollbacks').children[0].children[1];
  assert.equal(historyButton.textContent, '回退历史桌面事务');
  assert.equal(historyButton.disabled, false);
  await historyButton.listeners.click();
  assert.equal(rolledBack, 1); assert.equal(historyButton.disabled, true);
  assert.match(nodes.get('status').textContent, /原恢复记录不会自动删除/);
});
