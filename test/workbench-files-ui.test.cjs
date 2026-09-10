const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const filesScript = fs.readFileSync(path.join(root, 'assets', 'workbench-files.js'), 'utf8');
const filesCss = fs.readFileSync(path.join(root, 'assets', 'workbench-files.css'), 'utf8');
const reviewScript = fs.readFileSync(path.join(root, 'assets', 'workbench-panel.js'), 'utf8');

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
  assert.match(layout, /left: var\(--dsh-sidebar-left-inset\) !important/);
  assert.match(layout, /right: var\(--dsh-sidebar-right-inset\) !important/);
  assert.match(layout, /bottom: var\(--dsh-native-dock-height, 0px\) !important/);
  assert.match(layout, /width: auto !important/);
});
