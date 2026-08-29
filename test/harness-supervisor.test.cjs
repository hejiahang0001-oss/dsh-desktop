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
  provisionDesktopShellEnvPlugin,
  resolvePnpmDshBin,
  resolveHarnessRuntimePaths,
  stripAnsi
} = require('../electron/harness-supervisor.cjs');

const writeBundledOfficeSkills = (root) => {
  const bundledSkillDir = path.join(root, 'resources', 'skills');
  const docxToolPath = path.join(bundledSkillDir, 'word-docx', 'scripts', 'word-docx.cjs');
  const xlsxToolPath = path.join(bundledSkillDir, 'excel-xlsx', 'scripts', 'excel-xlsx.cjs');
  const pptxToolPath = path.join(bundledSkillDir, 'powerpoint-pptx', 'scripts', 'powerpoint-pptx.cjs');
  const wikiToolPath = path.join(bundledSkillDir, 'llm-wiki', 'scripts', 'wiki-basic.cjs');
  const shellEnvPluginDir = path.join(root, 'runtime', 'dsh-desktop-shell-env');
  fs.mkdirSync(path.dirname(docxToolPath), { recursive: true });
  fs.mkdirSync(path.dirname(xlsxToolPath), { recursive: true });
  fs.mkdirSync(path.dirname(pptxToolPath), { recursive: true });
  fs.mkdirSync(path.dirname(wikiToolPath), { recursive: true });
  fs.mkdirSync(shellEnvPluginDir, { recursive: true });
  fs.writeFileSync(docxToolPath, '// test');
  fs.writeFileSync(xlsxToolPath, '// test');
  fs.writeFileSync(pptxToolPath, '// test');
  fs.writeFileSync(wikiToolPath, '// test');
  fs.writeFileSync(path.join(shellEnvPluginDir, 'package.json'), JSON.stringify({ name: 'dsh-desktop-shell-env', exports: './index.mjs' }));
  fs.writeFileSync(path.join(shellEnvPluginDir, 'index.mjs'), '// test');
  return { bundledSkillDir, docxToolPath, xlsxToolPath, pptxToolPath, wikiToolPath, shellEnvPluginDir };
};

test('software-managed credential policy removes inherited DeepSeek keys case-insensitively', () => {
  const baseEnv = {
    PATH: 'runtime-path',
    deepseek_api_key: 'legacy-secret',
    http_proxy: 'http://inherited-proxy:8080',
    NO_PROXY: '*'
  };
  const overrides = {
    DEEPSEEK_API_KEY: 'override-secret',
    HTTP_PROXY: 'http://software-proxy:7890',
    HTTPS_PROXY: 'http://software-proxy:7890',
    NO_PROXY: '127.0.0.1,localhost,::1',
    NODE_USE_ENV_PROXY: '1',
    DSH_TEST_FLAG: 'kept'
  };
  const environment = buildHarnessEnvironment({
    baseEnv,
    overrides,
    homeDir: 'C:\\DSH_HOME'
  });

  assert.equal(Object.keys(environment).some((name) => name.toUpperCase() === 'DEEPSEEK_API_KEY'), false);
  assert.equal(environment.DSH_TEST_FLAG, 'kept');
  assert.equal(environment.HTTP_PROXY, 'http://software-proxy:7890');
  assert.equal(environment.HTTPS_PROXY, 'http://software-proxy:7890');
  assert.equal(environment.NO_PROXY, '127.0.0.1,localhost,::1');
  assert.equal(environment.NODE_USE_ENV_PROXY, '1');
  assert.equal(Object.hasOwn(environment, 'http_proxy'), false);
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
  const office = writeBundledOfficeSkills(root);
  const resolved = resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshPath, DSH_DESKTOP_PATCH: patchPath }
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: dshPath, patchPath, ...office });
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
  const shellEnvPluginDir = path.join(resourcesPath, 'harness-plugins', 'dsh-desktop-shell-env');
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.mkdirSync(path.dirname(linkedBin), { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(nodePath, 'test');
  fs.writeFileSync(linkedBin, 'top-level copy without dependency links');
  fs.writeFileSync(pnpmBin, 'real package');
  fs.mkdirSync(path.dirname(patchPath), { recursive: true });
  fs.writeFileSync(patchPath, '[]');
  fs.mkdirSync(shellEnvPluginDir, { recursive: true });
  fs.writeFileSync(path.join(shellEnvPluginDir, 'package.json'), JSON.stringify({ name: 'dsh-desktop-shell-env', exports: './index.mjs' }));
  fs.writeFileSync(path.join(shellEnvPluginDir, 'index.mjs'), '// test');
  const bundledSkillDir = path.join(resourcesPath, 'skills');
  const docxToolPath = path.join(bundledSkillDir, 'word-docx', 'scripts', 'word-docx.cjs');
  const xlsxToolPath = path.join(bundledSkillDir, 'excel-xlsx', 'scripts', 'excel-xlsx.cjs');
  const pptxToolPath = path.join(bundledSkillDir, 'powerpoint-pptx', 'scripts', 'powerpoint-pptx.cjs');
  const wikiToolPath = path.join(bundledSkillDir, 'llm-wiki', 'scripts', 'wiki-basic.cjs');
  fs.mkdirSync(path.dirname(docxToolPath), { recursive: true });
  fs.mkdirSync(path.dirname(xlsxToolPath), { recursive: true });
  fs.mkdirSync(path.dirname(pptxToolPath), { recursive: true });
  fs.mkdirSync(path.dirname(wikiToolPath), { recursive: true });
  fs.writeFileSync(docxToolPath, '// test');
  fs.writeFileSync(xlsxToolPath, '// test');
  fs.writeFileSync(pptxToolPath, '// test');
  fs.writeFileSync(wikiToolPath, '// test');

  assert.equal(resolvePnpmDshBin(nodeModules), pnpmBin);
  const resolved = resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath,
    isPackaged: true,
    env: {}
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: pnpmBin, patchPath, bundledSkillDir, docxToolPath, xlsxToolPath, pptxToolPath, wikiToolPath, shellEnvPluginDir });
});

