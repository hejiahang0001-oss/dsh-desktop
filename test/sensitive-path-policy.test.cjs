const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SENSITIVE_PATHSPECS,
  isRestrictedPath
} = require('../electron/sensitive-path-policy.cjs');

test('sensitive path policy checks every normalized path component case-insensitively', () => {
  const restricted = [
    '.env',
    'config/.env.local',
    'secrets/token.txt',
    'src/CrEdEnTiAlS/api.txt',
    'keys/id_ed25519.pub',
    'certificates/client.PFX',
    'nested/.npmrc'
  ];
  for (const value of restricted) assert.equal(isRestrictedPath(value), true, value);
  assert.equal(isRestrictedPath('src/client.ts'), false);
  assert.equal(isRestrictedPath('docs/secretary-notes.md'), false);
  assert.equal(isRestrictedPath('src/environment.js'), false);
});

test('checkpoint exclusions are exported by the shared policy', () => {
  assert.ok(SENSITIVE_PATHSPECS.includes(':(exclude,glob,icase)**/.env.*'));
  assert.ok(SENSITIVE_PATHSPECS.includes(':(exclude,glob,icase)**/credentials/**'));
  assert.ok(SENSITIVE_PATHSPECS.includes(':(exclude,glob,icase)**/*.key'));
  assert.equal(SENSITIVE_PATHSPECS.includes(':(exclude,glob)**/credentials*'), false);
  assert.equal(SENSITIVE_PATHSPECS.includes(':(exclude,glob)**/secret*'), false);
  assert.equal(Object.isFrozen(SENSITIVE_PATHSPECS), true);
});
