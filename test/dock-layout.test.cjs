const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DockLayoutStore, normalizeDock, dockBounds } = require('../electron/dock-layout.cjs');
test('dock geometry reserves chat space and keeps native surfaces inside small windows', () => {
  for (const [width, height] of [[820, 600], [1220, 800], [2560, 1344]]) {
    const bounds = dockBounds(width, height, 600, true);
    assert.ok(bounds.bar.y >= 200); assert.equal(bounds.pane.y + bounds.pane.height, height);
    assert.equal(bounds.bar.y + bounds.bar.height, bounds.pane.y); assert.equal(bounds.pane.width, width);
  }
  assert.equal(dockBounds(1000, 700, 500, false).reserved, 42);
  assert.deepEqual(normalizeDock({ active: '../shell', height: -1 }), { active: 'terminal', height: 220, open: false });
});
test('dock state is per project, survives restart and serializes layout changes', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-dock-test-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'layout.json'), store = new DockLayoutStore(file); await store.init();
  store.activate('C:/project-a'); await Promise.all([store.update({ open: true }), store.update({ active: 'office', height: 500 })]);
  store.activate('C:/project-b'); assert.equal(store.getState().open, false); await store.update({ active: 'tasks' });
  const recovered = new DockLayoutStore(file); await recovered.init();
  assert.deepEqual(recovered.activate('C:/project-a'), { open: true, active: 'office', height: 500 });
  assert.equal(recovered.activate('C:/project-b').active, 'tasks');
  recovered.activate('C:/project-a'); await recovered.update({ panels: { reviewPanelWidth: 400, filePanelOpen: false } });
  await recovered.update({ open: false }); assert.equal(recovered.getPanels().reviewPanelWidth, 400); assert.equal(recovered.getPanels().filePanelOpen, false);
  recovered.activate('C:/project-b'); assert.equal(recovered.getPanels(), null);
});
