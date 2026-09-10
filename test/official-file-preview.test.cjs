const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createOfficialFilePreview } = require('../electron/official-file-preview.cjs');

const sessionId = 'session-11111111-1111-4111-8111-111111111111';
const otherId = 'session-22222222-2222-4222-8222-222222222222';
const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-official-preview-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '中文 #?.md'.replace('?', '问')), '# readonly');
  fs.writeFileSync(path.join(root, '.env'), 'synthetic secret');
  return root;
};

test('official preview resolves a guarded relative address without returning file bytes', async (t) => {
  const root = fixture(t), name = '中文 #问.md';
  const service = createOfficialFilePreview({ getContext: async () => ({ sessionId, workspacePath: root }), getWorkspacePath: () => root });
  const request = { path: name, sessionId, workspacePath: root };
  const result = await service.resolve(request);
  assert.deepEqual(result, { available: true, sessionId, address: `dsh-resource://file/session/${sessionId}/${encodeURIComponent(name)}` });
  assert.equal(fs.readFileSync(path.join(root, name), 'utf8'), '# readonly');
  for (const bad of ['.env', '../outside.md', path.join(root, name), 'missing.md', 'file:stream', 'CON']) {
    await assert.rejects(service.resolve({ ...request, path: bad }));
  }
});

test('official preview rejects changed Session, workspace and links', async (t) => {
  const root = fixture(t), request = { path: '中文 #问.md', sessionId, workspacePath: root };
  let calls = 0;
  const changing = createOfficialFilePreview({ getContext: async () => ({ sessionId: ++calls === 1 ? sessionId : otherId, workspacePath: root }), getWorkspacePath: () => root });
  await assert.rejects(changing.resolve(request), /会话|工作区/);
  const mismatch = createOfficialFilePreview({ getContext: async () => ({ sessionId, workspacePath: os.tmpdir() }), getWorkspacePath: () => root });
  await assert.rejects(mismatch.resolve(request), /工作区/);
  const valid = createOfficialFilePreview({ getContext: async () => ({ sessionId, workspacePath: root }), getWorkspacePath: () => root });
  fs.symlinkSync(os.tmpdir(), path.join(root, 'outside'), 'junction');
  await assert.rejects(valid.resolve({ ...request, path: 'outside/any.md' }));
});

function clientHarness(resolvePreview) {
  let plugin, current = sessionId, currentAddress, dispose;
  const opened = [];
  const window = { desktopAPI: { files: { resolvePreview } }, __ModuleLoader__: { load: (row) => { plugin = row.factory(); } } };
  vm.runInNewContext(fs.readFileSync(path.resolve('runtime/dsh-desktop-tools/client.js'), 'utf8'), { window });
  plugin.apply({ sessions: { list: { getSnapshot: () => ({ current, currentAddress, phase: 'ready' }) } },
    sidebarRight: { openResource: (address) => opened.push(address) }, effect: (effect) => { dispose = effect(); } });
  return { window, opened, switch: () => { current = otherId; }, subagent: () => { currentAddress = {}; }, dispose: () => dispose() };
}

test('desktop browser plugin delegates only to public official Sidebar navigation', async () => {
  const address = `dsh-resource://file/session/${sessionId}/a.pdf`;
  const client = clientHarness(async () => ({ available: true, sessionId, address }));
  assert.equal(await client.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace'), true);
  assert.deepEqual(client.opened, [address]);
  client.subagent();
  await assert.rejects(client.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace'));
  client.dispose();
  assert.equal(client.window.__DSH_OFFICIAL_FILES__, undefined);
});

test('desktop browser plugin drops stale replies and failed grants', async () => {
  let finish;
  const client = clientHarness(() => new Promise((resolve) => { finish = resolve; }));
  const opening = client.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace');
  client.switch();
  finish({ available: true, sessionId, address: `dsh-resource://file/session/${sessionId}/a.pdf` });
  await assert.rejects(opening, /会话/);
  assert.deepEqual(client.opened, []);
  const rejected = clientHarness(async () => ({ available: false, message: '受保护的文件' }));
  await assert.rejects(rejected.window.__DSH_OFFICIAL_FILES__.openFile('.env', 'C:/workspace'), /受保护/);
  assert.deepEqual(rejected.opened, []);
});

test('desktop browser plugin invalidates concurrent and disposed preview requests', async () => {
  const pending = [];
  const client = clientHarness(() => new Promise((resolve) => pending.push(resolve)));
  const bridge = client.window.__DSH_OFFICIAL_FILES__;
  const grant = (file) => ({ available: true, sessionId, address: `dsh-resource://file/session/${sessionId}/${file}` });
  const first = bridge.openFile('a.pdf', 'C:/workspace');
  const stale = assert.rejects(first, /请求已变化/);
  const second = bridge.openFile('b.pdf', 'C:/workspace');
  pending[1](grant('b.pdf'));
  assert.equal(await second, true);
  pending[0](grant('a.pdf'));
  await stale;
  assert.deepEqual(client.opened, [grant('b.pdf').address]);
  const third = bridge.openFile('c.pdf', 'C:/workspace');
  const disposed = assert.rejects(third, /请求已变化/);
  client.dispose();
  pending[2](grant('c.pdf'));
  await disposed;
  assert.deepEqual(client.opened, [grant('b.pdf').address]);
});

test('desktop browser plugin rejects cross-session and non-file navigation grants', async () => {
  for (const grant of [
    { sessionId: otherId, address: `dsh-resource://file/session/${otherId}/a.pdf` },
    { sessionId, address: 'https://example.invalid/a.pdf' },
    { sessionId, address: 'file:///C:/outside/a.pdf' },
    { sessionId, address: null }
  ]) {
    const client = clientHarness(async () => ({ available: true, ...grant }));
    await assert.rejects(client.window.__DSH_OFFICIAL_FILES__.openFile('a.pdf', 'C:/workspace'), /身份不一致/);
    assert.deepEqual(client.opened, []);
  }
});
