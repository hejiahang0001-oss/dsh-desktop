const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { resolveHarnessHostModules } = require('../electron/harness-host-modules.cjs');
const { createDesktopCredentialHost } = require('../electron/desktop-credential-host.cjs');

const version = '0.2.1-alpha.1';
const names = { cli: '@deepseek-ai/dsh', tools: '@deepseek-ai/dsh-tools', local: '@deepseek-ai/dsh-credentials-local', provider: '@deepseek-ai/dsh-credentials' };
const invalid = { code: 'HARNESS_HOST_MODULE_INVALID' };
const parserSource = `export function renderFlatLayoutMigration() { return undefined; }
export function parseCredentialsDocument(text) { const d = JSON.parse(text); return { refs: new Map(Object.entries(d.refs || {})), records: new Map(Object.entries(d.records || {})) }; }`;

async function writePackage(dir, name, entry = 'index.js', body = 'throw new Error("resolver must not execute module code");') {
  await fsp.mkdir(path.join(dir, 'lib'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', main: `lib/${entry}`, exports: { '.': `./lib/${entry}`, './package.json': './package.json' } }));
  await fsp.writeFile(path.join(dir, 'lib', entry), body);
  return path.join(dir, 'lib', entry);
}
async function linkPackage(anchor, name, target) {
  const link = path.join(anchor, 'node_modules', name);
  await fsp.mkdir(path.dirname(link), { recursive: true }); await fsp.symlink(target, link, 'junction');
  return link;
}
async function fixture(t, layout) {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-module-boundary-'));
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'runtime'), dirs = {};
  for (const [key, name] of Object.entries(names)) {
    dirs[key] = layout === 'source' ? path.join(root, key === 'cli' ? 'apps/cli' : `packages/${key}`)
      : layout === 'pnpm' ? path.join(root, 'node_modules', '.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules', name)
        : path.join(root, 'node_modules', name);
  }
  const bin = await writePackage(dirs.cli, names.cli, 'bin.js');
  const tools = await writePackage(dirs.tools, names.tools);
  const local = await writePackage(dirs.local, names.local, 'index.js', parserSource);
  const provider = await writePackage(dirs.provider, names.provider);
  if (layout !== 'hoisted') {
    await linkPackage(dirs.cli, names.tools, dirs.tools);
    await linkPackage(dirs.cli, names.local, dirs.local);
    await linkPackage(dirs.local, names.provider, dirs.provider);
  }
  return { parent, root, dirs, bin, tools, local, provider };
}

for (const layout of ['source', 'hoisted', 'pnpm']) test(`${layout} resolves only fixed official modules without executing code`, async t => {
  const f = await fixture(t, layout);
  assert.deepEqual(resolveHarnessHostModules({ dshBinPath: f.bin, credentials: true }), { toolsModule: await fsp.realpath(f.tools), localModule: await fsp.realpath(f.local), providerModule: await fsp.realpath(f.provider) });
  assert.deepEqual(resolveHarnessHostModules({ dshBinPath: f.bin, tools: false }), {});
});

test('pnpm top-level CLI link retains the same closed runtime boundary', async t => {
  const f = await fixture(t, 'pnpm');
  const linked = await linkPackage(f.root, names.cli, f.dirs.cli);
  assert.equal(resolveHarnessHostModules({ dshBinPath: path.join(linked, 'lib/bin.js'), credentials: true }).providerModule, await fsp.realpath(f.provider));
});

test('abstract credentials resolve from the local provider, not a decoy CLI dependency', async t => {
  const f = await fixture(t, 'source');
  const decoy = path.join(f.root, 'packages/decoy'); await writePackage(decoy, names.provider);
  await linkPackage(f.dirs.cli, names.provider, decoy);
  assert.equal(resolveHarnessHostModules({ dshBinPath: f.bin, credentials: true }).providerModule, await fsp.realpath(f.provider));
});

test('unknown CLI layouts and missing binaries fail closed without legacy relative fallback', async t => {
  const f = await fixture(t, 'hoisted');
  for (const bin of [path.join(f.root, 'bin.js'), 'bin.js', path.join(f.dirs.cli, 'lib/absent.js'), path.join(f.dirs.cli, 'lib/bin.js:stream')]) assert.throws(() => resolveHarnessHostModules({ dshBinPath: bin }), invalid);
  await fsp.unlink(f.bin); assert.throws(() => resolveHarnessHostModules({ dshBinPath: f.bin }), invalid);
});

test('CLI or dependency identity/version mismatch is rejected', async t => {
  for (const [target, field, value] of [['cli', 'name', 'evil'], ['cli', 'version', '*'], ['tools', 'name', names.provider], ['tools', 'version', '0.2.1-alpha.2'], ['local', 'name', names.provider], ['provider', 'version', '0.2.1-alpha.2']]) {
    const f = await fixture(t, 'hoisted'), file = path.join(f.dirs[target], 'package.json');
    const data = JSON.parse(await fsp.readFile(file)); data[field] = value; await fsp.writeFile(file, JSON.stringify(data));
    assert.throws(() => resolveHarnessHostModules({ dshBinPath: f.bin, credentials: true }), invalid);
  }
});

test('dependency junction outside the selected runtime is rejected before import', async t => {
  const f = await fixture(t, 'source'), external = path.join(f.parent, 'external'); await writePackage(external, names.tools);
  const link = path.join(f.dirs.cli, 'node_modules', names.tools); await fsp.unlink(link); await fsp.symlink(external, link, 'junction');
  assert.throws(() => resolveHarnessHostModules({ dshBinPath: f.bin }), invalid);
});

test('module entry symlink escaping its own package is rejected, even within the runtime', async t => {
  const f = await fixture(t, 'hoisted'); await fsp.unlink(f.tools); await fsp.symlink(f.provider, f.tools, 'file');
  assert.throws(() => resolveHarnessHostModules({ dshBinPath: f.bin }), invalid);
});

test('ancestor node_modules cannot satisfy a missing runtime dependency', async t => {
  const f = await fixture(t, 'source'); await fsp.unlink(path.join(f.dirs.cli, 'node_modules', names.tools));
  await writePackage(path.join(f.parent, 'node_modules', names.tools), names.tools);
  assert.throws(() => resolveHarnessHostModules({ dshBinPath: f.bin }), invalid);
});

test('NODE_PATH outside the runtime cannot inject an otherwise matching official package', async t => {
  const f = await fixture(t, 'source'); await fsp.unlink(path.join(f.dirs.cli, 'node_modules', names.tools));
  const modules = path.join(f.parent, 'environment-modules'); await writePackage(path.join(modules, names.tools), names.tools);
  const check = `const {resolveHarnessHostModules}=require(${JSON.stringify(require.resolve('../electron/harness-host-modules.cjs'))}); try {resolveHarnessHostModules({dshBinPath:${JSON.stringify(f.bin)}}); process.exitCode=2} catch(e) {process.exitCode=e.code==='HARNESS_HOST_MODULE_INVALID'?0:3}`;
  const result = spawnSync(process.execPath, ['-e', check], { env: { ...process.env, NODE_PATH: modules }, windowsHide: true, timeout: 5000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('missing package entry and manifest fail closed with non-path error text', async t => {
  for (const file of ['lib/index.js', 'package.json']) {
    const f = await fixture(t, 'hoisted'); await fsp.unlink(path.join(f.dirs.tools, file));
    assert.throws(() => resolveHarnessHostModules({ dshBinPath: f.bin }), error => error.code === invalid.code && !error.message.includes(f.parent));
  }
});

test('credential host uses source resolution without changing the existing vault and provider contract', async t => {
  const f = await fixture(t, 'source');
  const homeDir = path.join(f.parent, 'home'), patchPath = path.join(f.parent, 'base.yml'); await fsp.mkdir(homeDir); await fsp.writeFile(patchPath, '- id: original\n');
  const provisions = [], crypto = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
  const host = await createDesktopCredentialHost({ homeDir, runtime: { dshBinPath: f.bin, patchPath }, rootDir: f.parent, isPackaged: false, crypto, provisionPlugin: async p => provisions.push(p) });
  assert.equal(host.providerModule, await fsp.realpath(f.provider)); assert.equal(host.toolsModule, null); assert.equal(host.status().configured, false);
  assert.deepEqual(provisions.map(p => p.expectedName), ['dsh-desktop-credentials']);
  assert.match(await fsp.readFile(host.patchPath, 'utf8'), /disabled: true/);
});

test('invalid credential module fails before vault creation, encryption or plugin provisioning', async t => {
  const f = await fixture(t, 'source'); await fsp.unlink(f.provider);
  const homeDir = path.join(f.parent, 'untouched');
  await assert.rejects(createDesktopCredentialHost({ homeDir, runtime: { dshBinPath: f.bin }, crypto: { isEncryptionAvailable: () => assert.fail('must not open vault') }, provisionPlugin: () => assert.fail('must not provision') }), invalid);
  await assert.rejects(fsp.stat(homeDir), { code: 'ENOENT' });
});
