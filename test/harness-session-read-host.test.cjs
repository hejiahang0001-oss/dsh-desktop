const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createSessionReadHost } = require('../scripts/harness-session-read-host.cjs');
const { authenticateHarnessSupervisor } = require('../scripts/harness-smoke-auth.cjs');
const { establishHarnessSession } = require('../electron/harness-supervisor.cjs');

function assertAuthenticationRoutes(requests, tokenRoute) {
  assert.equal(requests.at(-1), '/api/pluginInventory/list');
  const authentication = requests.slice(0, -1);
  // Only consecutive retries inside authentication are permitted. Inventory
  // still occurs once, and history or reordered/new HTTP routes remain denied.
  const phases = authentication.filter((route, index) => index === 0 || route !== authentication[index - 1]);
  assert.deepEqual(phases, [tokenRoute, '/']);
}

async function fixture(t, sourceLayout = false) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-history-host-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home'); await fsp.mkdir(homeDir);
  const cliDir = sourceLayout ? path.join(root, 'apps', 'cli') : path.join(root, 'node_modules', '@deepseek-ai', 'dsh');
  const dshBinPath = path.join(cliDir, 'lib', 'bin.js');
  const toolsDir = sourceLayout ? path.join(root, 'packages', 'core', 'tools') : path.join(root, 'node_modules', '@deepseek-ai', 'dsh-tools');
  const toolsModule = path.join(toolsDir, 'lib', 'index.js');
  await fsp.mkdir(path.dirname(dshBinPath), { recursive: true }); await fsp.writeFile(dshBinPath, '// fixture only');
  await fsp.writeFile(path.join(cliDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.1-alpha.1' }));
  await fsp.mkdir(path.dirname(toolsModule), { recursive: true }); await fsp.writeFile(toolsModule, '// fixture only');
  await fsp.writeFile(path.join(toolsDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.2.1-alpha.1', main: 'lib/index.js', exports: { '.': './lib/index.js', './package.json': './package.json' } }));
  if (sourceLayout) {
    const link = path.join(cliDir, 'node_modules', '@deepseek-ai', 'dsh-tools');
    await fsp.mkdir(path.dirname(link), { recursive: true }); await fsp.symlink(toolsDir, link, 'junction');
  }
  const patchPath = path.join(root, 'base.patch.yml'), base = '- id: retained-setting\n  value: unchanged\n';
  await fsp.writeFile(patchPath, base);
  const provisions = [], provisionPlugin = async (request) => provisions.push(request);
  const child = new EventEmitter(); child.connected = true; const sent = [];
  child.send = (request, callback) => {
    sent.push(request);
    if (request.channel === 'dsh-session-control-v1') setImmediate(() => child.emit('message', {
      channel: request.channel, requestId: request.requestId, ok: true,
      value: { events: [], hasMore: false, throughSeq: -1, projections: { asOfSeq: -1, values: {} } }
    }));
    callback?.();
  };
  return { root, homeDir, runtime: { dshBinPath, patchPath }, toolsModule, base, provisionPlugin, provisions, child, sent };
}

test('isolated session reader mounts only tools and never creates a credential provider or widens permissions', async (t) => {
  const f = await fixture(t), host = await createSessionReadHost(f);
  assert.equal('providerModule' in host, false); assert.equal('status' in host, false);
  assert.deepEqual(f.provisions.map((request) => request.expectedName), ['dsh-desktop-tools']);
  assert.equal(await fsp.readFile(host.patchPath, 'utf8'), `${f.base}\n- insert:\n    - id: desktop-tools\n      name: dsh-desktop-tools\n`);
  assert.equal((await fsp.readdir(f.homeDir)).some((name) => /credential|vault/i.test(name)), false);
  const close = host.attach(f.child); t.after(close);
  assert.equal((await host.sessionControl.request('history-page', { sessionId: `session-${randomUUID()}` })).throughSeq, -1);
  await assert.rejects(host.sessionControl.request('fork', {}), /only read-only/);
  assert.deepEqual(f.sent.map((request) => request.operation), ['history-page']);
  const requestId = randomUUID();
  f.child.emit('message', { channel: 'dsh-terminal-read-v1', requestId, operation: 'read' });
  assert.deepEqual(f.sent.at(-1), { channel: 'dsh-terminal-read-v1', requestId, ok: false,
    error: 'Terminal access is unavailable in the isolated history smoke host.' });
  close(); assert.equal(f.child.listenerCount('message'), 0);
});

test('isolated session reader resolves the official source workspace without guessing deployment relatives', async (t) => {
  const f = await fixture(t, true), host = await createSessionReadHost(f);
  assert.equal(host.toolsModule, await fsp.realpath(f.toolsModule));
  assert.equal('providerModule' in host, false);
});

test('smoke authentication provisions missing read IPC before launch and keeps history off HTTP', async (t) => {
  const f = await fixture(t), requests = [];
  const server = http.createServer(async (request, response) => {
    requests.push(request.url);
    if (request.url.startsWith('/?token=')) { response.writeHead(303, { location: '/', 'set-cookie': 'harness=fake-test-cookie; HttpOnly' }); response.end(); return; }
    assert.equal(request.headers.cookie, 'harness=fake-test-cookie');
    if (request.url === '/') { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>Harness fixture</title>'); return; }
    assert.equal(request.url, '/api/pluginInventory/list');
    let body = ''; for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({
      type: 'server-response', rpcId: rpc.rpcId, result: { ok: true, value: { entries: [{ moduleName: 'dsh-desktop-tools', enabled: true, fiberPhase: 'active' }] } }
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const supervisor = { options: { rootDir: path.resolve(__dirname, '..') }, async start() {
    assert.equal(typeof this.options.createCredentialHost, 'function');
    this.credentialHost = await this.options.createCredentialHost(f);
    t.after(this.credentialHost.attach(f.child)); this.child = f.child;
    return `${origin}/?token=${'a'.repeat(32)}`;
  } };
  const auth = await authenticateHarnessSupervisor(supervisor);
  const history = await auth.apiCall(origin, 'session.history', { sessionId: `session-${randomUUID()}`, maxMessages: 2 }, { timeoutMs: 1500 });
  assert.equal(history.throughSeq, -1);
  assert.equal(f.sent[0].payload.maxMessages, 2); assert.equal(f.sent[0].payload.timeoutMs, 1500);
  assertAuthenticationRoutes(requests, `/?token=${'a'.repeat(32)}`);
  await assert.rejects(auth.apiCall('http://127.0.0.1:1', 'session.history', { sessionId: `session-${randomUUID()}` }), /authenticated process/);
  assert.equal(f.sent.length, 1);
});

test('smoke authentication rejects an already-running process lacking the read-only bridge', async () => {
  await assert.rejects(authenticateHarnessSupervisor({ options: {}, child: {}, start: async () => assert.fail('must not restart') }), /before Harness starts/);
});

test('smoke HTTP route guard permits authentication retries but rejects extra or reordered capabilities', () => {
  const token = `/?token=${'a'.repeat(32)}`, inventory = '/api/pluginInventory/list';
  for (const allowed of [[token, '/', inventory], [token, token, '/', inventory], [token, '/', '/', inventory]]) {
    assert.doesNotThrow(() => assertAuthenticationRoutes(allowed, token));
  }
  for (const rejected of [
    [], ['/', inventory], [token, inventory], [token, '/', token, inventory],
    [token, '/', inventory, inventory], [token, '/', '/api/session/history', inventory],
    [token, '/', 'http://127.0.0.1:1/', inventory]
  ]) {
    assert.throws(() => assertAuthenticationRoutes(rejected, token), { code: 'ERR_ASSERTION' });
  }
});

for (const failureStage of ['token', 'probe']) {
  test(`smoke authentication recovers from a ${failureStage} transport failure without losing cookie or route boundaries`, async () => {
    const origin = 'http://127.0.0.1:4567', tokenRoute = `/?token=${'a'.repeat(32)}`;
    const requests = []; let failed = false;
    const auth = await establishHarnessSession(`${origin}${tokenRoute}`, {
      attempts: 2, intervalMs: 0,
      fetchImpl: async (input, options) => {
        const url = new URL(input); assert.equal(url.origin, origin);
        const route = `${url.pathname}${url.search}`; requests.push(route);
        const isToken = route === tokenRoute;
        if (isToken) {
          assert.equal(options.redirect, 'manual'); assert.equal(options.headers, undefined);
        } else {
          assert.equal(route, '/'); assert.equal(options.headers.cookie, 'harness=fake-test-cookie');
        }
        if (!failed && (failureStage === 'token' ? isToken : !isToken)) {
          failed = true; throw new TypeError('Synthetic one-shot transport failure');
        }
        return isToken ? new Response(null, { status: 303, headers: { location: '/', 'set-cookie': 'harness=fake-test-cookie; HttpOnly' } })
          : new Response('<title>Harness fixture</title>', { status: 200, headers: { 'content-type': 'text/html' } });
      }
    });
    assert.equal(failed, true); assert.equal(auth.probe.status, 200);
    assert.equal(auth.cookie.header, 'harness=fake-test-cookie');
    assert.deepEqual(requests, failureStage === 'token' ? [tokenRoute, tokenRoute, '/'] : [tokenRoute, '/', '/']);
    assertAuthenticationRoutes([...requests, '/api/pluginInventory/list'], tokenRoute);
  });
}
