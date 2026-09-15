const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { openOfficialTerminal } = require('../electron/official-terminal.cjs');

const client = () => {
  let plugin, dispose;
  const selected = { phase: 'ready', current: 'session-test', currentAddress: null };
  const opened = [];
  const window = { __ModuleLoader__: { load: (module) => { plugin = module.factory(); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve('runtime/dsh-desktop-tools/client.js'), 'utf8'), { window });
  plugin.apply({ sessions: { list: { getSnapshot: () => selected } },
    sidebarRight: { openTab: (...args) => opened.push(args) }, effect: (fn) => { dispose = fn(); } });
  return { selected, opened, window, dispose: () => dispose() };
};

test('official terminal bridge opens only the ready, exact main session using public navigation', () => {
  const c = client(), bridge = c.window.__DSH_OFFICIAL_FILES__;
  assert.equal(bridge.openTerminal('session-test'), true);
  assert.deepEqual(c.opened, [['terminal']]);
  for (const patch of [{ phase: 'loading' }, { current: 'other-session' }, { currentAddress: {} }, { current: null }]) {
    Object.assign(c.selected, { phase: 'ready', current: 'session-test', currentAddress: null }, patch);
    assert.throws(() => bridge.openTerminal('session-test'), /主会话/);
  }
  Object.assign(c.selected, { phase: 'ready', current: 'session-test', currentAddress: null });
  assert.throws(() => bridge.openTerminal(), /主会话/);
  c.dispose();
  assert.equal(c.window.__DSH_OFFICIAL_FILES__, undefined);
  assert.throws(() => bridge.openTerminal('session-test'), /主会话/);
  assert.equal(c.opened.length, 1);
});

const host = (changes = {}) => {
  const scripts = [];
  const window = { isDestroyed: () => false, webContents: { executeJavaScript: async (source) => { scripts.push(source); return true; } } };
  const context = { status: 'synced', sessionId: 'session-test' };
  return { scripts, window, context, options: { getWindow: () => window, getContext: () => context, ready: () => true, collapse: async () => {}, ...changes } };
};

test('native official entry rechecks identity after collapsing the desktop panel', async () => {
  const h = host();
  assert.equal((await openOfficialTerminal(h.options)).ok, true);
  assert.match(h.scripts[0], /openTerminal\("session-test"\)/);
  const changed = host();
  changed.options.collapse = async () => { changed.context.sessionId = 'other-session'; };
  assert.equal((await openOfficialTerminal(changed.options)).ok, false);
  assert.equal(changed.scripts.length, 0);
  const navigated = host({ ready: () => false });
  assert.equal((await openOfficialTerminal(navigated.options)).ok, false);
  assert.equal(navigated.scripts.length, 0);
});

test('official navigation reports unavailable UI without silently opening a compatibility PTY', async () => {
  const h = host();
  h.window.webContents.executeJavaScript = async () => { throw new Error('page closed'); };
  const result = await openOfficialTerminal(h.options);
  assert.equal(result.ok, false);
  assert.match(result.message, /重试/);
});

test('terminal IPC remains main-frame scoped and does not expose PTY control or official output reads', () => {
  const main = fs.readFileSync(path.resolve('electron/main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.resolve('electron/preload.cjs'), 'utf8');
  const plugin = fs.readFileSync(path.resolve('runtime/dsh-desktop-tools/client.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('terminal:open-official', \(event\) => \(\s+harnessIpcAllowed\(event\)/);
  assert.match(preload, /openOfficial: \(\) => ipcRenderer\.invoke\('terminal:open-official'\)/);
  assert.doesNotMatch(preload, /terminal:write|terminal:start|terminal:resize|terminal:stop/);
  assert.doesNotMatch(plugin, /\.follow\(|\.view\(|\.owners|\.views|__react/);
  assert.match(main, /JSON\.stringify\(remoteTerminalKeys\) === JSON\.stringify\(\['openOfficial', 'openWindow'\]\)/);
  assert.match(main, /untrustedOfficialTerminalRejected: rejectedOfficialTerminal\?\.ok === false/);
});

test('desktop overlay explicitly opts out of extra canonical session-log upload', () => {
  const overlay = fs.readFileSync(path.resolve('config/dsh-desktop.patch.yml'), 'utf8');
  assert.match(overlay, /- id: session-log-deepseek\s+config:\s+enabled: false/);
  assert.doesNotMatch(overlay, /baseURL:|auto-review|computer-use|browser-use/);
});
