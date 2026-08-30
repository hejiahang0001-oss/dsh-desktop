const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
test('session workflow distinguishes queue, steer, stop and explicit queue continuation', () => {
  const script = fs.readFileSync('assets/session-workflow.js', 'utf8');
  for (const label of ['排队发送', '插话并继续', '停止当前回合', '继续排队消息']) assert.ok(script.includes(label));
  assert.match(script, /api\.interruptQueued\(\)/);
  assert.match(script, /api\.interruptAndPrompt\(text\)/);
  assert.match(script, /!edited && selection\(\) === selected && bridge\.read\(\) === text/);
  assert.match(script, /event\.isTrusted/);
  assert.match(script, /bridge\.remove\(bridge\.current\(\), text, unchanged\)/);
  assert.match(script, /actions\.hidden = !state\.running && !state\.pending/);
  assert.match(script, /尚不代表已执行完成/);
  assert.doesNotMatch(script, /innerHTML|eval\(|fetch\(/);
});
