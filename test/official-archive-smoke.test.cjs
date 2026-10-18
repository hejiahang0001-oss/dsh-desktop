const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// A current WorkspaceBrowser public-DOM fixture, not an Electron or Host test.
// It has no retired Settings recovery page and never runs an Agent/model.
function fixture({ blank = false, wrongId = false, duplicate = false, occluded = false,
  hiddenAction = false, occludeBeforeClick = false, loseRestore = false, loseRemoteRow = false, loseSelection = false } = {}) {
  const events = [], root = { inert: false }, id = 'session-fixture-exact';
  let archived = false, filter = 'default', menuOpen = false, hovered = false, overlay = false, selectedId = id, reloaded = false;
  const rect = (x, y, width = 160, height = 24) => ({ left: x, top: y, right: x + width, bottom: y + height, width, height });
  const node = (text, attrs, box, parent = null) => ({ textContent: text, parentElement: parent,
    getAttribute: key => attrs[key] ?? null, getBoundingClientRect: () => box,
    contains(other) { return other === this || other?.parentElement === this; },
    querySelectorAll: () => [], style: { display: 'block', visibility: 'visible', opacity: '1' }
  });
  const row = node('Exact fixture', { 'data-row-key': `session:${wrongId ? 'other-session' : id}` }, rect(10, 110), root);
  row.getAttribute = key => key === 'aria-description' ? (archived ? 'Archived sessions cannot be opened. Unarchive it to view.' : null)
    : key === 'aria-selected' ? String(selectedId === id) : key === 'data-row-key' ? `session:${wrongId ? 'other-session' : id}` : null;
  const action = node('Unarchive session', { 'aria-label': 'Unarchive session' }, rect(140, 110, 24), row);
  action.click = () => { events.push('ui-unarchive'); archived = false; };
  row.querySelectorAll = () => archived && !blank ? [action] : [];
  const empty = node('No archived sessions yet', { 'data-row-key': 'empty' }, rect(10, 110), root);
  const menu = node('', { role: 'menu' }, rect(180, 40, 210, 140), root);
  const view = node('View options', { 'aria-label': 'View options' }, rect(10, 10), root);
  view.click = () => { events.push('view-options'); menuOpen = !menuOpen; };
  const options = ['In one list', 'Archived only', 'Hide archived'].map((label, index) => {
    const item = node(label, { role: 'menuitem' }, rect(185, 45 + 30 * index, 200), menu);
    item.click = () => { events.push(label); if (label !== 'In one list') filter = label === 'Archived only' ? 'only' : 'default'; menuOpen = false; hovered = false; };
    return item;
  });
  menu.querySelectorAll = () => options;
  const rows = () => (filter === 'only' ? archived : !archived) ? (duplicate ? [row, row] : [row]) : [];
  const document = {
    getElementById: () => root,
    querySelector(selector) {
      if (selector === '[role="menu"]') return menuOpen ? menu : null;
      if (selector.startsWith('[data-row-key=')) return rows().find(item => selector === `[data-row-key=${JSON.stringify(item.getAttribute('data-row-key'))}]`) || null;
      if (selector.includes('data-composer-card')) return {};
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('dialog')) return [];
      if (selector === '[data-row-key]') return rows().length ? rows() : filter === 'only' ? [empty] : [];
      if (selector === 'button') return [view, ...(menuOpen ? options : []), ...rows().flatMap(item => item.querySelectorAll())];
      return [];
    },
    elementFromPoint(x, y) {
      if (overlay || (occluded && y >= 110)) return root;
      const buttons = document.querySelectorAll('button');
      return [...buttons, ...rows(), empty].find(item => {
        if (item === action && (!hovered || hiddenAction)) return false;
        const b = item.getBoundingClientRect(); return x >= b.left && x < b.right && y >= b.top && y < b.bottom;
      }) || root;
    }
  };
  const context = vm.createContext({ document, innerWidth: 1024, innerHeight: 720,
    localStorage: { getItem: key => key === 'dsh.sessions.current' ? JSON.stringify({ sessionId: selectedId }) : null },
    getComputedStyle: item => item === action && (!hovered || hiddenAction) ? { ...item.style, display: 'none' }
      : item.style || { display: 'block', visibility: 'visible', opacity: '1' } });
  const evaluate = async code => vm.runInContext(code, context);
  const waitFor = async code => {
    if (!await evaluate(code)) throw new Error(`fixture UI condition not met: ${code}`);
    if (occludeBeforeClick && hovered && code.includes('Unarchive session')) overlay = true;
  };
  const wc = {
    sendInputEvent(event) {
      if (event.type === 'mouseMove') { events.push('native-hover'); hovered = true; }
      else { assert.ok(['mouseDown', 'mouseUp'].includes(event.type)); if (event.type === 'mouseUp') { selectedId = id; events.push('open-restored-row'); } }
    },
    capturePage: async () => ({ toPNG: () => Buffer.from('fixture') }),
    async loadURL() { events.push('reload'); reloaded = true; if (loseRestore) archived = true; if (loseSelection) selectedId = null; hovered = false; menuOpen = false; }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/official-archive-smoke.cjs'), 'utf8'), {
    module, exports: module.exports,
    require(name) {
      if (name === 'node:fs/promises') return { writeFile: async () => {} };
      if (name === './harness-ui-actions.cjs') return { invokeHarnessUiAction: async () => { throw new Error('retired Settings recovery route'); } };
      if (name === './extension-center.cjs') return { callHarnessRemote: async (_origin, namespace, method, args) => {
        events.push(`remote:${namespace}/${method}`);
        if (namespace === 'session' && method === 'list') return { items: loseRemoteRow && reloaded ? [] : [{ sessionId: id, blank }] };
        assert.equal(args.request.sessionId, id);
        if (method === 'archiveSession') { archived = true; selectedId = null; return { archivedSessionIds: [id] }; }
        if (method === 'unarchiveSession') { archived = false; return {}; }
        throw new Error(`unexpected remote ${method}`);
      } };
      return require(path.resolve('electron', name));
    }
  });
  return { events, run: () => module.exports.runOfficialArchiveSmoke({ window: { webContents: wc }, selected: { sessionId: id },
    origin: 'http://127.0.0.1:1', evaluate, waitFor, target: 'not-written', version: 'fixture' }) };
}

