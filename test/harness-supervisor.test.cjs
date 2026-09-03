const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn: spawnProcess } = require('node:child_process');
const {
  HarnessSupervisor,
  buildHarnessEnvironment,
  createAuthenticatedHarnessFetch,
  establishHarnessSession,
  isSafeHarnessUrl,
  parseHarnessUrl,
  probeHarness,
  provisionDesktopShellEnvPlugin,
  redactHarnessLog,
  resolveHarnessProcessHostPath,
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

const writeHarnessPackage = (binPath, content = '// test') => {
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, content);
  fs.writeFileSync(path.resolve(path.dirname(binPath), '..', 'package.json'), JSON.stringify({
    name: '@deepseek-ai/dsh',
    version: '0.1.2-rc.1'
  }));
};

const createFakeChild = (pid, { killImpl } = {}) => {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = killImpl || (() => true);
  child.emitExit = (code = 0, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit('exit', code, signal);
  };
  return child;
};

const waitUntil = async (predicate, timeoutMs = 1000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for supervisor state.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const waitForProcessExit = (child, timeoutMs = 10000) => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`Timed out waiting for PID ${child.pid} to exit.`));
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };
    child.once('exit', onExit);
  });
};

const processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
};

const killExactProcessTree = (pid) => new Promise((resolve) => {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !processIsAlive(pid)) {
    resolve();
    return;
  }
  let command;
  const done = () => resolve();
  try {
    command = spawnProcess('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore'
    });
    command.once('error', done);
    command.once('exit', done);
  } catch {
    resolve();
  }
});

const createSupervisorFixture = (options = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-supervisor-lifecycle-test-'));
  const workspace = path.join(root, 'workspace');
  const nodePath = path.join(root, 'node.exe');
  const dshPath = path.join(root, 'dsh', 'lib', 'fake-harness.cjs');
  const patchPath = path.join(root, 'desktop.patch.yml');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(nodePath, 'test');
  writeHarnessPackage(dshPath);
  fs.writeFileSync(patchPath, '[]');
  writeBundledOfficeSkills(root);
  const supervisor = new HarnessSupervisor({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    homeDir: path.join(root, 'home'),
    launchDir: workspace,
    logFile: path.join(root, 'logs', 'harness.log'),
    startTimeoutMs: 1000,
    stopTimeoutMs: 50,
    env: {
      DSH_DESKTOP_NODE: nodePath,
      DSH_DESKTOP_DSH_BIN: dshPath,
      DSH_DESKTOP_PATCH: patchPath
    },
    ...options
  });
  return { root, supervisor };
};

test('software-managed credential policy removes inherited DeepSeek keys case-insensitively', () => {
  const baseEnv = {
    PATH: 'runtime-path',
    deepseek_api_key: 'legacy-secret',
    dsh_desktop_dsh_bin: 'C:\\stale-dsh-bin.js',
    dsh_desktop_patch: 'C:\\stale-patch.yml',
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
  assert.equal(Object.keys(environment).some((name) => name.toUpperCase() === 'DSH_DESKTOP_DSH_BIN'), false);
  assert.equal(Object.keys(environment).some((name) => name.toUpperCase() === 'DSH_DESKTOP_PATCH'), false);
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
  assert.equal(
    parseHarnessUrl('dsh web: http://127.0.0.1:61045/?token=abcdefghijklmnopqrstuvwxyz012345'),
    'http://127.0.0.1:61045/?token=abcdefghijklmnopqrstuvwxyz012345'
  );
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

test('Harness startup logging redacts the local one-time authentication token', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz012345';
  const redacted = redactHarnessLog(`dsh web: http://127.0.0.1:61045/?token=${token}`);
  assert.equal(redacted, 'dsh web: http://127.0.0.1:61045/?token=[REDACTED]');
  assert.equal(redacted.includes(token), false);
});

test('runtime resolver prefers explicit, existing paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-test-'));
  const nodePath = path.join(root, 'node.exe');
  const dshPath = path.join(root, 'dsh', 'lib', 'bin.js');
  const patchPath = path.join(root, 'desktop.patch.yml');
  fs.writeFileSync(nodePath, 'test');
  writeHarnessPackage(dshPath, 'test');
  fs.writeFileSync(patchPath, '[]');
  const office = writeBundledOfficeSkills(root);
  const resolved = resolveHarnessRuntimePaths({
    rootDir: root,
    resourcesPath: root,
    isPackaged: false,
    env: { DSH_DESKTOP_NODE: nodePath, DSH_DESKTOP_DSH_BIN: dshPath, DSH_DESKTOP_PATCH: patchPath }
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: dshPath, patchPath, ...office, version: '0.1.2-rc.1' });
});

