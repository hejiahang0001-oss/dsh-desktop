const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  ProxySettingsError,
  ProxySettingsStore,
  buildHarnessProxyEnvironment,
  normalizeProxySettings,
  normalizeProxyUrl,
  parseResolvedProxy,
  sessionProxyConfig
} = require('../electron/network-proxy.cjs');

const root = path.resolve(__dirname, '..');

test('proxy settings accept direct, system, and credential-free HTTP(S) endpoints', () => {
  assert.deepEqual(normalizeProxySettings({ mode: 'direct', proxyUrl: 'http://ignored:1' }), { mode: 'direct', proxyUrl: '' });
  assert.deepEqual(normalizeProxySettings({ mode: 'system' }), { mode: 'system', proxyUrl: '' });
  assert.deepEqual(normalizeProxySettings({ mode: 'custom', proxyUrl: ' http://127.0.0.1:7890/ ' }), {
    mode: 'custom',
    proxyUrl: 'http://127.0.0.1:7890'
  });
  assert.equal(normalizeProxyUrl('https://proxy.example.com:8443'), 'https://proxy.example.com:8443');
  assert.throws(() => normalizeProxyUrl('socks5://127.0.0.1:1080'), ProxySettingsError);
  assert.throws(() => normalizeProxyUrl('http://user:password@proxy.example.com:8080'), (error) => error.code === 'credentials-not-supported');
  assert.throws(() => normalizeProxyUrl('http://proxy.example.com:8080/path'), (error) => error.code === 'invalid-url');
});

test('Windows proxy resolution accepts HTTP(S), preserves DIRECT, and rejects SOCKS', () => {
  assert.equal(parseResolvedProxy('PROXY 127.0.0.1:7890; DIRECT'), 'http://127.0.0.1:7890');
  assert.equal(parseResolvedProxy('HTTPS proxy.example.com:8443'), 'https://proxy.example.com:8443');
  assert.equal(parseResolvedProxy('DIRECT'), '');
  assert.throws(() => parseResolvedProxy('SOCKS5 127.0.0.1:1080'), (error) => error.code === 'unsupported-system-proxy');
});

test('proxy config bypasses loopback and Harness environment uses Node built-in proxy support', () => {
  assert.deepEqual(sessionProxyConfig({ mode: 'direct' }), { mode: 'direct' });
  assert.deepEqual(sessionProxyConfig({ mode: 'system' }), { mode: 'system' });
  assert.deepEqual(sessionProxyConfig({ mode: 'custom', proxyUrl: 'http://127.0.0.1:7890' }), {
    mode: 'fixed_servers',
    proxyRules: 'http://127.0.0.1:7890',
    proxyBypassRules: '127.0.0.1;localhost;[::1]'
  });
  assert.deepEqual(buildHarnessProxyEnvironment(''), {});
  assert.deepEqual(buildHarnessProxyEnvironment('http://127.0.0.1:7890'), {
    HTTP_PROXY: 'http://127.0.0.1:7890',
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    NO_PROXY: '127.0.0.1,localhost,::1',
    NODE_USE_ENV_PROXY: '1'
  });
});

test('proxy settings persist without accepting a corrupted or credential-bearing file', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-network-store-'));
  const filePath = path.join(root, 'network-state.json');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ProxySettingsStore({ filePath });
  assert.deepEqual(await store.init(), { mode: 'direct', proxyUrl: '' });
  await store.set({ mode: 'custom', proxyUrl: 'https://proxy.example.com:8443' });
  assert.deepEqual(await new ProxySettingsStore({ filePath }).init(), { mode: 'custom', proxyUrl: 'https://proxy.example.com:8443' });
  await assert.rejects(() => store.set({ mode: 'custom', proxyUrl: 'http://user:secret@proxy.example.com' }), ProxySettingsError);
  assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /user|secret/);
});

test('the bundled Node runtime sends fetch through the software-selected HTTP proxy', async (context) => {
  let requestCount = 0;
  const proxy = http.createServer((request, response) => {
    requestCount += 1;
    assert.match(request.url, /^http:\/\/dsh-proxy-smoke\.invalid\/probe/);
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('proxy-route-ok');
  });
  proxy.on('connect', (request, socket) => {
    requestCount += 1;
    assert.equal(request.url, 'dsh-proxy-smoke.invalid:80');
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 14\r\nConnection: close\r\n\r\nproxy-route-ok');
    });
  });
  context.after(() => proxy.close());
  await new Promise((resolve, reject) => {
    proxy.once('error', reject);
    proxy.listen(0, '127.0.0.1', resolve);
  });
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY'].includes(name.toUpperCase())) {
      delete environment[name];
    }
  }
  Object.assign(environment, buildHarnessProxyEnvironment(proxyUrl), { NO_PROXY: '' });
  const runtime = process.platform === 'win32'
    ? path.join(root, 'vendor', 'runtime', 'win32-x64', 'node.exe')
    : process.execPath;
  assert.equal(fs.existsSync(runtime), true);
  const child = spawn(runtime, ['-e', "fetch('http://dsh-proxy-smoke.invalid/probe').then(async (response) => { console.log(await response.text()); process.exit(0); }).catch((error) => { console.error(error.message); process.exit(1); });"], {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 0, stderr);
  assert.equal(stdout.trim(), 'proxy-route-ok');
  assert.equal(requestCount, 1);
});
