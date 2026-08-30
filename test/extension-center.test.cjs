const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_INVENTORY_ENTRIES,
  boundedErrorMessage,
  buildExtensionCenter,
  callHarnessRemote,
  categoryOf,
  safeHarnessOrigin,
  sanitizePluginInventory
} = require('../electron/extension-center.cjs');

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

test('extension center maps the official inventory into four fixed capability surfaces', () => {
  const state = buildExtensionCenter({
    runtimeVersion: '0.1.2-alpha.1',
    runtimeCapabilities: {
      skills: { status: 'ready', version: '0.1.2-alpha.1' },
      mcp: { status: 'ready', version: '0.1.2-alpha.1' },
      pluginInventory: { status: 'ready', version: '0.1.2-alpha.1' }
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
    runtimeVersion: '0.1.2-alpha.1',
    runtimeCapabilities: { mcp: { status: 'ready', version: '0.1.2-alpha.1' } },
    inventory: { entries: [{ moduleName: '@deepseek-ai/dsh-skill', enabled: true, fiberPhase: 'active' }] }
  });
  const mcp = state.surfaces.find((item) => item.id === 'mcp');
  assert.equal(mcp.status, 'ready');
  assert.equal(mcp.total, 0);
  assert.match(mcp.message, /不代表已配置/);
});

test('extension center fails closed when live Harness inventory is unavailable', () => {
  const state = buildExtensionCenter({ runtimeVersion: '0.1.2-alpha.1', inventoryError: 'Harness 尚未就绪。' });
  assert.equal(state.available, false);
  assert.equal(state.surfaces.find((item) => item.id === 'skills').status, 'unavailable');
  assert.equal(state.surfaces.find((item) => item.id === 'plugins').manageable, true);
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
