const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');

test('official Harness owns queue, steer and stop interaction', () => {
  const root = 'vendor/harness-source-0.1.2-alpha.5/packages/client/ui-conversation/src/client';
  const inputBar = read(`${root}/skeleton/InputBar.tsx`);
  const inputHub = read(`${root}/input/hub.ts`);
  const submission = read(`${root}/input/submission-policy.ts`);

  assert.match(inputBar, /keyboard\.steerQueue\(\)/);
  assert.match(inputHub, /updateQueue\(item\.id, \{ kind: 'steer' \}\)/);
  assert.match(submission, /BusyEnterBehavior/);
  assert.match(inputBar, /onClick=\{stop\}/);
});

test('desktop does not intercept or reimplement official queue and steer controls', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const manifest = read('package.json');
  const client = read('electron/session-control-client.cjs');
  const host = read('runtime/dsh-desktop-tools/session-control.mjs');
  const smoke = read('electron/session-workflow-smoke.cjs');

  assert.equal(fs.existsSync('electron/harness-reliable-interrupt.cjs'), false);
  assert.equal(fs.existsSync('assets/harness-reliable-interrupt.js'), false);
  assert.equal(fs.existsSync('assets/session-workflow.js'), false);
  for (const source of [main, preload, manifest]) {
    assert.doesNotMatch(source, /harness-reliable-interrupt|interrupt-and-prompt|interrupt-queued/);
  }
  assert.doesNotMatch(manifest, /assets\/session-workflow\.js/);
  assert.doesNotMatch(client, /resume-queue/);
  assert.doesNotMatch(host, /resume-queue/);

  assert.match(smoke, /Steer queued message/);
  assert.match(smoke, /querySelectorAll\('button'\)/);
  assert.match(smoke, /pressEnter\(true\)/);
  assert.match(smoke, /Stop generating/);
  assert.doesNotMatch(smoke, /__DSH_WORKFLOW__|dsh-session-workflow|reliable interrupt/i);
});
