const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('V1 license inventory is fixed to the packaged Harness and desktop runtime', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'generate-third-party-licenses.cjs'), 'utf8');
  const inventory = fs.readFileSync(path.join(root, 'docs', 'THIRD_PARTY_LICENSES.md'), 'utf8');
  assert.match(script, /harness-hoisted-0\.1\.2-alpha\.2/);
  assert.match(script, /Expected 533 packaged JavaScript packages/);
  assert.match(inventory, /@deepseek-ai\/dsh@0\.1\.2-alpha\.2/);
  assert.match(inventory, /JavaScript packages inventoried: \*\*533\*\*/);
  assert.match(inventory, /no package in this fixed set is missing a declared license identifier/);
  assert.match(inventory, /Node\.js: `v24\.19\.0`/);
  assert.match(inventory, /Electron: `43\.4\.1`/);
});
