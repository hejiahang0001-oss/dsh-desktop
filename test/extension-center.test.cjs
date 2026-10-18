const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_INVENTORY_ENTRIES,
  boundedErrorMessage,
  buildExtensionCenter,
  callHarnessRemote,
  categoryOf,
  requiredInventoryModulesActive,
  safeHarnessOrigin,
  sanitizePluginInventory
} = require('../electron/extension-center.cjs');

const flushRemote = () => new Promise((resolve) => setImmediate(resolve));
const remoteResponse = (options, value = { entries: [] }) => ({
  ok: true,
  json: async () => ({ type: 'server-response', rpcId: JSON.parse(options.body).rpcId, result: { ok: true, value } })
});

test('cold plugin inventory retries its own 3-second timeout once after 250ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const requests = [], args = {};
  const pending = callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', args, {
    now: Date.now,
    fetchImpl: (_url, options) => {
      requests.push(options);
      if (requests.length === 2) return Promise.resolve(remoteResponse(options));
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
  }).then((value) => ({ value }), (error) => ({ error }));
  t.mock.timers.tick(2999); await flushRemote();
  assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, false);
  t.mock.timers.tick(1); await flushRemote();
  assert.equal(requests[0].signal.aborted, true);
  args.filter = 'changed after the initial request';
  t.mock.timers.tick(249); await flushRemote(); assert.equal(requests.length, 1);
  t.mock.timers.tick(1); await flushRemote();
  assert.deepEqual(await pending, { value: { entries: [] } });
  assert.equal(requests.length, 2); assert.equal(requests[1].signal.aborted, false);
  assert.notEqual(JSON.parse(requests[0].body).rpcId, JSON.parse(requests[1].body).rpcId);
  assert.deepEqual(JSON.parse(requests[1].body).payload, { args: {} });
  t.mock.timers.tick(10000); await flushRemote();
  assert.equal(requests[1].signal.aborted, false, 'successful attempt timer was cleared');
});

test('two inventory timeouts preserve the final AbortError without a third request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const requests = [];
  const pending = callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', {}, {
    now: Date.now,
    fetchImpl: (_url, options) => {
      requests.push(options);
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
  }).catch((error) => error);
  t.mock.timers.tick(3000); await flushRemote();
  t.mock.timers.tick(250); await flushRemote();
  assert.equal(requests.length, 2); assert.notEqual(requests[0].signal, requests[1].signal);
  t.mock.timers.tick(2999); await flushRemote(); assert.equal(requests[1].signal.aborted, false);
  t.mock.timers.tick(1); await flushRemote();
  assert.equal(await pending, requests[1].signal.reason); assert.equal(Date.now(), 6250);
  t.mock.timers.tick(10000); await flushRemote(); assert.equal(requests.length, 2);
});

test('inventory does not retry cancellation, transport, HTTP, JSON, protocol or business errors', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const abort = new DOMException('external cancellation', 'AbortError');
  const transport = new TypeError('transport unavailable');
  const parse = new SyntaxError('invalid JSON');
  const cases = [
    { response: () => { throw abort; }, expected: abort },
    { response: () => { throw transport; }, expected: transport },
    { response: () => ({ ok: false, status: 503 }), expected: /HTTP 503/ },
    { response: () => ({ ok: true, json: async () => { throw parse; } }), expected: parse },
    { response: () => ({ ok: true, json: async () => ({ type: 'server-response', rpcId: 'wrong', result: { ok: true } }) }), expected: /不匹配/ },
    { response: (options) => ({ ok: true, json: async () => ({ type: 'server-response', rpcId: JSON.parse(options.body).rpcId, result: { ok: false, error: { message: 'business refused' } } }) }), expected: /business refused/ }
  ];
  for (const item of cases) {
    const requests = [];
    await assert.rejects(callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', {}, {
      now: Date.now, fetchImpl: async (_url, options) => { requests.push(options); return item.response(options); }
    }), item.expected);
    t.mock.timers.tick(10000); await flushRemote();
    assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, false);
  }
});

test('an internal timer does not authorize retry of an unrelated error or AbortError', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const failure of [new TypeError('transport failed'), new DOMException('unrelated abort', 'AbortError')]) {
    let calls = 0;
    const pending = callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', {}, {
      now: Date.now,
      fetchImpl: (_url, options) => {
        calls += 1;
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(failure), { once: true }));
      }
    }).catch((error) => error);
    t.mock.timers.tick(3000); await flushRemote();
    assert.equal(await pending, failure); t.mock.timers.tick(10000); await flushRemote(); assert.equal(calls, 1);
  }
});

