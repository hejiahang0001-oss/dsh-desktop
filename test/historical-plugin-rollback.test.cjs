const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { buildExtensionCenter } = require('../electron/extension-center.cjs');
const { createHistoricalPluginRollback } = require('../electron/historical-plugin-rollback.cjs');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('dedicated historical rollback IPC is available without reopening ordinary plugin mutation IPC', () => {
  assert.equal(read('electron/main.cjs').includes('plugin-health:rollback-history'), true);
  assert.match(read('electron/plugin-health-preload.cjs'), /rollbackHistory:/);
  assert.doesNotMatch(read('electron/plugin-health-preload.cjs'), /plugin-health:(?:install|toggle|lifecycle)/);
  assert.match(read('plugin-health.html'), /历史桌面事务回退/);
});

const fixture = () => {
  const calls = [];
  const state = { busy: false, validLkg: true, accept: true, pnpm: 'ready', workspace: 'isolated-workspace' };
  const health = { runtime: { status: 'healthy' }, profiles: [{ id: 'profile', name: 'web', status: 'healthy', workspaceReady: true,
    dependencies: [{ name: 'reviewed-plugin', version: '0.3.0', enabled: false, compatibility: { status: 'verified' } }] }] };
  const installer = {
    inspectRuntime: async () => ({ status: state.pnpm, version: '11.19.0' }),
    inspectLifecycle: async () => ({ status: 'ready', canRollback: state.validLkg }),
    rollbackLastKnownGood: async options => { calls.push(['rollback-history', options]); return { id: 'transaction', changed: true,
      plugin: { name: 'reviewed-plugin' }, target: { version: '0.3.0', enabled: false } }; },
    commit: async id => { calls.push(['commit', id]); }, rollback: async id => { calls.push(['restore', id]); }
  };
  const options = { getInstaller: () => installer,
    getCatalog: () => [{ id: 'fixed-catalog', name: 'reviewed-plugin', displayName: 'Reviewed theme', profiles: ['web'] }],
    getHealth: async () => health, resolveProfilePath: async () => 'isolated-profile', isBusy: () => state.busy,
    getContext: () => ({ workspacePath: state.workspace, proxyEnvironment: {} }),
    confirm: async () => { calls.push(['confirm']); return state.accept; }, restart: async () => { calls.push(['restart']); return { ok: true }; }
  };
  return { calls, state, health, installer, options, create: () => createHistoricalPluginRollback(options), request: { profileId: 'profile', catalogId: 'fixed-catalog' } };
};

test('history inventory exposes only bounded LKG rollback, never ordinary lifecycle capabilities', async () => {
  const f = fixture(), service = f.create();
  const result = await service.list();
  assert.equal(result.items.length, 1); assert.equal(result.items[0].canRollback, true);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['canRollback', 'catalogId', 'displayName', 'name', 'profileId', 'profileName']);
  f.state.busy = true; assert.equal((await service.list()).items[0].canRollback, false);
  f.state.busy = false; f.state.pnpm = 'unavailable'; assert.equal((await service.list()).items[0].canRollback, false);
  f.state.validLkg = false; assert.deepEqual((await service.list()).items, []);
});

test('historical rollback confirms, uses only fixed rollback method, verifies restart and commits', async () => {
  const f = fixture();
  assert.equal((await f.create().run(f.request)).ok, true);
  assert.deepEqual(f.calls.map(call => call[0]), ['confirm', 'rollback-history', 'restart', 'commit']);
  assert.deepEqual(f.calls[1][1], { profileDir: 'isolated-profile', catalogId: 'fixed-catalog', workspacePath: 'isolated-workspace', proxyEnvironment: {} });
});

test('cancellation, missing LKG, failed pnpm and active work never mutate', async () => {
  for (const setting of ['cancel', 'missing', 'pnpm', 'busy', 'unknown']) {
    const f = fixture();
    if (setting === 'cancel') f.state.accept = false;
    if (setting === 'missing') f.state.validLkg = false;
    if (setting === 'pnpm') f.state.pnpm = 'invalid';
    if (setting === 'busy') f.state.busy = true;
    const result = await f.create().run(setting === 'unknown' ? { ...f.request, catalogId: 'arbitrary' } : f.request);
    assert.equal(result.ok, false, setting);
    assert.equal(f.calls.some(call => call[0] !== 'confirm'), false, setting);
  }
});

test('confirmation rechecks changed LKG, pnpm, busy and workspace without overwriting history', async () => {
  for (const setting of ['lkg', 'pnpm', 'busy', 'workspace']) {
    const f = fixture();
    f.options.confirm = async () => {
      if (setting === 'lkg') f.state.validLkg = false;
      if (setting === 'pnpm') f.state.pnpm = 'invalid';
      if (setting === 'busy') f.state.busy = true;
      if (setting === 'workspace') f.state.workspace = 'changed';
      return true;
    };
    assert.equal((await f.create().run(f.request)).ok, false, setting);
    assert.deepEqual(f.calls, [], setting);
  }
});

test('a concurrent request and inventory are blocked while native confirmation is pending', async () => {
  const f = fixture(); let release;
  f.options.confirm = () => new Promise(resolve => { release = resolve; });
  const service = f.create(), first = service.run(f.request);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await service.list()).items[0].canRollback, false);
  assert.equal((await service.run(f.request)).ok, false);
  release(false); assert.equal((await first).canceled, true);
  assert.equal((await service.list()).items[0].canRollback, true);
});

