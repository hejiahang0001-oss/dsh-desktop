const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { inspectOfficialModal } = require('../electron/workbench-layout-smoke.cjs');

function modalDetailsFixture() {
  const buttons = [], obstructed = new Set();
  const node = (tagName, parentElement, label) => {
    const element = { tagName, parentElement, children: [], hidden: false, inert: false, open: false,
      contains(other) { for (let p = other; p; p = p.parentElement) if (p === this) return true; return false; },
      getAttribute: () => null, textContent: label || '' };
    parentElement?.children.push(element);
    const left = tagName === 'BUTTON' ? 100 + buttons.length * 80 : 50;
    // Chromium can retain nonzero geometry for descendants of closed details.
    element.getBoundingClientRect = () => ({ left, top: 100, right: left + 60, bottom: 130, width: 60, height: 30 });
    if (tagName === 'BUTTON') buttons.push(element);
    return element;
  };
  const dialog = node('DIV'); dialog.querySelectorAll = () => buttons;
  const context = { innerWidth: 1280, innerHeight: 880,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { querySelectorAll: () => [dialog], elementFromPoint: x => {
      const button = buttons.find(b => { const r = b.getBoundingClientRect(); return x === (r.left + r.right) / 2; });
      return obstructed.has(button) ? dialog : button;
    } } };
  return { node, dialog, obstructed,
    inspect: () => JSON.parse(JSON.stringify(vm.runInNewContext(`(${inspectOfficialModal.toString()})()`, context))) };
}

test('closed details excludes body and later summaries but retains the first direct summary', () => {
  const { node, dialog, obstructed, inspect } = modalDetailsFixture();
  const details = node('DETAILS', dialog);
  const body = node('DIV', details);
  const nestedSummary = node('SUMMARY', body);
  const bodyButton = node('BUTTON', nestedSummary, '隐藏模型选项');
  const firstSummary = node('SUMMARY', details);
  const summaryButton = node('BUTTON', firstSummary, '展开设置');
  const laterSummary = node('SUMMARY', details);
  const laterButton = node('BUTTON', laterSummary, '隐藏后续摘要');
  obstructed.add(bodyButton); obstructed.add(laterButton);
  const result = inspect();
  assert.equal(result.ok, true);
  assert.deepEqual(result.buttons, [{ label: '展开设置', exposed: true }]);
  obstructed.add(summaryButton);
  assert.equal(inspect().ok, false, 'A visible summary button must still pass the obstruction check');
});

test('every closed details ancestor must allow the button through its own first summary', () => {
  const { node, dialog, obstructed, inspect } = modalDetailsFixture();
  const outer = node('DETAILS', dialog), outerSummary = node('SUMMARY', outer);
  node('BUTTON', outerSummary, '外层设置');
  const inner = node('DETAILS', outer), innerSummary = node('SUMMARY', inner);
  const innerSummaryButton = node('BUTTON', innerSummary, '内层设置');
  const bodyButton = node('BUTTON', inner, '模型选项');
  inner.open = true;
  obstructed.add(innerSummaryButton); obstructed.add(bodyButton);
  assert.deepEqual(inspect().buttons, [{ label: '外层设置', exposed: true }]);
  outer.open = true; inner.open = false; obstructed.delete(innerSummaryButton);
  assert.deepEqual(inspect().buttons, [{ label: '外层设置', exposed: true }, { label: '内层设置', exposed: true }]);
  assert.equal(inspect().ok, true);
  inner.open = true;
  assert.equal(inspect().ok, false, 'An exposed open-details body must not bypass obstruction checks');
  obstructed.delete(bodyButton);
  assert.equal(inspect().ok, true);
});

test('closed details without a direct summary does not expose nested summary buttons', () => {
  const { node, dialog, obstructed, inspect } = modalDetailsFixture();
  node('BUTTON', dialog, '保存');
  const details = node('DETAILS', dialog), body = node('DIV', details), summary = node('SUMMARY', body);
  obstructed.add(node('BUTTON', summary, '隐藏模型选项'));
  assert.deepEqual(inspect().buttons, [{ label: '保存', exposed: true }]);
  assert.equal(inspect().ok, true);
});

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
