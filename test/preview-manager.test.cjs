const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

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

test('stopping during an external probe prevents the stale result from reviving preview', async () => {
  const pendingProbe = deferred();
  const manager = new PreviewManager({ probe: () => pendingProbe.promise });
  const connecting = manager.connect('http://127.0.0.1:5173');
  await waitForState(manager, 'starting');

  const stopped = await manager.stop();
  assert.equal(stopped.status, 'stopped');
  pendingProbe.resolve({ ok: true, url: 'http://127.0.0.1:5173/' });
  await connecting;

  assert.equal(manager.getState().status, 'stopped');
  assert.equal(manager.getState().mode, 'none');
  assert.equal(manager.monitor, null);
});

test('a stale monitor probe cannot overwrite a replacement external preview', async () => {
  const staleMonitorProbe = deferred();
  let probeCount = 0;
  const manager = new PreviewManager({
    probe: async (url) => {
      probeCount += 1;
      if (probeCount === 2) return staleMonitorProbe.promise;
      return { ok: true, url };
    }
  });

  await manager.connect('http://127.0.0.1:5173');
  const staleMonitoring = manager._monitorExternal();
  assert.equal(probeCount, 2);
  await manager.connect('http://127.0.0.1:4173');
  staleMonitorProbe.resolve({ ok: false, error: new Error('old service offline') });
  await staleMonitoring;

  assert.equal(manager.getState().status, 'ready');
  assert.equal(manager.getState().url, 'http://127.0.0.1:4173/');
  assert.equal(manager.getState().error, '');
  await manager.stop();
});

test('stopping while a managed preview starts listening prevents a stale ready state', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-listen-race-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>race</h1>');

  const server = new EventEmitter();
  server.listen = () => {};
  server.close = (callback) => callback();
  server.address = () => ({ port: 54321 });
  const manager = new PreviewManager({ createServer: () => server });
  await manager.activate(root);

  const opening = manager.openFile('index.html');
  await waitForState(manager, 'starting');
  await manager.stop();
  server.emit('listening');
  await opening;

  assert.equal(manager.getState().status, 'stopped');
  assert.equal(manager.getState().mode, 'none');
  assert.equal(manager.server, null);
});

test('managed preview close force-clears persistent connections and rejects within a bound', {
  timeout: 1000
}, async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-close-timeout-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>persistent</h1>');

  const calls = { close: 0, closeIdleConnections: 0, closeAllConnections: 0 };
  const server = new EventEmitter();
  server.listen = () => queueMicrotask(() => server.emit('listening'));
  server.close = () => { calls.close += 1; };
  server.closeIdleConnections = () => { calls.closeIdleConnections += 1; };
  server.closeAllConnections = () => { calls.closeAllConnections += 1; };
  server.address = () => ({ port: 54322 });
  const manager = new PreviewManager({
    createServer: () => server,
    closeTimeoutMs: 25
  });
  await manager.activate(root);
  await manager.openFile('index.html');

  await assert.rejects(manager.stop(), (error) => error instanceof PreviewError && error.code === 'PREVIEW_CLOSE_TIMEOUT');
  assert.deepEqual(calls, { close: 1, closeIdleConnections: 1, closeAllConnections: 1 });
  assert.equal(manager.server, server);
  assert.equal(manager.isActive(), true);
  assert.equal(manager.getState().owned, true);

  server.close = (callback) => { calls.close += 1; callback(); };
  await manager.stop();
  assert.equal(manager.server, null);
  assert.equal(manager.isActive(), false);
});

test('stopping an external preview never closes the external service', async (context) => {
  const server = http.createServer((_request, response) => response.end('still-running'));
  const port = await listen(server);
  context.after(async () => { if (server.listening) await close(server); });
  const manager = new PreviewManager();

  await manager.connect(`http://127.0.0.1:${port}`);
  await manager.stop();

  assert.equal(server.listening, true);
  assert.equal((await probeLoopback(`http://127.0.0.1:${port}`)).ok, true);
});

test('only HTML files can start the managed application preview', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preview-type-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'readme.md'), '# no');
  const manager = new PreviewManager();
  await manager.activate(root);
  await assert.rejects(manager.openFile('readme.md'), (error) => error.code === 'PREVIEW_NOT_HTML');
});
