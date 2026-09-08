const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ reference = '', text = '' } = {}) {
  const handlers = {}, children = [];
  const element = () => ({ dataset: {}, children: [], isConnected: true, classList: { add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, append(...items) { this.children.push(...items); },
    replaceChildren() { this.children = []; }, remove() { this.isConnected = false; }, querySelector() { return null; } });
  const card = element(); card.insertAdjacentElement = (_where, item) => children.push(item);
  const body = element(); body.append = (...items) => children.push(...items);
  const document = { body, documentElement: element(), createElement: element, querySelector: () => card,
    addEventListener: (name, handler) => { handlers[name] = handler; }, removeEventListener() {} };
  const windowHandlers = {};
  const window = { innerWidth: 1200, innerHeight: 800,
    addEventListener: (name, handler) => { windowHandlers[name] = handler; }, removeEventListener() {},
    desktopAPI: { documents: { getState: async () => ({ items: reference ? [{ name: '旧报告.xlsx', relativePath: 'legacy.xlsx' }] : [], references: reference ? [reference] : [] }) } },
    __DSH_COMPOSER_TEXT__: { current: () => ({ focus() {} }), read: () => text, remove: async (_input, value) => { text = text.replace(value, ''); } } };
  const context = { window, document, localStorage: { getItem: () => 'session-A' },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {}, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/document-intake.js'), 'utf8'), context);
  const event = (types = ['Files'], files = []) => ({ dataTransfer: { types, files, dropEffect: 'none' },
    target: body, clientX: 100, clientY: 100, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } });
  return { handlers, windowHandlers, children, event, read: () => text };
}

test('workspace import leaves every global file drag event to the official attachment handler', () => {
  const f = fixture();
  for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    const event = f.event(); f.handlers[type]?.(event);
    assert.equal(f.handlers[type], undefined, `${type} belongs to the official attachment UI`);
    assert.equal(event.prevented, false); assert.equal(event.stopped, false);
  }
  assert.equal(f.children.some((item) => item.className === 'dsh-document-drop-hint'), false);
  assert.equal(f.windowHandlers.dragend, undefined);
});

test('text, documents, images, and mixed drops are neither intercepted nor duplicated', () => {
  const f = fixture();
  for (const event of [f.event(['text/plain']), f.event(['Files'], [{ name: 'report.xlsx', type: '' }]),
    f.event(['Files'], [{ name: 'photo.png', type: 'image/png' }]),
    f.event(['Files'], [{ name: 'report.pdf', type: 'application/pdf' }, { name: 'photo.png', type: 'image/png' }])]) {
    f.handlers.drop?.(event);
    assert.equal(event.prevented, false); assert.equal(event.stopped, false);
  }
});

test('new chats have no duplicate file entry or empty compatibility bar', async () => {
  const f = fixture();
  await new Promise((resolve) => setImmediate(resolve));
  const bar = f.children.find((item) => item.className === 'dsh-document-intake');
  assert.equal(bar.hidden, true);
  assert.equal(bar.children.some((item) => item.className === 'dsh-document-actions'), false);
  assert.equal(bar.children[0].children.length, 0);
});

test('older file references still appear and removing one preserves draft text', async () => {
  const f = fixture({ reference: '[参考资料 legacy.xlsx]', text: '草稿 [参考资料 legacy.xlsx]' });
  await new Promise((resolve) => setImmediate(resolve));
  const bar = f.children.find((item) => item.className === 'dsh-document-intake');
  assert.equal(bar.hidden, false);
  const remove = bar.children[0].children[0].children[1];
  assert.equal(remove.type, 'button');
  await remove.onclick();
  assert.equal(f.read(), '草稿 ');
  assert.equal(bar.hidden, true);
});
