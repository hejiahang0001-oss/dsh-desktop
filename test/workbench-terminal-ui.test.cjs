const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Harness workbench can only open the isolated terminal window', () => {
  const preload = read('electron/preload.cjs');
  const command = read('assets/workbench-command.js');
  assert.match(preload, /openWindow: \(\) => ipcRenderer\.invoke\('terminal:open-window'\)/);
  assert.doesNotMatch(preload, /terminal:start|terminal:write|terminal:resize|terminal:stop|terminal:output/);
  assert.match(command, /api\.terminal\.openWindow/);
  assert.doesNotMatch(command, /api\.terminal\.(start|write|resize|stop)/);
});

test('trusted local terminal window owns the complete xterm and PTY bridge', () => {
  const html = read('terminal.html');
  const source = read('assets/terminal-window.js');
  const preload = read('electron/terminal-preload.cjs');
  const main = read('electron/main.cjs');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /terminal-window\.js/);
  assert.match(source, /new window\.Terminal/);
  assert.match(source, /screenReaderMode: true/);
  assert.match(source, /api\.start/);
  assert.match(source, /api\.write/);
  assert.match(source, /api\.resize/);
  assert.match(source, /api\.stop/);
  assert.match(source, /snapshot\?\.output/);
  assert.match(source, /软件 Key 不会进入终端/);
  assert.match(source, /PowerShell 终端输入/);
  assert.match(preload, /terminal:start/);
  assert.match(preload, /terminal:write/);
  assert.match(preload, /terminal:resize/);
  assert.match(preload, /terminal:stop/);
  assert.match(main, /terminalIpcAllowed/);
  assert.match(main, /terminalOwnedBy/);
  assert.doesNotMatch(main, /mainWindow\.webContents\.send\('terminal:output'/);
});

test('packaged desktop includes pinned xterm assets and an external Windows node-pty host', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.dependencies['@xterm/xterm'], '6.0.0');
  assert.equal(manifest.dependencies['@xterm/addon-fit'], '0.11.0');
  assert.equal(manifest.dependencies['node-pty'], '1.2.0-beta.15');
  assert.equal(manifest.build.npmRebuild, false);
  assert.ok(manifest.build.files.includes('terminal.html'));
  assert.ok(manifest.build.files.includes('assets/terminal-window.js'));
  assert.ok(manifest.build.files.includes('assets/terminal-window.css'));
  assert.ok(manifest.build.files.includes('node_modules/@xterm/xterm/lib/xterm.js'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.to === 'terminal/terminal-pty-host.cjs'));
  assert.ok(manifest.build.extraResources.some((entry) => entry.to === 'terminal/node_modules/node-pty'));

  const main = read('electron/main.cjs');
  assert.match(main, /resolveTerminalRuntime/);
  assert.match(main, /交互式终端仍在运行/);
  assert.match(main, /terminal\.html/);
  assert.match(main, /terminal-preload\.cjs/);
  assert.doesNotMatch(main, /executeJavaScript\(assets\.xterm/);
});
