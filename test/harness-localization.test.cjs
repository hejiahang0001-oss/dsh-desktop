const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'assets', 'harness-localization.js'), 'utf8');
const patch = fs.readFileSync(path.join(root, 'config', 'dsh-desktop.patch.yml'), 'utf8');

test('Harness localization covers the remaining visible upstream English labels', () => {
  assert.match(script, /\['Session log', '\u4f1a\u8bdd\u65e5\u5fd7'\]/);
  assert.match(script, /\['Think', '\u601d\u8003'\]/);
  assert.match(script, /\['Thinking', '\u6b63\u5728\u601d\u8003'\]/);
  assert.match(script, /\['\(no output\)', '\uff08\u65e0\u8f93\u51fa\uff09'\]/);
  assert.match(script, /aria-label/);
});

test('Harness localization never rewrites executable or editable text surfaces', () => {
  assert.match(script, /code, pre, kbd, samp/);
  assert.match(script, /contenteditable/);
  assert.doesNotMatch(script, /innerHTML|eval\(/);
});

test('desktop prompt patch keeps code and raw output intact while localizing generated UI text', () => {
  assert.match(patch, /visible reasoning traces/);
  assert.match(patch, /tool-call descriptions and summaries/);
  assert.match(patch, /Preserve code, commands, file paths/);
  assert.match(patch, /raw tool output in their original form/);
});
