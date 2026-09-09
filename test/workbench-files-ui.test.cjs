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
  assert.match(filesScript, /api\.files\.read/);
  assert.match(filesScript, /api\.files\.search/);
  assert.match(filesScript, /api\.files\.preview/);
  assert.match(filesScript, /textContent/);
  assert.match(filesScript, /name: entry\.path/);
  assert.match(filesScript, /window\.__DSH_FILES__/);
  assert.doesNotMatch(filesScript, /innerHTML|eval\(|writeFile|unlink|rename/);
});

test('workspace file UI has dedicated local image and PDF controls with explicit failure handling', () => {
  assert.match(filesScript, /PNG、JPEG、WebP、GIF 和 PDF|mediaKindForPath/);
  assert.match(filesScript, /适合窗口/);
  assert.match(filesScript, /PDF 页码/);
  assert.match(filesScript, /create\('embed'/);
  assert.match(filesScript, /图片解码失败/);
  assert.match(filesScript, /URL\.revokeObjectURL/);
  assert.match(filesCss, /dsh-file-preview-media/);
  assert.match(filesCss, /dsh-file-preview-pdf/);
  assert.match(filesCss, /dsh-file-preview-page\[hidden\]/);
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
