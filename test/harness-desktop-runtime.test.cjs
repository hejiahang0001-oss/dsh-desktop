'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const official = require('../runtime/harness-official/runtime-tree.cjs');
const product = require('../electron/harness-desktop-runtime.cjs');
const root = path.resolve(__dirname, '..');
const moduleFile = path.join(root, 'electron/harness-desktop-runtime.cjs');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const invalid = { code: 'HARNESS_DESKTOP_RUNTIME_INVALID' };

// Tiny fixtures substitute application code's pin in an isolated module realm;
// the public production API intentionally accepts no profile/override argument.
function loadFixtureBridge(profile, verifier = official) {
  const result = { exports: {} };
  const localRequire = createRequire(moduleFile);
  const fixtureRequire = name => name === '../runtime/harness/package.json' ? profile
    : name === '../runtime/harness-official/runtime-tree.cjs' ? verifier : localRequire(name);
  vm.runInNewContext('(function(require,module,exports){' + fs.readFileSync(moduleFile, 'utf8') + '\n})', {
    Buffer, structuredClone
  }, { filename: moduleFile })(fixtureRequire, result, result.exports);
  return result.exports;
}

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-runtime-binding-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const runtime = path.join(parent, 'runtime');
  const write = (relative, value) => {
    const target = path.join(runtime, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value) + '\n');
  };
  const version = product.HARNESS_VERSION;
  write('package.json', { name: '@deepseek-ai/dsh-desktop-runtime', version, dependencies: { '@deepseek-ai/dsh': version } });
  write('node_modules/@deepseek-ai/dsh/package.json', { name: '@deepseek-ai/dsh', version });
  write('node_modules/@deepseek-ai/dsh/lib/bin.js', 'export const fixture = true;\n');
  write('node_modules/@deepseek-ai/dsh/lib/extra.js', 'export const other = true;\n');
  write('node_modules/@deepseek-ai/dsh-desktop-host/package.json', { name: '@deepseek-ai/dsh-desktop-host', version });
  const descriptor = official.writeDesktopRuntime(runtime, {
    schemaVersion: 1, version, nodeVersion: '24.19.0', pnpmVersion: '11.7.0', hostProtocolVersion: 4
  }, ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host'], { platform: 'win32', arch: 'x64' });
  const profile = structuredClone(require('../runtime/harness/package.json'));
  const pin = () => { profile.dshDesktop.descriptor.sha256 = sha256(fs.readFileSync(path.join(runtime, 'desktop-runtime.json'))); };
  pin();
  const editDescriptor = change => { change(descriptor); write('desktop-runtime.json', JSON.stringify(descriptor, null, 2) + '\n'); pin(); };
  return { parent, runtime, profile, descriptor, write, editDescriptor, bridge: () => loadFixtureBridge(profile) };
}

test('product candidate pin is exact, deeply frozen and separate from preparation promotion', () => {
  assert.equal(product.HARNESS_VERSION, '0.2.1-alpha.1');
  assert.equal(product.HARNESS_RUNTIME_DIRECTORY, 'harness-desktop-0.2.1-alpha.1-attachment-1');
  assert.equal(product.PRODUCT_BINDING.descriptor.sha256, 'b0692fff88311e8cc326b7a7792b8e66620716176f3865c9a188dbaffcff82a7');
  assert.equal(product.PRODUCT_BINDING.node.sha256, '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237');
  assert.equal(product.PRODUCT_BINDING.powerShell.version, '7.6.6');
  assert.ok(Object.isFrozen(product.PRODUCT_BINDING.descriptor));
  assert.equal(require('../runtime/harness-021-candidate/profile.json').promotionAllowed, false);
});

test('official CJS artifact and retained upstream sources match their reviewed build record', () => {
  const directory = path.join(root, 'runtime/harness-official');
  const record = JSON.parse(fs.readFileSync(path.join(directory, 'build-manifest.json')));
  assert.equal(record.upstream.commit, product.PRODUCT_BINDING.commit);
  for (const [name, expected] of Object.entries(record.sourceHashes)) {
    assert.equal(sha256(fs.readFileSync(path.join(directory, 'sources', name))), expected);
  }
  for (const output of record.outputs) assert.equal(sha256(fs.readFileSync(path.join(directory, output.file))), output.sha256);
  for (const [name, expected] of Object.entries(record.licenses)) assert.equal(sha256(fs.readFileSync(path.join(directory, name))), expected);
  const sourceMap = JSON.parse(fs.readFileSync(path.join(directory, 'runtime-tree.cjs.map')));
  assert.equal(sourceMap.sources.length, record.inputs.length);
  assert.equal(sourceMap.sourcesContent.length, sourceMap.sources.length);
  const retained = new Map(sourceMap.sources.map((source, i) => [source, sha256(Buffer.from(sourceMap.sourcesContent[i]))]));
  for (const input of record.inputs) assert.equal(retained.get(input.file), input.sha256);
  assert.match(fs.readFileSync(path.join(directory, 'LICENSE.deepseek.txt'), 'utf8'), /Copyright \(c\) 2026 DeepSeek/);
  assert.match(fs.readFileSync(path.join(directory, 'LICENSE.semver.txt'), 'utf8'), /The ISC License/);
});

