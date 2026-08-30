const assert = require('node:assert/strict');
const test = require('node:test');
const { DocumentIntakeController, contextKey } = require('../electron/document-intake-controller.cjs');

const build = () => {
  let context = { workspacePath: 'C:/workspace', sessionId: 'one' };
  let imports = 0;
  const controller = new DocumentIntakeController({ getContext: async () => context,
    chooseFiles: async () => ['C:/source/file.pdf'], confirmImport: async () => true,
    intake: { importFiles: async ({ assertCurrent }) => { await assertCurrent(); imports++; return { items: [{ id: '1', name: 'file.pdf', relativePath: 'dsh-attachments/file.pdf' }], rejected: [] }; } } });
  return { controller, context, change: () => { context = { ...context, sessionId: 'two' }; }, imports: () => imports };
};

test('stale context cannot import or append files to another session', async () => {
  const f = build(); const state = await f.controller.getState(); f.change();
  const result = await f.controller.importFiles({ expectedContext: state.context, choose: true });
  assert.equal(result.ok, false); assert.equal(f.imports(), 0);
});

test('canceled native confirmation does not read files', async () => {
  const f = build(); f.controller.confirmImport = async () => false;
  const result = await f.controller.importFiles({ expectedContext: contextKey(f.context), paths: ['C:/file.pdf'] });
  assert.equal(result.canceled, true); assert.equal(f.imports(), 0);
});

test('chooser imports once and stores references only for the original context', async () => {
  const f = build(); const state = await f.controller.getState();
  const result = await f.controller.importFiles({ expectedContext: state.context, choose: true });
  assert.equal(result.ok, true); assert.equal(result.references.length, 1);
  assert.equal((await f.controller.getState()).items.length, 1);
  f.change(); assert.equal((await f.controller.getState()).items.length, 0);
});

test('context change during native confirmation rejects the import', async () => {
  const f = build(); f.controller.confirmImport = async () => { f.change(); return true; };
  const result = await f.controller.importFiles({ expectedContext: contextKey(f.context), paths: ['C:/file.pdf'] });
  assert.equal(result.ok, false); assert.equal(f.imports(), 0);
});
