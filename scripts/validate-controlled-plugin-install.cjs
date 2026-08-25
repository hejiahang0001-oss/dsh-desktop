const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  ControlledPluginInstaller,
  resolveControlledPnpmRuntime,
  runBoundedCommand
} = require('../electron/controlled-plugin-installer.cjs');
const {
  HarnessSupervisor,
  probeHarness,
  resolveHarnessRuntimePaths
} = require('../electron/harness-supervisor.cjs');

const CATALOG_ID = 'catppuccin-0.3.1';
const PROFILE = 'web';
const CREDENTIAL_MARKER = 'dsh-controlled-install-secret-marker';
const TRACKED_FILES = Object.freeze(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']);

const readArgument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const requireEmptyDirectory = async (target) => {
  const directory = path.resolve(target);
  let info;
  try { info = await fsp.lstat(directory); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (info) {
    assert.equal(info.isDirectory() && !info.isSymbolicLink(), true, '隔离数据目录必须是普通目录。');
    assert.deepEqual(await fsp.readdir(directory), [], '隔离数据目录必须为空。');
  } else {
    await fsp.mkdir(directory, { recursive: false });
  }
  return directory;
};

const trackedSnapshot = async (profileDir) => Object.fromEntries(await Promise.all(TRACKED_FILES.map(async (name) => {
  const target = path.join(profileDir, name);
  try { return [name, hash(await fsp.readFile(target))]; } catch (error) {
    if (error?.code === 'ENOENT') return [name, null];
    throw error;
  }
})));

const treeContainsMarker = async (root) => {
  const queue = [root];
  let seen = 0;
  while (queue.length > 0) {
    const directory = queue.shift();
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      seen += 1;
      if (seen > 20_000) throw new Error('隔离验证目录超出文件数量上限。');
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        queue.push(target);
      } else if (entry.isFile()) {
        const info = await fsp.lstat(target);
        if (info.size <= 1024 * 1024 && (await fsp.readFile(target)).includes(CREDENTIAL_MARKER)) return true;
      }
    }
  }
  return false;
};

const main = async () => {
  const resourcesArgument = readArgument('resources-root');
  const dataArgument = readArgument('data-root');
  const outputArgument = readArgument('output');
  if (!resourcesArgument || !dataArgument || !outputArgument) {
    throw new Error('用法：node scripts/validate-controlled-plugin-install.cjs --resources-root=<目录> --data-root=<空目录> --output=<json>');
  }

  const projectRoot = path.resolve(__dirname, '..');
  const resourcesPath = path.resolve(resourcesArgument);
  const dataRoot = await requireEmptyDirectory(dataArgument);
  const outputPath = path.resolve(outputArgument);
  const harnessHome = path.join(dataRoot, 'harness');
  const workspacePath = path.join(dataRoot, 'workspace');
  const logFile = path.join(dataRoot, 'logs', 'harness.log');
  const supervisor = new HarnessSupervisor({
    rootDir: projectRoot,
    resourcesPath,
    isPackaged: true,
    homeDir: harnessHome,
    launchDir: workspacePath,
    logFile
  });
  const runtime = resolveHarnessRuntimePaths({ rootDir: projectRoot, resourcesPath, isPackaged: true });
  const pnpmRuntime = resolveControlledPnpmRuntime({ rootDir: projectRoot, resourcesPath, isPackaged: true });
  const environmentChecks = [];
  const manager = new ControlledPluginInstaller({
    profilesRoot: path.join(harnessHome, 'profiles'),
    harnessHome,
    nodePath: runtime.nodePath,
    dshBinPath: runtime.dshBinPath,
    runtimeModulesDir: path.join(resourcesPath, 'harness', 'node_modules'),
    pnpmRuntime,
    baseEnv: { ...process.env, DEEPSEEK_API_KEY: CREDENTIAL_MARKER },
    runCommand: async (command, args, options) => {
      const credentialIsolated = !Object.keys(options.env || {}).some((name) => name.toUpperCase() === 'DEEPSEEK_API_KEY');
      const fixedPnpmPath = String(options.env?.Path || '').split(path.delimiter)[0] === pnpmRuntime.shimDir;
      environmentChecks.push({ credentialIsolated, fixedPnpmPath });
      assert.equal(credentialIsolated, true, '软件 Key 被传入插件安装进程。');
      assert.equal(fixedPnpmPath, true, '插件安装没有优先使用软件随附 pnpm。');
      return runBoundedCommand(command, args, options);
    }
  });

  let result;
  let transaction;
  try {
    const url = await supervisor.start();
    const rootProbe = await probeHarness(url);
    assert.equal(rootProbe.status, 200);
    await supervisor.stop();
    const profileDir = path.join(harnessHome, 'profiles', PROFILE);
    const before = await trackedSnapshot(profileDir);
    const runtimeStatus = await manager.inspectRuntime();
    assert.deepEqual(runtimeStatus, { status: 'ready', version: '11.19.0', registry: 'registry.npmjs.org' });
    transaction = await manager.install({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    assert.equal(transaction.plugin.name, '@nonamelego/dsh-catppuccin');
    assert.equal(transaction.plugin.version, '0.3.1');
    assert.equal(transaction.plugin.compatibility, 'verified');
    assert.equal(transaction.scriptsIgnored, true);
    await manager.rollback(transaction.id);
    transaction = null;
    const after = await trackedSnapshot(profileDir);
    assert.deepEqual(after, before, '回滚后的 Profile 文件摘要不一致。');
    assert.equal(fs.existsSync(path.join(profileDir, 'node_modules', '@nonamelego', 'dsh-catppuccin')), false, '回滚后仍残留插件目录。');
    assert.equal(await treeContainsMarker(dataRoot), false, '隔离目录中发现软件 Key 标记。');
    result = {
      ok: true,
      package: '@nonamelego/dsh-catppuccin',
      version: '0.3.1',
      pnpmVersion: runtimeStatus.version,
      registry: runtimeStatus.registry,
      compatibility: 'verified',
      scriptsIgnored: true,
      credentialIsolated: environmentChecks.every((entry) => entry.credentialIsolated),
      fixedPnpmPath: environmentChecks.every((entry) => entry.fixedPnpmPath),
      rollbackTrackedFilesByteExact: true,
      commands: environmentChecks.length
    };
  } catch (error) {
    if (transaction?.id) await manager.rollback(transaction.id).catch(() => {});
    result = { ok: false, error: error.stack || error.message, commands: environmentChecks.length };
    process.exitCode = 1;
  } finally {
    await supervisor.stop();
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

void main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