test('lightweight identity read and official full verification accept a relocated exact runtime', async t => {
  const f = fixture(t), bridge = f.bridge();
  const identity = bridge.readHarnessDesktopRuntime(f.runtime);
  assert.equal(identity.version, product.HARNESS_VERSION);
  assert.equal(identity.dshBinPath, path.join(f.runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'));
  assert.equal(identity.manifest.name, '@deepseek-ai/dsh');
  assert.ok(Object.isFrozen(identity.descriptor.files));
  const relocated = path.join(f.parent, 'relocated');
  fs.renameSync(f.runtime, relocated);
  assert.equal((await bridge.verifyHarnessDesktopRuntime(relocated)).verified, true);
});

for (const [name, change] of [
  ['untrusted descriptor', f => fs.appendFileSync(path.join(f.runtime, 'desktop-runtime.json'), ' ')],
  ['changed root manifest', f => f.write('package.json', '{}')],
  ['changed dsh manifest', f => f.write('node_modules/@deepseek-ai/dsh/package.json', '{}')],
  ['changed CLI', f => f.write('node_modules/@deepseek-ai/dsh/lib/bin.js', 'changed')],
  ['missing CLI', f => fs.unlinkSync(path.join(f.runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'))],
  ['wrong release', f => f.editDescriptor(d => { d.release.version = '0.1.6-alpha.2'; })],
  ['wrong host protocol', f => f.editDescriptor(d => { d.release.hostProtocolVersion = 3; })],
  ['wrong Node', f => f.editDescriptor(d => { d.release.nodeVersion = '24.18.0'; })],
  ['wrong platform', f => f.editDescriptor(d => { d.platform = 'linux'; })],
  ['parent traversal', f => f.editDescriptor(d => { d.files[0].path = '../outside'; })],
  ['alternate stream', f => f.editDescriptor(d => { d.files[0].path = 'package.json:stream'; })],
  ['reserved device', f => f.editDescriptor(d => { d.files[0].path = 'node_modules/AUX.txt'; })],
  ['case-colliding ancestor', f => f.editDescriptor(d => { d.files[0].path = d.files[0].path.replace('node_modules', 'NODE_MODULES'); })],
  ['case-colliding file', f => f.editDescriptor(d => { d.files.push({ ...d.files[0], path: d.files[0].path.toUpperCase() }); })],
  ['oversized declaration', f => f.editDescriptor(d => { d.files[0].bytes = 3 * 1024 * 1024 * 1024; })]
]) {
  test(`runtime identity rejects ${name}`, t => {
    const f = fixture(t); change(f);
    assert.throws(() => f.bridge().readHarnessDesktopRuntime(f.runtime), invalid);
  });
}

for (const [name, change] of [
  ['changed non-CLI payload', f => f.write('node_modules/@deepseek-ai/dsh/lib/extra.js', 'changed')],
  ['missing payload', f => fs.unlinkSync(path.join(f.runtime, 'node_modules/@deepseek-ai/dsh/lib/extra.js'))],
  ['unexpected payload', f => f.write('node_modules/unexpected.js', 'extra')],
  ['hard-linked payload', f => fs.linkSync(path.join(f.runtime, 'node_modules/@deepseek-ai/dsh/lib/extra.js'), path.join(f.parent, 'outside.js'))],
  ['linked payload directory', f => fs.symlinkSync(f.parent, path.join(f.runtime, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')]
]) {
  test(`official full verification rejects ${name}`, async t => {
    const f = fixture(t); change(f);
    await assert.rejects(f.bridge().verifyHarnessDesktopRuntime(f.runtime), invalid);
  });
}

test('runtime identity refuses a linked root or ancestor and a hard-linked CLI', t => {
  const f = fixture(t), linked = path.join(f.parent, 'linked');
  fs.symlinkSync(f.runtime, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.bridge().readHarnessDesktopRuntime(linked), invalid);
  fs.symlinkSync(f.parent, path.join(f.parent, 'ancestor'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.bridge().readHarnessDesktopRuntime(path.join(f.parent, 'ancestor/runtime')), invalid);
  fs.linkSync(path.join(f.runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), path.join(f.parent, 'outside.js'));
  assert.throws(() => f.bridge().readHarnessDesktopRuntime(f.runtime), invalid);
});

test('verification calls the official implementation and rejects a concurrent identity change', async t => {
  const f = fixture(t);
  let calls = 0;
  const bridge = loadFixtureBridge(f.profile, {
    verifyDesktopRuntime: async (...args) => {
      calls += 1;
      assert.equal(args[0], f.runtime);
      assert.equal(args[1], product.HARNESS_VERSION);
      const result = await official.verifyDesktopRuntime(...args);
      f.write('node_modules/@deepseek-ai/dsh/lib/extra.js', 'changed-after-official-read');
      return result;
    }
  });
  await assert.rejects(bridge.verifyHarnessDesktopRuntime(f.runtime), invalid);
  assert.equal(calls, 1);
});

test('lightweight read rejects growth during a bounded descriptor read without exposing paths', t => {
  const f = fixture(t), originalRead = fs.readSync;
  const target = path.join(f.runtime, 'desktop-runtime.json');
  const inode = fs.statSync(target).ino;
  let changed = false;
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    if (!changed && fs.fstatSync(fd).ino === inode) { changed = true; fs.appendFileSync(target, 'growth'); }
    return originalRead(fd, ...args);
  });
  assert.throws(() => f.bridge().readHarnessDesktopRuntime(f.runtime), error => error.code === invalid.code && !error.message.includes(f.parent));
  assert.equal(changed, true);
});
