const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { getHarnessUiActionScript } = require('../electron/harness-ui-actions.cjs');

// Public DOM contract only: no React/Cordis internals, real profile or model.
function fixture({ english = false, direct = false, selected = true } = {}) {
  const names = english ? { account: 'Account menu', settings: 'Settings', models: 'Models' }
    : { account: '账号菜单', settings: '设置', models: '模型' };
  const clicks = [];
  let measured;
  const text = value => ({ nodeType: 3, textContent: value });
  const matches = (node, selector) => selector.split(',').some(part => {
    const value = part.trim();
    const tag = value.match(/^[a-z]+/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    return [...value.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)]
      .every(([, name, expected]) => expected === undefined ? node.hasAttribute(name) : node.getAttribute(name) === expected);
  });
  const descendants = node => node.childNodes.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []);
  function element(tag, attrs = {}, content = '') {
    const node = {
      nodeType: 1, tagName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [], parentElement: null,
      hidden: false, inert: false, disabled: false, blocked: false,
      style: { display: 'block', visibility: 'visible', opacity: '1' },
      getAttribute(name) { return this.attrs[name] ?? null; },
      hasAttribute(name) { return name in this.attrs; },
      setAttribute(name, value) { this.attrs[name] = String(value); },
      get textContent() { return this.childNodes.map(child => child.textContent).join(''); },
      append(...children) { for (const child of children) { child.parentElement = this; this.childNodes.push(child); } return this; },
      contains(child) { return child === this || descendants(this).includes(child); },
      querySelectorAll(selector) { return descendants(this).filter(child => matches(child, selector)); },
      getBoundingClientRect() { measured = this; return { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }; },
      click() { clicks.push(this.getAttribute('aria-label') || this.textContent); this.onClick?.(); },
      focus() {}
    };
    if (content) node.append(text(content));
    return node;
  }
  const root = element('main');
  const menu = element('div', { role: 'menu' }); menu.hidden = true;
  const settings = element('button', { role: 'menuitem' });
  settings.append(element('span', {}, names.settings), element('span', { 'aria-hidden': 'true' }, 'Ctrl,'));
  menu.append(settings);
  const dialog = element('div', { role: 'dialog', 'aria-modal': 'true', 'data-shortcut-modal': 'settings', 'aria-labelledby': 'settings-title' });
  dialog.hidden = true;
  const title = element('div', { id: 'settings-title' }, names.settings);
  const models = element('button', {}, names.models);
  dialog.append(title, models);
  models.onClick = () => { if (selected) models.setAttribute('aria-current', 'true'); };
  settings.onClick = () => { menu.hidden = true; dialog.hidden = false; };
  const account = element('button', { 'aria-label': names.account, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, '…');
  account.onClick = () => { menu.hidden = !menu.hidden; account.setAttribute('aria-expanded', String(!menu.hidden)); };
  const fallback = element('button', { 'aria-label': names.settings, 'aria-haspopup': 'dialog' }, names.settings);
  fallback.onClick = () => { dialog.hidden = false; };
  root.append(direct ? fallback : account, menu, dialog);
  const document = {
    querySelectorAll: selector => root.querySelectorAll(selector),
    getElementById: id => descendants(root).find(node => node.getAttribute('id') === id) || null,
    elementFromPoint: () => measured?.blocked ? root : measured
  };
  const run = () => vm.runInNewContext(getHarnessUiActionScript('models-settings'), {
    document, innerWidth: 1280, innerHeight: 880,
    getComputedStyle: node => node.style,
    setTimeout: callback => { callback(); return 0; }
  });
  return { names, root, menu, settings, dialog, title, models, account, fallback, element, clicks, run };
}

for (const english of [false, true]) {
  test(`rc.2 ${english ? 'English' : 'Chinese'} account menu opens settings and verifies current models page`, async () => {
    const f = fixture({ english });
    assert.equal(await f.run(), true);
    assert.deepEqual(f.clicks, [f.names.account, `${f.names.settings}Ctrl,`, f.names.models]);
    assert.equal(f.models.getAttribute('aria-current'), 'true');
  });
}

