const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('context source window is local-only, read-only, and packaged', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/context-sources-preload.cjs');
  const renderer = read('assets/context-sources.js');
  const manifest = JSON.parse(read('package.json'));
  assert.match(main, /contextSourcesIpcAllowed/);
  assert.match(
    main,
    /isTrustedMainFrameEvent\(\s*event,\s*contextSourcesWindow\?\.webContents,\s*contextSourcesUrlAllowed\s*\)/
  );
  assert.match(main, /label: '上下文来源…'/);
  assert.match(main, /--context-sources-smoke-file=/);
  assert.match(main, /runContextSourcesSmoke/);
  assert.match(main, /!rendered\.text\.includes\('hidden-rule-prose-marker'\)/);
  assert.match(main, /shell\.showItemInFolder\(target\)/);
  assert.match(preload, /context-sources:get-state/);
  assert.match(preload, /context-sources:refresh/);
  assert.match(preload, /context-sources:reveal/);
  assert.doesNotMatch(preload, /readFile|writeFile|shell|ipcRenderer\.send/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /内容去重、总预算省略和截断由 Harness 决定/);
  assert.match(renderer, /超过 1 MiB，Harness 忽略/);
  assert.doesNotMatch(renderer, /innerHTML|eval\(/);
  for (const asset of ['context-sources.html', 'assets/context-sources.css', 'assets/context-sources.js']) {
    assert.ok(manifest.build.files.includes(asset), asset);
  }
});
