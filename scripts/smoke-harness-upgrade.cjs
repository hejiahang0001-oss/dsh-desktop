// Offline v0 -> v2 gate: generated completed sessions only. No user profile,
// credentials, Agent, Provider, HTTP server or model calls.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const SESSION_ID = 'session-upgrade-synthetic-completed';
const MARKER = 'dsh-upgrade-v2-only-checkpoint';

function fixtureEvents() {
  const events = [];
  const add = (type, data, extra = {}) => {
    const seq = events.length;
    events.push({ type, seq, time: 1700000000000 + seq, data, ...extra });
    return seq;
  };
  for (let turn = 1; turn <= 2; turn++) {
    const step = 1, callId = `synthetic-call-${turn}`;
    add('user/message', { id: `synthetic-user-${turn}`, role: 'user',
      content: [{ type: 'text', text: `第 ${turn} 轮：读取合成数据，不访问真实文件。` }], source: { kind: 'user' } }, { surfaceOp: 'append' });
    add('turn/start', { turn });
    add('step/start', { turn, step });
    const sources = [
      add('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text: '合成' } }),
      add('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text: '回答' } }),
      add('assistant/chunk', { turn, step, chunk: { type: 'reasoning-delta', index: 1, text: '合成推理' } }),
      add('assistant/chunk', { turn, step, chunk: { type: 'tool-call-delta', index: 2, id: callId, name: 'synthetic_read', argumentsDelta: '{"row":' } }),
      add('assistant/chunk', { turn, step, chunk: { type: 'tool-call-delta', index: 2, id: callId, name: 'synthetic_read', argumentsDelta: `${turn}}` } }),
      add('assistant/chunk', { turn, step, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } })
    ];
    add('assistant/message', { turn, step, message: { id: `synthetic-assistant-${turn}`, role: 'assistant',
      content: [{ type: 'text', text: '合成回答' }, { type: 'reasoning', text: '合成推理' },
        { type: 'tool-call', id: callId, name: 'synthetic_read', arguments: `{"row":${turn}}` }],
      source: { kind: 'model', provider: 'synthetic', model: 'offline' } } }, { surfaceOp: 'append', sourceEventSeqs: sources });
    add('tool/call', { turn, step, callId, name: 'synthetic_read', arguments: `{"row":${turn}}` });
    add('tool/result', { turn, step, message: { id: `synthetic-result-${turn}`, role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text: `合成金额=${turn * 123}.45` }] }],
      source: { kind: 'tool', callId } } }, { surfaceOp: 'append' });
    add('step/end', { turn, step });
    add('turn/end', { turn, reason: { kind: 'completed' } });
  }
  return events;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Only normalize documented stream compaction/sequence remapping, never message
// IDs, sources, content blocks, tool data, timestamps, usage or error fields.
function summarizeEvents(events) {
  assert.ok(Array.isArray(events) && events.length > 0 && events.length <= 10000, 'bounded nonempty event log');
  events.forEach((event, index) => assert.equal(event.seq, index, 'complete dense event sequence required'));
  const retained = events.filter((event) => !['assistant/chunk', 'assistant/attempt'].includes(event.type));
  const positions = new Map(retained.map((event, index) => [event.seq, index]));
  const chunks = new Set(events.filter((event) => event.type === 'assistant/chunk').map((event) => event.seq));
  const stream = [];
  const pushChunk = (event, time, chunk) => stream.push({ turn: event.data.turn, step: event.data.step, time, chunk });
  for (const event of events) {
    if (event.type === 'assistant/attempt') {
      assert.ok(Object.keys(event.data).every((key) => ['turn', 'step', 'stream'].includes(key)), 'unsupported attempt payload');
      assert.ok(Array.isArray(event.data.stream) && event.data.stream.length > 0, 'nonempty attempt stream required');
    }
    if (event.type === 'assistant/chunk') pushChunk(event, event.time, event.data.chunk);
    if (['assistant/message', 'assistant/attempt'].includes(event.type) && event.data.stream !== undefined) {
      assert.ok(Array.isArray(event.data.stream), 'stream must be an array');
      for (const record of event.data.stream) {
        if (record.type === 'chunk') {
          assert.ok(Object.keys(record).every((key) => ['type', 'time', 'chunk'].includes(key)), 'unsupported stream metadata');
          pushChunk(event, record.time, record.chunk); continue;
        }
        assert.ok(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].includes(record.type), 'unsupported stream record');
        const allowedKeys = record.type === 'tool-call-chunks'
          ? ['type', 'time0', 'index', 'dt', 'id', 'name', 'args'] : ['type', 'time0', 'index', 'dt', 'texts'];
        assert.ok(Object.keys(record).every((key) => allowedKeys.includes(key)), 'unsupported stream metadata');
        const values = record.type === 'tool-call-chunks' ? record.args : record.texts;
        assert.ok(Array.isArray(values) && values.length > 0 && record.dt.length === values.length - 1, 'complete compact stream required');
        let time = record.time0;
        values.forEach((value, index) => {
          if (index) time += record.dt[index - 1];
          pushChunk(event, time, record.type === 'tool-call-chunks'
            ? { type: 'tool-call-delta', index: record.index, id: record.id, ...(record.name === undefined ? {} : { name: record.name }), argumentsDelta: value }
            : { type: record.type === 'text-chunks' ? 'text-delta' : 'reasoning-delta', index: record.index, text: value });
        });
      }
    }
  }
  const records = retained.map((event) => {
    const { seq: _seq, sourceEventSeqs, ...record } = event;
    if (event.type === 'assistant/message') {
      const { stream: _stream, ...data } = record.data;
      record.data = data;
    }
    if (sourceEventSeqs !== undefined) {
      assert.ok(Array.isArray(sourceEventSeqs), 'logical source references required');
      const streamProvenance = event.type === 'assistant/message' && sourceEventSeqs.every((seq) => chunks.has(seq));
      if (!streamProvenance) record.sourceEventSeqs = sourceEventSeqs.map((seq) => {
        assert.ok(positions.has(seq), 'unsupported source reference');
        return positions.get(seq);
      });
    }
    return record;
  });
  const counts = Object.fromEntries(['user/message', 'assistant/message', 'tool/call', 'tool/result'].map((type) => [type, records.filter((event) => event.type === type).length]));
  return { counts, semanticEvents: records.length, semanticHash: hash(stableJson(records)),
    streamChunks: stream.length, streamHash: hash(stableJson(stream)), rawHistoryHash: hash(stableJson(events)) };
}