test('other routes and nonempty inventory arguments retain single-attempt timeout behavior', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const cases = [
    ['session', 'list', {}], ['pluginInventory', 'get', {}], ['pluginInventory', 'list', { filter: true }],
    ['pluginInventory', 'list', Object.defineProperty({}, 'toJSON', { value: () => ({ filter: true }) })],
    ['pluginInventory', 'list', { [Symbol('nonempty')]: true }]
  ];
  for (const [namespace, method, args] of cases) {
    const requests = [];
    const pending = callHarnessRemote('http://127.0.0.1:18888', namespace, method, args, {
      now: Date.now,
      fetchImpl: (_url, options) => {
        requests.push(options);
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      }
    }).catch((error) => error);
    t.mock.timers.tick(3000); await flushRemote();
    assert.equal(await pending, requests[0].signal.reason);
    t.mock.timers.tick(10000); await flushRemote(); assert.equal(requests.length, 1);
  }
});

test('inventory retry consumes the existing 8-second budget instead of extending it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const [timeoutMs, secondTimeout] of [[5000, 2750], [3500, 3000]]) {
    const requests = [], startedAt = Date.now();
    const pending = callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', {}, {
      now: Date.now, timeoutMs,
      fetchImpl: (_url, options) => {
        requests.push(options);
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      }
    }).catch((error) => error);
    t.mock.timers.tick(timeoutMs); await flushRemote();
    t.mock.timers.tick(250); await flushRemote(); assert.equal(requests.length, 2);
    t.mock.timers.tick(secondTimeout - 1); await flushRemote(); assert.equal(requests[1].signal.aborted, false);
    t.mock.timers.tick(1); await flushRemote();
    assert.equal(await pending, requests[1].signal.reason);
    assert.equal(Date.now() - startedAt, timeoutMs + 250 + secondTimeout);
    t.mock.timers.tick(10000); await flushRemote(); assert.equal(requests.length, 2);
  }
});

test('an exhausted deadline or late backoff never starts another inventory request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const timeoutMs of [8000, 3000]) {
    let calls = 0, firstSignal;
    const pending = callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', {}, {
      now: Date.now, timeoutMs,
      fetchImpl: (_url, options) => {
        calls += 1; firstSignal = options.signal;
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
      }
    }).catch((error) => error);
    t.mock.timers.tick(timeoutMs); await flushRemote();
    t.mock.timers.tick(8000); await flushRemote();
    assert.equal(await pending, firstSignal.reason); assert.equal(calls, 1);
  }
});

test('inventory response bodies and abort-ignoring transports cannot exceed the total budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (const bodyOnly of [true, false]) {
    let calls = 0, firstSignal;
    const pending = callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', {}, {
      now: Date.now,
      fetchImpl: async (_url, options) => {
        calls += 1; firstSignal = options.signal;
        if (bodyOnly) return { ok: true, json: () => new Promise(() => {}) };
        return new Promise(() => {});
      }
    }).catch((error) => error);
    await flushRemote(); t.mock.timers.tick(8000); await flushRemote();
    assert.equal(await pending, firstSignal.reason); assert.equal(calls, 1);
  }
});

test('Harness Remote caller uses the official slash endpoint and exact empty args envelope', async () => {
  let captured;
  const value = await callHarnessRemote('http://127.0.0.1:18888', 'pluginInventory', 'list', {}, {
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          type: 'server-response',
          rpcId: captured.body.rpcId,
          result: { ok: true, value: { entries: [] } }
        })
      };
    }
  });
  assert.deepEqual(value, { entries: [] });
  assert.equal(captured.url, 'http://127.0.0.1:18888/api/pluginInventory/list');
  assert.equal(captured.body.method, 'pluginInventory/list');
  assert.deepEqual(captured.body.payload, { args: {} });
  await assert.rejects(() => callHarnessRemote('https://example.com', 'pluginInventory', 'list'));
  await assert.rejects(() => callHarnessRemote('http://127.0.0.1:18888', '../bad', 'list'));
  await assert.rejects(() => callHarnessRemote('http://user:pass@127.0.0.1:18888', 'pluginInventory', 'list'));
  await assert.rejects(() => callHarnessRemote('http://127.0.0.1:18888/?redirect=1', 'pluginInventory', 'list'));
  await assert.rejects(() => callHarnessRemote('http://127.0.0.1:18888', '..', 'list'));
  assert.equal(safeHarnessOrigin('http://127.0.0.1:18888/'), true);
  assert.equal(boundedErrorMessage(` bad\0  ${'x'.repeat(600)} `, 'fallback').length, 512);
});

