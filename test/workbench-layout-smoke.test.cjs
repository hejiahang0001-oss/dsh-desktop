const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { inspectWorkbenchLayout } = require('../electron/workbench-layout-smoke.cjs');

function inspect({ label = '发送消息', covered = false, innerOverlay = false, clipped = false, missing = false } = {}) {
  const element = (left, top, width, height, cls) => ({
    tagName: 'DIV', id: '', className: cls,
    getBoundingClientRect: () => ({ toJSON: () => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height }) }),
    getAttribute: () => null, contains: node => node === element,
    parentElement: null
  });
  const root = element(0, 0, 680, 640, 'root');
  const card = element(80, 300, 560, 120, 'card'); card.parentElement = root;
  const button = element(clipped ? 670 : 600, 375, 34, 34, 'primary');
  const overlay = element(590, 370, 60, 50, 'popover');
  button.getAttribute = () => label; button.disabled = true; button.contains = node => node === button;
  card.contains = node => node === button || node === card || node === overlay;
  card.querySelectorAll = () => missing ? [] : [button];
  const panel = element(680, 0, 340, 640, 'review');
  const doc = { documentElement: { getAttribute: () => 'false' },
    getElementById: id => id === 'root' ? root : panel,
    querySelector: () => card,
    elementsFromPoint: () => [covered ? panel : innerOverlay ? overlay : button, card] };
  return vm.runInNewContext(`(${inspectWorkbenchLayout.toString()})()`, {
    document: doc, innerWidth: 1020, innerHeight: 680,
    getComputedStyle: () => ({ width: 'auto', minWidth: '0px', maxWidth: 'none', position: 'static', display: 'block', overflowX: 'visible', pointerEvents: 'auto' })
  });
}

test('layout smoke recognizes Chinese and English send labels without an ASCII word-boundary assumption', () => {
  for (const label of ['发送消息', '发送', 'Send', 'Send message']) {
    const state = inspect({ label });
    assert.equal(state.cardFits, true); assert.equal(state.sendFits, true);
  }
});
test('layout smoke rejects a send control covered by a side panel', () => assert.equal(inspect({ covered: true }).sendFits, false));
test('layout smoke rejects a sibling popover inside the card covering send', () => assert.equal(inspect({ innerOverlay: true }).sendFits, false));
test('layout smoke rejects a send control extending outside the usable root', () => assert.equal(inspect({ clipped: true }).sendFits, false));
test('layout smoke rejects an absent send control even when the editor card fits', () => assert.equal(inspect({ missing: true }).sendFits, false));
