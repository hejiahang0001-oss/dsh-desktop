const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('V1 license inventory is fixed to the packaged Harness and desktop runtime', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'generate-third-party-licenses.cjs'), 'utf8');
  const inventory = fs.readFileSync(path.join(root, 'docs', 'THIRD_PARTY_LICENSES.md'), 'utf8');
  assert.match(script, /harness-hoisted-0\.1\.5-rc\.2/);
  assert.match(script, /Expected 537 packaged JavaScript manifest identities/);
  assert.match(inventory, /@deepseek-ai\/dsh@0\.1\.5-rc\.2/);
  assert.match(inventory, /Physical JavaScript manifest identities inventoried: \*\*537\*\*/);
  assert.match(inventory, /pdfjs-dist@6\.3\.289/);
  assert.match(script, /pdfNotices\.some/);
  assert.match(inventory, /no package in this fixed set is missing a declared license identifier/);
  assert.match(inventory, /Node\.js: `v24\.19\.0`/);
  assert.match(inventory, /Electron: `43\.4\.1`/);
});
