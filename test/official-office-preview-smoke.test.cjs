const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { previewExpression, finishOfficialOnboarding, observeAndAdvanceOfficialOnboarding } = require('../electron/official-office-preview-contract.cjs');

function element(attributes = {}, parentElement = null) {
  const children = new Map();
  return { attributes, parentElement, children, hidden: false, inert: false,
    style: { display: 'block', visibility: 'visible', opacity: '1' }, textContent: '',
    getAttribute: name => attributes[name] ?? null,
    querySelector: selector => children.get(selector)?.[0] || null,
    querySelectorAll: selector => children.get(selector) || [],
    getBoundingClientRect: () => ({ width: 500, height: 400, left: 0, top: 0, right: 500, bottom: 400 }),
    getClientRects: () => [1],
    contains(node) { for (; node; node = node.parentElement) if (node === this) return true; return false; }
  };
}

function previewFixture() {
  const name = '中文预览.docx';
  const root = element();
  const tab = element({ 'data-dockkit-tab': 'active' }, root);
  const title = element(); title.textContent = name;
  tab.children.set('[data-dockkit-tab-title]', [title]);
  const host = element({ 'data-dockkit-content': 'active' }, root);
  const preview = element({ 'data-textpreview-url': `dsh-resource://file/session/s/${encodeURIComponent(name)}` }, host);
  const pdf = element({}, preview);
  const page = element({}, pdf);
  const surface = element({}, page);
  const canvas = element({}, surface);
  const text = element({}, surface); text.textContent = '中文 金额 123.45';
  canvas.width = 2; canvas.height = 1;
  canvas.pixels = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  canvas.getContext = () => ({ getImageData: () => ({ data: canvas.pixels }) });
  host.children.set('[data-document-preview]', [preview]);
  preview.children.set('[data-pdf-preview]', [pdf]);
  pdf.children.set('[data-pdf-page]', [page]);
  pdf.children.set('[data-pdf-page="1"]', [page]);
  page.children.set('canvas', [canvas]);
  page.children.set('[data-pdf-text]', [text]);
  let scrolls = 0; page.scrollIntoView = () => { scrolls += 1; };
  const document = element();
  preview.contains = candidate => { for (let node = candidate; node; node = node.parentElement) if (node === preview) return true; return false; };
  document.elementFromPoint = () => canvas;
  document.children.set('[role="tab"][aria-selected="true"]', [tab]);
  document.children.set('[data-dockkit-content]', [host]);
  document.getElementById = id => id === 'root' ? root : null;
  const context = { document, getComputedStyle: node => node.style, innerWidth: 1280, innerHeight: 880 };
  const inspect = (action) => vm.runInNewContext(previewExpression(name, 1, action), context);
  return { root, tab, host, preview, pdf, page, surface, canvas, document, inspect, scrolls: () => scrolls };
}

test('official preview requires the selected file owner, visible canvas and nonempty bitmap without a font notice', () => {
  const f = previewFixture();
  const p = f.inspect();
  assert.equal(p.ready, true); assert.equal(p.kind, 'pdf'); assert.equal(p.canvasVisible, true);
  assert.equal(p.bitmap.ink, 1); assert.equal(p.text, '中文金额123.45'); assert.equal(p.fontWarning, null);
  assert.equal(p.occlusion.clear, true);
  f.inspect('scroll'); assert.equal(f.scrolls(), 1);
  f.canvas.attributes['aria-hidden'] = 'true';
  assert.equal(f.inspect().canvasVisible, true, 'FortuneSheet decorative canvas remains visually rendered');
  f.host.attributes['aria-hidden'] = 'true'; assert.equal(f.inspect().ready, false);
  delete f.host.attributes['aria-hidden'];
  f.host.attributes['data-dockkit-content'] = 'stale'; assert.equal(f.inspect().ready, false);
  f.host.attributes['data-dockkit-content'] = 'active';
  f.preview.attributes['data-textpreview-url'] = 'dsh-resource://file/session/s/old.pdf';
  assert.equal(f.inspect().ready, false);
});