test('runtime resolver fails closed when the desktop language patch is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-no-patch-test-'));
  const nodePath = path.join(root, 'node.exe');
  const dshPath = path.join(root, 'bin.js');
  fs.writeFileSync(nodePath, 'test');
  fs.writeFileSync(dshPath, 'test');
  writeBundledOfficeSkills(root);
  assert.throws(() => resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshPath }
  }), (error) => error?.code === 'HARNESS_PATCH_MISSING');
});

test('desktop shell environment plugin is provisioned into the Harness profile fallback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-shell-plugin-provision-test-'));
  const sourceDir = path.join(root, 'source');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'package.json'), JSON.stringify({
    name: 'dsh-desktop-shell-env',
    version: '0.6.4',
    type: 'module',
    exports: './index.mjs'
  }));
  fs.writeFileSync(path.join(sourceDir, 'index.mjs'), 'export const name = "dsh-desktop-shell-env";');
  try {
    const targetDir = await provisionDesktopShellEnvPlugin({ homeDir, sourceDir });
    assert.equal(targetDir, path.join(homeDir, 'profiles', 'node_modules', 'dsh-desktop-shell-env'));
    assert.match(fs.readFileSync(path.join(targetDir, 'index.mjs'), 'utf8'), /dsh-desktop-shell-env/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, 'package.json'), 'utf8')).name, 'dsh-desktop-shell-env');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
  const envFile = path.join(root, 'env.json');
  const fakeHarness = path.join(root, 'fake-harness.cjs');
  const patchPath = path.join(root, 'desktop.patch.yml');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(fakeHarness, [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.DSH_TEST_CWD_FILE, process.cwd());",
    "fs.writeFileSync(process.env.DSH_TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));",
    "fs.writeFileSync(process.env.DSH_TEST_ENV_FILE, JSON.stringify({ bundled: process.env.DSH_BUNDLED_SKILL_DIR, docx: process.env.DSH_DESKTOP_DOCX_TOOL, xlsx: process.env.DSH_DESKTOP_XLSX_TOOL, pptx: process.env.DSH_DESKTOP_PPTX_TOOL, wiki: process.env.DSH_DESKTOP_WIKI_TOOL, wikiConfig: process.env.DSH_DESKTOP_WIKI_CONFIG, node: process.env.DSH_DESKTOP_NODE }));",
    "process.stdout.write('dsh web: http://127.0.0.1:45678\\n');",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  fs.writeFileSync(patchPath, '[]');
  const office = writeBundledOfficeSkills(root);
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
      DSH_TEST_ARGS_FILE: argsFile,
      DSH_TEST_ENV_FILE: envFile,
      DSH_BUNDLED_SKILL_DIR: 'C:\\untrusted-skills',
      DSH_DESKTOP_DOCX_TOOL: 'C:\\untrusted-word-tool.cjs',
      DSH_DESKTOP_XLSX_TOOL: 'C:\\untrusted-excel-tool.cjs',
      DSH_DESKTOP_PPTX_TOOL: 'C:\\untrusted-powerpoint-tool.cjs',
      DSH_DESKTOP_WIKI_TOOL: 'C:\\untrusted-wiki-tool.cjs',
      DSH_DESKTOP_WIKI_CONFIG: 'C:\\untrusted-wiki-config.json'
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
  const environment = JSON.parse(fs.readFileSync(envFile, 'utf8'));
  assert.deepEqual(environment, {
    bundled: office.bundledSkillDir,
    docx: office.docxToolPath,
    xlsx: office.xlsxToolPath,
    pptx: office.pptxToolPath,
    wiki: office.wikiToolPath,
    wikiConfig: path.join(root, 'wiki-settings.json'),
    node: process.execPath
  });
});
