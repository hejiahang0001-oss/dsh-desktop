const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  LAST_KNOWN_GOOD_NAME,
  LIFECYCLE_JOURNAL_NAME,
  REVIEWED_PLUGIN_VERSIONS,
  ControlledPluginInstaller,
  buildControlledInstallEnvironment,
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
const readManifest = async (profileDir) => JSON.parse(await fsp.readFile(path.join(profileDir, 'package.json'), 'utf8'));

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
  const commandSummaries = [];
  let diagnosticProfileDir = '';
  const checkedRunCommand = async (command, args, options) => {
    const credentialIsolated = !Object.keys(options.env || {}).some((name) => name.toUpperCase() === 'DEEPSEEK_API_KEY');
    const fixedPnpmPath = String(options.env?.Path || '').split(path.delimiter)[0] === pnpmRuntime.shimDir;
    environmentChecks.push({ credentialIsolated, fixedPnpmPath });
    assert.equal(credentialIsolated, true, '软件 Key 被传入插件生命周期进程。');
    assert.equal(fixedPnpmPath, true, '插件生命周期没有优先使用软件随附 pnpm。');
    const commandResult = await runBoundedCommand(command, args, options);
    const kind = args.includes('add') ? 'add' : args.includes('remove') ? 'remove' : args.includes('prune') ? 'prune' : 'probe';
    const profileState = diagnosticProfileDir && kind !== 'probe'
      ? {
          declared: Object.hasOwn((await readManifest(diagnosticProfileDir).catch(() => ({ dependencies: {} }))).dependencies || {}, '@nonamelego/dsh-catppuccin'),
          linked: fs.existsSync(path.join(diagnosticProfileDir, 'node_modules', '@nonamelego', 'dsh-catppuccin'))
        }
      : null;
    commandSummaries.push({ kind, code: commandResult.code, timedOut: commandResult.timedOut, profileState });
    return commandResult;
  };
  const managerOptions = {
    profilesRoot: path.join(harnessHome, 'profiles'),
    harnessHome,
    nodePath: runtime.nodePath,
    dshBinPath: runtime.dshBinPath,
    runtimeModulesDir: path.join(resourcesPath, 'harness', 'node_modules'),
    pnpmRuntime,
    baseEnv: { ...process.env, DEEPSEEK_API_KEY: CREDENTIAL_MARKER },
    runCommand: checkedRunCommand
  };
  const manager = new ControlledPluginInstaller(managerOptions);

  let result;
  let transaction;
  let transactionManager = manager;
  try {
    const url = await supervisor.start();
    const rootProbe = await probeHarness(url);
    assert.equal(rootProbe.status, 200);
    await supervisor.stop();
    const profileDir = path.join(harnessHome, 'profiles', PROFILE);
    diagnosticProfileDir = profileDir;
    const runtimeStatus = await manager.inspectRuntime();
    assert.deepEqual(runtimeStatus, { status: 'ready', version: '11.19.0', registry: 'registry.npmjs.org' });
    const seedEnvironment = buildControlledInstallEnvironment({
      baseEnv: managerOptions.baseEnv,
      harnessHome,
      workspacePath,
      nodePath: runtime.nodePath,
      pnpmRuntime
    });
    const seeded = await checkedRunCommand(runtime.nodePath, [
      runtime.dshBinPath,
      'plugin',
      '--profile', PROFILE,
      'add', `@nonamelego/dsh-catppuccin@0.3.0`,
      '--save-exact', '--ignore-scripts', '--registry=https://registry.npmjs.org'
    ], { cwd: workspacePath, env: seedEnvironment, timeoutMs: 5 * 60 * 1000 });
    assert.equal(seeded.code, 0, seeded.stderr || '无法建立已审核 0.3.0 生命周期基线。');
    assert.equal((await readManifest(profileDir)).dependencies['@nonamelego/dsh-catppuccin'], '0.3.0');

    transaction = await manager.upgrade({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    assert.equal(transaction.plugin.version, '0.3.1');
    assert.equal(transaction.plugin.compatibility, 'verified');
    const restarted = new ControlledPluginInstaller(managerOptions);
    await restarted.inspectRuntime();
    const recovered = await restarted.recoverPending({ workspacePath, proxyEnvironment: {} });
    assert.deepEqual(recovered, [{ profile: PROFILE, kind: 'plugin-lifecycle', status: 'rolled-back' }]);
    transaction = null;
    assert.equal((await readManifest(profileDir)).dependencies['@nonamelego/dsh-catppuccin'], '0.3.0');

    let activeManager = restarted;
    transactionManager = activeManager;
    transaction = await activeManager.upgrade({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    await activeManager.commit(transaction.id);
    transaction = null;
    assert.equal((await readManifest(profileDir)).dependencies['@nonamelego/dsh-catppuccin'], '0.3.1');

    transaction = await activeManager.rollbackLastKnownGood({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    await activeManager.commit(transaction.id);
    transaction = null;
    assert.equal((await readManifest(profileDir)).dependencies['@nonamelego/dsh-catppuccin'], '0.3.0');

    transaction = await activeManager.upgrade({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    await activeManager.commit(transaction.id);
    transaction = null;
    transaction = await activeManager.uninstall({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    await activeManager.commit(transaction.id);
    transaction = null;
    const absentSnapshot = await trackedSnapshot(profileDir);
    assert.equal(Object.hasOwn((await readManifest(profileDir)).dependencies || {}, '@nonamelego/dsh-catppuccin'), false);

    transaction = await activeManager.rollbackLastKnownGood({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    await activeManager.commit(transaction.id);
    transaction = null;
    assert.equal((await readManifest(profileDir)).dependencies['@nonamelego/dsh-catppuccin'], '0.3.1');
    transaction = await activeManager.rollbackLastKnownGood({ profileDir, catalogId: CATALOG_ID, workspacePath, proxyEnvironment: {} });
    await activeManager.commit(transaction.id);
    transaction = null;
    assert.deepEqual(await trackedSnapshot(profileDir), absentSnapshot, '卸载状态的最近可用回退不是逐字节一致。');
    assert.equal(fs.existsSync(path.join(profileDir, 'node_modules', '@nonamelego', 'dsh-catppuccin')), false, '最终卸载后仍残留插件目录。');
    assert.equal(fs.existsSync(path.join(profileDir, LIFECYCLE_JOURNAL_NAME)), false, '提交后仍残留生命周期事务日志。');
    assert.equal(fs.existsSync(path.join(profileDir, LAST_KNOWN_GOOD_NAME)), true, '提交后缺少最近可用回退点。');
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
      reviewedVersions: Object.keys(REVIEWED_PLUGIN_VERSIONS),
      crashRecovery: 'rolled-back',
      upgradeRollback: true,
      uninstallRollback: true,
      rollbackTrackedFilesByteExact: true,
      journalCleaned: true,
      lastKnownGoodPresent: true,
      commands: environmentChecks.length
    };
  } catch (error) {
    if (transaction?.id) await transactionManager.rollback(transaction.id).catch(() => {});
    result = { ok: false, error: error.stack || error.message, commands: environmentChecks.length, commandSummaries };
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
