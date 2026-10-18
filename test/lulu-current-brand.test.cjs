const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { NativeWorkbenchDock } = require('../electron/native-workbench-dock.cjs');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
function smokeFixture(finishOfficialOnboarding = async () => { throw new Error('Unexpected onboarding'); }) {
  const module = { exports: {} };
  vm.runInNewContext(read('electron/native-dock-ui-smoke.cjs'), { module,
    process: { argv: ['--smoke-lulu-brand'] }, setTimeout,
    require: name => name === 'electron' ? { dialog: { showMessageBox() {} } }
      : name === 'node:fs/promises' ? { writeFile: async () => {} }
        : name === './official-office-preview-contract.cjs' ? { finishOfficialOnboarding } : require(name)
  });
  return module.exports;
}
const { inspectBrandInteraction } = smokeFixture();
// Reviewed rc.2 commit 687f282e8625c6b8d11ff58211a90524be2e4317:
// EmptyHero/HeroShell, SidebarRoot and FishLogo retain the alpha.2 DOM contract,
// but the actual rc.2 client bundles have new scoped class names. Never broaden
// these decorative-only selectors to generic functional icons.
const reviewedBrandVersion = '0.2.1-rc.2';
const marks = ['VNJnBa_fishHitbox', '_9Bqw3q_railMark', '_9Bqw3q_brandMark'];

test('the reviewed UI brand pin matches the runtime manifest and CSS version', () => {
  const manifest = JSON.parse(read('runtime/harness/package.json'));
  assert.equal(manifest.version, reviewedBrandVersion, 'A Harness upgrade requires a fresh UI brand selector review');
  assert.equal(manifest.dshDesktop.packageVersion, reviewedBrandVersion);
  assert.ok(read('assets/lulu-harness-theme.css').includes(`Pinned ${reviewedBrandVersion} decorative marks only.`));
});

test('the pinned Harness welcome and sidebar marks receive lulu without changing official controls', () => {
  const css = read('assets/lulu-harness-theme.css');
  for (const mark of marks) assert.ok(css.includes(`.${mark}`), `Missing current decorative mark: ${mark}`);
  assert.doesNotMatch(css, /(?:djng-q|qVIJiq|zBQbhG)_fishHitbox|(?:SF2FbG|ghK-Yq|_4_Dsta)_(?:root|railMark|brandMark)/);
  for (const mark of marks.slice(1)) assert.ok(css.includes(`._9Bqw3q_root .${mark}`));
  assert.match(css, /svg\[aria-hidden="true"\]\[viewBox="0 0 23\.16 17\.04"\]/);
  assert.match(css, /:has\(> div\[data-slot\] > svg/);
  assert.doesNotMatch(css, /!important|(?:^|[;{])\s*(?:display|position|pointer-events)\s*:/m);
});

test('the real brand smoke recognizes the same current Harness mark containers', () => {
  const smoke = read('electron/native-dock-ui-smoke.cjs');
  for (const mark of marks) assert.ok(smoke.includes(`.${mark}`), `Smoke cannot inspect current mark: ${mark}`);
  assert.doesNotMatch(smoke, /(?:djng-q|qVIJiq|zBQbhG)_fishHitbox|(?:SF2FbG|ghK-Yq|_4_Dsta)_(?:root|railMark|brandMark|toggle)/);
  for (const mark of [...marks.slice(1), '_9Bqw3q_toggle']) assert.ok(smoke.includes(`._9Bqw3q_root .${mark}`));
});

test('brand interaction rejects modal, inert or hidden ancestry, and hit-test occlusion', () => {
  const element = (parentElement = null, left = 10) => ({ parentElement, hidden: false, inert: false,
    style: { display: 'block', visibility: 'visible', opacity: '1' },
    getBoundingClientRect: () => ({ left, top: 10, width: 40, height: 20 }),
    contains(node) { for (; node; node = node.parentElement) if (node === this) return true; return false; }
  });
  const root = element(), modal = element(), input = element(root, 100), navigation = element(root, 200);
  let dialogs = [modal];
  const document = { getElementById: () => root, querySelectorAll: () => dialogs,
    querySelector: selector => selector.startsWith('[data-composer') ? input : navigation,
    elementFromPoint: x => x < 200 ? input : navigation };
  const context = { document, getComputedStyle: node => node.style, innerWidth: 1280, innerHeight: 880 };
  const inspect = () => vm.runInNewContext(`(${inspectBrandInteraction.toString()})()`, context);
  assert.equal(inspect().noVisibleDialog, false);
  dialogs = []; assert.ok(Object.values(inspect()).every(Boolean));
  root.inert = true; assert.equal(inspect().rootInteractive, false); assert.equal(inspect().inputExposed, false);
  root.inert = false; root.hidden = true; assert.equal(inspect().inputExposed, false);
  root.hidden = false; document.elementFromPoint = () => modal;
  assert.equal(inspect().inputExposed, false); assert.equal(inspect().navigationExposed, false);
  document.elementFromPoint = x => element(x < 200 ? input : navigation);
  assert.ok(Object.values(inspect()).every(Boolean), 'A descendant icon is a real hit on its control');
});

for (const rejectedFact of [null, 'noVisibleDialog', 'rootInteractive', 'inputExposed', 'navigationExposed']) {
  test(`real brand smoke requires shared onboarding and all appearance facts: ${rejectedFact || 'clear'}`, async () => {
    let onboardingCalls = 0;
    const smoke = smokeFixture(async () => { onboardingCalls++; return { ok: true, actions: ['关闭'], rootInert: false }; });
    const window = { getBounds: () => ({}), setBounds() {}, setSize() {}, webContents: {
      capturePage: async () => ({ toPNG: () => Buffer.alloc(0) }),
      executeJavaScript: async code => {
        if (code.includes('const marks =')) return { configured: true, marks: [{ visibility: 'hidden', mascotBackground: true }] };
        if (code.startsWith('(async () =>')) {
          assert.ok(code.includes('function inspectBrandInteraction()'), 'Every appearance runs the public DOM observer');
          return { dark: code.includes("toggleAttribute('data-ds-dark-theme', true)"), imagesDecoded: true,
            inputVisible: true, inputFocusable: true, navigationVisible: true, noHorizontalOverflow: true,
            noVisibleDialog: true, rootInteractive: true, inputExposed: true, navigationExposed: true,
            ...(rejectedFact ? { [rejectedFact]: false } : {}) };
        }
        return null;
      }
    } };
    const result = await smoke.runNativeDockSmoke({ window, dock: { layout() {} }, target: 'fixture', version: 'fixture' });
    assert.equal(onboardingCalls, 1); assert.equal(result.onboarding.ok, true);
    assert.equal(result.ok, rejectedFact === null);
    assert.equal(result.appearances.length, 3);
    for (const variant of ['light', 'dark', 'compact']) assert.equal(result.assertions[`brand${variant}`], rejectedFact === null);
  });
}

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
