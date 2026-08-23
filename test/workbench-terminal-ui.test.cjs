const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('interactive terminal UI uses xterm with explicit start, keyboard focus, resize, recovery, and Key isolation copy', () => {
  const source = read('assets/workbench-terminal.js');
  assert.match(source, /new window\.Terminal/);
  assert.match(source, /screenReaderMode: true/);
  assert.match(source, /api\.terminal\.start/);
  assert.match(source, /api\.terminal\.write/);
  assert.match(source, /api\.terminal\.resize/);
  assert.match(source, /api\.terminal\.stop/);
  assert.match(source, /snapshot\?\.output/);
  assert.match(source, /软件 Key 不会进入终端/);
  assert.match(source, /PowerShell 终端输入/);
  assert.doesNotMatch(source, /terminal\.run/);
  assert.doesNotMatch(source, /type = 'text'/);
});

test('packaged desktop includes pinned xterm assets and an external Windows node-pty host', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.version, '0.4.6');
  assert.equal(manifest.dependencies['@xterm/xterm'], '6.0.0');
  assert.equal(manifest.dependencies['@xterm/addon-fit'], '0.11.0');
  assert.equal(manifest.dependencies['node-pty'], '1.2.0-beta.15');
  assert.equal(manifest.build.npmRebuild, false);
  assert.ok(manifest.build.files.includes('node_modules/@xterm/xterm/lib/xterm.js'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.to === 'terminal/terminal-pty-host.cjs'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.to === 'terminal/node_modules/node-pty'));

  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  assert.match(main, /resolveTerminalRuntime/);
  assert.match(main, /交互式终端仍在运行/);
  assert.match(preload, /terminal:start/);
  assert.match(preload, /terminal:write/);
  assert.match(preload, /terminal:resize/);
});
