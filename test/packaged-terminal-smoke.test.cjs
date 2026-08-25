const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'smoke-packaged-terminal.cjs'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('packaged terminal smoke uses only the external fixed runtime and proves credential isolation', () => {
  assert.equal(manifest.scripts['smoke:packaged-terminal'], 'node scripts/smoke-packaged-terminal.cjs');
  assert.match(source, /resolveTerminalRuntime\(\{ rootDir: path\.join\(resourcesPath, 'app\.asar'\), resourcesPath, isPackaged: true \}\)/);
  assert.match(source, /secret=False/);
  assert.match(source, /second-command/);
  assert.match(source, /info\.isSymbolicLink\(\)/);
  assert.match(source, /credentialIsolated/);
  assert.doesNotMatch(source, /resourcesPath.*node_modules.*node-pty/);
});
