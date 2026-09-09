// Generated V2 -> V3 persistence gate. Never opens user profiles or loads a provider.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { stableJson, summarizeEvents, fingerprint, cleanEnvironment } = require('./smoke-harness-upgrade.cjs');
const execute = promisify(execFile);
const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const digest = (value) => createHash('sha256').update(stableJson(value)).digest('hex');
const ID = 'session-v3-synthetic';
const MARKER = 'v3-only-durable-checkpoint';

function fixtureV2() {
  const events = [];
  const add = (type, data, extra = {}) => events.push({ type, seq: events.length, time: 1700000000000 + events.length, data, ...extra });
  add('agent-preset/selected', { agentPreset: 'code' });
  for (let turn = 1; turn <= 2; turn++) {
    const step = 1, callId = `call-${turn}`;
    add('turn/start', { turn });
    add('step/start', { turn, step });
    add('user/message', { id: `user-${turn}`, role: 'user', content: [{ type: 'text', text: `合成金额第${turn}轮` }], source: { kind: 'user' } }, { surfaceOp: 'append' });
    add('request/header', { reason: 'initial', header: { config: { provider: 'synthetic', model: 'offline' }, system: `仅分析合成数据，规则${turn}。`, tools: [], adapterDefaults: {} } });
    add('assistant/message', { turn, step, message: { id: `assistant-${turn}`, role: 'assistant', source: { kind: 'model', provider: 'synthetic', model: 'offline' },
      content: [{ type: 'text', text: '读取金额' }, { type: 'tool-call', id: callId, name: 'synthetic_read', arguments: '{}' }] },
      stream: [{ type: 'text-chunks', index: 0, time0: 1700000000000 + events.length, dt: [1], texts: ['读取', '金额'] },
        { type: 'tool-call-chunks', index: 1, time0: 1700000000001 + events.length, dt: [], id: callId, name: 'synthetic_read', args: ['{}'] },
        { type: 'chunk', time: 1700000000002 + events.length, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } }] }, { surfaceOp: 'append' });
    add('tool/call', { turn, step, callId, name: 'synthetic_read', arguments: '{}' });
    add('tool/result', { turn, step, message: { id: `result-${turn}`, role: 'user', source: { kind: 'tool', callId },
      content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text: `金额=${turn * 123}.45` }] }] } }, { surfaceOp: 'append' });
    add('step/end', { turn, step });
    add('turn/end', { turn, reason: { kind: 'completed' } });
  }
  return events;
}

// Compare request meaning, not changed sequence numbers or generated system IDs.
// Strict catalog validation separately checks the actual V3 system-node lineage.
function semanticSummary(events) {
  let system = '';
  const retained = [], positions = new Map();
  for (const event of events) {
    if (event.type === 'system/message') {
      const message = event.data.message;
      assert.equal(message.role, 'system');
      assert.ok(message.content.length <= 1 && message.content.every((block) => block.type === 'text' && typeof block.text === 'string'));
      system = message.content[0]?.text ?? '';
      continue;
    }
    positions.set(event.seq, retained.length);
    const row = structuredClone(event);
    row.seq = retained.length;
    if (row.type === 'request/header') {
      const header = row.data.header;
      if (!Object.hasOwn(header, 'system')) header.system = system;
      if (Array.isArray(header.tools) && header.tools.length === 0) delete header.tools;
      if (header.adapterDefaults && Object.keys(header.adapterDefaults).length === 0) delete header.adapterDefaults;
    }
    if (row.type === 'agent-preset/selected' && row.data.agentPreset === 'code') row.data.agentPreset = 'ptc';
    if (row.sourceEventSeqs) row.sourceEventSeqs = row.sourceEventSeqs.map((seq) => {
      assert.ok(positions.has(seq), 'non-system provenance must remain resolvable');
      return positions.get(seq);
    });
    if (typeof row.surfaceOp === 'object') {
      const start = row.surfaceOp.startSeq ?? row.surfaceOp.start, end = row.surfaceOp.endSeq ?? row.surfaceOp.end;
      assert.ok(positions.has(start) && positions.has(end));
      row.surfaceOp = { op: 'replace', startSeq: positions.get(start), endSeq: positions.get(end) };
    }
    retained.push(row);
  }
  const summary = summarizeEvents(retained);
  delete summary.rawHistoryHash;
  return summary;
}

