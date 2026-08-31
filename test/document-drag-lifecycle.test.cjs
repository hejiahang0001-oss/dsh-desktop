const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const handlers = {}, children = [];
  const element = () => ({ dataset: {}, children: [], isConnected: true, classList: { add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, append(...items) { this.children.push(...items); },
    replaceChildren() {}, remove() { this.isConnected = false; }, querySelector() { return null; } });
  const card = element(); card.insertAdjacentElement = (_where, item) => children.push(item);
  const body = element(); body.append = (...items) => children.push(...items);
  const document = { body, documentElement: element(), createElement: element, querySelector: () => card,
    addEventListener: (name, handler) => { handlers[name] = handler; }, removeEventListener() {} };
  const windowHandlers = {};
  const window = { innerWidth: 1200, innerHeight: 800,
    addEventListener: (name, handler) => { windowHandlers[name] = handler; }, removeEventListener() {},
    desktopAPI: { documents: { getState: async () => ({ items: [], references: [] }) } },
    __DSH_COMPOSER_TEXT__: { current: () => null, read: () => '' } };
  const context = { window, document, localStorage: { getItem: () => 'session-A' },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/document-intake.js'), 'utf8'), context);
  const event = (types = ['Files'], files = []) => ({ dataTransfer: { types, files, dropEffect: 'none' },
    target: body, clientX: 100, clientY: 100, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
  return { handlers, windowHandlers, children, event };
}

test('file drag entry and hover do not bubble into the upstream image-only overlay', () => {
  const f = fixture();
  for (const type of ['dragenter', 'dragover']) {
    const event = f.event(); f.handlers[type]?.(event);
    assert.equal(event.prevented, true, `${type} must accept the OS file drag`);
    assert.equal(event.stopped, true, `${type} must not activate the upstream image overlay`);
  }
  const hint = f.children.find((item) => item.className === 'dsh-document-drop-hint');
  assert.ok(hint); assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /Excel.*Word.*PDF/);
  f.windowHandlers.dragend?.(); assert.equal(hint.hidden, true);
});

test('ordinary text drags stay native and image drops reach the official image handler', () => {
  const f = fixture();
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const event = f.event(['text/plain']); f.handlers[type]?.(event);
    assert.equal(event.prevented, false); assert.equal(event.stopped, false);
  }
  const image = f.event(['Files'], [{ name: 'photo.png', type: 'image/png' }]);
  f.handlers.drop(image); assert.equal(image.stopped, false);
});

test('nested drag leaves and leaving the viewport clear feedback without waiting for a drop', () => {
  const f = fixture(); f.handlers.dragenter(f.event()); f.handlers.dragenter(f.event());
  const hint = f.children.find((item) => item.className === 'dsh-document-drop-hint');
  f.handlers.dragleave(f.event()); assert.equal(hint.hidden, false);
  f.handlers.dragleave(f.event()); assert.equal(hint.hidden, true);
  f.handlers.dragenter(f.event()); const leave = f.event(); leave.clientX = -1;
  f.handlers.dragleave(leave); assert.equal(hint.hidden, true);
});
