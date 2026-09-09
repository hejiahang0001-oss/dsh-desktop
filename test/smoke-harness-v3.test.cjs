const test = require('node:test');
const assert = require('node:assert/strict');
const { fixtureV2, semanticSummary } = require('../scripts/smoke-harness-v3.cjs');

function projectedV3() {
  const result = [];
  for (const row of fixtureV2()) {
    const event = structuredClone(row);
    if (event.type === 'request/header') {
      result.push({ type: 'system/message', seq: result.length, time: event.time, data: { message: { role: 'system', content: [{ type: 'text', text: event.data.header.system }] } } });
      delete event.data.header.system; delete event.data.header.tools; delete event.data.header.adapterDefaults;
    }
    event.seq = result.length; result.push(event);
  }
  return result;
}
test('V3 semantic gate compares request prompts after relocation without mutating source events', () => {
  const old = fixtureV2(), updated = projectedV3(), snapshot = structuredClone(updated);
  assert.deepEqual(semanticSummary(old), semanticSummary(updated));
  assert.deepEqual(updated, snapshot);
});
test('V3 request prompt loss, changed stream content and tool results fail semantic equality', () => {
  for (const mutate of [
    (events) => { events.find((row) => row.type === 'system/message').data.message.content[0].text = 'lost prompt'; },
    (events) => { events.find((row) => row.type === 'assistant/message').data.stream[0].texts[0] = 'changed'; },
    (events) => { events.find((row) => row.type === 'tool/result').data.message.content[0].content[0].text = 'changed'; }
  ]) {
    const events = projectedV3(); mutate(events);
    assert.notDeepEqual(semanticSummary(events), semanticSummary(fixtureV2()));
  }
});
test('V3 semantic gate does not silently discard unexpected system content', () => {
  const events = projectedV3();
  events.find((row) => row.type === 'system/message').data.message.content[0] = { type: 'file', path: 'unexpected' };
  assert.throws(() => semanticSummary(events));
});
