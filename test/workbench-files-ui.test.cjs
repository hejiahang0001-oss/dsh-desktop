const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const filesScript = fs.readFileSync(path.join(root, 'assets', 'workbench-files.js'), 'utf8');
const filesCss = fs.readFileSync(path.join(root, 'assets', 'workbench-files.css'), 'utf8');
const reviewScript = fs.readFileSync(path.join(root, 'assets', 'workbench-panel.js'), 'utf8');

test('workspace file UI stays read-only and uses the bounded preload surface', () => {
  assert.match(filesScript, /api\.files\.list/);
  assert.match(filesScript, /api\.files\.read/);
  assert.match(filesScript, /api\.files\.search/);
  assert.match(filesScript, /textContent/);
  assert.match(filesScript, /name: entry\.path/);
  assert.match(filesScript, /window\.__DSH_FILES__/);
  assert.doesNotMatch(filesScript, /innerHTML|eval\(|writeFile|unlink|rename/);
});

test('workspace file UI exposes accessible layout and Diff reveal hooks', () => {
  assert.match(filesCss, /forced-colors: active/);
  assert.match(filesCss, /prefers-reduced-motion: reduce/);
  assert.match(filesCss, /data-dsh-files-open/);
  assert.match(reviewScript, /查看文件/);
  assert.match(reviewScript, /__DSH_FILES__\?\.reveal/);
});