test('required Harness modules must be enabled and active', () => {
  const required = [
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-api-workspace-controller',
    '@deepseek-ai/dsh-session-log-export'
  ];
  const ready = { entries: required.map((moduleName) => ({ moduleName, enabled: true, fiberPhase: 'active' })) };
  assert.equal(requiredInventoryModulesActive(ready, required), true);
  assert.equal(requiredInventoryModulesActive({ entries: ready.entries.slice(1) }, required), false);
  assert.equal(requiredInventoryModulesActive({ entries: ready.entries.map((entry, index) => index === 0 ? { ...entry, fiberPhase: 'failed' } : entry) }, required), false);
});

test('extension center maps the official inventory into four fixed capability surfaces', () => {
  const state = buildExtensionCenter({
    runtimeVersion: '0.1.2-alpha.2',
    runtimeCapabilities: {
      skills: { status: 'ready', version: '0.1.2-alpha.2' },
      mcp: { status: 'ready', version: '0.1.2-alpha.2' },
      pluginInventory: { status: 'ready', version: '0.1.2-alpha.2' }
    },
    profiles: [{ dependencies: [{ name: '@example/one' }] }],
    inventory: { entries: [
      { entryId: '1', moduleName: '@deepseek-ai/dsh-skill-filesystem', enabled: true, fiberPhase: 'active' },
      { entryId: '2', moduleName: '@deepseek-ai/dsh-tool-skill', enabled: true, fiberPhase: 'active' },
      { entryId: '3', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active' },
      { entryId: '4', moduleName: '@example/external', enabled: false, fiberPhase: null }
    ] }
  });
  assert.equal(state.available, true);
  assert.deepEqual(state.surfaces.map((item) => item.id), ['skills', 'plugins', 'hooks', 'mcp']);
  assert.equal(state.surfaces.find((item) => item.id === 'skills').status, 'healthy');
  assert.equal(state.surfaces.find((item) => item.id === 'mcp').active, 1);
  assert.equal(state.surfaces.find((item) => item.id === 'plugins').disabled, 1);
  assert.equal(state.surfaces.find((item) => item.id === 'hooks').status, 'unsupported');
  assert.deepEqual(state.issues, [{ category: 'plugins', moduleName: '@example/external', status: 'disabled' }]);
});

test('installed MCP capability remains ready without claiming a configured server', () => {
  const state = buildExtensionCenter({
    runtimeVersion: '0.1.2-alpha.2',
    runtimeCapabilities: { mcp: { status: 'ready', version: '0.1.2-alpha.2' } },
    inventory: { entries: [{ moduleName: '@deepseek-ai/dsh-skill', enabled: true, fiberPhase: 'active' }] }
  });
  const mcp = state.surfaces.find((item) => item.id === 'mcp');
  assert.equal(mcp.status, 'ready');
  assert.equal(mcp.total, 0);
  assert.match(mcp.message, /不代表已配置/);
});

test('extension center fails closed when live Harness inventory is unavailable', () => {
  const state = buildExtensionCenter({ runtimeVersion: '0.1.2-alpha.2', inventoryError: 'Harness 尚未就绪。' });
  assert.equal(state.available, false);
  assert.equal(state.surfaces.find((item) => item.id === 'skills').status, 'unavailable');
  assert.equal(state.surfaces.find((item) => item.id === 'plugins').manageable, false);
  assert.match(state.surfaces.find((item) => item.id === 'mcp').message, /不代表已配置/);
  assert.equal(state.surfaces.find((item) => item.id === 'hooks').status, 'unsupported');
});

test('official inventory input is bounded and strips invalid module names', () => {
  const entries = Array.from({ length: MAX_INVENTORY_ENTRIES + 5 }, (_, index) => ({
    moduleName: index === 0 ? 'bad\0name' : `@example/plugin-${index}`,
    enabled: true,
    fiberPhase: index === 1 ? 'unknown' : 'active'
  }));
  entries.push({ moduleName: 'x'.repeat(300), enabled: true, fiberPhase: 'active' });
  const sanitized = sanitizePluginInventory({ entries });
  assert.equal(sanitized.entries.length, MAX_INVENTORY_ENTRIES);
  assert.equal(sanitized.limited, true);
  assert.equal(sanitized.entries[0].moduleName, 'badname');
  assert.equal(sanitized.entries[1].fiberPhase, null);
  assert.equal(categoryOf('@deepseek-ai/dsh-client-ui-skill'), 'skills');
  assert.equal(categoryOf('@deepseek-ai/dsh-mcp-client'), 'mcp');
});
