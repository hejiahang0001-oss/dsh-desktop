const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  BUNDLED_PNPM_VERSION,
  CONTROLLED_PLUGIN_CATALOG,
  ControlledPluginInstaller,
  buildControlledInstallEnvironment
} = require('../electron/controlled-plugin-installer.cjs');

const plugin = CONTROLLED_PLUGIN_CATALOG[0];
const writeJson = (target, value) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
};

const fixture = (root, runCommand) => {
  const harnessHome = path.join(root, 'harness');
  const profilesRoot = path.join(harnessHome, 'profiles');
  const profileDir = path.join(profilesRoot, 'web');
  const runtimeModulesDir = path.join(root, 'runtime', 'node_modules');
  const pnpmPackage = path.join(root, 'pnpm', 'package');
  const pnpmRuntime = {
    packageDir: pnpmPackage,
    binPath: path.join(pnpmPackage, 'bin', 'pnpm.mjs'),
    shimDir: path.join(root, 'pnpm'),
    shimPath: path.join(root, 'pnpm', 'pnpm.cmd'),
    emptyConfigPath: path.join(root, 'pnpm', 'empty.npmrc')
  };
  const nodePath = path.join(root, 'runtime', 'node.exe');
  const dshBinPath = path.join(runtimeModulesDir, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  for (const target of [nodePath, dshBinPath, pnpmRuntime.binPath, pnpmRuntime.shimPath, pnpmRuntime.emptyConfigPath]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixed');
  }
  writeJson(path.join(pnpmPackage, 'package.json'), { name: 'pnpm', version: BUNDLED_PNPM_VERSION });
  writeJson(path.join(profileDir, 'package.json'), {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }
  });
  fs.writeFileSync(path.join(profileDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  fs.writeFileSync(path.join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  return {
    harnessHome,
    profilesRoot,
    profileDir,
    runtimeModulesDir,
    pnpmRuntime,
    nodePath,
    dshBinPath,
    manager: new ControlledPluginInstaller({
      profilesRoot,
      harnessHome,
      nodePath,
      dshBinPath,
      runtimeModulesDir,
      pnpmRuntime,
      baseEnv: { SystemRoot: 'C:\\Windows', PATH: 'C:\\user-bin', DEEPSEEK_API_KEY: 'must-not-forward' },
      runCommand
    })
  };
};

const installFiles = (profileDir) => {
  const manifestPath = path.join(profileDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.dependencies[plugin.name] = plugin.version;
  manifest.dsh.profile.bundles.push(plugin.name);
  writeJson(manifestPath, manifest);
  const packageDir = path.join(profileDir, 'node_modules', ...plugin.name.split('/'));
  writeJson(path.join(packageDir, 'package.json'), {
    name: plugin.name,
    version: plugin.version,
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
  });
  fs.writeFileSync(path.join(packageDir, 'cordis.patch.yml'), '- insert: []\n');
  fs.writeFileSync(path.join(profileDir, 'pnpm-lock.yaml'), `lockfileVersion: 9.0\n  integrity: ${plugin.integrity}\n`);
};

test('controlled environment keeps only fixed pnpm paths, proxy state, and no software key', () => {
  const environment = buildControlledInstallEnvironment({
    baseEnv: {
      SystemRoot: 'C:\\Windows',
      PATH: 'C:\\user-bin',
      ComSpec: 'C:\\untrusted\\shell.exe',
      NODE_OPTIONS: '--require C:\\untrusted\\hook.cjs',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      PNPM_HOME: 'C:\\untrusted\\pnpm',
      DEEPSEEK_API_KEY: 'secret',
      HTTP_PROXY: 'http://inherited.invalid'
    },
    harnessHome: 'C:\\data\\harness',
    workspacePath: 'C:\\workspace',
    proxyEnvironment: { HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890' },
    nodePath: 'C:\\fixed-node\\node.exe',
    pnpmRuntime: { shimDir: 'C:\\fixed-pnpm', emptyConfigPath: 'C:\\fixed-pnpm\\empty.npmrc' }
  });
  assert.equal(environment.DEEPSEEK_API_KEY, undefined);
  assert.equal(environment.HTTP_PROXY, 'http://127.0.0.1:7890');
  assert.equal(environment.Path.includes('C:\\user-bin'), false);
  assert.equal(environment.Path.startsWith('C:\\fixed-pnpm;C:\\fixed-node;'), true);
  assert.equal(environment.ComSpec, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(environment.PATHEXT, '.COM;.EXE;.BAT;.CMD');
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.NODE_TLS_REJECT_UNAUTHORIZED, undefined);
  assert.equal(environment.PNPM_HOME, undefined);
  assert.equal(environment.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org');
  assert.equal(environment.NPM_CONFIG_IGNORE_SCRIPTS, 'true');
  assert.equal(environment.NPM_CONFIG_SAVE_EXACT, 'true');
  assert.equal(environment.NPM_CONFIG_STORE_DIR, 'C:\\data\\harness\\.pnpm-store');
  assert.equal(environment.NPM_CONFIG_STRICT_SSL, 'true');
});

test('rollback failure blocks the Profile for the rest of the process', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-controlled-rollback-block-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let created;
  const runCommand = async (_command, args) => {
    if (args[0].endsWith('pnpm.mjs')) {
      if (args.includes('prune')) return { code: 1, stdout: '', stderr: 'blocked prune', timedOut: false, error: null };
      return { code: 0, stdout: `${BUNDLED_PNPM_VERSION}\n`, stderr: '', timedOut: false, error: null };
    }
    if (args.includes('add')) {
      installFiles(created.profileDir);
      return { code: 1, stdout: '', stderr: 'simulated add failure', timedOut: false, error: null };
    }
    if (args.includes('remove')) return { code: 1, stdout: '', stderr: 'blocked remove', timedOut: false, error: null };
    return { code: 0, stdout: '', stderr: '', timedOut: false, error: null };
  };
  created = fixture(root, runCommand);
  await assert.rejects(
    created.manager.install({ profileDir: created.profileDir, catalogId: plugin.id, workspacePath: root }),
    (error) => error?.code === 'install-rollback-failed'
  );
  await assert.rejects(
    created.manager.install({ profileDir: created.profileDir, catalogId: plugin.id, workspacePath: root }),
    (error) => error?.code === 'profile-busy'
  );
});

test('controlled installer uses one fixed catalog spec and commits a verified profile install', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-controlled-install-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let created;
  const calls = [];
  const runCommand = async (_command, args, options) => {
    calls.push({ args, env: options.env });
    if (args[0].endsWith('pnpm.mjs')) return { code: 0, stdout: `${BUNDLED_PNPM_VERSION}\n`, stderr: '', timedOut: false, error: null };
    assert.deepEqual(args.slice(1), [
      'plugin', '--profile', 'web', 'add', `${plugin.name}@${plugin.version}`,
      '--save-exact', '--ignore-scripts', '--registry=https://registry.npmjs.org'
    ]);
    assert.equal(Object.keys(options.env).some((name) => name.toUpperCase() === 'DEEPSEEK_API_KEY'), false);
    installFiles(created.profileDir);
    return { code: 0, stdout: '', stderr: '', timedOut: false, error: null };
  };
  created = fixture(root, runCommand);
  const result = await created.manager.install({
    profileDir: created.profileDir,
    catalogId: plugin.id,
    workspacePath: root,
    proxyEnvironment: {}
  });
  assert.equal(result.plugin.version, plugin.version);
  assert.equal(result.pnpmVersion, BUNDLED_PNPM_VERSION);
  assert.equal(result.scriptsIgnored, true);
  assert.equal(calls.length, 2);
  await created.manager.commit(result.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(created.profileDir, 'package.json'), 'utf8')).dependencies[plugin.name], plugin.version);
});

test('controlled installer rejects arbitrary catalog ids, profiles, and bundled pnpm versions', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-controlled-boundary-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const created = fixture(root, async () => ({ code: 0, stdout: `${BUNDLED_PNPM_VERSION}\n`, stderr: '', timedOut: false, error: null }));
  await assert.rejects(
    created.manager.install({ profileDir: created.profileDir, catalogId: '../arbitrary', workspacePath: root }),
    /已验证安装目录/
  );
  const other = path.join(created.profilesRoot, 'headless');
  writeJson(path.join(other, 'package.json'), { dependencies: {}, dsh: { profile: { bundles: [] } } });
  await assert.rejects(
    created.manager.install({ profileDir: other, catalogId: plugin.id, workspacePath: root }),
    /不能安装到此 Profile/
  );
  writeJson(path.join(created.pnpmRuntime.packageDir, 'package.json'), { name: 'pnpm', version: '11.23.0' });
  assert.equal((await created.manager.inspectRuntime()).status, 'unavailable');
});

test('controlled installer rollback removes the package and restores tracked profile files byte-for-byte', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-controlled-rollback-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let created;
  const runCommand = async (_command, args) => {
    if (args[0].endsWith('pnpm.mjs')) return { code: 0, stdout: `${BUNDLED_PNPM_VERSION}\n`, stderr: '', timedOut: false, error: null };
    if (args.includes('add')) installFiles(created.profileDir);
    if (args.includes('remove')) {
      assert.deepEqual(args.slice(1), ['plugin', '--profile', 'web', 'remove', plugin.name]);
      const manifestPath = path.join(created.profileDir, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      delete manifest.dependencies[plugin.name];
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((name) => name !== plugin.name);
      writeJson(manifestPath, manifest);
      fs.rmSync(path.join(created.profileDir, 'node_modules', ...plugin.name.split('/')), { recursive: true, force: true });
    }
    return { code: 0, stdout: '', stderr: '', timedOut: false, error: null };
  };
  created = fixture(root, runCommand);
  const before = new Map(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map((name) => [name, fs.readFileSync(path.join(created.profileDir, name))]));
  const result = await created.manager.install({ profileDir: created.profileDir, catalogId: plugin.id, workspacePath: root });
  await created.manager.rollback(result.id);
  for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(created.profileDir, name)), bytes);
  assert.equal(fs.existsSync(path.join(created.profileDir, 'node_modules', ...plugin.name.split('/'))), false);
});
