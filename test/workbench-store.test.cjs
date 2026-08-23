const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_FILE_WIDTH,
  DEFAULT_TERMINAL_HEIGHT,
  DEFAULT_REVIEW_WIDTH,
  MAX_FILE_WIDTH,
  MAX_TERMINAL_HEIGHT,
  MAX_REVIEW_WIDTH,
  MIN_FILE_WIDTH,
  MIN_TERMINAL_HEIGHT,
  MIN_REVIEW_WIDTH,
  WorkbenchStore,
  normalizeWorkbenchState
} = require('../electron/workbench-store.cjs');
const {
  getWorkbenchPanelBootstrapScript,
  getWorkbenchPanelLayoutScript
} = require('../electron/workbench-panel.cjs');

test('workbench layout defaults and clamps persisted panel sizes', () => {
  assert.deepEqual(normalizeWorkbenchState(), {
    filePanelOpen: true,
    filePanelWidth: DEFAULT_FILE_WIDTH,
    previewPanelOpen: false,
    reviewPanelOpen: true,
    reviewPanelWidth: DEFAULT_REVIEW_WIDTH,
    terminalPanelOpen: true,
    terminalPanelHeight: DEFAULT_TERMINAL_HEIGHT
  });
  assert.equal(normalizeWorkbenchState({ filePanelWidth: 1 }).filePanelWidth, MIN_FILE_WIDTH);
  assert.equal(normalizeWorkbenchState({ filePanelWidth: 9000 }).filePanelWidth, MAX_FILE_WIDTH);
  assert.equal(normalizeWorkbenchState({ filePanelOpen: false }).filePanelOpen, false);
  assert.equal(normalizeWorkbenchState({ previewPanelOpen: true }).previewPanelOpen, true);
  assert.equal(normalizeWorkbenchState({ reviewPanelWidth: 1 }).reviewPanelWidth, MIN_REVIEW_WIDTH);
  assert.equal(normalizeWorkbenchState({ reviewPanelWidth: 9000 }).reviewPanelWidth, MAX_REVIEW_WIDTH);
  assert.equal(normalizeWorkbenchState({ reviewPanelOpen: false }).reviewPanelOpen, false);
  assert.equal(normalizeWorkbenchState({ terminalPanelHeight: 1 }).terminalPanelHeight, MIN_TERMINAL_HEIGHT);
  assert.equal(normalizeWorkbenchState({ terminalPanelHeight: 9000 }).terminalPanelHeight, MAX_TERMINAL_HEIGHT);
  assert.equal(normalizeWorkbenchState({ terminalPanelOpen: false }).terminalPanelOpen, false);
});

test('workbench store persists visibility and width without touching workspace state', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workbench-store-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'workbench-state.json');
  const store = new WorkbenchStore({ filePath });
  await store.init();
  await store.setFilePanelOpen(false);
  await store.setFilePanelWidth(312);
  await store.setPreviewPanelOpen(true);
  await store.setReviewPanelOpen(false);
  await store.setReviewPanelWidth(410);
  await store.setTerminalPanelOpen(false);
  await store.setTerminalPanelHeight(380);

  const restored = new WorkbenchStore({ filePath });
  assert.deepEqual(await restored.init(), {
    filePanelOpen: false,
    filePanelWidth: 312,
    previewPanelOpen: true,
    reviewPanelOpen: false,
    reviewPanelWidth: 410,
    terminalPanelOpen: false,
    terminalPanelHeight: 380
  });
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.deepEqual(persisted, {
    version: 4,
    filePanelOpen: false,
    filePanelWidth: 312,
    previewPanelOpen: true,
    reviewPanelOpen: false,
    reviewPanelWidth: 410,
    terminalPanelOpen: false,
    terminalPanelHeight: 380
  });
});

test('workbench panel scripts serialize only normalized layout values', () => {
  const bootstrap = getWorkbenchPanelBootstrapScript({ reviewPanelOpen: false, reviewPanelWidth: 9999 });
  const layout = getWorkbenchPanelLayoutScript({ reviewPanelOpen: true, reviewPanelWidth: 120 });
  assert.match(bootstrap, /"reviewPanelOpen":false/);
  assert.match(bootstrap, new RegExp(`"reviewPanelWidth":${MAX_REVIEW_WIDTH}`));
  assert.match(layout, /applyLayout/);
  assert.match(layout, new RegExp(`"reviewPanelWidth":${MIN_REVIEW_WIDTH}`));
  assert.match(layout, /__DSH_TERMINAL__/);
  assert.match(layout, /__DSH_FILES__/);
  assert.match(layout, /__DSH_PREVIEW__/);
  assert.match(layout, new RegExp(`"terminalPanelHeight":${DEFAULT_TERMINAL_HEIGHT}`));
  assert.doesNotMatch(layout, /eval\(|innerHTML/);
});
