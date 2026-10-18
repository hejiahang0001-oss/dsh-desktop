const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');
function fixture() {
  const peer = new EventEmitter();
  const sent = [];
  peer.send = (value, callback) => { sent.push(value); callback?.(); };
  peer.connected = true;
  let source = fs.readFileSync(path.join(__dirname, '../runtime/dsh-desktop-tools/index.mjs'), 'utf8');
  source = source.slice(source.indexOf('export const name')).replaceAll('export ', '');
  const context = vm.createContext({ process: peer, randomUUID: require('node:crypto').randomUUID,
    defineTool: x => x, attachSessionControl: () => () => {}, setTimeout, clearTimeout, Map, Error });
  vm.runInContext(source + '\nthis.mount = apply;', context);
  let tool; const disposers = [];
  context.mount({ effect: setup => disposers.push(setup()), tools: { register: value => { tool = value; } } });
  return { peer, sent, tool, dispose: () => disposers.forEach(fn => fn()) };
}
test('terminal plugin removes its message listener when unloaded', () => {
  const f = fixture();
  assert.equal(f.peer.listenerCount('message'), 1);
  f.dispose(); f.dispose();
  assert.equal(f.peer.listenerCount('message'), 0);
});

const execution = () => ({ agent: { session: { id: 'a', header: { cwd: 'C:\\fixture' } } } });
test('unload cancels pending reads and refuses later execution', async () => {
  const f = fixture();
  const pending = f.tool.execute({}, execution());
  const rejected = assert.rejects(pending, /canceled/);
  f.dispose();
  await rejected;
  assert.equal(f.sent.at(-1).operation, 'cancel');
  await assert.rejects(f.tool.execute({}, execution()), /disconnected/);
  assert.equal(f.peer.listenerCount('disconnect'), 0);
});
test('disconnect settles pending reads without sending on a closed channel', async () => {
  const f = fixture();
  const pending = f.tool.execute({}, execution());
  const rejected = assert.rejects(pending, /canceled/);
  f.peer.connected = false; f.peer.emit('disconnect');
  await rejected;
  assert.equal(f.sent.length, 1);
  assert.equal(f.peer.listenerCount('message'), 0);
});
test('successful response and synchronous send failure release request slots', async () => {
  const f = fixture();
  const pending = f.tool.execute({}, execution());
  f.peer.emit('message', { ...f.sent[0], ok: true, text: 'bounded text' });
  assert.equal(await pending, 'bounded text');
  f.peer.send = () => { throw new Error('closed'); };
  for (let i = 0; i < 3; i++) await assert.rejects(f.tool.execute({}, execution()), /disconnected/);
  f.dispose();
});
