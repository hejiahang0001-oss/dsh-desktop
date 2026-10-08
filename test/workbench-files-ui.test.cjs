const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const filesScript = fs.readFileSync(path.join(root, 'assets', 'workbench-files.js'), 'utf8');
const filesCss = fs.readFileSync(path.join(root, 'assets', 'workbench-files.css'), 'utf8');
const reviewScript = fs.readFileSync(path.join(root, 'assets', 'workbench-panel.js'), 'utf8');

test('desktop file preload exposes only search and guarded official preview navigation', async () => {
  let desktopAPI;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8'), {
    process: { isMainFrame: false },
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, 'desktopAPI'); desktopAPI = api; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return { available: true }; } },
        webUtils: {}
      };
    }
  });
  assert.deepEqual(Object.keys(desktopAPI.files).sort(), ['resolvePreview', 'search']);
  assert.equal(Object.isFrozen(desktopAPI.files), true);
  const request = { path: '中文.md', sessionId: 'session-test', workspacePath: 'C:/workspace' };
  await desktopAPI.files.search('中文');
  await desktopAPI.files.resolvePreview(request);
  assert.deepEqual(calls, [['files:search', '中文'], ['files:resolve-preview', request]]);
});

test('workspace file UI stays read-only and uses the bounded preload surface', () => {
  assert.doesNotMatch(filesScript, /api\.files\.list/);
  assert.match(filesScript, /普通文件浏览请使用官方右侧文件面板/);
  assert.doesNotMatch(filesScript, /api\.files\.read/);
  assert.match(filesScript, /api\.files\.search/);
  assert.doesNotMatch(filesScript, /api\.files\.preview/);
  assert.match(filesScript, /__DSH_OFFICIAL_FILES__/);
  assert.match(filesScript, /bridge\.openFile\(pathValue, workspace\.activePath\)/);
  assert.match(filesScript, /textContent/);
  assert.match(filesScript, /name: entry\.path/);
  assert.match(filesScript, /window\.__DSH_FILES__/);
  assert.doesNotMatch(filesScript, /innerHTML|eval\(|writeFile|unlink|rename/);
});

test('workspace file UI retires the duplicate document viewer and reports official navigation failures', () => {
  assert.doesNotMatch(filesScript, /create\('embed'|createObjectURL|PDF 页码|dsh-file-preview/);
  assert.doesNotMatch(filesCss, /dsh-file-preview/);
  assert.match(filesScript, /官方文件面板尚未就绪/);
  assert.match(filesScript, /request !== previewRequest/);
  assert.match(filesScript, /内容加载状态请查看该面板/);
});

test('workspace file UI exposes accessible layout and Diff reveal hooks', () => {
  assert.match(filesCss, /forced-colors: active/);
  assert.match(filesCss, /prefers-reduced-motion: reduce/);
  assert.match(filesCss, /data-dsh-files-open/);
  assert.match(reviewScript, /查看文件/);
  assert.match(reviewScript, /__DSH_FILES__\?\.reveal/);
});

test('official fullscreen file controls respect desktop side and bottom insets', () => {
  const layout = fs.readFileSync(path.join(root, 'assets', 'workbench-native-layout.css'), 'utf8');
  assert.match(layout, /\[data-sidebar-right-panel="fullscreen"\]/);
  // The official fullscreen column can be zero-width. Insets therefore belong
  // to the explicit viewport width; its frame already excludes the bottom dock.
  assert.match(layout, /--dsh-sidebar-left-inset: var\(--dsh-files-width\)/);
  assert.match(layout, /--dsh-sidebar-right-inset: var\(--dsh-review-width\)/);
  assert.match(layout, /width: calc\(100vw - var\(--dsh-sidebar-left-inset\) - var\(--dsh-sidebar-right-inset\)\) !important/);
  assert.match(layout, /height: calc\(100dvh - var\(--dsh-native-dock-height, 0px\)\) !important/);
  const rule = layout.match(/\[data-sidebar-right-panel="fullscreen"\]\s*\{([^}]+)\}/)?.[1];
  assert.match(rule, /left: auto !important/);
  assert.match(rule, /right: 0 !important/);
  assert.match(rule, /bottom: 0 !important/);
});
