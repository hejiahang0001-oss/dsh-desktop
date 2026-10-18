'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { observeDriver } = require('./fixtures/driver-observation.cjs');

const fixture = () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 321, exitCode: null, signalCode: null, stderr: new PassThrough() });
  let now = 0;
  let fileExists = false;
  let nextId = 0;
  const timers = new Map();
  const observer = observeDriver(child, {
    now: () => now,
    exists: () => fileExists,
    setTimer: (action, ms) => { const id = ++nextId; timers.set(id, { action, at: now + ms }); return id; },
    clearTimer: (id) => timers.delete(id)
  });
  const advanceTo = (target) => {
    assert.ok(target >= now);
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].action();
    }
    now = target;
  };
  return { child, observer, timers, advanceTo, provideFile: () => { fileExists = true; } };
};

test('driver observation accepts a normal state file and removes its polling timer', async () => {
  const f = fixture();
  const waiting = f.observer.waitForFile('isolated/driver-state.json');
  f.advanceTo(100);
  f.provideFile();
  f.advanceTo(150);
  await waiting;
  assert.equal(f.timers.size, 0);
  assert.equal(f.observer.snapshot().elapsedMs, 150);
  f.observer.dispose();
});

test('driver observation preserves the original 5000 ms deadline without a retry', async () => {
  const f = fixture();
  const waiting = f.observer.waitForFile('isolated/driver-state.json');
  let settled = false;
  const captured = waiting.then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
  f.advanceTo(4999);
  await Promise.resolve();
  assert.equal(settled, false);
  f.advanceTo(5000);
  const error = await captured;
  assert.match(error.message, /Timed out waiting for isolated\/driver-state.json/);
  assert.equal(error.driverObservation.elapsedMs, 5000);
  assert.equal(error.driverObservation.stage, 'await-driver-state');
  assert.equal(f.timers.size, 0);
  f.observer.dispose();
});

for (const event of ['exit', 'close']) {
  test(`driver observation rejects an early ${event} immediately with bounded stderr`, async () => {
    const f = fixture();
    f.child.stderr.write('x'.repeat(40000));
    f.child.stderr.write('\n[safe-exit-driver] job-launch-start\noriginal guardian failure');
    const waiting = f.observer.waitForFile('isolated/driver-state.json');
    const captured = waiting.catch((error) => error);
    f.advanceTo(17);
    f.child.emit(event, 1, null);
    const error = await captured;
    assert.match(error.message, /Driver ended before state file was ready/);
    assert.equal(error.driverObservation.elapsedMs, 17);
    assert.deepEqual(error.driverObservation[event], { code: 1, signal: null });
    assert.ok(Buffer.byteLength(error.driverObservation.stderr) <= 32768);
    assert.match(error.driverObservation.stderr, /job-launch-start\noriginal guardian failure$/);
    assert.equal(f.timers.size, 0);
    f.observer.dispose();
  });
}

test('driver observation reports a spawn error before the first poll', async () => {
  const f = fixture();
  const waiting = f.observer.waitForFile('isolated/driver-state.json');
  const captured = waiting.catch((error) => error);
  f.child.emit('error', new Error('fixture spawn failure'));
  const error = await captured;
  assert.equal(error.driverObservation.elapsedMs, 0);
  assert.equal(error.driverObservation.spawnError, 'fixture spawn failure');
  assert.equal(f.timers.size, 0);
  f.observer.dispose();
});

test('driver observation remembers an exit that occurred before waiting and does not accept a stale file', async () => {
  const f = fixture();
  f.child.emit('exit', 0, null);
  f.provideFile();
  await assert.rejects(f.observer.waitForFile('isolated/driver-state.json'), /Driver ended before state file was ready/);
  assert.equal(f.timers.size, 0);
  f.observer.dispose();
});

test('driver observation decorates later-stage failures without changing the original cause', () => {
  const f = fixture();
  f.advanceTo(321);
  f.observer.setStage('verify-owned-descendant-exit');
  const cause = new Error('PID 456 remained alive.');
  const error = f.observer.withContext(cause);
  assert.equal(error.cause, cause);
  assert.equal(error.driverObservation.stage, 'verify-owned-descendant-exit');
  assert.equal(error.driverObservation.elapsedMs, 321);
  assert.equal(f.observer.withContext(error), error);
  f.observer.dispose();
});

test('driver observation removes only its own listeners after disposal', async () => {
  const f = fixture();
  const external = () => {};
  f.child.on('exit', external);
  f.child.on('close', external);
  f.child.on('error', external);
  f.child.stderr.on('data', external);
  const waiting = f.observer.waitForFile('isolated/driver-state.json');
  const captured = waiting.catch((error) => error);
  f.observer.dispose();
  const error = await captured;
  assert.match(error.message, /observation disposed/i);
  for (const event of ['exit', 'close', 'error']) assert.deepEqual(f.child.listeners(event), [external]);
  assert.deepEqual(f.child.stderr.listeners('data'), [external]);
  assert.equal(f.timers.size, 0);
});