test('Harness process host uses fixed development and packaged paths', () => {
  assert.equal(
    resolveHarnessProcessHostPath({ isPackaged: false }),
    path.resolve(__dirname, '..', 'electron', 'harness-process-host.cjs')
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-process-host-path-test-'));
  const fixedPath = path.join(root, 'harness-host', 'harness-process-host.cjs');
  const externalPath = path.join(root, 'external-host.cjs');
  try {
    fs.writeFileSync(externalPath, '// external');
    assert.throws(
      () => resolveHarnessProcessHostPath({ isPackaged: true, resourcesPath: root, processHostPath: externalPath }),
      (error) => error?.code === 'HARNESS_PROCESS_HOST_MISSING'
    );
    fs.mkdirSync(path.dirname(fixedPath), { recursive: true });
    fs.writeFileSync(fixedPath, '// fixed');
    assert.equal(
      resolveHarnessProcessHostPath({ isPackaged: true, resourcesPath: root, processHostPath: externalPath }),
      fixedPath
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged runtime resolves DSH only from the fixed top-level package path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-packaged-runtime-test-'));
  const resourcesPath = path.join(root, 'resources');
  const nodePath = path.join(resourcesPath, 'runtime', 'node.exe');
  const nodeModules = path.join(resourcesPath, 'harness', 'node_modules');
  const packageDir = path.join(
    nodeModules,
    '.pnpm',
    '@deepseek-ai+dsh@0.1.2-rc.1_test',
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
  fs.writeFileSync(path.resolve(path.dirname(linkedBin), '..', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' }));
  fs.writeFileSync(pnpmBin, 'real package');
  fs.mkdirSync(path.dirname(patchPath), { recursive: true });
  fs.writeFileSync(patchPath, '[]');
  fs.mkdirSync(shellEnvPluginDir, { recursive: true });
  fs.writeFileSync(path.join(shellEnvPluginDir, 'package.json'), JSON.stringify({ name: 'dsh-desktop-shell-env', exports: './index.mjs' }));
  fs.writeFileSync(path.join(shellEnvPluginDir, 'index.mjs'), '// test');
  const externalNodePath = path.join(root, 'external-node.exe');
  const externalDshPath = path.join(root, 'external-bin.js');
  const externalPatchPath = path.join(root, 'external.patch.yml');
  fs.writeFileSync(externalNodePath, 'untrusted');
  fs.writeFileSync(externalDshPath, 'untrusted');
  fs.writeFileSync(externalPatchPath, '[]');
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
    env: {
      DSH_DESKTOP_NODE: externalNodePath,
      DSH_DESKTOP_DSH_BIN: externalDshPath,
      DSH_DESKTOP_PATCH: externalPatchPath
    }
  });
  assert.deepEqual(resolved, { nodePath, dshBinPath: linkedBin, patchPath, bundledSkillDir, docxToolPath, xlsxToolPath, pptxToolPath, wikiToolPath, shellEnvPluginDir, version: '0.1.2-rc.1' });
});

test('packaged runtime fails closed instead of falling back to external overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-packaged-runtime-missing-test-'));
  const rootDir = path.join(root, 'app.asar');
  const resourcesPath = path.join(root, 'resources');
  const nodePath = path.join(resourcesPath, 'runtime', 'node.exe');
  const dshPath = path.join(resourcesPath, 'harness', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const patchPath = path.join(resourcesPath, 'harness-config', 'dsh-desktop.patch.yml');
  const externalNodePath = path.join(root, 'external-node.exe');
  const externalDshPath = path.join(root, 'external-bin.js');
  const externalPatchPath = path.join(root, 'external.patch.yml');
  for (const target of [nodePath, dshPath, patchPath, externalNodePath, externalDshPath, externalPatchPath]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, target.endsWith('.yml') ? '[]' : 'test');
  }
  fs.writeFileSync(path.resolve(path.dirname(dshPath), '..', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.2-rc.1' }));
  for (const target of [
    path.join(rootDir, 'vendor', 'runtime', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'node.exe' : 'bin/node'),
    path.join(rootDir, 'vendor', 'harness-hoisted-0.1.2-rc.1', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    path.join(rootDir, 'config', 'dsh-desktop.patch.yml')
  ]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, target.endsWith('.yml') ? '[]' : 'untrusted root fallback');
  }
  const shellEnvPluginDir = path.join(resourcesPath, 'harness-plugins', 'dsh-desktop-shell-env');
  fs.mkdirSync(shellEnvPluginDir, { recursive: true });
  fs.writeFileSync(path.join(shellEnvPluginDir, 'package.json'), JSON.stringify({ name: 'dsh-desktop-shell-env', exports: './index.mjs' }));
  fs.writeFileSync(path.join(shellEnvPluginDir, 'index.mjs'), '// test');
  writeBundledOfficeSkills(root);
  const resolve = () => resolveHarnessRuntimePaths({
    rootDir,
    resourcesPath,
    isPackaged: true,
    env: {
      DSH_DESKTOP_NODE: externalNodePath,
      DSH_DESKTOP_DSH_BIN: externalDshPath,
      DSH_DESKTOP_PATCH: externalPatchPath
    }
  });
  for (const [target, code] of [
    [nodePath, 'NODE_RUNTIME_MISSING'],
    [dshPath, 'HARNESS_RUNTIME_MISSING'],
    [patchPath, 'HARNESS_PATCH_MISSING']
  ]) {
    fs.rmSync(target);
    assert.throws(resolve, (error) => error?.code === code);
    fs.writeFileSync(target, target.endsWith('.yml') ? '[]' : 'test');
  }
});

test('runtime resolver fails closed when the desktop language patch is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-no-patch-test-'));
  const nodePath = path.join(root, 'node.exe');
  const dshPath = path.join(root, 'dsh', 'lib', 'bin.js');
  fs.writeFileSync(nodePath, 'test');
  writeHarnessPackage(dshPath, 'test');
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

test('tokenized Harness launch exchanges a bounded cookie before probing the clean origin', async () => {
  const calls = [];
  const authenticated = await establishHarnessSession(
    'http://127.0.0.1:4567/?token=abcdefghijklmnopqrstuvwxyz012345',
    {
      attempts: 1,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (calls.length === 1) {
          return new Response(null, {
            status: 303,
            headers: { location: '/', 'set-cookie': 'dsh_session=local-cookie-value; HttpOnly; SameSite=Strict; Path=/' }
          });
        }
        return new Response('<title>DeepSeek Harness</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
    }
  );
  assert.equal(authenticated.origin, 'http://127.0.0.1:4567');
  assert.equal(authenticated.cookie.header, 'dsh_session=local-cookie-value');
  assert.equal(authenticated.probe.status, 200);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[1].options.headers.cookie, 'dsh_session=local-cookie-value');
});

test('authenticated Harness fetch never forwards its cookie outside the pinned loopback origin', async () => {
  let observed;
  const authenticatedFetch = createAuthenticatedHarnessFetch({
    origin: 'http://127.0.0.1:4567',
    cookie: { header: 'dsh_session=local-cookie-value' },
    fetchImpl: async (url, options) => {
      observed = { url: String(url), cookie: new Headers(options.headers).get('cookie') };
      return new Response('{}');
    }
  });
  await authenticatedFetch('http://127.0.0.1:4567/api/session.list', { headers: { accept: 'application/json' } });
  assert.deepEqual(observed, {
    url: 'http://127.0.0.1:4567/api/session.list',
    cookie: 'dsh_session=local-cookie-value'
  });
  assert.throws(() => authenticatedFetch('https://example.com/api/session.list'), /拒绝/);
});

test('stopping while Harness is starting rejects the start promise and clears the owned child', async (context) => {
  const child = createFakeChild(41001, {
    killImpl: () => {
      queueMicrotask(() => child.emitExit(null, 'SIGTERM'));
      return true;
    }
  });
  const stoppedTrees = [];
  const { root, supervisor } = createSupervisorFixture({
    spawnImpl: () => child,
    stopTree: async (ownedChild) => {
      stoppedTrees.push(ownedChild);
      queueMicrotask(() => ownedChild.emitExit(null, 'SIGTERM'));
    }
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const startPromise = supervisor.start();
  await waitUntil(() => supervisor.child === child);
  const stopPromise = supervisor.stop();

  await assert.rejects(
    Promise.race([
      startPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('start remained pending')), 200))
    ]),
    (error) => error?.code === 'HARNESS_START_ABORTED'
  );
  await stopPromise;
  assert.deepEqual(stoppedTrees, [child]);
  assert.equal(supervisor.child, null);
  assert.equal(supervisor.getState().status, 'stopped');
});

test('an immediate stop cancels startup before a child can be spawned', async (context) => {
  let spawnCalls = 0;
  const { root, supervisor } = createSupervisorFixture({
    spawnImpl: () => {
      spawnCalls += 1;
      return createFakeChild(41501);
    }
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const startPromise = supervisor.start();
  await supervisor.stop();
  await assert.rejects(startPromise, (error) => error?.code === 'HARNESS_START_ABORTED');
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(spawnCalls, 0);
  assert.equal(supervisor.child, null);
  assert.equal(supervisor.getState().status, 'stopped');
});

test('an asynchronous spawn error without a PID releases the nonexistent child', async (context) => {
  const child = createFakeChild(undefined);
  const { root, supervisor } = createSupervisorFixture({ spawnImpl: () => child });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const startPromise = supervisor.start();
  await waitUntil(() => supervisor.child === child);
  const failure = new Error('spawn ENOENT');
  failure.code = 'ENOENT';
  child.emit('error', failure);

  await assert.rejects(startPromise, (error) => error === failure);
  assert.equal(supervisor.child, null);
  assert.equal(supervisor.isActive(), false);
  assert.equal(supervisor.getState().status, 'failed');
  assert.equal(supervisor.getState().pid, null);
  await supervisor.stop();
  assert.equal(supervisor.getState().status, 'stopped');
});

test('Windows shutdown uses taskkill for the exact owned process tree', async (context) => {
  const child = createFakeChild(42002, {
    killImpl: () => {
      throw new Error('child.kill must not be used for Windows process-tree shutdown');
    }
  });
  const invocations = [];
  const launches = [];
  const { root, supervisor } = createSupervisorFixture({
    platform: 'win32',
    spawnImpl: (command, args, options) => {
      launches.push({ command, args, options });
      return child;
    },
    taskkillSpawnImpl: (command, args, options) => {
      invocations.push({ command, args, options });
      const taskkill = createFakeChild(43003);
      queueMicrotask(() => {
        taskkill.emitExit(0, null);
        child.emitExit(null, 'SIGKILL');
      });
      return taskkill;
    }
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const startPromise = supervisor.start();
  await waitUntil(() => supervisor.child === child);
  child.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:45678\n'));
  await startPromise;
  await supervisor.stop();

  assert.equal(launches.length, 1);
  assert.equal(path.basename(launches[0].args[0]), 'harness-process-host.cjs');
  assert.equal(path.basename(launches[0].args[1]), 'fake-harness.cjs');
  assert.equal(launches[0].options.stdio[0], 'pipe');
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].command, 'taskkill.exe');
  assert.deepEqual(invocations[0].args, ['/PID', '42002', '/T', '/F']);
  assert.equal(invocations[0].options.shell, false);
  assert.equal(invocations[0].options.windowsHide, true);
  assert.equal(supervisor.child, null);
  assert.equal(supervisor.getState().status, 'stopped');
});

test('Windows shutdown accepts a taskkill race when the owned child already exited', async (context) => {
  const child = createFakeChild(42012);
  const { root, supervisor } = createSupervisorFixture({
    platform: 'win32',
    spawnImpl: () => child,
    taskkillSpawnImpl: () => {
      const taskkill = createFakeChild(43013);
      queueMicrotask(() => {
        child.emitExit(0, null);
        taskkill.emitExit(128, null);
      });
      return taskkill;
    }
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const startPromise = supervisor.start();
  await waitUntil(() => supervisor.child === child);
  child.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:45679\n'));
  await startPromise;
  await supervisor.stop();

  assert.equal(supervisor.child, null);
  assert.equal(supervisor.getState().status, 'stopped');
});

test('process host proxies IPC and removes its Harness tree when the desktop stdin lease closes', {
  skip: process.platform !== 'win32',
  timeout: 20000
}, async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-process-host-watchdog-test-'));
  const fakeHarness = path.join(root, 'fake-harness.cjs');
  const pidFile = path.join(root, 'owned-pids.json');
  const hostPath = path.resolve(__dirname, '..', 'electron', 'harness-process-host.cjs');
  fs.writeFileSync(fakeHarness, [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, shell: false, stdio: 'ignore' });",
    "fs.writeFileSync(process.env.DSH_TEST_PID_FILE, JSON.stringify({ dsh: process.pid, grandchild: grandchild.pid }));",
    "process.on('message', (message) => process.send?.({ source: 'harness', message }));",
    "process.stdout.write('dsh web: http://127.0.0.1:48001\\n');",
    'setInterval(() => {}, 1000);'
  ].join('\n'));
  let output = '';
  let ownedPids = null;
  const host = spawnProcess(process.execPath, [hostPath, fakeHarness, 'web'], {
    cwd: root,
    env: { ...process.env, DSH_TEST_PID_FILE: pidFile },
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  host.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  context.after(async () => {
    await killExactProcessTree(host.pid);
    for (const pid of Object.values(ownedPids || {})) await killExactProcessTree(pid);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitUntil(() => fs.existsSync(pidFile) && output.includes('http://127.0.0.1:48001'), 5000);
  ownedPids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(processIsAlive(ownedPids.dsh), true);
  assert.equal(processIsAlive(ownedPids.grandchild), true);

  const echoed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for proxied Harness IPC.')), 3000);
    host.once('message', (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
  host.send({ operation: 'credential-status', requestId: 'watchdog-test' });
  assert.deepEqual(await echoed, {
    source: 'harness',
    message: { operation: 'credential-status', requestId: 'watchdog-test' }
  });

  host.stdin.end();
  const exit = await waitForProcessExit(host, 12000);
  await waitUntil(() => !processIsAlive(ownedPids.dsh) && !processIsAlive(ownedPids.grandchild), 5000);
  assert.deepEqual(exit, { code: 0, signal: null });
});

test('process host removes a chatty Harness tree when the desktop output pipe breaks', {
  skip: process.platform !== 'win32',
  timeout: 20000
}, async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-process-host-output-watchdog-test-'));
  const fakeHarness = path.join(root, 'fake-chatty-harness.cjs');
  const pidFile = path.join(root, 'owned-pids.json');
  const hostPath = path.resolve(__dirname, '..', 'electron', 'harness-process-host.cjs');
  fs.writeFileSync(fakeHarness, [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, shell: false, stdio: 'ignore' });",
    "fs.writeFileSync(process.env.DSH_TEST_PID_FILE, JSON.stringify({ dsh: process.pid, grandchild: grandchild.pid }));",
    "setInterval(() => process.stdout.write('x'.repeat(65536)), 1);"
  ].join('\n'));
  let ownedPids = null;
  const host = spawnProcess(process.execPath, [hostPath, fakeHarness, 'web'], {
    cwd: root,
    env: { ...process.env, DSH_TEST_PID_FILE: pidFile },
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  host.stderr.resume();
  context.after(async () => {
    await killExactProcessTree(host.pid);
    for (const pid of Object.values(ownedPids || {})) await killExactProcessTree(pid);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await waitUntil(() => fs.existsSync(pidFile), 5000);
  ownedPids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
  assert.equal(processIsAlive(ownedPids.dsh), true);
  assert.equal(processIsAlive(ownedPids.grandchild), true);
  host.stdout.destroy();

  const exit = await waitForProcessExit(host, 12000);
  await waitUntil(() => !processIsAlive(ownedPids.dsh) && !processIsAlive(ownedPids.grandchild), 5000);
  assert.equal(exit.code, 70);
});

test('output and exit events from an old generation cannot corrupt the next start', async (context) => {
  const firstChild = createFakeChild(44004);
  const secondChild = createFakeChild(45005);
  const children = [firstChild, secondChild];
  const { root, supervisor } = createSupervisorFixture({
    spawnImpl: () => children.shift(),
    stopTree: async (ownedChild) => queueMicrotask(() => ownedChild.emitExit(null, 'SIGTERM'))
  });
  context.after(async () => {
    await supervisor.stop().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const firstStart = supervisor.start();
  await waitUntil(() => supervisor.child === firstChild);
  firstChild.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:46001\n'));
  assert.equal(await firstStart, 'http://127.0.0.1:46001');
  const staleStdoutListener = firstChild.stdout.listeners('data')[0];
  const staleExitListener = firstChild.listeners('exit')[0];
  await supervisor.stop();

  const secondStart = supervisor.start();
  await waitUntil(() => supervisor.child === secondChild);
  staleStdoutListener(Buffer.from('dsh web: http://127.0.0.1:46999\n'));
  staleExitListener(17, null);

  assert.equal(supervisor.child, secondChild);
  assert.equal(supervisor.getState().status, 'starting');
  assert.equal(supervisor.getState().url, null);
  secondChild.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:46002\n'));
  assert.equal(await secondStart, 'http://127.0.0.1:46002');
});

test('a failed process-tree stop rejects and retains an accurate failed/owned-child state', async (context) => {
  const child = createFakeChild(46006);
  const stopError = new Error('taskkill failed');
  const { root, supervisor } = createSupervisorFixture({
    spawnImpl: () => child,
    stopTree: async () => { throw stopError; }
  });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const startPromise = supervisor.start();
  await waitUntil(() => supervisor.child === child);
  child.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:47001\n'));
  await startPromise;

  await assert.rejects(supervisor.stop(), (error) => error === stopError);
  assert.equal(supervisor.child, child);
  assert.equal(supervisor.getState().status, 'failed');
  assert.equal(supervisor.getState().pid, child.pid);
  assert.match(supervisor.getState().error, /taskkill failed/);
});

test('supervisor launches Harness in the selected workspace directory', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-cwd-test-'));
  const workspace = path.join(root, 'selected-workspace');
  const outputFile = path.join(root, 'cwd.txt');
  const argsFile = path.join(root, 'args.json');
  const envFile = path.join(root, 'env.json');
  const fakeHarness = path.join(root, 'dsh', 'lib', 'fake-harness.cjs');
  const patchPath = path.join(root, 'desktop.patch.yml');
  fs.mkdirSync(workspace, { recursive: true });
  writeHarnessPackage(fakeHarness, [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.DSH_TEST_CWD_FILE, process.cwd());",
    "fs.writeFileSync(process.env.DSH_TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));",
    "fs.writeFileSync(process.env.DSH_TEST_ENV_FILE, JSON.stringify({ bundled: process.env.DSH_BUNDLED_SKILL_DIR, docx: process.env.DSH_DESKTOP_DOCX_TOOL, xlsx: process.env.DSH_DESKTOP_XLSX_TOOL, pptx: process.env.DSH_DESKTOP_PPTX_TOOL, wiki: process.env.DSH_DESKTOP_WIKI_TOOL, wikiConfig: process.env.DSH_DESKTOP_WIKI_CONFIG, wikiHistorySource: process.env.DSH_DESKTOP_WIKI_HISTORY_SOURCE, node: process.env.DSH_DESKTOP_NODE }));",
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
      DSH_DESKTOP_WIKI_CONFIG: 'C:\\untrusted-wiki-config.json',
      DSH_DESKTOP_WIKI_HISTORY_SOURCE: 'C:\\untrusted-history-source.json'
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
    wikiHistorySource: path.join(root, 'wiki-history-source.json'),
    node: process.execPath
  });
});
