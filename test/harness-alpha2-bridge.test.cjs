const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const sessionId = 'session-11111111-1111-4111-8111-111111111111';
const otherId = 'session-22222222-2222-4222-8222-222222222222';
const address = `dsh-resource://file/session/${sessionId}/a.pdf`;

function fixture(resolvePreview = async () => ({ available: true, sessionId, address })) {
  let plugin, dispose;
  const opened = [], grants = [];
  const snapshot = { sessionId, openState: 'open', removed: false, subagent: null };
  let binding = { sessionId, session: { getSnapshot: () => snapshot } };
  const list = { phase: 'ready', ids: [sessionId], byId: {
    [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } }
  } };
  const diagnostics = { workspaceSync: { status: 'synced', sessionId } };
  const window = {
    desktopAPI: {
      diagnostics: { getState: async () => diagnostics },
      files: { resolvePreview: (request) => { grants.push(request); return resolvePreview(request); } }
    },
    __ModuleLoader__: { load: (row) => { plugin = row.factory(); } }
  };
  vm.runInNewContext(fs.readFileSync(path.resolve('runtime/dsh-desktop-tools/client.js'), 'utf8'), { window });
  plugin.apply({
    sessions: {
      list: { getSnapshot: () => list },
      binding: (id) => id === sessionId ? binding : undefined,
      retain() { throw new Error('Navigation must not acquire a Session'); }
    },
    sidebarRight: {
      openResource: (value) => opened.push(value),
      openTab: (kind) => opened.push(kind)
    },
    effect: (effect) => { dispose = effect(); }
  });
  return { window, opened, grants, list, snapshot, diagnostics,
    dispose: () => dispose(),
    replace: () => { binding = { sessionId, session: { getSnapshot: () => snapshot } }; }
  };
}

test('alpha.2 navigation uses an explicit desktop target and its live main-view binding', async () => {
  const c = fixture(), bridge = c.window.__DSH_OFFICIAL_FILES__;
  assert.equal(bridge.openTerminal(sessionId), true);
  assert.equal(await bridge.openFile('a.pdf', 'C:/workspace'), true);
  assert.deepEqual(c.opened, ['terminal', address]);
  assert.equal(c.grants[0].sessionId, sessionId);
});

test('alpha.2 navigation rejects absent, errored, removed and subagent bindings', async () => {
  for (const change of [
    c => { c.list.phase = 'loading'; },
    c => { c.list.byId[sessionId].retainedBy = {}; },
    c => { c.list.byId[sessionId].retainedBy = { sidebar: 1 }; },
    c => { c.list.byId[sessionId].id = otherId; },
    c => { c.snapshot.openState = 'error'; },
    c => { c.snapshot.removed = true; },
    c => { c.snapshot.sessionId = otherId; },
    c => { c.snapshot.subagent = { address: { parentSessionId: otherId } }; },
    c => { c.list.byId[otherId] = { id: otherId, retainedBy: { mainView: 1 } }; }
  ]) {
    const c = fixture(); change(c);
    assert.throws(() => c.window.__DSH_OFFICIAL_FILES__.openTerminal(sessionId), /主会话/);
    await assert.rejects(c.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace'), /主会话/);
    assert.equal(c.opened.length, 0);
    assert.equal(c.grants.length, 0);
  }
});

test('alpha.2 file navigation never guesses a target from the catalog', async () => {
  for (const change of [
    c => { delete c.window.desktopAPI.diagnostics; },
    c => { c.diagnostics.workspaceSync.status = 'syncing'; },
    c => { c.diagnostics.workspaceSync.sessionId = otherId; }
  ]) {
    const c = fixture(); change(c);
    await assert.rejects(c.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace'));
    assert.equal(c.grants.length, 0);
    assert.equal(c.opened.length, 0);
  }
});

test('alpha.2 file reply cannot cross a same-id generation replacement', async () => {
  let finish, admitted;
  const admission = new Promise(resolve => { admitted = resolve; });
  const c = fixture(() => { admitted(); return new Promise(resolve => { finish = resolve; }); });
  const opening = c.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace');
  const rejected = assert.rejects(opening, /会话或打开请求已变化/);
  await admission;
  c.replace();
  finish({ available: true, sessionId, address });
  await rejected;
  assert.equal(c.opened.length, 0);
});

test('alpha.2 disposal during target lookup prevents a later native file request', async () => {
  const c = fixture();
  let finish;
  c.window.desktopAPI.diagnostics.getState = () => new Promise(resolve => { finish = resolve; });
  const opening = c.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace');
  const rejected = assert.rejects(opening);
  c.dispose();
  finish(c.diagnostics);
  await rejected;
  assert.equal(c.grants.length, 0);
  assert.equal(c.opened.length, 0);
});
