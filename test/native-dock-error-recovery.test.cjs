const test = require('node:test');
const assert = require('node:assert/strict');
const { NativeWorkbenchDock } = require('../electron/native-workbench-dock.cjs');

test('a successful panel action clears a previous error; a rejected action preserves it', async () => {
  const dock = Object.create(NativeWorkbenchDock.prototype);
  dock.lastError = 'previous failure';
  dock.state = () => ({ error: dock.lastError });
  dock.onPanel = async () => { throw new Error('retry failed'); };
  await assert.rejects(dock.act('panel', 'review'), /retry failed/);
  assert.equal(dock.lastError, 'previous failure');
  dock.onPanel = async () => {};
  assert.deepEqual(await dock.act('panel', 'review'), { error: '' });
});
