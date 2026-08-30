const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
test('native tools use independent sandboxed views and the bar has a closed IPC surface', () => {
  const code = read('electron/native-workbench-dock.cjs');
  assert.match(code, /contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true/);
  assert.match(code, /will-frame-navigate/); assert.match(code, /render-process-gone/); assert.match(code, /'destroyed'/);
  assert.match(code, /surface\.view/); assert.doesNotMatch(read('electron/dock-preload.cjs'), /terminal:write|exec|shell\./);
  assert.match(read('electron/main.cjs'), /dockIpcAllowed = \(event\) => isTrustedMainFrameEvent/);
  assert.match(read('assets/workbench-dock.js'), /aria-label/); assert.match(read('assets/workbench-dock.css'), /focus-visible/);
});
test('the native workbench and fixed read-only plugin are packaged, not remote shell bridges', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.ok(manifest.build.files.includes('workbench-dock.html'));
  assert.ok(manifest.build.extraResources.some((item) => item.from === 'runtime/dsh-desktop-tools'));
  const tool = read('runtime/dsh-desktop-tools/index.mjs');
  assert.match(tool, /session\.header\.cwd/); assert.match(tool, /desktop_terminal_read/);
  assert.doesNotMatch(tool, /child_process|execFile\s*\(|clipboard\.(?:read|write)|writeFile\s*\(/);
  assert.match(read('electron/harness-supervisor.cjs'), /DSH_DESKTOP_TOOL_MODULE/);
});