test('legacy direct Settings launcher remains supported', async () => {
  const f = fixture({ direct: true });
  assert.equal(await f.run(), true);
  assert.deepEqual(f.clicks, [f.names.settings, f.names.models]);
});

test('already open account menu is used without toggling it closed', async () => {
  const f = fixture(); f.menu.hidden = false; f.account.setAttribute('aria-expanded', 'true');
  assert.equal(await f.run(), true);
  assert.deepEqual(f.clicks, [`${f.names.settings}Ctrl,`, f.names.models]);
});

test('an unrelated open Settings menu is not clicked while Account is collapsed', async () => {
  const f = fixture(); f.menu.hidden = false;
  assert.equal(await f.run(), false);
  assert.deepEqual(f.clicks, []);
});

test('an open Settings menu without an Account launcher fails closed', async () => {
  const f = fixture({ direct: true }); f.menu.hidden = false;
  assert.equal(await f.run(), false);
  assert.deepEqual(f.clicks, []);
});

test('ambiguous Account ownership of an open Settings menu fails closed', async () => {
  const f = fixture(); f.menu.hidden = false; f.account.setAttribute('aria-expanded', 'true');
  f.root.append(f.element('button', { 'aria-label': f.names.account, 'aria-haspopup': 'menu', 'aria-expanded': 'true' }));
  assert.equal(await f.run(), false);
  assert.deepEqual(f.clicks, []);
});

test('a newly visible menu must be acknowledged by the Account expanded state', async () => {
  const f = fixture(); f.account.onClick = () => { f.menu.hidden = false; };
  assert.equal(await f.run(), false);
  assert.deepEqual(f.clicks, [f.names.account]);
});

test('already open settings dialog is reused without reopening a launcher', async () => {
  const f = fixture(); f.dialog.hidden = false;
  assert.equal(await f.run(), true);
  assert.deepEqual(f.clicks, [f.names.models]);
});

for (const state of ['hidden', 'inert', 'disabled', 'blocked', 'aria-disabled', 'aria-hidden']) {
  test(`refuses ${state} account launcher without clicking`, async () => {
    const f = fixture();
    if (state.startsWith('aria-')) f.account.setAttribute(state, 'true'); else f.account[state] = true;
    assert.equal(await f.run(), false);
    assert.deepEqual(f.clicks, []);
  });
}

test('ambiguous visible account launchers fail closed', async () => {
  const f = fixture();
  f.root.append(f.element('button', { 'aria-label': f.names.account, 'aria-haspopup': 'menu' }));
  assert.equal(await f.run(), false);
  assert.deepEqual(f.clicks, []);
});

test('ambiguous settings menuitems are not clicked', async () => {
  const f = fixture();
  f.menu.append(f.element('button', { role: 'menuitem' }, f.names.settings));
  assert.equal(await f.run(), false);
  assert.deepEqual(f.clicks, [f.names.account]);
});

test('models outside the settings dialog are not selected', async () => {
  const f = fixture();
  f.root.append(f.element('button', {}, f.names.models));
  assert.equal(await f.run(), true);
  assert.equal(f.models.getAttribute('aria-current'), 'true');
  assert.equal(f.clicks.length, 3);
});

test('ambiguous settings dialogs refuse models navigation', async () => {
  const f = fixture();
  f.root.append(f.element('div', { role: 'dialog', 'aria-modal': 'true', 'data-shortcut-modal': 'settings' }));
  f.dialog.hidden = false;
  assert.equal(await f.run(), false);
  assert.deepEqual(f.clicks, []);
});

test('covered or disabled models button cannot pass on programmatic click alone', async () => {
  for (const state of ['blocked', 'disabled']) {
    const f = fixture(); f.models[state] = true;
    assert.equal(await f.run(), false);
    assert.equal(f.clicks.includes(f.names.models), false);
  }
});

test('successful clicks without aria-current selection remain a failure', async () => {
  const f = fixture({ selected: false });
  assert.equal(await f.run(), false);
});

test('hidden duplicate controls do not prevent the actual visible route', async () => {
  const f = fixture();
  const hidden = f.element('button', { 'aria-label': f.names.account, 'aria-haspopup': 'menu' }); hidden.hidden = true;
  f.root.append(hidden);
  assert.equal(await f.run(), true);
});
