const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('CI separates quality, production security, and package-data contracts', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /^  quality:/m);
  assert.match(workflow, /^  security:/m);
  assert.match(workflow, /^  package-smoke:/m);
  assert.match(workflow, /pnpm audit --prod --audit-level moderate/);
  assert.match(workflow, /test\/semantic-state-snapshot\.test\.cjs/);
  assert.match(workflow, /test\/release-version\.test\.cjs/);
});
