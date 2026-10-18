const assert = require('node:assert/strict');
const test = require('node:test');
const { createCloseToTrayHandler } = require('../electron/close-to-tray.cjs');

const settle = () => new Promise((resolve) => setImmediate(resolve));
const fixture = (options = {}) => {
  const calls = [];
  const state = { allow: false, quitting: false, tray: true, destroyed: false };
  const window = { isDestroyed: () => state.destroyed, hide: () => calls.push('hide') };
  const handler = createCloseToTrayHandler({
    getWindow: () => window,
    getTray: () => state.tray ? { isDestroyed: () => false } : null,
    canClose: () => state.allow,
    isQuitting: () => state.quitting,
    flushDraft: async () => { calls.push('flush'); },
    restoreWindow: () => calls.push('restore'),
    requestQuit: (reason) => calls.push(reason),
    notify: (copy) => { calls.push('notify'); assert.match(copy.body, /退出 lulu/); },
    onDraftFailure: async () => { calls.push('draft-error'); },
    ...options
  });
  const close = () => handler({ preventDefault: () => calls.push('prevent') });
  return { calls, state, window, close };
};

test('every ordinary close hides to tray without destroying the idle window or quitting', async () => {
  const f = fixture();
  f.close();
  assert.deepEqual(f.calls.slice(0, 3), ['prevent', 'hide', 'notify']);
  await settle();
  assert.deepEqual(f.calls, ['prevent', 'hide', 'notify', 'flush']);
  f.close();
  await settle();
  assert.equal(f.calls.filter((value) => value === 'notify').length, 1);
  assert.equal(f.calls.filter((value) => value === 'hide').length, 2);
});

test('confirmed shutdown may close but pending shutdown cannot hide its confirmation', () => {
  const f = fixture();
  f.state.quitting = true;
  f.close();
  assert.deepEqual(f.calls, ['prevent']);
  f.state.allow = true;
  f.close();
  assert.deepEqual(f.calls, ['prevent']);
});

test('missing or destroyed tray requests safe quit before destroying or hiding the window', () => {
  for (const tray of [null, { isDestroyed: () => true }]) {
    const f = fixture({ getTray: () => tray });
    f.close();
    assert.deepEqual(f.calls, ['prevent', 'window-close']);
  }
});

test('repeated close while draft flush is pending does not start concurrent flushes', async () => {
  let finish;
  let flushCount = 0;
  const f = fixture({ flushDraft: () => { flushCount += 1; return new Promise((resolve) => { finish = resolve; }); } });
  f.close();
  await settle();
  f.close();
  assert.equal(flushCount, 1);
  finish();
  await settle();
});

test('failed draft flush restores the retained window and reports without closing it', async () => {
  for (const flushDraft of [() => { throw new Error('fixture'); }, async () => { throw new Error('fixture'); }]) {
    const f = fixture({ flushDraft });
    f.close();
    await settle();
    assert.deepEqual(f.calls, ['prevent', 'hide', 'notify', 'restore', 'draft-error']);
  }
});

test('late draft failure must not resurrect a destroyed window or interfere with safe quit', async () => {
  for (const field of ['quitting', 'destroyed', 'allow']) {
    const f = fixture({ flushDraft: async () => { throw new Error('fixture'); } });
    f.close();
    f.state[field] = true;
    await settle();
    assert.deepEqual(f.calls, ['prevent', 'hide', 'notify']);
  }
});

test('notification failure does not prevent hide, draft flush or later close requests', async () => {
  const f = fixture({ notify: () => { throw new Error('notifications unavailable'); } });
  f.close();
  await settle();
  assert.deepEqual(f.calls, ['prevent', 'hide', 'flush']);
});

test('cancelled quit permits the next close to hide normally', async () => {
  const f = fixture();
  f.state.quitting = true;
  f.close();
  f.state.quitting = false;
  f.close();
  await settle();
  assert.deepEqual(f.calls, ['prevent', 'prevent', 'hide', 'notify', 'flush']);
});

test('late draft failure belongs to its original window, not a replacement', async () => {
  let current = { isDestroyed: () => false, hide() {} };
  const f = fixture({ getWindow: () => current, flushDraft: async () => { throw new Error('fixture'); } });
  f.close();
  current = { isDestroyed: () => false, hide() {} };
  await settle();
  assert.deepEqual(f.calls, ['prevent', 'notify']);
});
