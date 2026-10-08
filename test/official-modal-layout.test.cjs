const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { inspectOfficialModal } = require('../electron/workbench-layout-smoke.cjs');

test('official modal observation rejects desktop-panel obstruction and keeps panel state observational', () => {
  const node = () => ({ hidden: false, inert: false, parentElement: null,
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 160, bottom: 130, width: 60, height: 30 }),
    contains(other) { return other === this; }, getAttribute: () => null, textContent: '保存' });
  const button = node(), dialog = node(); button.parentElement = dialog;
  dialog.querySelectorAll = () => [button];
  let hit = button;
  const context = { innerWidth: 1280, innerHeight: 880,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { querySelectorAll: () => [dialog], elementFromPoint: () => hit } };
  const inspect = () => vm.runInNewContext(`(${inspectOfficialModal.toString()})()`, context);
  assert.equal(inspect().ok, true);
  hit = node(); assert.equal(inspect().ok, false);
  hit = button; dialog.inert = true; assert.equal(inspect().ok, false);
});

test('desktop side panels stay below the official modal layer', () => {
  const fs = require('node:fs'); const path = require('node:path');
  for (const file of ['workbench-panel.css', 'workbench-files.css']) {
    const css = fs.readFileSync(path.join(__dirname, '../assets', file), 'utf8');
    const layer = Number(/#dsh-workbench-(?:review|files)\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
    assert.ok(layer > 0 && layer < 1000, 'Official modal backdrop uses z-index 1000');
  }
});
