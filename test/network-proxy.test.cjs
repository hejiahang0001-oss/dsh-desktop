const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { HARNESS_RUNTIME_DIRECTORY, HARNESS_VERSION, readHarnessDesktopRuntime } = require('../electron/harness-desktop-runtime.cjs');
const { buildHarnessEnvironment } = require('../electron/harness-supervisor.cjs');
const {
  ProxySettingsError,
  ProxySettingsStore,
  buildHarnessProxyEnvironment,
  confirmProxySettingsChange,
  normalizeProxySettings,
  normalizeProxyUrl,
  parseResolvedProxy,
  sessionProxyConfig
} = require('../electron/network-proxy.cjs');

const root = path.resolve(__dirname, '..');
const proxyNames = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'];
const explicitProxyValues = (proxyUrl = '') => Object.fromEntries(proxyNames.flatMap((name) => {
  const value = name === 'ALL_PROXY' ? '' : name === 'NO_PROXY' ? (proxyUrl ? '127.0.0.1,localhost,::1' : '') : proxyUrl;
  return [[name, value], [name.toLowerCase(), value]];
}));

const probeHomeProxyEnvironment = (context, proxyUrl, upstreamModules = []) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-proxy-precedence-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, '.env');
  fs.writeFileSync(envFile, [
    'HTTP_PROXY=http://home-upper.invalid:8080',
    'https_proxy=http://home-lower.invalid:8443',
    'ALL_PROXY=http://home-fallback.invalid:8888',
    'no_proxy=*'
  ].join('\n'));
  const environment = buildHarnessEnvironment({
    baseEnv: { ...process.env, HTTP_PROXY: 'http://parent.invalid:8080', https_proxy: 'http://parent.invalid:8443', ALL_PROXY: 'http://parent.invalid:8888', NO_PROXY: '*' },
    overrides: buildHarnessProxyEnvironment(proxyUrl),
    homeDir: directory,
    workspaceDir: directory
  });
  const runtime = process.platform === 'win32' ? path.join(root, 'vendor', 'runtime', 'win32-x64', 'node.exe') : process.execPath;
  const child = spawnSync(fs.existsSync(runtime) ? runtime : process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { parseEnv } from 'node:util';
    const inherited = { ...process.env };
    const home = parseEnv(readFileSync(process.argv[1], 'utf8'));
    // Match app-boot loadLayeredEnv's checked-value materialization exactly.
    for (const [name, value] of Object.entries(home)) {
      if (process.env[name] === undefined) process.env[name] = value;
    }
    const values = Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].flatMap(name =>
      [[name, process.env[name]], [name.toLowerCase(), process.env[name.toLowerCase()]]]));
    if (process.argv[2]) {
      const { createLaunchEnvironmentSnapshot } = await import(process.argv[2]);
      const { installProxyFromEnvironment, proxyRouteFor, proxyEnvironmentForChild } = await import(process.argv[3]);
      const snapshot = createLaunchEnvironmentSnapshot([
        { source: 'process', values: inherited },
        { source: 'user-env', path: process.argv[1], values: home }
      ]);
      const diagnostics = [];
      const dispose = await installProxyFromEnvironment(snapshot, message => diagnostics.push(message));
      try {
        const https = proxyRouteFor(new URL('https://api.deepseek.com'));
        const loopbacks = ['http://127.0.0.1:8765', 'http://localhost:8765', 'http://[::1]:8765'];
        console.log(JSON.stringify({ values, diagnostics,
          httpsProxy: https.proxied ? https.proxy : null,
          loopbackProxied: loopbacks.map(url => proxyRouteFor(new URL(url)).proxied),
          childEnvironment: proxyEnvironmentForChild(),
          sources: Object.fromEntries(Object.keys(home).map(name => [name, snapshot.get(name).source]))
        }));
      } finally { await dispose(); }
    } else console.log(JSON.stringify({ values }));
  `, envFile, ...upstreamModules], { env: environment, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
};

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
  assert.deepEqual(buildHarnessProxyEnvironment(''), explicitProxyValues());
  assert.deepEqual(buildHarnessProxyEnvironment('http://127.0.0.1:7890'), {
    ...explicitProxyValues('http://127.0.0.1:7890'),
    NODE_USE_ENV_PROXY: '1'
  });
});

test('software direct and custom settings survive child spawn and home .env backfill', (context) => {
  for (const proxyUrl of ['', 'http://127.0.0.1:7890']) {
    const result = probeHomeProxyEnvironment(context, proxyUrl);
    assert.deepEqual(result.values, explicitProxyValues(proxyUrl));
  }
});

test('packaged official proxy installation keeps software settings above mixed-case home proxies', (context) => {
  const runtimeRoot = path.join(root, 'vendor', HARNESS_RUNTIME_DIRECTORY);
  if (!fs.existsSync(runtimeRoot)) {
    context.skip('Run pnpm runtime:deploy for the current product pin; no legacy runtime or source fallback is accepted.');
    return;
  }
  const runtime = readHarnessDesktopRuntime(runtimeRoot);
  const modulePaths = ['@deepseek-ai/dsh-launch-environment', '@deepseek-ai/dsh-http-proxy'];
  const modules = modulePaths.map(name => {
    const manifest = JSON.parse(fs.readFileSync(path.join(runtime.nodeModulesPath, name, 'package.json')));
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, HARNESS_VERSION);
    const relative = `node_modules/${name}/lib/index.js`;
    const file = path.join(runtimeRoot, relative);
    const expected = runtime.descriptor.files.find(entry => entry.path === relative);
    assert.ok(expected);
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected.sha256);
    return pathToFileURL(file).href;
  });
  for (const proxyUrl of ['', 'http://127.0.0.1:7890']) {
    const result = probeHomeProxyEnvironment(context, proxyUrl, modules);
    assert.deepEqual(result.values, explicitProxyValues(proxyUrl));
    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.httpsProxy, proxyUrl || null);
    assert.deepEqual(result.loopbackProxied, [false, false, false]);
    if (proxyUrl) {
      assert.equal(result.childEnvironment.HTTP_PROXY, proxyUrl);
      assert.equal(result.childEnvironment.HTTPS_PROXY, proxyUrl);
      assert.equal(result.childEnvironment.NODE_USE_ENV_PROXY, '1');
      assert.match(result.childEnvironment.NO_PROXY, /127\.0\.0\.1/);
    } else assert.deepEqual(result.childEnvironment, {});
    assert.ok(Object.values(result.sources).every((source) => source === 'process'));
  }
});

test('proxy settings persist without accepting a corrupted or credential-bearing file', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-network-store-'));
  const filePath = path.join(root, 'network-state.json');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ProxySettingsStore({ filePath });
  assert.deepEqual(await store.init(), { mode: 'direct', proxyUrl: '' });
  await store.set({ mode: 'custom', proxyUrl: 'https://proxy.example.com:8443' });
  const restored = new ProxySettingsStore({ filePath });
  assert.deepEqual(await restored.init(), { mode: 'custom', proxyUrl: 'https://proxy.example.com:8443' });
  fs.writeFileSync(filePath, '{ interrupted');
  const recovered = new ProxySettingsStore({ filePath });
  assert.deepEqual(await recovered.init(), { mode: 'custom', proxyUrl: 'https://proxy.example.com:8443' });
  assert.equal(recovered.recoverySource, 'backup');
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
    version: 1,
    mode: 'custom',
    proxyUrl: 'https://proxy.example.com:8443'
  });
  await assert.rejects(() => store.set({ mode: 'custom', proxyUrl: 'http://user:secret@proxy.example.com' }), ProxySettingsError);
  assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /user|secret/);
});

test('proxy changes require a native default-cancel confirmation while unchanged settings do not', async () => {
  const calls = [];
  const dialog = {
    showMessageBox: async (...args) => {
      calls.push(args);
      return { response: 1 };
    }
  };
  const parentWindow = { id: 'trusted-parent' };
  const canceled = await confirmProxySettingsChange({
    dialog,
    parentWindow,
    previous: { mode: 'direct' },
    proposed: { mode: 'custom', proxyUrl: 'http://127.0.0.1:7890' }
  });
  assert.deepEqual(canceled, {
    changed: true,
    confirmed: false,
    settings: { mode: 'custom', proxyUrl: 'http://127.0.0.1:7890' }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], parentWindow);
  assert.equal(calls[0][1].defaultId, 1);
  assert.equal(calls[0][1].cancelId, 1);
  assert.match(calls[0][1].detail, /直连/);
  assert.match(calls[0][1].detail, /127\.0\.0\.1:7890/);

  const unchanged = await confirmProxySettingsChange({
    dialog,
    parentWindow,
    previous: { mode: 'custom', proxyUrl: 'http://127.0.0.1:7890/' },
    proposed: { mode: 'custom', proxyUrl: 'http://127.0.0.1:7890' }
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.confirmed, true);
  assert.equal(calls.length, 1);
});

test('the Node 24 runtime sends fetch through the software-selected HTTP proxy', async (context) => {
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
  const bundledRuntime = process.platform === 'win32'
    ? path.join(root, 'vendor', 'runtime', 'win32-x64', 'node.exe')
    : '';
  const runtime = bundledRuntime && fs.existsSync(bundledRuntime) ? bundledRuntime : process.execPath;
  assert.equal(Number(process.versions.node.split('.')[0]) >= 24, true);
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
