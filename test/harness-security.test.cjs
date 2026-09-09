const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { digest, policy, renderWorkspace, verifySecurity } = require('../scripts/apply-harness-security.cjs');
const { matchingAdvisories } = require('../scripts/audit-harness-runtime.cjs');

test('security lock is fixed, reviewed, and confined to nine exact-version selectors', () => {
  const bytes = fs.readFileSync(path.join(__dirname, '../runtime/harness-security/pnpm-lock.yaml'));
  assert.equal(digest(bytes), policy.lockSha256);
  assert.equal(Object.keys(policy.overrides).length, 9);
  for (const [selector, fixed] of Object.entries(policy.overrides)) {
    assert.match(selector, /@\d+\.\d+\.\d+$/);
    assert.match(fixed, /^\d+\.\d+\.\d+$/);
    assert.equal(selector.match(/@(\d+)\./)[1], fixed.split('.')[0]);
  }
  assert.throws(() => renderWorkspace(Buffer.from('overrides:\n')), /differs/);
  assert.throws(() => verifySecurity(__dirname), /ENOENT/);
});

test('physical payload audit respects affected ranges rather than matching package name only', () => {
  const advisory = { severity: 'high', vulnerable_versions: '>=7.0.0 <7.29.0', title: 'test' };
  assert.deepEqual(matchingAdvisories({ undici: ['8.10.0'] }, { undici: [advisory] }), []);
  assert.equal(matchingAdvisories({ undici: ['7.28.0', '8.10.0'] }, { undici: [advisory] })[0].versions[0], '7.28.0');
  assert.throws(() => matchingAdvisories({ undici: ['8.10.0'] }, { undici: [{ ...advisory, severity: 'unknown' }] }), /Invalid/);
  assert.throws(() => matchingAdvisories({}, { unexpected: [] }), /Unexpected/);
});
