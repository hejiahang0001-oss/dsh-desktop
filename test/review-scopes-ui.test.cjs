const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('review UI binds four explicit scopes and native guarded comment operations', () => {
  const ui = read('assets/workbench-panel.js'), main = read('electron/main.cjs'), preload = read('electron/preload.cjs');
  for (const key of ['unstaged', 'staged', 'branch', 'last-turn']) assert.ok(ui.includes(key));
  for (const key of ['reviews:list', 'reviews:diff', 'reviews:add-comment', 'reviews:remove-comment', 'reviews:list-comments', 'reviews:prompt']) assert.ok(preload.includes(key));
  assert.match(main, /if \(!harnessIpcAllowed\(event\)\) throw new Error\('审查操作/);
  assert.match(main, /last\?\.source !== 'automatic'/);
  assert.match(ui, /state\.context !== result\.context/);
  assert.match(ui, /commentText\.maxLength = 2000/);
  assert.match(ui, /setAttribute\('aria-label', '审查范围'\)/);
  assert.match(ui, /Escape/);
  assert.doesNotMatch(ui, /innerHTML\s*=|session\.prompt|invoke\('session/);
});