test('hidden parent surfaces, collapsed sidebars, modal onboarding and blank bitmap cannot satisfy Office acceptance', () => {
  const f = previewFixture();
  f.surface.hidden = true; assert.equal(f.inspect().canvasVisible, false); assert.equal(f.inspect().bitmap.ink, 0);
  f.surface.hidden = false;
  f.surface.style.overflowX = 'hidden';
  f.surface.getBoundingClientRect = () => ({ width: 0, height: 400, left: 0, top: 0, right: 0, bottom: 400 });
  assert.equal(f.inspect().canvasVisible, false);
  f.surface.style.overflowX = 'visible';
  f.host.style.visibility = 'hidden'; assert.equal(f.inspect().ready, false);
  f.host.style.visibility = 'visible'; f.root.inert = true; assert.equal(f.inspect().ready, false);
  f.root.inert = false;
  f.document.children.set('[role="dialog"][aria-modal="true"]', [element()]); assert.equal(f.inspect().ready, false);
  f.document.children.delete('[role="dialog"][aria-modal="true"]');
  f.canvas.pixels.fill(255); assert.equal(f.inspect().bitmap.ink, 0);
  f.document.elementFromPoint = () => element();
  assert.equal(f.inspect().occlusion.clear, false, 'A composer painted over the preview is not usable document content');
  assert.equal(f.inspect().occlusion.obstructions.length, 9);
});

test('preview ownership uses its exact resource address, not the shortened presented-file tab label', () => {
  const f = previewFixture();
  f.tab.querySelector('[data-dockkit-tab-title]').textContent = '中文预览';
  assert.equal(f.inspect().ready, true);
  assert.equal(f.inspect().tabId, 'active');
  f.document.children.get('[role="tab"][aria-selected="true"]').push(f.tab);
  assert.equal(f.inspect().ready, false, 'Ambiguous selected owners must fail closed');
  f.document.children.get('[role="tab"][aria-selected="true"]').pop();
  f.preview.attributes['data-textpreview-url'] = 'dsh-resource://file/session/s/another.docx';
  assert.equal(f.inspect().ready, false);
});

test('spreadsheet observation keeps formula, saved display, notices and read-only state separate from PDF pages', () => {
  const f = previewFixture();
  f.preview.children.delete('[data-pdf-preview]');
  const excel = element({}, f.preview);
  const sheet = element({}, excel); sheet.textContent = '中文汇总';
  const formula = element({ contenteditable: 'false' }, excel); formula.textContent = '=SUM(B3:B4)';
  const selection = element({}, excel); selection.textContent = 'B5';
  const copied = element({}, excel); copied.textContent = '123.45';
  const notice = element({ 'aria-label': '公式结果可能不准确' }, excel);
  const overlay = element({}, excel); f.document.activeElement = overlay;
  excel.children.set('canvas', [f.canvas]);
  excel.children.set('.luckysheet-sheets-item-name', [sheet]);
  excel.children.set('.fortune-fx-input', [formula]);
  excel.children.set('.fortune-name-box', [selection]);
  excel.children.set('#fortune-copy-content table td', [copied]);
  excel.children.set('[data-excel-formula-warning]', [notice]);
  excel.children.set('.fortune-sheet-overlay', [overlay]);
  f.preview.children.set('[data-excel-preview]', [excel]);
  const p = f.inspect();
  assert.equal(p.kind, 'spreadsheet'); assert.equal(p.pages, 0);
  assert.equal(p.spreadsheet.formula, '=SUM(B3:B4)'); assert.equal(p.spreadsheet.copied[0], '123.45');
  assert.equal(p.spreadsheet.formulaReadOnly, true); assert.equal(p.spreadsheet.editingToolbar, false);
  assert.equal(p.spreadsheet.formulaWarning, '公式结果可能不准确');
  assert.equal(p.spreadsheet.keyboardTargetReady, true);
  const cellInput = element({}, excel); excel.children.set('.luckysheet-cell-input', [cellInput]);
  f.document.activeElement = cellInput; assert.equal(f.inspect().spreadsheet.keyboardTargetReady, true);
  f.document.activeElement = copied; assert.equal(f.inspect().spreadsheet.keyboardTargetReady, false);
});