test('archive smoke uses current official filter, exact row UI restore, and reload persistence', async () => {
  const f = fixture(), report = await f.run();
  assert.equal(report.ok, true);
  assert.equal(report.modelCalls, 0);
  assert.equal(report.checks.restorePersistsAcrossReload, true);
  assert.equal(report.checks.restoredSessionVisible, true);
  assert.equal(report.checks.restoredSelectionPersists, true);
  assert.equal(report.checks.restoredRemoteSessionExists, true);
  assert.ok(f.events.indexOf('Archived only') < f.events.indexOf('ui-unarchive'));
  assert.ok(f.events.indexOf('native-hover') < f.events.indexOf('ui-unarchive'));
  assert.ok(f.events.indexOf('ui-unarchive') < f.events.indexOf('reload'));
  assert.ok(f.events.lastIndexOf('Hide archived') > f.events.indexOf('reload'));
  assert.equal(f.events.filter(event => event === 'remote:workspace/unarchiveSession').length, 1); // cleanup only
});

test('archive smoke rejects a blank fixture instead of inventing a first model turn', async () => {
  const f = fixture({ blank: true });
  await assert.rejects(f.run(), /non-blank/);
  assert.equal(f.events.includes('remote:workspace/archiveSession'), false);
  assert.equal(f.events.includes('ui-unarchive'), false);
});

for (const options of [{ wrongId: true }, { duplicate: true }, { occluded: true }, { hiddenAction: true }, { occludeBeforeClick: true }]) {
  test(`archive smoke refuses a wrong, ambiguous, hidden or covered target: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    await assert.rejects(f.run(), /condition|action|row/i);
    assert.equal(f.events.includes('ui-unarchive'), false);
  });
}

test('archive smoke does not confuse a transient UI restore with persisted restoration', async () => {
  const f = fixture({ loseRestore: true });
  await assert.rejects(f.run(), /condition/i);
  assert.equal(f.events.includes('ui-unarchive'), true);
  assert.equal(f.events.includes('reload'), true);
});

for (const options of [{ loseRemoteRow: true }, { loseSelection: true }]) {
  test(`archive smoke verifies remote and selected persistence after reload: ${JSON.stringify(options)}`, async () => {
    await assert.rejects(fixture(options).run(), /persist|condition/i);
  });
}

test('combined workflow forwards the existing authenticated fetch only after its real turn and sidebar checks', () => {
  const workflow = fs.readFileSync(path.resolve('electron/session-workflow-smoke.cjs'), 'utf8');
  const main = fs.readFileSync(path.resolve('electron/main.cjs'), 'utf8');
  assert.match(workflow, /async function runWorkflowSmoke\(\{[^\n]+fetchImpl/);
  assert.match(main, /runWorkflowSmoke\(\{[^;]+fetchImpl: harnessFetch/);
  assert.ok(workflow.indexOf("require('./official-archive-smoke.cjs')") > workflow.indexOf('checks.officialSidebar = sidebar.ok'));
  assert.match(workflow, /runOfficialArchiveSmoke\(\{\s*window, selected, origin, fetchImpl/);
  assert.match(workflow, /checks\.officialArchiveRecovery = archive\.ok/);
  assert.match(workflow, /const remainingDraft = await evaluate/);
});
