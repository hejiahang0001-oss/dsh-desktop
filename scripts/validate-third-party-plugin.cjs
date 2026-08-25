const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { HarnessSupervisor, buildHarnessEnvironment, probeHarness } = require('../electron/harness-supervisor.cjs');
const { PluginHealthCatalog } = require('../electron/plugin-health.cjs');
const { ProfileBundleManager } = require('../electron/profile-bundle-manager.cjs');

const PLUGIN = '@nonamelego/dsh-catppuccin';
const PROFILE = 'web';
const VERSION_SEQUENCE = Object.freeze([
  Object.freeze({
    version: '0.3.0',
    integrity: 'sha512-87SkXJUZxLsct3Jz/nyFYT9+IBr7Pgs6O5DetJpSzw0/y6HX69XnnNJSUHUNx+cZoCDVoBc9s/HcpKmOdiojew=='
  }),
  Object.freeze({
    version: '0.3.1',
    integrity: 'sha512-N6ZVm/n23E7M1piBbS29pzfzSfz1vCGaTkT30utyUepoPgpyL3ZOfHkeCDC9VbV8lnlzSleeWJEUf65tAf4hig=='
  })
]);
const EXPECTED_RUNTIME_PACKAGES = 432;
const TEST_STATE = Object.freeze({
  version: 1,
  flavor: 'catppuccin-mocha',
  glass: Object.freeze({ enabled: true, mode: 'compat', blur: 12, frost: 36, brightness: 61 })
});

const readArgument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const safeEnvironment = ({ homeDir, workspaceDir }) => buildHarnessEnvironment({
  baseEnv: process.env,
  homeDir,
  workspaceDir
});

const requireEmptyDirectory = async (directory) => {
  const resolved = path.resolve(directory);
  let info;
  try { info = await fsp.lstat(resolved); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (info) {
    assert.equal(info.isDirectory() && !info.isSymbolicLink(), true, '隔离数据根目录必须是普通目录。');
    assert.deepEqual(await fsp.readdir(resolved), [], '隔离数据根目录必须为空，验证器不会覆盖已有 Profile。');
  } else {
    await fsp.mkdir(resolved, { recursive: false });
  }
  return resolved;
};

const runPnpmProbe = (environment) => {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : 'pnpm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm --version'] : ['--version'];
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: environment,
    windowsHide: true
  });
  if (result.error || result.status !== 0) throw result.error || new Error(`pnpm 版本探测失败（exit=${result.status}）。`);
  const version = String(result.stdout || '').trim();
  assert.match(version, /^\d+\.\d+\.\d+$/, 'pnpm 返回了无效版本。');
  return version;
};

const installPlugin = ({ nodePath, dshBinPath, harnessHome, workspaceDir, version, integrity }) => {
  const environment = safeEnvironment({ homeDir: harnessHome, workspaceDir });
  const result = spawnSync(nodePath, [
    dshBinPath,
    'plugin',
    '--profile', PROFILE,
    'add', `${PLUGIN}@${version}`,
    '--save-exact',
    '--ignore-scripts'
  ], {
    cwd: workspaceDir,
    encoding: 'utf8',
    env: environment,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-4000);
    throw result.error || new Error(`固定插件 ${version} 安装失败（exit=${result.status}）：${output}`);
  }
  const profileDir = path.join(harnessHome, 'profiles', PROFILE);
  const profileManifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  const installedManifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'node_modules', ...PLUGIN.split('/'), 'package.json'), 'utf8'));
  const lockfile = fs.readFileSync(path.join(profileDir, 'pnpm-lock.yaml'), 'utf8');
  assert.equal(profileManifest.dependencies?.[PLUGIN], version, 'Profile 没有保存固定插件版本。');
  assert.equal(installedManifest.version, version, '安装目录中的插件版本不一致。');
  assert.equal(profileManifest.dsh?.profile?.bundles?.includes(PLUGIN), true, '插件没有进入 Profile 扩展层。');
  assert.equal(lockfile.includes(integrity), true, 'pnpm lockfile 缺少固定完整性摘要。');
};

const requestJson = async (url, { method = 'GET', body, expectedStatus = 200 } = {}) => {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
  assert.equal(response.status, expectedStatus, `${new URL(url).pathname} 返回 HTTP ${response.status}。`);
  if (expectedStatus === 404) return null;
  return response.json();
};

const pluginHealth = async ({ harnessHome, dshPackageDir, version, enabled }) => {
  const state = await new PluginHealthCatalog({ harnessHome, dshPackageDir }).scan();
  assert.equal(state.runtime.status, 'healthy');
  assert.equal(state.runtime.expected, EXPECTED_RUNTIME_PACKAGES);
  assert.equal(state.runtime.healthy, EXPECTED_RUNTIME_PACKAGES);
  const profile = state.profiles.find((entry) => entry.name === PROFILE);
  assert.ok(profile, '插件 Profile 未出现在健康目录中。');
  assert.equal(profile.status, 'healthy');
  const dependency = profile.dependencies.find((entry) => entry.name === PLUGIN);
  assert.ok(dependency, '第三方插件未出现在 Profile 依赖中。');
  assert.equal(dependency.version, version);
  assert.equal(dependency.source, 'profile');
  assert.equal(dependency.enabled, enabled);
  assert.equal(dependency.toggleable, true);
  assert.equal(dependency.compatibility?.status, 'verified');
  assert.equal(dependency.compatibility?.sourceType, 'registry-exact');
  assert.equal(dependency.compatibility?.bundlePatch, 'ready');
  assert.equal(dependency.compatibility?.clientPlatform, 'web');
  assert.equal(dependency.compatibility?.peers?.status, 'ready');
  return { runtime: `${state.runtime.healthy}/${state.runtime.expected}`, compatibility: dependency.compatibility.status };
};

