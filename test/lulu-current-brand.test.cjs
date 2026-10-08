const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { NativeWorkbenchDock } = require('../electron/native-workbench-dock.cjs');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
// Reviewed 0.2.1-alpha.1 decorative containers; never match a generic functional icon.
const marks = ['qVIJiq_fishHitbox', 'ghK-Yq_railMark', 'ghK-Yq_brandMark'];

test('the pinned Harness welcome and sidebar marks receive lulu without changing official controls', () => {
  const css = read('assets/lulu-harness-theme.css');
  for (const mark of marks) assert.ok(css.includes(`.${mark}`), `Missing current decorative mark: ${mark}`);
  assert.doesNotMatch(css, /djng-q_fishHitbox|SF2FbG_(?:root|railMark|brandMark)/);
  assert.match(css, /svg\[aria-hidden="true"\]\[viewBox="0 0 23\.16 17\.04"\]/);
  assert.match(css, /:has\(> div\[data-slot\] > svg/);
  assert.doesNotMatch(css, /!important|(?:^|[;{])\s*(?:display|position|pointer-events)\s*:/m);
});

test('the real brand smoke recognizes the same current Harness mark containers', () => {
  const smoke = read('electron/native-dock-ui-smoke.cjs');
  for (const mark of marks) assert.ok(smoke.includes(`.${mark}`), `Smoke cannot inspect current mark: ${mark}`);
  assert.doesNotMatch(smoke, /djng-q_fishHitbox|SF2FbG_(?:root|railMark|brandMark)/);
});

test('detaching a native tool retains its application icon and reuses the sandboxed content', () => {
  let options, attached, focused = 0, layouts = 0;
  class FloatingWindow extends EventEmitter {
    constructor(value) { super(); options = value; this.contentView = { addChildView: (view) => { attached = view; } }; }
    getContentSize() { return [900, 640]; }
    show() {}
  }
  const icon = path.join(root, 'build', 'icon.ico');
  const view = { setVisible() {}, setBounds() {} };
  const surface = { options: { title: 'lulu · Office', icon, width: 900 }, view,
    isDestroyed: () => false, focus: () => { focused++; } };
  const dock = Object.create(NativeWorkbenchDock.prototype);
  Object.assign(dock, {
    rootDir: root, BrowserWindow: FloatingWindow,
    store: { getState: () => ({ active: 'office' }) }, surfaces: new Map([['office', surface]]),
    window: { contentView: { removeChildView(value) { assert.equal(value, view); } } },
    layout: () => { layouts++; }
  });
  dock.detach();
  assert.equal(options.icon, icon);
  assert.equal(options.title, surface.options.title);
  assert.deepEqual(options.webPreferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(attached, view);
  assert.equal(focused, 1);
  assert.equal(layouts, 1);
});
