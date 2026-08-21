const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  HarnessSupervisor,
  buildHarnessEnvironment,
  isSafeHarnessUrl,
  parseHarnessUrl,
  probeHarness,
  resolvePnpmDshBin,
  resolveHarnessRuntimePaths,
  stripAnsi
} = require('../electron/harness-supervisor.cjs');

test('software-managed credential policy removes inherited DeepSeek keys case-insensitively', () => {
  const baseEnv = {
    PATH: 'runtime-path',
    deepseek_api_key: 'legacy-secret'
  };
  const overrides = {
    DEEPSEEK_API_KEY: 'override-secret',
    DSH_TEST_FLAG: 'kept'
  };
  const environment = buildHarnessEnvironment({
    baseEnv,
    overrides,
    homeDir: 'C:\\DSH_HOME'
  });

  assert.equal(Object.keys(environment).some((name) => name.toUpperCase() === 'DEEPSEEK_API_KEY'), false);
  assert.equal(environment.DSH_TEST_FLAG, 'kept');
  assert.equal(environment.DSH_HOME, 'C:\\DSH_HOME');
  assert.equal(environment.NO_COLOR, '1');
  assert.equal(baseEnv.deepseek_api_key, 'legacy-secret');
  assert.equal(overrides.DEEPSEEK_API_KEY, 'override-secret');
});

test('parseHarnessUrl accepts only a random IPv4 loopback origin', () => {
  assert.equal(parseHarnessUrl('dsh web: http://127.0.0.1:61045\n'), 'http://127.0.0.1:61045');
  assert.equal(parseHarnessUrl('\u001b[32mdsh web: http://127.0.0.1:3080\u001b[0m'), 'http://127.0.0.1:3080');
  assert.equal(parseHarnessUrl('dsh web: http://localhost:3080'), null);
  assert.equal(parseHarnessUrl('dsh web: https://127.0.0.1:3080'), null);
});

test('safe URL guard rejects non-loopback and incomplete addresses', () => {
  assert.equal(isSafeHarnessUrl('http://127.0.0.1:3080'), true);
  assert.equal(isSafeHarnessUrl('http://127.0.0.1'), false);
  assert.equal(isSafeHarnessUrl('http://0.0.0.0:3080'), false);
  assert.equal(isSafeHarnessUrl('https://example.com:3080'), false);
});

test('stripAnsi removes terminal control sequences from logs', () => {
  assert.equal(stripAnsi('\u001b[31mfailed\u001b[0m'), 'failed');
});

test('runtime resolver prefers explicit, existing paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-test-'));
  const nodePath = path.join(root, 'node.exe');
  const dshPath = path.join(root, 'bin.js');
  fs.writeFileSync(nodePath, 'test');
  fs.writeFileSync(dshPath, 'test');
  const resolved = resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshPath }
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: dshPath });
});

test('packaged runtime resolves DSH from the real pnpm package path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-packaged-runtime-test-'));
  const resourcesPath = path.join(root, 'resources');
  const nodePath = path.join(resourcesPath, 'runtime', 'node.exe');
  const nodeModules = path.join(resourcesPath, 'harness', 'node_modules');
  const packageDir = path.join(
    nodeModules,
    '.pnpm',
    '@deepseek-ai+dsh@0.1.0-rc.8_test',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib'
  );
  const linkedBin = path.join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const pnpmBin = path.join(packageDir, 'bin.js');
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.mkdirSync(path.dirname(linkedBin), { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(nodePath, 'test');
  fs.writeFileSync(linkedBin, 'top-level copy without dependency links');
  fs.writeFileSync(pnpmBin, 'real package');

  assert.equal(resolvePnpmDshBin(nodeModules), pnpmBin);
  const resolved = resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath,
    isPackaged: true,
    env: {}
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: pnpmBin });
});

test('probeHarness verifies a successful HTML response', async () => {
  const response = new Response('<title>DeepSeek Harness</title>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
  const result = await probeHarness('http://127.0.0.1:4567', {
    attempts: 1,
    fetchImpl: async () => response
  });
  assert.equal(result.status, 200);
  assert.equal(result.title, 'DeepSeek Harness');
});

test('supervisor launches Harness in the selected workspace directory', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-cwd-test-'));
  const workspace = path.join(root, 'selected-workspace');
  const outputFile = path.join(root, 'cwd.txt');
  const fakeHarness = path.join(root, 'fake-harness.cjs');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(fakeHarness, [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.DSH_TEST_CWD_FILE, process.cwd());",
    "process.stdout.write('dsh web: http://127.0.0.1:45678\\n');",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  const supervisor = new HarnessSupervisor({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    homeDir: path.join(root, 'home'),
    launchDir: workspace,
    logFile: path.join(root, 'logs', 'harness.log'),
    env: {
      DSH_DESKTOP_NODE: process.execPath,
      DSH_DESKTOP_DSH_BIN: fakeHarness,
      DSH_TEST_CWD_FILE: outputFile
    }
  });
  context.after(async () => {
    await supervisor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await supervisor.start(), 'http://127.0.0.1:45678');
  assert.equal(fs.readFileSync(outputFile, 'utf8'), fs.realpathSync(workspace));
  assert.equal(supervisor.getState().workspacePath, workspace);
});