function assertPreserved(expected, actual) {
  for (const key of ['counts', 'semanticEvents', 'semanticHash', 'streamChunks', 'streamHash']) {
    assert.equal(stableJson(actual[key]), stableJson(expected[key]), `migration changed ${key}`);
  }
  if (expected.metadataHash !== undefined) assert.equal(actual.metadataHash, expected.metadataHash, 'migration changed session metadata');
}
function metadataHash(meta, inheritedEventCount) {
  const { version: _version, ...header } = meta;
  return hash(stableJson({ header: { ...header, isSeeded: header.isSeeded ?? false, delegationDepth: header.delegationDepth ?? 0 }, inheritedEventCount }));
}
async function filesUnder(root) {
  assert.equal((await fs.lstat(root)).isSymbolicLink(), false, 'linked fixture root forbidden');
  const result = [];
  let seen = 0;
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      assert.ok(++seen <= 2000, 'bounded upgrade fixture');
      assert.equal(entry.isSymbolicLink(), false, 'linked fixture paths forbidden');
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile()) result.push(full);
      else throw new Error('non-regular fixture entry forbidden');
    }
  }
  await visit(root);
  return result.sort();
}
async function fingerprint(root) {
  const result = {};
  for (const file of await filesUnder(root)) result[path.relative(root, file)] = hash(await fs.readFile(file));
  return result;
}
function cleanEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'].includes(key.toUpperCase())));
}
async function runWorker(runtime, sessions, mode, compression) {
  const { stdout } = await execute(process.execPath, [__filename, `--worker=${mode}`, `--runtime=${runtime}`, `--sessions=${sessions}`, `--compression=${compression}`],
    { env: cleanEnvironment(), windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  const line = stdout.trim().split(/\r?\n/).findLast((value) => value.startsWith('{'));
  assert.ok(line, 'worker must return evidence');
  return JSON.parse(line);
}
async function persistenceWorker({ runtime, sessions, mode, compression }) {
  const resolve = createRequire(path.join(runtime, 'offline-upgrade-probe.cjs'));
  const load = (name) => import(pathToFileURL(resolve.resolve(name)).href);
  const [{ Context }, { default: Jsonl }, sessionModule] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session-persistence-jsonl'), load('@deepseek-ai/dsh-session')]);
  const ctx = new Context(), oldApi = sessionModule.SESSION_FORMAT_VERSION === 0;
  try {
    if (oldApi) await ctx.plugin(sessionModule.default);
    await ctx.plugin(Jsonl, { root: sessions, compression });
    const storage = ctx.sessionPersistence;
    if (mode === 'create') {
      assert.equal(oldApi, true, 'fixture must be written by the shipped v0 runtime');
      await storage.create({ version: 0, id: SESSION_ID, createdAt: 1700000000000, delegationDepth: 0, cwd: path.join(sessions, 'synthetic-workspace') });
      await storage.append(SESSION_ID, fixtureEvents());
    }
    if (oldApi) {
      const { events, meta, inheritedEventCount } = await storage.readFrom(SESSION_ID, 0);
      return { version: 0, metadataHash: metadataHash(meta, inheritedEventCount), ...summarizeEvents(events), markerPresent: events.some((event) => event.data?.text === MARKER) };
    }
    assert.equal(sessionModule.SESSION_FORMAT_VERSION, 2, 'review required for another session format');
    if (mode === 'contend') {
      try {
        const unexpected = await storage.open(SESSION_ID, 'write');
        await unexpected.close();
      } catch (error) {
        assert.equal(error.name, 'SessionAlreadyOwnedError', 'contention must be a write ownership refusal');
        return { writeLockRefused: true };
      }
      throw new Error('second process unexpectedly obtained write ownership');
    }
    const handle = await storage.open(SESSION_ID, mode === 'read' ? 'read' : 'write');
    let lock;
    try {
      if (mode === 'migrate') lock = await runWorker(runtime, sessions, 'contend', compression);
      if (mode === 'append') {
        const { events } = await handle.read();
        await handle.append([{ type: 'feedback/record', seq: events.length, time: 1700000100000, data: { text: MARKER } }]);
        await handle.flush();
      }
      const { events } = await handle.read();
      return { version: handle.header.version, metadataHash: metadataHash(handle.header, handle.inheritedEventCount),
        ...summarizeEvents(events), markerPresent: events.some((event) => event.data?.text === MARKER), ...lock };
    } finally { await handle.close(); }
  } finally { await ctx.fiber.dispose(); }
}

async function main() {
  if (arg('worker')) {
    const result = await persistenceWorker({ runtime: arg('runtime'), sessions: arg('sessions'), mode: arg('worker'), compression: arg('compression') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const oldRuntime = arg('old-runtime'), newRuntime = arg('new-runtime'), destination = arg('output-root');
  for (const value of [oldRuntime, newRuntime, destination]) assert.ok(value && path.isAbsolute(value), 'all paths must be absolute');
  assert.equal(arg('fixture-home'), undefined, 'external profiles are not accepted; this gate generates credential-free synthetic fixtures');
  await fs.mkdir(destination); // Fresh only; never opens an installed profile.
  const evidence = [];
  for (const compression of ['none', 'zstd']) {
    const base = path.join(destination, compression);
    const source = path.join(base, 'source'), migrated = path.join(base, 'migrated'), rollback = path.join(base, 'rollback');
    await fs.mkdir(source, { recursive: true });
    const old = await runWorker(oldRuntime, source, 'create', compression);
    assertPreserved(summarizeEvents(fixtureEvents()), old);
    for (const count of Object.values(old.counts)) assert.equal(count, 2, 'two completed user/assistant/tool rounds required');
    const before = await fingerprint(source);
    await fs.cp(source, migrated, { recursive: true, errorOnExist: true, force: false });
    const updated = await runWorker(newRuntime, migrated, 'migrate', compression);
    assertPreserved(old, updated);
    assert.equal(updated.writeLockRefused, true);
    for (let restart = 0; restart < 2; restart++) assertPreserved(old, await runWorker(newRuntime, migrated, 'migrate', compression));
    const checkpoint = await runWorker(newRuntime, migrated, 'append', compression);
    assert.equal(checkpoint.markerPresent, true);
    for (let restart = 0; restart < 2; restart++) {
      const reopened = await runWorker(newRuntime, migrated, 'read', compression);
      assertPreserved(checkpoint, reopened);
      assert.equal(reopened.rawHistoryHash, checkpoint.rawHistoryHash, 'v2 reopen must preserve exact logical events');
      assert.equal(reopened.markerPresent, true);
    }
    const currentFiles = await fingerprint(migrated);
    for (const [file, digest] of Object.entries(before)) assert.equal(currentFiles[file], digest, 'old generation retained unchanged');
    assert.ok(Object.keys(currentFiles).some((file) => /session\.v2\.jsonl(?:\.zstd)?$/.test(file)), 'v2 generation must be published');
    // Probe only the isolated copy: old kernels silently selecting v0 would
    // miss subsequent v2 writes. This is evidence AGAINST in-place downgrade.
    const oldOnMigrated = await runWorker(oldRuntime, migrated, 'read', compression);
    assertPreserved(old, oldOnMigrated);
    assert.equal(oldOnMigrated.markerPresent, false, 'downgrade divergence boundary must be visible');
    await fs.cp(source, rollback, { recursive: true, errorOnExist: true, force: false });
    assertPreserved(old, await runWorker(oldRuntime, rollback, 'read', compression));
    assert.deepEqual(await fingerprint(source), before, 'source fixture must remain byte-for-byte unchanged');
    evidence.push({ compression, old, updated, checkpoint, restartReads: 4, crossProcessWriteLock: 'refused-and-released',
      sourceFilesUnchanged: Object.keys(before).length, oldGenerationRetained: true,
      rollback: { backupRestored: true, inPlaceDowngradeSafe: false, oldRuntimeMissesV2Writes: true } });
  }
  const report = { ok: true, fixture: 'generated-completed-two-round-tool-conversation', credentialsCopied: false,
    providerPluginsLoaded: 0, modelCalls: 0, userSessionsTested: false, evidence };
  await fs.writeFile(path.join(destination, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
module.exports = { fixtureEvents, summarizeEvents, assertPreserved, stableJson, fingerprint, cleanEnvironment };
if (require.main === module) main().catch((error) => { process.stderr.write(`Upgrade gate failed: ${error.message}\n`); process.exitCode = 1; });