const main = async () => {
  const runtimeRootArgument = readArgument('runtime-root');
  const outputArgument = readArgument('output');
  const dataRootArgument = readArgument('data-root');
  if (!runtimeRootArgument || !outputArgument || !dataRootArgument) {
    throw new Error('用法：node scripts/validate-third-party-plugin.cjs --runtime-root=<目录> --output=<json> --data-root=<空目录>');
  }

  const projectRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.resolve(runtimeRootArgument);
  const outputFile = path.resolve(outputArgument);
  const dataRoot = await requireEmptyDirectory(dataRootArgument);
  const harnessHome = path.join(dataRoot, 'harness');
  const workspaceDir = path.join(dataRoot, 'workspace');
  const logFile = path.join(dataRoot, 'logs', 'harness.log');
  await fsp.mkdir(workspaceDir, { recursive: true });
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'bin/node';
  const nodePath = path.join(projectRoot, 'vendor', 'runtime', `${process.platform}-${process.arch}`, nodeName);
  const dshBinPath = path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const dshPackageDir = path.resolve(path.dirname(dshBinPath), '..');
  assert.equal(fs.existsSync(nodePath), true, '固定 Node 运行时不存在。');
  assert.equal(fs.existsSync(dshBinPath), true, '固定 Harness CLI 不存在。');
  const environment = safeEnvironment({ homeDir: harnessHome, workspaceDir });
  const pnpmVersion = runPnpmProbe(environment);
  const supervisor = new HarnessSupervisor({
    rootDir: projectRoot,
    resourcesPath: runtimeRoot,
    isPackaged: false,
    homeDir: harnessHome,
    launchDir: workspaceDir,
    logFile,
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshBinPath }
  });
  const manager = new ProfileBundleManager({ profilesRoot: path.join(harnessHome, 'profiles') });
  const stages = [];

  const startAndProbe = async ({ version, enabled, expectedState = TEST_STATE, routeStatus = 200, name }) => {
    const url = await supervisor.start();
    const rootProbe = await probeHarness(url);
    assert.equal(rootProbe.status, 200);
    const health = await pluginHealth({ harnessHome, dshPackageDir, version, enabled });
    const payload = await requestJson(`${url}/catppuccin/state`, { expectedStatus: routeStatus });
    if (routeStatus === 200) {
      assert.equal(payload?.ok, true);
      assert.deepEqual(payload.state, expectedState);
    }
    stages.push({ name, version, enabled, routeStatus, rootStatus: rootProbe.status, ...health });
    await supervisor.stop();
  };

  let result;
  try {
    const initial = VERSION_SEQUENCE[0];
    installPlugin({ nodePath, dshBinPath, harnessHome, workspaceDir, ...initial });
    const initialUrl = await supervisor.start();
    const initialRootProbe = await probeHarness(initialUrl);
    assert.equal(initialRootProbe.status, 200);
    assert.deepEqual(await requestJson(`${initialUrl}/catppuccin/state`), { ok: true, state: null });
    assert.deepEqual(await requestJson(`${initialUrl}/catppuccin/state`, { method: 'PUT', body: TEST_STATE }), { ok: true });
    assert.deepEqual((await requestJson(`${initialUrl}/catppuccin/state`)).state, TEST_STATE);
    await pluginHealth({ harnessHome, dshPackageDir, version: initial.version, enabled: true });
    stages.push({ name: 'install-and-write', version: initial.version, enabled: true, routeStatus: 200, rootStatus: initialRootProbe.status, runtime: '432/432', compatibility: 'verified' });
    await supervisor.stop();

    await startAndProbe({ name: 'restart-persistence', version: initial.version, enabled: true });

    const profileDir = path.join(harnessHome, 'profiles', PROFILE);
    const disabled = await manager.apply({ profileDir, packageName: PLUGIN, enable: false });
    assert.equal(disabled.changed, true);
    await startAndProbe({ name: 'disabled', version: initial.version, enabled: false, routeStatus: 404 });
    await manager.commit(disabled.id);
    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(harnessHome, 'catppuccin-state.json'), 'utf8')), TEST_STATE);

    const enabled = await manager.apply({ profileDir, packageName: PLUGIN, enable: true });
    assert.equal(enabled.changed, true);
    await startAndProbe({ name: 're-enabled', version: initial.version, enabled: true });
    await manager.commit(enabled.id);

    const latest = VERSION_SEQUENCE[1];
    installPlugin({ nodePath, dshBinPath, harnessHome, workspaceDir, ...latest });
    await startAndProbe({ name: 'upgrade', version: latest.version, enabled: true });
    installPlugin({ nodePath, dshBinPath, harnessHome, workspaceDir, ...initial });
    await startAndProbe({ name: 'rollback', version: initial.version, enabled: true });
    installPlugin({ nodePath, dshBinPath, harnessHome, workspaceDir, ...latest });
    await startAndProbe({ name: 'final-upgrade', version: latest.version, enabled: true });

    result = {
      ok: true,
      plugin: PLUGIN,
      finalVersion: latest.version,
      pnpmVersion,
      scriptsIgnored: true,
      credentialsForwarded: false,
      isolatedDataRoot: true,
      statePreserved: true,
      versions: VERSION_SEQUENCE,
      stages
    };
  } catch (error) {
    result = { ok: false, plugin: PLUGIN, error: error.stack || error.message, stages };
    process.exitCode = 1;
  } finally {
    await supervisor.stop();
  }
  await fsp.mkdir(path.dirname(outputFile), { recursive: true });
  await fsp.writeFile(outputFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

void main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
