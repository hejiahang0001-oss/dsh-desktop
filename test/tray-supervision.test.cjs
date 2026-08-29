const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AgentTransitionTracker,
  isBackgroundSupervisionRequired,
  notificationCopy,
  trayStatusLabel
} = require('../electron/tray-supervision.cjs');

test('agent tracker emits one fixed waiting notification per active turn', () => {
  const tracker = new AgentTransitionTracker({ status: 'ready' });
  assert.equal(tracker.observe({ status: 'running' }), null);
  assert.equal(tracker.observe({ status: 'waiting' }).type, 'waiting');
  assert.equal(tracker.observe({ status: 'waiting' }), null);
  assert.equal(tracker.observe({ status: 'running' }), null);
  assert.equal(tracker.observe({ status: 'waiting' }), null);
});

test('agent tracker distinguishes completion, failure, stop, and disconnect without content', () => {
  const completed = new AgentTransitionTracker({ status: 'ready' });
  completed.observe({ status: 'running', failedToolCount: 2 });
  assert.equal(completed.observe({ status: 'ready', failedToolCount: 2 }).type, 'completed');

  const failed = new AgentTransitionTracker({ status: 'ready', failedToolCount: 2 });
  failed.observe({ status: 'running', failedToolCount: 2 });
  assert.equal(failed.observe({ status: 'ready', failedToolCount: 3 }).type, 'failed');

  const stopped = new AgentTransitionTracker({ status: 'ready' });
  stopped.observe({ status: 'running' });
  assert.equal(stopped.observe({ status: 'ready', stoppedToolCount: 1 }).type, 'stopped');

  const disconnected = new AgentTransitionTracker({ status: 'ready' });
  disconnected.observe({ status: 'running' });
  assert.equal(disconnected.observe({ status: 'unavailable' }).type, 'disconnected');
});

test('tray labels and notification text are a fixed content-free allowlist', () => {
  assert.equal(trayStatusLabel({ status: 'waiting' }), 'Agent：等待确认');
  assert.equal(isBackgroundSupervisionRequired({ status: 'running' }), true);
  assert.equal(isBackgroundSupervisionRequired({ status: 'ready' }), false);
  const copies = ['waiting', 'completed', 'failed', 'stopped', 'disconnected'].map(notificationCopy);
  assert.ok(copies.every((copy) => copy && copy.title.startsWith('DSH Desktop')));
  assert.ok(copies.every((copy) => !JSON.stringify(copy).includes('workspace')));
});