test('restart, version, enabled state, compatibility and commit failures restore the prior transaction', async () => {
  for (const failure of ['restart', 'version', 'enabled', 'compatibility', 'runtime', 'profile', 'commit']) {
    const f = fixture(); let restartCount = 0;
    f.options.restart = async () => {
      f.calls.push(['restart']); restartCount += 1;
      if (restartCount === 1) {
        if (failure === 'restart') return { ok: false, error: 'restart failure' };
        if (failure === 'version') f.health.profiles[0].dependencies[0].version = '9.9.9';
        if (failure === 'enabled') f.health.profiles[0].dependencies[0].enabled = true;
        if (failure === 'compatibility') f.health.profiles[0].dependencies[0].compatibility.status = 'blocked';
        if (failure === 'runtime') f.health.runtime.status = 'degraded';
        if (failure === 'profile') f.health.profiles[0].status = 'degraded';
      }
      return { ok: true };
    };
    if (failure === 'commit') f.installer.commit = async () => { throw new Error('commit failed'); };
    const result = await f.create().run(f.request);
    assert.equal(result.ok, false, failure);
    assert.equal(f.calls.filter(call => call[0] === 'restore').length, 1, failure);
    assert.equal(restartCount, 2, failure);
    assert.match(result.message, /已恢复回退前 Profile/, failure);
  }
});

test('failed recovery preserves the journal boundary and cannot claim restored state', async () => {
  const f = fixture();
  f.options.restart = async () => ({ ok: false });
  f.installer.rollback = async () => { throw new Error('recovery failed'); };
  const result = await f.create().run(f.request);
  assert.equal(result.ok, false); assert.match(result.message, /持久日志会在下次启动/);
});

test('rollback to the historically absent plugin commits only when it is actually absent', async () => {
  for (const remains of [false, true]) {
    const f = fixture();
    f.installer.rollbackLastKnownGood = async () => ({ id: 'transaction', changed: true, plugin: { name: 'reviewed-plugin' }, target: { version: null, enabled: false } });
    f.options.restart = async () => { if (!remains) f.health.profiles[0].dependencies = []; return { ok: true }; };
    const result = await f.create().run(f.request);
    assert.equal(result.ok, !remains);
    assert.equal(f.calls.some(call => call[0] === 'commit'), !remains);
  }
});

test('new activity during the write restores the transaction without claiming a restart', async () => {
  const f = fixture(), mutate = f.installer.rollbackLastKnownGood;
  f.installer.rollbackLastKnownGood = async options => { const result = await mutate(options); f.state.busy = true; return result; };
  const result = await f.create().run(f.request);
  assert.equal(result.ok, false); assert.match(result.message, /Harness 未执行重启/);
  assert.equal(f.calls.some(call => call[0] === 'restore'), true);
  assert.equal(f.calls.some(call => call[0] === 'restart'), false);
});

test('extension center describes official management without claiming desktop mutation', () => {
  const plugins = buildExtensionCenter().surfaces.find(item => item.id === 'plugins');
  assert.equal(plugins.manageable, false);
  assert.match(plugins.permission, /官方插件页/);
  assert.doesNotMatch(plugins.permission, /原生确认后变更/);
});

test('historical rollback IPC enforces trust, parameters, concurrency and existing quit-operation protection', async () => {
  const source = read('electron/main.cjs');
  const begin = source.indexOf("ipcMain.handle('plugin-health:rollback-history'");
  const end = source.indexOf('\n});', begin) + 4;
  assert.ok(begin > 0 && end > begin);
  let handler, calls = 0, release;
  const sandbox = { ipcMain: { handle: (_channel, value) => { handler = value; } },
    pluginHealthIpcAllowed: event => event.trusted, appIsClosing: () => sandbox.closing,
    closing: false, quitOperationPromise: null, pluginTogglePromise: null, pluginInstallPromise: null,
    historicalPluginRollback: { run: () => { calls += 1; return new Promise(resolve => { release = resolve; }); } },
    getPluginHealthState: async () => ({ checked: true }) };
  vm.runInNewContext(source.slice(begin, end), sandbox);
  assert.equal((await handler({ trusted: false }, 'profile', 'catalog')).ok, false);
  for (const input of [null, '', 'x'.repeat(129), {}]) assert.equal((await handler({ trusted: true }, input, 'catalog')).ok, false);
  sandbox.closing = true; assert.equal((await handler({ trusted: true }, 'profile', 'catalog')).ok, false);
  sandbox.closing = false; sandbox.quitOperationPromise = Promise.resolve();
  assert.equal((await handler({ trusted: true }, 'profile', 'catalog')).ok, false);
  sandbox.quitOperationPromise = null;
  const first = handler({ trusted: true }, 'profile', 'catalog');
  assert.ok(sandbox.pluginInstallPromise);
  assert.equal((await handler({ trusted: true }, 'profile', 'catalog')).ok, false);
  assert.equal(calls, 1);
  release({ ok: true }); assert.equal((await first).state.checked, true);
  assert.equal(sandbox.pluginInstallPromise, null);
  assert.equal(source.includes("['历史插件事务回退', pluginInstallPromise]"), true);
});
