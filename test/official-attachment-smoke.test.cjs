const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const test = require('node:test');
const vm = require('node:vm');
const { verifyStoredOfficeCopies, switchAttachmentWorkspace } = require('../electron/official-attachment-smoke.cjs');
const word = require('../resources/skills/word-docx/scripts/word-docx.cjs');
const excel = require('../resources/skills/excel-xlsx/scripts/excel-xlsx.cjs');

test('official attachment verification copies exact stored files before strict workspace inspection', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-official-attachment-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspacePath = path.join(directory, 'workspace'), harnessHome = path.join(directory, 'harness');
  await fs.mkdir(workspacePath);
  const fixtures = [
    ['表格.xlsx', word.createZip(excel.workbookEntries(excel.normalizeSpec({ sheets: [{ name: 'Data', rows: [['Item', 'Value'], ['Test', 12]] }] })))],
    ['文档.docx', word.createZip(word.documentEntries(word.normalizeSpec({ title: 'Attachment check', sections: [{ kind: 'paragraph', text: 'Fixture only.' }] })))],
    ['资料.pdf', Buffer.from('%PDF-1.7\nfixture')]
  ];
  const files = [];
  for (const [name, bytes] of fixtures) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const source = path.join(directory, name);
    const stored = path.join(harnessHome, 'attachments', 'v1', 'files', sha256.slice(0, 2), sha256, name);
    await fs.mkdir(path.dirname(stored), { recursive: true });
    await fs.writeFile(stored, bytes); await fs.writeFile(source, bytes);
    files.push({ name, bytes, path: source });
  }
  const result = await verifyStoredOfficeCopies({ files, harnessHome, workspacePath, word, excel });
  assert.equal(result.length, 2);
  assert.ok(result.every((item) => item.strict && item.outsideRejected && /^[a-f0-9]{64}$/.test(item.sha256)));
  await assert.rejects(verifyStoredOfficeCopies({ files, harnessHome, workspacePath, word, excel }), { code: 'EEXIST' });
});

test('bundled Office instructions preserve the workspace boundary for official attachments', async () => {
  for (const name of ['word-docx', 'excel-xlsx', 'powerpoint-pptx']) {
    const text = await fs.readFile(path.join(__dirname, '..', 'resources', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(text, /官方对话附件|Official conversation attachments/);
    assert.match(text, /未占用文件名|unused filename/);
    assert.match(text, /inspect --strict/);
    assert.match(text, /DSH_CWD/);
    assert.match(text, /导入工作区/);
  }
});

function navigationFixture(options = {}) {
  const originalId = 'session-11111111-1111-4111-8111-111111111111';
  const otherId = 'session-22222222-2222-4222-8222-222222222222';
  const workspacePath = path.join(os.tmpdir(), 'attachment-original'), otherPath = path.join(os.tmpdir(), 'attachment-other');
  const original = { workspaceId: 'workspace-a', path: workspacePath, title: 'attachment-original', sessionIds: [originalId] };
  const other = { workspaceId: 'workspace-b', path: otherPath, title: 'attachment-other', sessionIds: [] };
  if (options.extraOriginal) original.sessionIds.push(otherId);
  const state = { current: originalId, otherCreated: false, menuOpen: false, hovered: false, events: [], waits: [], calls: [] };
  const shown = { getClientRects: () => [{}] };
  const draft = () => state.current === originalId ? 'original unsent draft' : (options.otherDraft || '');
  const rail = () => state.current === originalId
    ? { children: Array.from({ length: state.events.includes('workspace-menu') && options.loseAttachment ? 3 : 4 }) }
    : options.otherAttachment ? { children: [{}] } : null;
  const button = {
    getClientRects: () => state.hovered ? [{}] : [],
    getAttribute: key => key === 'aria-label' ? 'New session in attachment-other' : null,
    click: () => {
      state.events.push('new-session'); state.current = otherId; other.sessionIds = [otherId];
      if (options.staleOriginal) original.sessionIds.push('session-33333333-3333-4333-8333-333333333333');
    }
  };
  const workspaceRow = { ...shown, querySelectorAll: () => [button],
    scrollIntoView: () => { state.events.push('scroll-workspace'); },
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 34 }) };
  const chip = { ...shown, getAttribute: key => key === 'aria-label' ? 'Choose workspace' : null,
    click: () => { state.events.push('workspace-picker'); state.menuOpen = true; } };
  const menu = { ...shown, disabled: false, textContent: original.title,
    click: () => { state.events.push('workspace-menu'); state.current = options.wrongReturn ? otherId : originalId; state.menuOpen = false; } };
  const context = { window: { __DSH_COMPOSER_TEXT__: { read: draft } },
    localStorage: { getItem: () => JSON.stringify({ sessionId: state.current }) },
    document: {
      querySelector: () => rail(),
      querySelectorAll: selector => {
        if (selector === '[role="treeitem"][aria-expanded] button') return [button];
        if (selector === '[role="treeitem"][aria-expanded]') return options.duplicateRows ? [workspaceRow, workspaceRow] : [workspaceRow];
        if (selector === '[data-conversation-content]') return [{ ...shown,
          getAttribute: key => key === 'data-conversation-session' ? state.current : null,
          querySelectorAll: () => [chip] }];
        if (selector === '[role="menu"] button[role="menuitem"]') return state.menuOpen ? [menu] : [];
        throw new Error('Unexpected selector: ' + selector);
      }
    } };
  const evaluate = async code => vm.runInNewContext(code, context);
  const hoverAt = async point => {
    assert.equal(point.x, 60); assert.equal(point.y, 37);
    state.events.push('hover-workspace'); state.hovered = !options.hoverFailed;
  };
  const waitFor = async code => { state.waits.push(code); assert.equal(await evaluate(code), true, 'UI condition failed: ' + code); };
  const api = async (_origin, method, payload) => {
    state.calls.push(method);
    if (method === 'workspace.create') {
      if (payload.path === workspacePath) return { created: false, workspace: structuredClone(original) };
      assert.equal(payload.path, otherPath);
      const created = !state.otherCreated; state.otherCreated = true;
      return { created, workspace: structuredClone(other) };
    }
    assert.equal(method, 'session.list', 'Navigation must not pre-create a Session through the API');
    return { items: [{ sessionId: originalId, cwd: options.wrongCwd ? otherPath : workspacePath, blank: true, running: false },
      ...(other.sessionIds.length ? [{ sessionId: otherId, cwd: otherPath, blank: true, running: false }] : [])] };
  };
  return { state, originalId, args: { selected: { workspaceId: original.workspaceId, sessionId: originalId },
    workspacePath, otherPath, origin: 'http://127.0.0.1:12345', api, evaluate, waitFor, hoverAt } };
}