for (const [welcomeTitle, credentialTitle, continueLabel, laterLabel] of [
  ['预览版说明', '添加一个 API Key 开始使用', '继续', '稍后配置'],
  ['Preview Notice', 'Add an API key to get started', 'Continue', 'Configure later']
]) test(`onboarding completes ${welcomeTitle} only through official actions and waits for a clear root`, async () => {
  const root = element(); root.inert = true;
  const unrelated = element({ 'aria-label': 'Other dialog' });
  const unrelatedButton = element(); unrelatedButton.textContent = '继续'; unrelatedButton.click = () => assert.fail('unrelated action');
  unrelated.children.set('button', [unrelatedButton]);
  const welcome = element({ 'aria-label': welcomeTitle, 'aria-modal': 'true' });
  const later = element({ 'aria-label': credentialTitle, 'aria-modal': 'true' });
  let dialogs = [unrelated, welcome], clicked = [];
  const button = element({}, welcome); button.textContent = continueLabel;
  button.click = () => { clicked.push(continueLabel); dialogs = [later]; };
  const skip = element({}, later); skip.textContent = laterLabel;
  skip.click = () => { clicked.push(laterLabel); dialogs = []; root.inert = false; };
  welcome.children.set('button', [button]); later.children.set('button', [skip]);
  const document = { querySelectorAll: () => dialogs, getElementById: () => root,
    elementFromPoint: () => dialogs.at(-1).querySelectorAll('button')[0] };
  const result = await finishOfficialOnboarding({ evaluate: async code => vm.runInNewContext(code, {
    document, getComputedStyle: node => node.style, innerWidth: 1280, innerHeight: 880
  }) });
  assert.deepEqual(clicked, [continueLabel, laterLabel]); assert.equal(result.rootInert, false);
});

function accountFixture(title = '开始使用', close = '关闭', key = '添加 API Key', login = '登录') {
  const root = element();
  const dialog = element({ 'aria-label': title, 'aria-modal': 'true' });
  const button = element({ 'aria-label': close }, dialog);
  const api = element({}, dialog); api.textContent = key;
  const signIn = element({}, dialog); signIn.textContent = login;
  const controls = [button, api, signIn]; dialog.children.set('button', controls);
  let dialogs = [dialog], hit = button;
  const clicks = [];
  button.click = () => { clicks.push(close); dialogs = []; };
  api.click = signIn.click = () => assert.fail('Must not invoke account or API-key setup');
  const document = { querySelectorAll: () => dialogs, getElementById: () => root, elementFromPoint: () => hit };
  return { root, dialog, button, api, signIn, controls, clicks,
    context: { document, getComputedStyle: node => node.style, innerWidth: 1280, innerHeight: 880 },
    dialogs: value => { dialogs = value; }, hit: value => { hit = value; } };
}

async function finishWithClock(fixture, beforeObserve = () => {}) {
  let now = 1000, observations = 0;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../electron/official-office-preview-contract.cjs'), 'utf8'), {
    module, Date: { now: () => now },
    setTimeout: (resolve, ms) => { assert.equal(ms, 100); now += ms; resolve(); }
  });
  let result, error;
  try {
    result = await module.exports.finishOfficialOnboarding({ evaluate: async code => {
      beforeObserve(observations++, now); return vm.runInNewContext(code, fixture.context);
    } });
  } catch (caught) { error = caught; }
  return { result, error, elapsed: now - 1000 };
}

for (const row of [
  ['开始使用', '关闭', '添加 API Key', '登录'], ['Get started', 'Close', 'Add API Key', 'Sign in']
]) test(`official idle account choice closes through the sole ${row[1]} action`, async () => {
  const fixture = accountFixture(...row), actual = await finishWithClock(fixture);
  assert.equal(actual.error, undefined); assert.equal(actual.result.ok, true);
  assert.deepEqual(fixture.clicks, [row[1]]); assert.equal(actual.elapsed, 700);
});

