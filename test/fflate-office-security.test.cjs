const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

test('fixed Office ZIP parser rejects malformed ZIP64 within a bounded child', (t) => {
  const runtime = path.resolve(__dirname, '../vendor/harness-hoisted-0.1.6-alpha.2-desktop-security-1');
  if (!fs.existsSync(path.join(runtime, 'harness-runtime.json'))) {
    t.skip('Run against the assembled, ignored alpha.2 runtime after download.');
    return;
  }
  const load = createRequire(path.join(runtime, 'office-security-gate.cjs'));
  const output = execFileSync(process.execPath, [path.join(__dirname, 'fixtures/fflate-office-probe.cjs'), load.resolve('fflate')], {
    timeout: 5000, windowsHide: true, encoding: 'utf8'
  });
  assert.match(output, /ZIP64 rejected; Chinese ZIP round-trip passed/);
});
