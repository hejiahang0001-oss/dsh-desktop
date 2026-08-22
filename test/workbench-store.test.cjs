const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_REVIEW_WIDTH,
  MAX_REVIEW_WIDTH,
  MIN_REVIEW_WIDTH,
  WorkbenchStore,
  normalizeWorkbenchState
} = require('../electron/workbench-store.cjs');
const {
  getWorkbenchPanelBootstrapScript,
  getWorkbenchPanelLayoutScript
} = require('../electron/workbench-panel.cjs');

test('workbench layout defaults and clamps the review panel width', () => {
  assert.deepEqual(normalizeWorkbenchState(), {
    reviewPanelOpen: true,
    reviewPanelWidth: DEFAULT_REVIEW_WIDTH
  });
  assert.equal(normalizeWorkbenchState({ reviewPanelWidth: 1 }).reviewPanelWidth, MIN_REVIEW_WIDTH);
  assert.equal(normalizeWorkbenchState({ reviewPanelWidth: 9000 }).reviewPanelWidth, MAX_REVIEW_WIDTH);
  assert.equal(normalizeWorkbenchState({ reviewPanelOpen: false }).reviewPanelOpen, false);
});

test('workbench store persists visibility and width without touching workspace state', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workbench-store-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'workbench-state.json');
  const store = new WorkbenchStore({ filePath });
  await store.init();
  await store.setReviewPanelOpen(false);
  await store.setReviewPanelWidth(410);

  const restored = new WorkbenchStore({ filePath });
  assert.deepEqual(await restored.init(), { reviewPanelOpen: false, reviewPanelWidth: 410 });
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(persisted, { version: 1, reviewPanelOpen: false, reviewPanelWidth: 410 });
});

test('workbench panel scripts serialize only normalized layout values', () => {
  const bootstrap = getWorkbenchPanelBootstrapScript({ reviewPanelOpen: false, reviewPanelWidth: 9999 });
  const layout = getWorkbenchPanelLayoutScript({ reviewPanelOpen: true, reviewPanelWidth: 120 });
  assert.match(bootstrap, /"reviewPanelOpen":false/);
  assert.match(bootstrap, new RegExp(`"reviewPanelWidth":${MAX_REVIEW_WIDTH}`));
  assert.match(layout, /applyLayout/);
  assert.match(layout, new RegExp(`"reviewPanelWidth":${MIN_REVIEW_WIDTH}`));
  assert.doesNotMatch(layout, /eval\(|innerHTML/);
});