const inspectOnboarding = fixture => vm.runInNewContext(`(${observeAndAdvanceOfficialOnboarding.toString()})()`, fixture.context);
for (const [name, change] of [
  ['unknown title', f => { f.dialog.attributes['aria-label'] = 'Delete all data'; }],
  ['waiting login', f => { f.dialog.attributes['aria-label'] = '等待登录'; }],
  ['failed login', f => { f.dialog.attributes['aria-label'] = '登录失败'; }],
  ['expired login', f => { f.dialog.attributes['aria-label'] = '登录已超时'; }],
  ['English waiting login', f => { f.dialog.attributes['aria-label'] = 'Waiting for sign in'; }],
  ['English failed login', f => { f.dialog.attributes['aria-label'] = 'Could not sign in'; }],
  ['English expired login', f => { f.dialog.attributes['aria-label'] = 'Sign in timed out'; }],
  ['busy dialog with idle labels', f => { f.dialog.attributes['aria-busy'] = 'true'; }],
  ['busy descendant with idle labels', f => { f.dialog.children.set('[aria-busy="true"]', [element({ 'aria-busy': 'true' }, f.dialog)]); }],
  ['pending disabled key action', f => { f.api.disabled = true; }],
  ['pending disabled sign-in action', f => { f.signIn.disabled = true; }],
  ['pending aria-disabled sign-in action', f => { f.signIn.attributes['aria-disabled'] = 'true'; }],
  ['missing idle key action', f => { f.controls.splice(1, 1); }],
  ['missing idle sign-in action', f => { f.controls.splice(2, 1); }],
  ['wrong locale close', f => { f.button.attributes['aria-label'] = 'Close'; }],
  ['duplicate close', f => { f.controls.push(f.button); }],
  ['hidden close', f => { f.button.hidden = true; }],
  ['inert close', f => { f.button.inert = true; }],
  ['disabled close', f => { f.button.disabled = true; }],
  ['aria-disabled close', f => { f.button.attributes['aria-disabled'] = 'true'; }],
  ['occluded close', f => { f.hit(element()); }],
  ['offscreen close', f => { f.button.getBoundingClientRect = () => ({ left: 2000, top: 10, width: 40, height: 20 }); }],
  ['nonmodal account title', f => { f.dialog.attributes['aria-modal'] = 'false'; }],
  ['newer unknown foreground', f => { f.dialogs([f.dialog, element({ 'aria-label': 'Unknown', 'aria-modal': 'true' })]); }]
]) test(`onboarding does not dismiss ${name}`, () => {
  const fixture = accountFixture(); change(fixture);
  assert.equal(inspectOnboarding(fixture).clear, false); assert.deepEqual(fixture.clicks, []);
});

test('onboarding uses dialog-local controls and allows a real nested icon hit', () => {
  const fixture = accountFixture(); fixture.hit(element({}, fixture.button));
  fixture.context.document.querySelector = () => assert.fail('Must not search page-global Close');
  assert.equal(inspectOnboarding(fixture).action, '关闭'); assert.deepEqual(fixture.clicks, ['关闭']);
});

test('unknown dialog and inert root retain the original 15-second timeout', async () => {
  const fixture = accountFixture('Unknown');
  const unknown = await finishWithClock(fixture);
  assert.match(unknown.error.message, /Official onboarding did not settle/); assert.equal(unknown.elapsed, 15000);
  assert.deepEqual(fixture.clicks, []); fixture.dialogs([]); fixture.root.inert = true;
  const inert = await finishWithClock(fixture);
  assert.equal(inert.elapsed, 15000); assert.match(inert.error.message, /Official onboarding did not settle/);
});

test('another modal resets the original 600ms clear settling interval', async () => {
  const fixture = accountFixture(); fixture.dialogs([]);
  const actual = await finishWithClock(fixture, observation => {
    if (observation === 5) { fixture.dialog.attributes['aria-label'] = 'Unknown'; fixture.dialogs([fixture.dialog]); }
    if (observation === 7) fixture.dialogs([]);
  });
  assert.equal(actual.error, undefined); assert.equal(actual.elapsed, 1300); assert.deepEqual(fixture.clicks, []);
});
