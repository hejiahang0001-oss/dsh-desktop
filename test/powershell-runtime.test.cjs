const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { inspectPowerShellRuntime, resolvePowerShellRuntime } = require('../electron/powershell-runtime.cjs');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lulu-private-pwsh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payload = path.join(root, 'payload');
  fs.mkdirSync(payload);
  const names = ['pwsh.exe', 'LICENSE.txt', 'ThirdPartyNotices.txt', 'pwsh.runtimeconfig.json'];
  const entries = names.map((name) => {
    const bytes = Buffer.from(`fixture:${name}`);
    fs.writeFileSync(path.join(payload, name), bytes);
    return { path: name, size: bytes.length, sha256: digest(bytes) };
  });
  const profile = { version: '7.6.6', executableSha256: entries[0].sha256 };
  const writeManifest = () => {
    const bytes = JSON.stringify(entries);
    fs.writeFileSync(path.join(payload, 'runtime-manifest.json'), bytes);
    profile.manifestSha256 = digest(bytes);
  };
  writeManifest();
  return { root, payload, entries, profile, writeManifest };
};

test('private PowerShell verifies the complete pinned payload without executing it', (t) => {
  const f = fixture(t);
  const result = inspectPowerShellRuntime(f.payload, f.profile);
  assert.equal(result.version, '7.6.6');
  assert.equal(result.executable, path.join(f.payload, 'pwsh.exe'));
  assert.equal(result.fileCount, 4);
  assert.equal(result.bytes, f.entries.reduce((sum, entry) => sum + entry.size, 0));
});

for (const [name, change] of [
  ['changed executable', (f) => fs.writeFileSync(path.join(f.payload, 'pwsh.exe'), 'altered')],
  ['missing license', (f) => fs.unlinkSync(path.join(f.payload, 'LICENSE.txt'))],
  ['unexpected DLL', (f) => fs.writeFileSync(path.join(f.payload, 'unexpected.dll'), 'extra')],
  ['untrusted manifest', (f) => fs.appendFileSync(path.join(f.payload, 'runtime-manifest.json'), ' ')],
  ['manifest parent traversal', (f) => { f.entries[1].path = '../outside'; f.writeManifest(); }],
  ['case-colliding manifest', (f) => { f.entries.push({ ...f.entries[0], path: 'PWSH.EXE' }); f.writeManifest(); }],
  ['alternate stream', (f) => { f.entries[1].path = 'LICENSE.txt:stream'; f.writeManifest(); }],
  ['reserved filename', (f) => { f.entries[1].path = 'AUX.txt'; f.writeManifest(); }],
  ['unbound executable hash', (f) => { f.profile.executableSha256 = '0'.repeat(64); }],
  ['missing trusted profile digest', (f) => { delete f.profile.manifestSha256; }],
]) {
  test(`private PowerShell rejects ${name}`, (t) => {
    const f = fixture(t); change(f);
    assert.throws(() => inspectPowerShellRuntime(f.payload, f.profile), { code: 'POWERSHELL_RUNTIME_INVALID' });
  });
}

test('private PowerShell refuses hard-linked payload files', (t) => {
  const f = fixture(t);
  fs.linkSync(path.join(f.payload, 'pwsh.exe'), path.join(f.root, 'outside.exe'));
  assert.throws(() => inspectPowerShellRuntime(f.payload, f.profile), { code: 'POWERSHELL_RUNTIME_INVALID' });
});

test('private PowerShell refuses a linked payload root', (t) => {
  const f = fixture(t), linked = path.join(f.root, 'linked');
  fs.symlinkSync(f.payload, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => inspectPowerShellRuntime(linked, f.profile), { code: 'POWERSHELL_RUNTIME_INVALID' });
});

test('private PowerShell reads payloads through bounded verified descriptors', (t) => {
  const f = fixture(t), unbounded = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...args) => {
    assert.notEqual(file, path.join(f.payload, 'pwsh.exe'), 'Payload must not be read through an unbounded path read');
    return unbounded(file, ...args);
  });
  assert.equal(inspectPowerShellRuntime(f.payload, f.profile).fileCount, 4);
});

test('private PowerShell rejects payload growth during descriptor reads', (t) => {
  const f = fixture(t), read = fs.readSync, target = path.join(f.payload, 'pwsh.exe');
  const inode = fs.statSync(target).ino;
  let changed = false;
  t.mock.method(fs, 'readSync', (fd, ...args) => {
    if (!changed && fs.fstatSync(fd).ino === inode) { changed = true; fs.appendFileSync(target, 'growth'); }
    return read(fd, ...args);
  });
  assert.throws(() => inspectPowerShellRuntime(f.payload, f.profile), { code: 'POWERSHELL_RUNTIME_INVALID' });
  assert.equal(changed, true);
});

test('private PowerShell resolution has no environment or PATH fallback', (t) => {
  const f = fixture(t);
  assert.throws(() => resolvePowerShellRuntime({ rootDir: f.root, resourcesPath: f.payload, isPackaged: false }), { code: 'POWERSHELL_RUNTIME_INVALID' });
  assert.throws(() => resolvePowerShellRuntime({ rootDir: f.payload, resourcesPath: f.root, isPackaged: true }), { code: 'POWERSHELL_RUNTIME_INVALID' });
});

test('packaging binds the trusted PowerShell profile separately from the complete private payload', () => {
  const manifest = require('../package.json');
  assert.ok(manifest.build.files.includes('runtime/powershell/profile.json'));
  assert.deepEqual(manifest.build.extraResources.filter(entry => entry.to.startsWith('powershell/')), [
    { from: 'vendor/powershell/7.6.6/win32-x64', to: 'powershell/7.6.6/win32-x64' }
  ]);
});