async function worker(runtime, sessions, mode, compression) {
  const { stdout } = await execute(process.execPath, [__filename, `--worker=${mode}`, `--runtime=${runtime}`, `--sessions=${sessions}`, `--compression=${compression}`],
    { env: cleanEnvironment(), windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout.trim().split(/\r?\n/).findLast((line) => line.startsWith('{')));
}
async function persistenceWorker(runtime, sessions, mode, compression) {
  const resolve = createRequire(path.join(runtime, 'v3-isolated-probe.cjs'));
  const load = (name) => import(pathToFileURL(resolve.resolve(name)).href);
  const [{ Context }, { default: Jsonl }, sessionModule, { sessionFormatCatalog }] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session-persistence-jsonl'), load('@deepseek-ai/dsh-session'), load('@deepseek-ai/dsh-session-format-catalog')]);
  const ctx = new Context();
  try {
    await ctx.plugin(Jsonl, { root: sessions, compression });
    const storage = ctx.sessionPersistence;
    if (mode === 'create') {
      assert.equal(sessionModule.SESSION_FORMAT_VERSION, 2);
      const created = await storage.create({ version: 2, id: ID, createdAt: 1700000000000, isSeeded: false, delegationDepth: 0, agentPreset: 'code', cwd: path.join(sessions, 'workspace') });
      try { await created.append(fixtureV2()); await created.flush(); } finally { await created.close(); }
    }
    if (mode === 'contend') {
      try { const wrong = await storage.open(ID, 'write'); await wrong.close(); }
      catch (error) { assert.equal(error.name, 'SessionAlreadyOwnedError'); return { refused: true }; }
      throw new Error('second writer was incorrectly admitted');
    }
    const handle = await storage.open(ID, mode === 'read' ? 'read' : 'write');
    try {
      if (mode === 'migrate') {
        assert.equal(sessionModule.SESSION_FORMAT_VERSION, 3);
        assert.equal((await worker(runtime, sessions, 'contend', compression)).refused, true);
      }
      if (mode === 'append') {
        const { events } = await handle.read();
        await handle.append([{ type: 'agent-preset/selected', seq: events.length, time: 1700000100000, data: { agentPreset: MARKER } }]);
        await handle.flush();
      }
      const { events } = await handle.read();
      // Decode through the public current-format catalog, not a permissive log reader.
      const restore = sessionFormatCatalog.createRestore(sessionFormatCatalog.encodeCurrentHeader(handle.header, handle.inheritedEventCount), { recovery: 'strict', validation: 'current' });
      for (const event of events) restore.decodeRow(sessionFormatCatalog.encodeCurrentEvent(event));
      const restored = restore.finish();
      assert.equal(digest(restored.events), digest(events));
      const { version, ...header } = handle.header;
      if (header.agentPreset === 'code') header.agentPreset = 'ptc';
      return { version, headerHash: digest(header), rawHash: digest(events), semantic: semanticSummary(events),
        systems: events.filter((event) => event.type === 'system/message').length,
        marker: events.some((event) => event.data?.agentPreset === MARKER), lockRefused: mode === 'migrate' };
    } finally { await handle.close(); }
  } finally { await ctx.fiber.dispose(); }
}

async function main() {
  if (arg('worker')) {
    console.log(JSON.stringify(await persistenceWorker(arg('runtime'), arg('sessions'), arg('worker'), arg('compression')))); return;
  }
  const oldRuntime = arg('old-runtime'), newRuntime = arg('new-runtime'), output = arg('output-root');
  for (const value of [oldRuntime, newRuntime, output]) assert.ok(value && path.isAbsolute(value));
  await fs.mkdir(output); // Fresh isolated directory only.
  const evidence = [];
  for (const compression of ['none', 'zstd']) {
    const base = path.join(output, compression), source = path.join(base, 'source'), migrated = path.join(base, 'migrated'), backup = path.join(base, 'backup');
    await fs.mkdir(source, { recursive: true });
    const before = await worker(oldRuntime, source, 'create', compression);
    assert.deepEqual(before.semantic, semanticSummary(fixtureV2()));
    const sourceHash = await fingerprint(source);
    await fs.cp(source, migrated, { recursive: true, force: false, errorOnExist: true });
    await fs.cp(source, backup, { recursive: true, force: false, errorOnExist: true });
    const updated = await worker(newRuntime, migrated, 'migrate', compression);
    assert.equal(updated.version, 3); assert.equal(updated.systems, 3); assert.equal(updated.lockRefused, true);
    assert.deepEqual(updated.semantic, before.semantic); assert.equal(updated.headerHash, before.headerHash);
    for (let i = 0; i < 2; i++) assert.equal((await worker(newRuntime, migrated, 'migrate', compression)).rawHash, updated.rawHash);
    const appended = await worker(newRuntime, migrated, 'append', compression);
    assert.equal(appended.marker, true);
    assert.equal((await worker(newRuntime, migrated, 'read', compression)).rawHash, appended.rawHash);
    const generations = await fingerprint(migrated);
    for (const [file, hash] of Object.entries(sourceHash)) assert.equal(generations[file], hash, 'predecessor bytes must survive');
    assert.ok(Object.keys(generations).some((file) => /session\.v3\.jsonl(?:\.zstd)?$/.test(file)));
    let downgrade;
    try { const old = await worker(oldRuntime, migrated, 'read', compression); assert.equal(old.marker, false); downgrade = 'old reader cannot see v3 writes'; }
    catch (error) { assert.match(error.message, /version|format|unsupported|newer/i); downgrade = 'old reader refuses new format'; }
    assert.deepEqual((await worker(oldRuntime, backup, 'read', compression)).semantic, before.semantic);
    assert.deepEqual(await fingerprint(source), sourceHash);
    evidence.push({ compression, before, updated, appended, predecessorFilesRetained: Object.keys(sourceHash).length, backupRestored: true, downgrade });
  }
  const report = { ok: true, credentialsCopied: false, modelCalls: 0, userProfilesOpened: 0, evidence };
  await fs.writeFile(path.join(output, 'result.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(report));
}
module.exports = { fixtureV2, semanticSummary };
if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
