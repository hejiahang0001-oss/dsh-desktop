const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fixtureEvents, summarizeEvents, assertPreserved, fingerprint, cleanEnvironment } = require('../scripts/smoke-harness-upgrade.cjs');

function v2Fixture() {
  const source = fixtureEvents();
  return source.filter((event) => event.type !== 'assistant/chunk').map((event, seq) => {
    const result = structuredClone(event);
    result.seq = seq;
    if (event.type === 'assistant/message') {
      const chunks = source.filter((chunk) => event.sourceEventSeqs.includes(chunk.seq));
      result.data.stream = [{ type: 'text-chunks', index: 0, time0: chunks[0].time, dt: [1], texts: ['合成', '回答'] },
        ...chunks.slice(2).map((chunk) => ({ type: 'chunk', time: chunk.time, chunk: chunk.data.chunk }))];
      delete result.sourceEventSeqs;
    }
    return result;
  });
}

test('v0 and v2 preserve exact semantics and expanded stream, not raw event hashes', () => {
  const old = summarizeEvents(fixtureEvents()), updated = summarizeEvents(v2Fixture());
  assertPreserved(old, updated);
  assert.notEqual(old.rawHistoryHash, updated.rawHistoryHash);
  assert.deepEqual(old.counts, { 'user/message': 2, 'assistant/message': 2, 'tool/call': 2, 'tool/result': 2 });
  assert.equal(old.streamChunks, 12);
  assert.deepEqual(fixtureEvents().filter((event) => event.type === 'step/start').map((event) => event.data.step), [1, 1]);
});

for (const type of ['user/message', 'assistant/message', 'tool/call', 'tool/result']) {
  test(`same-count ${type} content corruption fails the migration gate`, () => {
    const events = v2Fixture(), changed = events.find((event) => event.type === type);
    if (type === 'user/message') changed.data.content[0].text += 'CORRUPT';
    else if (type === 'assistant/message') changed.data.message.content[0].text += 'CORRUPT';
    else if (type === 'tool/call') changed.data.arguments = '{"row":999}';
    else changed.data.message.content[0].content[0].text += 'CORRUPT';
    assert.throws(() => assertPreserved(summarizeEvents(fixtureEvents()), summarizeEvents(events)), /semanticHash/);
  });
}

test('message identity, source, tool call links, timestamps and extra metadata cannot be dropped', () => {
  const before = summarizeEvents(fixtureEvents());
  for (const mutate of [
    (row) => { row.data.message.id = 'different'; },
    (row) => { row.data.message.source.model = 'different'; },
    (row) => { row.data.message.content[2].id = 'different'; },
    (row) => { row.time += 1; },
    (row) => { row.data.interrupted = true; }
  ]) {
    const events = v2Fixture();
    mutate(events.find((row) => row.type === 'assistant/message'));
    assert.throws(() => assertPreserved(before, summarizeEvents(events)), /semanticHash/);
  }
});

test('stream-only loss or timing corruption fails even when final messages are identical', () => {
  for (const mutate of [
    (stream) => { stream[0].texts[0] = 'CORRUPT'; },
    (stream) => { stream[0].dt[0] = 2; },
    (stream) => { stream.splice(1, 1); },
    (stream) => { stream[2].chunk.argumentsDelta = 'CORRUPT'; }
  ]) {
    const events = v2Fixture();
    mutate(events.find((row) => row.type === 'assistant/message').data.stream);
    assert.throws(() => assertPreserved(summarizeEvents(fixtureEvents()), summarizeEvents(events)), /streamHash|streamChunks/);
  }
});

test('missing and reordered conversation events fail; malformed streams fail closed', () => {
  const missing = v2Fixture();
  missing.splice(missing.findIndex((event) => event.type === 'tool/result'), 1);
  assert.throws(() => assertPreserved(summarizeEvents(fixtureEvents()), summarizeEvents(missing)));
  const reordered = v2Fixture();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  reordered.forEach((event, index) => { event.seq = index; });
  assert.throws(() => assertPreserved(summarizeEvents(fixtureEvents()), summarizeEvents(reordered)), /semanticHash/);
  const malformed = v2Fixture();
  malformed.find((event) => event.type === 'assistant/message').data.stream[0].dt = [];
  assert.throws(() => summarizeEvents(malformed), /complete compact stream/);
  const unknown = v2Fixture();
  unknown.find((event) => event.type === 'assistant/message').data.stream.push({ type: 'future-stream' });
  assert.throws(() => summarizeEvents(unknown), /unsupported stream/);
});

test('metadata changes and unrecognized stream metadata cannot pass silently', () => {
  const summary = summarizeEvents(fixtureEvents());
  assert.throws(() => assertPreserved({ ...summary, metadataHash: 'original' }, { ...summary, metadataHash: 'changed' }), /session metadata/);
  const events = v2Fixture();
  events.find((event) => event.type === 'assistant/message').data.stream[0].unknown = 'content';
  assert.throws(() => summarizeEvents(events), /unsupported stream metadata/);
});

test('semantic hashing does not mutate the original events', () => {
  const events = v2Fixture(), before = structuredClone(events);
  summarizeEvents(events);
  assert.deepEqual(events, before);
});

test('worker environment drops all credentials, proxy and Node preloads', () => {
  const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']);
  assert.ok(Object.keys(cleanEnvironment()).every((key) => allowed.has(key.toUpperCase())));
});

test('source fingerprints detect same-length changes without exposing file contents', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-upgrade-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'synthetic.jsonl');
  await fs.writeFile(file, 'original');
  const before = await fingerprint(root);
  await fs.writeFile(file, 'modified');
  assert.notDeepEqual(await fingerprint(root), before);
  assert.match(before['synthetic.jsonl'], /^[a-f0-9]{64}$/);
});
