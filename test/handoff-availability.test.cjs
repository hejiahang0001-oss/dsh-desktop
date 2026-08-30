const test = require('node:test');
const assert = require('node:assert/strict');
const { handoffWorkflowIdle } = require('../electron/handoff-availability.cjs');
test('handoff waits for authoritative idle state, never guesses from stale DOM controls', () => {
  const idle = { available: true, running: false, pending: 0, approvals: 0, jobs: 0, turnOpen: false };
  assert.equal(handoffWorkflowIdle(idle, false), true);
  for (const patch of [{ available: false }, { running: true }, { pending: 1 }, { approvals: 1 }, { jobs: 1 }, { turnOpen: true }]) assert.equal(handoffWorkflowIdle({ ...idle, ...patch }, false), false);
  assert.equal(handoffWorkflowIdle(idle, true), false); assert.equal(handoffWorkflowIdle({}, false), false);
});
