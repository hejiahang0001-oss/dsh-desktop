const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { seedLegacyReference } = require('../electron/legacy-reference-smoke.cjs');
test('legacy smoke setup emits executable JavaScript and refreshes only the old reference adapter', async () => {
  const refs = ['旧引用 A', '旧引用 B']; let inserted, restored;
  const context = { desktopAPI: { documents: { getState: async () => ({ context: 'test' }), choose: async (value) => { assert.equal(value, 'test'); return { ok: true, references: refs }; } } },
    window: { __DSH_COMPOSER_TEXT__: { current: () => 'input', append: async (input, text) => { assert.equal(input, 'input'); inserted = text; } } },
    document: { dispatchEvent: (event) => { restored = event.type; } }, Event };
  await seedLegacyReference((script) => vm.runInNewContext(script, context));
  assert.equal(inserted, refs.join('\n'));
  assert.equal(restored, 'dsh-draft-restored');
});
