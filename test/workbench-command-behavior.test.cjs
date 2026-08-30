const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

class MockElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || '').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.inert = false;
    this.disabled = false;
    this.isConnected = true;
    this.textContent = '';
    this.value = '';
    this.className = '';
    this.id = '';
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      const child = typeof node === 'string' ? new MockText(node, this.ownerDocument) : node;
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, init = {}) {
    const event = createEvent({ target: this, ...init });
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  select() {}
  scrollIntoView() {}

  getClientRects() {
    return this.hidden || this.closest('[hidden]') ? [] : [{}];
  }

  contains(candidate) {
    for (let node = candidate; node; node = node.parentElement) {
      if (node === this) return true;
    }
    return false;
  }

  closest(selector) {
    if (selector === '[hidden]') {
      for (let node = this; node; node = node.parentElement) {
        if (node.hidden) return node;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    const descendants = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    if (selector === '[role="option"]') {
      return descendants.filter((node) => node.getAttribute?.('role') === 'option');
    }
    if (selector === 'button:not(:disabled), input:not(:disabled)') {
      return descendants.filter((node) => !node.disabled && ['BUTTON', 'INPUT'].includes(node.tagName));
    }
    return [];
  }
}

class MockText extends MockElement {
  constructor(text, ownerDocument) {
    super('#text', ownerDocument);
    this.textContent = text;
  }
}

const createEvent = (init = {}) => ({
  key: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; },
  stopPropagation() {},
  ...init
});

const createHarness = () => {
  const document = {
    activeElement: null,
    composerCandidates: [],
    listeners: new Map(),
    createElement(tag) { return new MockElement(tag, document); },
    querySelectorAll(selector) {
      return selector === 'textarea, [contenteditable="true"]' ? this.composerCandidates : [];
    },
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    },
    dispatch(type, init = {}) {
      const event = createEvent(init);
      for (const listener of this.listeners.get(type) || []) listener(event);
      return event;
    }
  };
  document.body = new MockElement('body', document);
  document.documentElement = new MockElement('html', document);
  const origin = new MockElement('button', document);
  document.body.append(origin);
  origin.focus();

  const success = async () => ({ ok: true });
  const desktopAPI = {
    workbench: {
      getState: async () => ({}),
      setFilePanelOpen: success,
      setReviewPanelOpen: success,
      setPreviewPanelOpen: success,
      setUiZoomFactor: success,
      resetLayout: success
    },
    sideChat: { openWindow: success },
    extensions: { openWindow: success },
    office: { openWindow: success },
    wiki: { openWindow: success },
    delivery: { openWindow: success },
    support: { exportDiagnostics: success, createBackup: success, validateBackup: success },
    terminal: { openWindow: success },
    checkpoints: { create: success, restoreLatest: success }
  };
  const window = { desktopAPI, location: { reload() {} } };
  const context = {
    window,
    document,
    console,
    InputEvent: class InputEvent {},
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    HTMLInputElement: class HTMLInputElement {},
    Object,
    Boolean,
    String,
    Math,
    JSON,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', 'workbench-command.js'), 'utf8'), context);
  const findByClass = (className) => {
    const queue = [document.body];
    while (queue.length) {
      const node = queue.shift();
      if (node.className === className) return node;
      queue.push(...(node.children || []));
    }
    return null;
  };
  return { document, window, findByClass };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('command failure uses truthful copy and traps focus inside the visible dialog', async () => {
  const { document, window, findByClass } = createHarness();
  assert.equal(window.__DSH_COMMAND_PALETTE__.open(), true);
  const search = findByClass('dsh-command-search');
  search.value = '聚焦对话输入';
  search.dispatch('input');
  search.dispatch('keydown', { key: 'Enter' });
  await settle();

  const failure = findByClass('dsh-command-failure');
  const detail = failure.children[1];
  assert.equal(failure.hidden, false);
  assert.doesNotMatch(detail.textContent, /没有执行任何修改/);
  assert.match(detail.textContent, /未能确认操作完整完成/);

  const dialog = findByClass('dsh-command-dialog');
  const focusable = dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')
    .filter((node) => !node.closest('[hidden]'));
  focusable.at(-1).focus();
  const tab = document.dispatch('keydown', { key: 'Tab', target: focusable.at(-1) });
  assert.equal(tab.defaultPrevented, true);
  assert.equal(document.activeElement, focusable[0]);

  focusable[0].focus();
  const shiftTab = document.dispatch('keydown', { key: 'Tab', shiftKey: true, target: focusable[0] });
  assert.equal(shiftTab.defaultPrevented, true);
  assert.equal(document.activeElement, focusable.at(-1));

  const retryButton = failure.children[2].children[0];
  const dismissButton = failure.children[2].children[1];
  const composer = new MockElement('div', document);
  composer.setAttribute('data-placeholder', 'message');
  document.composerCandidates = [composer];
  retryButton.dispatch('click');
  await settle();
  assert.equal(findByClass('dsh-command-backdrop').hidden, true);
  assert.equal(document.activeElement, composer);

  document.composerCandidates = [];
  window.__DSH_COMMAND_PALETTE__.open();
  search.value = '聚焦对话输入';
  search.dispatch('input');
  search.dispatch('keydown', { key: 'Enter' });
  await settle();
  dismissButton.dispatch('click');
  assert.equal(failure.hidden, true);
  assert.equal(document.activeElement, search);
});
