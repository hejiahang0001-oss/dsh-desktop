const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  PreviewError,
  PreviewManager,
  isSafePreviewNavigation,
  normalizeLoopbackUrl,
  probeLoopback
} = require('../electron/preview-manager.cjs');

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = (server) => new Promise((resolve) => server.close(() => resolve()));

const waitForState = (manager, status, timeoutMs = 5000) => new Promise((resolve, reject) => {
  if (manager.getState().status === status) return resolve(manager.getState());
  const timer = setTimeout(() => {
    manager.off('state', onState);
    reject(new Error(`preview state timed out: ${status}`));
  }, timeoutMs);
  const onState = (state) => {
    if (state.status !== status) return;
    clearTimeout(timer);
    manager.off('state', onState);
    resolve(state);
  };
  manager.on('state', onState);
});

test('preview URLs accept only credential-free loopback services outside the Harness origin', () => {
  assert.equal(normalizeLoopbackUrl('3000'), 'http://127.0.0.1:3000/');
  assert.equal(normalizeLoopbackUrl('localhost:5173/app'), 'http://localhost:5173/app');
  assert.equal(isSafePreviewNavigation('about:blank'), true);
  assert.equal(isSafePreviewNavigation('http://127.0.0.1:5173/'), true);
  assert.equal(isSafePreviewNavigation('http://127.0.0.1:5173/app', { allowedOrigins: ['http://127.0.0.1:5173'] }), true);
  assert.equal(isSafePreviewNavigation('http://127.0.0.1:4173/', { allowedOrigins: ['http://127.0.0.1:5173'] }), false);
  assert.equal(isSafePreviewNavigation('http://127.0.0.1:5173/', { allowedOrigins: [] }), false);
  assert.equal(isSafePreviewNavigation('https://example.com/'), false);
  assert.throws(() => normalizeLoopbackUrl('https://example.com'), PreviewError);
  assert.throws(() => normalizeLoopbackUrl('http://user:secret@127.0.0.1:3000'), PreviewError);
  assert.throws(() => normalizeLoopbackUrl('http://127.0.0.1:4010', { reservedOrigins: ['http://127.0.0.1:4010'] }), PreviewError);
});

test('managed HTML preview serves current workspace assets and blocks secrets and traversal', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-static-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site', 'index.html'), '<!doctype html><link rel="stylesheet" href="/site/style.css"><h1>DSH preview</h1>');
  fs.writeFileSync(path.join(root, 'site', 'style.css'), 'h1 { color: green; }');
  fs.writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=not-for-preview');

  const manager = new PreviewManager();
  await manager.activate(root);
  context.after(async () => { await manager.stop(); });
  const state = await manager.openFile('site/index.html');
  assert.equal(state.status, 'ready');
  assert.equal(state.mode, 'static');
  assert.equal(state.owned, true);
  assert.ok(state.port > 0);

  const html = await fetch(state.url);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /DSH preview/);
  const css = await fetch(`http://127.0.0.1:${state.port}/site/style.css`);
  assert.equal(css.status, 200);
  assert.match(await css.text(), /color: green/);
  assert.equal((await fetch(`http://127.0.0.1:${state.port}/.env`)).status, 403);
  assert.ok([400, 403].includes((await fetch(`http://127.0.0.1:${state.port}/..%2Foutside.txt`)).status));

  await manager.stop();
  assert.equal(manager.getState().status, 'stopped');
  await assert.rejects(fetch(state.url));
});

test('workspace activation releases the previous managed preview port', async (context) => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-first-'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-second-'));
  context.after(() => {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(first, 'index.html'), '<h1>first</h1>');
  const manager = new PreviewManager();
  await manager.activate(first);
  const state = await manager.openFile('index.html');
  await manager.activate(second);
  assert.equal(manager.getState().workspacePath, second);
  assert.equal(manager.isActive(), false);
  await assert.rejects(fetch(state.url));
});

test('external loopback preview is monitored but never treated as an owned port', async (context) => {
  const server = http.createServer((_request, response) => response.end('<h1>external</h1>'));
  const port = await listen(server);
  context.after(async () => { if (server.listening) await close(server); });
  const manager = new PreviewManager({ monitorIntervalMs: 500 });
  context.after(async () => { await manager.stop(); });
  const state = await manager.connect(`http://127.0.0.1:${port}`);
  assert.equal(state.status, 'ready');
  assert.equal(state.mode, 'external');
  assert.equal(state.owned, false);
  assert.equal((await probeLoopback(state.url)).ok, true);

  const offline = waitForState(manager, 'offline');
  await close(server);
  assert.equal((await offline).owned, false);
});

test('only HTML files can start the managed application preview', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-type-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'readme.md'), '# no');
  const manager = new PreviewManager();
  await manager.activate(root);
  await assert.rejects(manager.openFile('readme.md'), (error) => error.code === 'PREVIEW_NOT_HTML');
});
