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

test('desktop workspace is explicit in the Harness environment', () => {
  const environment = buildHarnessEnvironment({
    baseEnv: { DSH_CWD: 'C:\\stale-workspace' },
    homeDir: 'C:\\DSH_HOME',
    workspaceDir: 'C:\\selected-workspace'
  });
  assert.equal(environment.DSH_CWD, 'C:\\selected-workspace');
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
  const patchPath = path.join(root, 'desktop.patch.yml');
  fs.writeFileSync(nodePath, 'test');
  fs.writeFileSync(dshPath, 'test');
  fs.writeFileSync(patchPath, '[]');
  const resolved = resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshPath, DSH_DESKTOP_PATCH: patchPath }
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: dshPath, patchPath });
});

test('packaged runtime resolves DSH from the real pnpm package path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-packaged-runtime-test-'));
  const resourcesPath = path.join(root, 'resources');
  const nodePath = path.join(resourcesPath, 'runtime', 'node.exe');
  const nodeModules = path.join(resourcesPath, 'harness', 'node_modules');
  const packageDir = path.join(
    nodeModules,
    '.pnpm',
    '@deepseek-ai+dsh@0.1.1-rc.2_test',
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib'
  );
  const linkedBin = path.join(nodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const pnpmBin = path.join(packageDir, 'bin.js');
  const patchPath = path.join(resourcesPath, 'harness-config', 'dsh-desktop.patch.yml');
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.mkdirSync(path.dirname(linkedBin), { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(nodePath, 'test');
  fs.writeFileSync(linkedBin, 'top-level copy without dependency links');
  fs.writeFileSync(pnpmBin, 'real package');
  fs.mkdirSync(path.dirname(patchPath), { recursive: true });
  fs.writeFileSync(patchPath, '[]');

  assert.equal(resolvePnpmDshBin(nodeModules), pnpmBin);
  const resolved = resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath,
    isPackaged: true,
    env: {}
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: pnpmBin, patchPath });
});

test('runtime resolver fails closed when the desktop language patch is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-no-patch-test-'));
  const nodePath = path.join(root, 'node.exe');
  const dshPath = path.join(root, 'bin.js');
  fs.writeFileSync(nodePath, 'test');
  fs.writeFileSync(dshPath, 'test');
  assert.throws(() => resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshPath }
  }), (error) => error?.code === 'HARNESS_PATCH_MISSING');
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
  const argsFile = path.join(root, 'args.json');
  const fakeHarness = path.join(root, 'fake-harness.cjs');
  const patchPath = path.join(root, 'desktop.patch.yml');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(fakeHarness, [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.DSH_TEST_CWD_FILE, process.cwd());",
    "fs.writeFileSync(process.env.DSH_TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));",
    "process.stdout.write('dsh web: http://127.0.0.1:45678\\n');",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  fs.writeFileSync(patchPath, '[]');
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
      DSH_DESKTOP_PATCH: patchPath,
      DSH_TEST_CWD_FILE: outputFile,
      DSH_TEST_ARGS_FILE: argsFile
    }
  });
  context.after(async () => {
    await supervisor.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(await supervisor.start(), 'http://127.0.0.1:45678');
  assert.equal(fs.readFileSync(outputFile, 'utf8'), fs.realpathSync(workspace));
  const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
  assert.deepEqual(args.slice(0, 3), ['web', '--patch', patchPath]);
  assert.equal(supervisor.getState().workspacePath, workspace);
});
