'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const { HarnessSupervisor } = require(path.join(repo, 'electron/harness-supervisor.cjs'));
const { authenticateHarnessSupervisor } = require(path.join(repo, 'scripts/harness-smoke-auth.cjs'));
const { createSessionReadHost } = require(path.join(repo, 'scripts/harness-session-read-host.cjs'));
const { callHarnessApi } = require(path.join(repo, 'electron/harness-workspace-sync.cjs'));
const runtime = path.join(repo, 'vendor/harness-hoisted-0.1.5-alpha.1-desktop-security-2');
const resolve = createRequire(path.join(runtime, 'cold-read-gate.cjs'));
const load = (name) => import(pathToFileURL(resolve.resolve(name)).href);
const sha = (value) => createHash('sha256').update(value).digest('hex');

async function fixtureEvents(sessionId, workspace) {
  const [{ sessionFormatCatalog }, { releasedV2SessionFormatCodec }] = await Promise.all([
    load('@deepseek-ai/dsh-session-format-catalog'), load('@deepseek-ai/dsh-session-format-v2-to-v3')]);
  const restore = sessionFormatCatalog.createRestore({ type: 'session', version: 2, id: sessionId, createdAt: 1700000000000,
    cwd: workspace, delegationDepth: 0, isSeeded: false, agentPreset: 'standard' }, { recovery: 'strict', validation: 'current' });
  for (const row of require('./smoke-harness-v3.cjs').fixtureV2()) restore.decodeRow(releasedV2SessionFormatCodec.encodeEvent(row));
  return restore.finish().events;
}
async function fingerprint(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = {};
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) {
      for (const [name, digest] of Object.entries(await fingerprint(absolute))) result[`${entry.name}/${name}`] = digest;
    } else if (entry.isFile() && /\.jsonl(?:\.zstd)?$/.test(entry.name)) result[entry.name] = sha(await fs.readFile(absolute));
  }
  return result;
}
function probe(child, operation, sessionId, workspacePath) {
  return new Promise((resolveResult, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => finish(new Error('Probe IPC timeout.')), 10000);
    const onMessage = (message) => {
      if (message?.channel === 'dsh-cold-read-probe' && message.requestId === requestId) finish(null, message.value);
    };
    const finish = (error, value) => { clearTimeout(timer); child.off('message', onMessage); error ? reject(error) : resolveResult(value); };
    child.on('message', onMessage);
    child.send({ channel: 'dsh-cold-read-probe', requestId, operation, sessionId, workspacePath }, (error) => { if (error) finish(error); });
  });
}
async function main() {
  const destination = await fs.mkdtemp(path.join(repo, 'artifacts', 'v1.1.11-cold-read-'));
  const homeDir = path.join(destination, 'home'), workspace = path.join(destination, '合成 工作区');
  const sessions = path.join(homeDir, 'sessions'), sessionId = `session-${randomUUID()}`;
  await fs.mkdir(sessions, { recursive: true }); await fs.mkdir(workspace);
  const [{ Context }, { default: Jsonl }] = await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session-persistence-jsonl')]);
  const ctx = new Context(); let supervisor;
  const expected = await fixtureEvents(sessionId, workspace);
  try {
    await ctx.plugin(Jsonl, { root: sessions, compression: 'zstd' });
    const initial = await ctx.sessionPersistence.create({ version: 3, id: sessionId, createdAt: 1700000000000,
      cwd: workspace, delegationDepth: 0, isSeeded: false, agentPreset: 'standard' });
    try { await initial.append(expected); await initial.flush(); } finally { await initial.close(); }
    const before = await fingerprint(sessions);
    assert.equal(Object.keys(before).length, 1, 'one synthetic v3 log');
    supervisor = new HarnessSupervisor({ rootDir: repo, resourcesPath: repo, isPackaged: false,
      homeDir, launchDir: workspace, logFile: path.join(destination, 'harness.log'),
      startTimeoutMs: 60000, stopTimeoutMs: 8000,
      spawnImpl: (command, args, options) => {
        const allowed = new Set(['SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT', 'NO_COLOR']);
        const env = Object.fromEntries(Object.entries(options.env).filter(([name]) => allowed.has(name.toUpperCase()) || /^DSH_(HOME|CWD|BUNDLED_SKILL_DIR|DESKTOP_(DOCX_TOOL|XLSX_TOOL|PPTX_TOOL|WIKI_TOOL|WIKI_CONFIG|WIKI_HISTORY_SOURCE|NODE|TOOL_MODULE))$/.test(name)));
        assert.equal(Object.keys(env).some((key) => /KEY|TOKEN|SECRET|CREDENTIAL|PROXY/i.test(key)), false);
        return spawn(command, args, { ...options, env });
      },
      createCredentialHost: async (options) => {
        const host = await createSessionReadHost({ ...options, rootDir: repo });
        assert.equal(host.providerModule, undefined);
        const pluginDir = path.join(homeDir, 'profiles/node_modules/dsh-cold-read-probe');
        await fs.mkdir(pluginDir, { recursive: true });
        await fs.copyFile(path.join(__dirname, 'cold-read-probe.mjs'), path.join(pluginDir, 'index.mjs'));
        await fs.writeFile(path.join(pluginDir, 'package.json'), JSON.stringify({ name: 'dsh-cold-read-probe', type: 'module', exports: './index.mjs' }), { flag: 'wx' });
        await fs.appendFile(host.patchPath, '\n- insert:\n    - id: cold-read-probe\n      name: dsh-cold-read-probe\n');
        return host;
      }
    });
    const auth = await authenticateHarnessSupervisor(supervisor);
    const inspect = () => probe(supervisor.child, 'inspect', sessionId, workspace);
    const assertCold = async () => assert.deepEqual(await inspect(), { createdAgents: 0, liveAgent: false, liveSession: false });
    await assertCold();
    const pages = [], all = [];
    let cut, beforeSeq;
    // An external process already owns write access: cold reads must still work.
    const writer = await ctx.sessionPersistence.open(sessionId, 'write');
    try {
      for (let count = 0; count < 50; count++) {
        const page = await auth.apiCall(auth.origin, 'session.history', { sessionId, maxMessages: 1,
          ...(cut === undefined ? {} : { throughSeq: cut }), ...(beforeSeq === undefined ? {} : { beforeSeq }) });
        cut ??= page.throughSeq;
        assert.equal(page.throughSeq, cut);
        const records = page.events.map((record) => record.event);
        assert.ok(records.length > 0);
        pages.push({ first: records[0].seq, last: records.at(-1).seq, hasMore: page.hasMore });
        all.unshift(...records);
        if (!page.hasMore) break;
        beforeSeq = records[0].seq;
      }
      assert.equal(pages.at(-1).hasMore, false);
      assert.ok(pages.length >= 3);
      assert.deepEqual(all, expected, 'every event, final answer, stream and tool block is preserved across pages');
      assert.equal(cut, expected.length - 1);
      await assertCold();
      assert.deepEqual(await fingerprint(sessions), before, 'cold reads never rewrite the persisted session');
      await writer.append([{ type: 'agent-preset/selected', seq: expected.length, time: 1700000200000, data: { agentPreset: 'isolated-writer-checkpoint' } }]);
      await writer.flush();
    } finally { await writer.close(); }
    const updated = await fingerprint(sessions);
    const pinned = await auth.apiCall(auth.origin, 'session.history', { sessionId, maxMessages: 1000, throughSeq: cut });
    assert.deepEqual(pinned.events.map((record) => record.event), expected, 'fixed cursor excludes subsequent external writes');
    const latest = await auth.apiCall(auth.origin, 'session.history', { sessionId, maxMessages: 1000 });
    assert.equal(latest.throughSeq, expected.length);
    assert.equal(latest.events.at(-1).event.data.agentPreset, 'isolated-writer-checkpoint');
    await assertCold();
    const reopen = await ctx.sessionPersistence.open(sessionId, 'write');
    await reopen.close();
    await assert.rejects(auth.apiCall(auth.origin, 'session.history', { sessionId, throughSeq: latest.throughSeq + 100 }), /历史快照/);
    await assert.rejects(auth.apiCall(auth.origin, 'session.history', { sessionId, maxMessages: 1001 }), /分页位置/);
    await assert.rejects(auth.apiCall(auth.origin, 'session.history', { sessionId: `session-${randomUUID()}` }));
    await assert.rejects(supervisor.credentialHost.sessionControl.request('fork', {}), /only read-only/);
    await assert.rejects(callHarnessApi(auth.origin, 'session.history', { sessionId }, { fetchImpl: auth.fetchImpl }), /只读历史通道/);
    await assert.rejects(auth.apiCall('http://127.0.0.1:1', 'session.history', { sessionId }), /authenticated process/);
    const terminal = await probe(supervisor.child, 'terminal-check', sessionId, workspace);
    assert.equal(terminal.terminalDenied, true);
    assert.match(terminal.error, /unavailable.*isolated history/);
    const rpcId = randomUUID();
    const oldRoute = await auth.fetchImpl(`${auth.origin}/api/session/history`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'session/history', payload: { args: { request: { sessionId } } } }) });
    const oldBody = await oldRoute.text();
    assert.ok(!oldRoute.ok || JSON.parse(oldBody).result?.ok === false, 'old HTTP history method must not silently succeed');
    await assertCold();
    assert.deepEqual(await fingerprint(sessions), updated);
    // The official authenticated Web profile generates its own browser-session
    // record. It is not a model credential and must not be logged or disabled.
    const nativeCredentials = resolve('js-yaml').load(await fs.readFile(path.join(homeDir, '.credentials.yaml'), 'utf8'));
    assert.deepEqual(Object.keys(nativeCredentials).sort(), ['records', 'version']);
    assert.deepEqual(Object.keys(nativeCredentials.records), ['client-connection/browser-session']);
    const result = { ok: true, runtime: '0.1.5-alpha.1', fixture: 'synthetic-two-completed-v3-tool-turns',
      modelCredentialsLoaded: false, officialBrowserSessionRecordOnly: true,
      modelCalls: 0, agentsCreated: 0, liveSessionPublished: false,
      events: expected.length, pages, authenticatedPrivateHistory: true, oldHttpRouteStatus: oldRoute.status,
      concurrentExternalWriter: true, fixedCutPreserved: true, freshCutSeesAppend: true, writeOwnershipReleased: true,
      invalidInputsRefused: true, writeOperationsRefused: true, terminalReadRefused: true, sourceUnchangedByReads: true };
    await fs.writeFile(path.join(destination, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ ...result, evidenceDir: path.relative(repo, destination) })}\n`);
  } finally {
    if (supervisor) await supervisor.stop();
    await ctx.fiber.dispose();
  }
}
main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
