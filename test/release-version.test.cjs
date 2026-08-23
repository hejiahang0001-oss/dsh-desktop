const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('release-facing files follow the package version', () => {
  const manifest = JSON.parse(read('package.json'));
  const version = manifest.version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(fs.existsSync(path.join(root, 'docs', `RELEASE_NOTES_v${version}.md`)), true);
  assert.match(read('README.md'), new RegExp(`DSH-Desktop-Setup-${version.replaceAll('.', '\\.')}`));
  assert.match(read('PROGRESS.md'), new RegExp(`V${version.replaceAll('.', '\\.')}`));
});
