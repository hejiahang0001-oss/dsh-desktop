const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'validate-third-party-plugin.cjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('real third-party validator is fixed, isolated, credential-free, and scripted', () => {
  assert.equal(manifest.scripts['validate:third-party-plugin'], 'node scripts/validate-third-party-plugin.cjs');
  assert.match(source, /@nonamelego\/dsh-catppuccin/);
  assert.match(source, /version: '0\.3\.0'/);
  assert.match(source, /version: '0\.3\.1'/);
  assert.match(source, /--save-exact/);
  assert.match(source, /--ignore-scripts/);
  assert.match(source, /requireEmptyDirectory/);
  assert.match(source, /credentialsForwarded: false/);
  assert.match(source, /manager\.apply\(\{ profileDir, packageName: PLUGIN, enable: false \}\)/);
  assert.match(source, /name: 'rollback'/);
  assert.match(source, /name: 'final-upgrade'/);
  assert.match(source, /catppuccin\/state/);
  assert.match(source, /EXPECTED_RUNTIME_PACKAGES = 432/);
  assert.doesNotMatch(source, /npm view|latest'|latest\"|process\.env\.DEEPSEEK_API_KEY/);
});