test('attachment navigation uses New Session outward and the empty hero picker back to the exact original ID', async () => {
  const fixture = navigationFixture();
  assert.deepEqual(await switchAttachmentWorkspace(fixture.args), { otherSessionEmpty: true, originalSessionRestored: true, originalDraftRestored: true });
  assert.deepEqual(fixture.state.events, ['scroll-workspace', 'hover-workspace', 'new-session', 'workspace-picker', 'workspace-menu']);
  assert.equal(fixture.state.current, fixture.originalId);
  assert.ok(fixture.state.waits.some(code => code.includes('children.length === 4')));
  assert.ok(!fixture.state.calls.includes('session.create'));
});

for (const [name, options] of [
  ['multiple original sessions', { extraOriginal: true }], ['wrong original cwd', { wrongCwd: true }],
]) test('attachment navigation refuses ' + name + ' before leaving the draft', async () => {
  const fixture = navigationFixture(options);
  await assert.rejects(switchAttachmentWorkspace(fixture.args));
  assert.deepEqual(fixture.state.events, []);
});

for (const [name, options] of [
  ['text', { otherDraft: 'must not be carried into the original' }], ['attachments', { otherAttachment: true }],
  ['changed original membership', { staleOriginal: true }],
]) test('attachment return refuses ' + name + ' before opening the workspace picker', async () => {
  const fixture = navigationFixture(options);
  await assert.rejects(switchAttachmentWorkspace(fixture.args));
  assert.deepEqual(fixture.state.events, ['scroll-workspace', 'hover-workspace', 'new-session']);
});

for (const [name, options] of [
  ['another selected ID', { wrongReturn: true }], ['a missing attachment', { loseAttachment: true }],
]) test('attachment return does not accept ' + name, async () => {
  await assert.rejects(switchAttachmentWorkspace(navigationFixture(options).args));
});

test('attachment New Session refuses a button still hidden after a native hover', async () => {
  const fixture = navigationFixture({ hoverFailed: true });
  await assert.rejects(switchAttachmentWorkspace(fixture.args), /UI condition failed/);
  assert.deepEqual(fixture.state.events, ['scroll-workspace', 'hover-workspace']);
});

test('attachment New Session refuses ambiguous workspace rows before moving the pointer', async () => {
  const fixture = navigationFixture({ duplicateRows: true });
  await assert.rejects(switchAttachmentWorkspace(fixture.args), /UI condition failed/);
  assert.deepEqual(fixture.state.events, []);
});
