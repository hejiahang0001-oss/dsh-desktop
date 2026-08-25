const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'validate-controlled-plugin-install.cjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('real controlled plugin validator is isolated, fixed-version, and rollback-gated', () => {
  assert.equal(manifest.scripts['validate:controlled-plugin-install'], 'node scripts/validate-controlled-plugin-install.cjs');
  assert.match(source, /requireEmptyDirectory/);
  assert.match(source, /CATALOG_ID = 'catppuccin-0\.3\.1'/);
  assert.match(source, /DEEPSEEK_API_KEY: CREDENTIAL_MARKER/);
  assert.match(source, /credentialIsolated/);
  assert.match(source, /fixedPnpmPath/);
  assert.match(source, /manager\.rollback\(transaction\.id\)/);
  assert.match(source, /assert\.deepEqual\(after, before/);
  assert.doesNotMatch(source, /packageSpec|process\.argv.*package|pnpmArgs/);
});
