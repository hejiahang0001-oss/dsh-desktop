// Compare cold JSONL history with both fixed runtimes using an isolated copy.
// Copies only sessions and projection caches; never credentials or user settings.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { HarnessSupervisor } = require('../electron/harness-supervisor.cjs');
const { authenticateHarnessSupervisor } = require('./harness-smoke-auth.cjs');

const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function filesUnder(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, 'linked fixture paths are forbidden');
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) files.push(full);
      assert.ok(files.length + pending.length <= 2000, 'bounded upgrade fixture');
    }
  }
  return files.sort();
}
async function fingerprint(root) {
  const result = {};
  for (const file of await filesUnder(root)) result[path.relative(root, file)] = hash(await fs.readFile(file));
  return result;
}
async function readHistory(runtime, dataRoot, label) {
  const root = path.resolve(__dirname, '..');
  const supervisor = new HarnessSupervisor({ rootDir: root, resourcesPath: root, isPackaged: false,
    homeDir: path.join(dataRoot, 'harness'), launchDir: path.join(dataRoot, 'workspace'),
    logFile: path.join(dataRoot, `${label}.log`),
    env: { DSH_DESKTOP_NODE: path.join(root, 'vendor/runtime/win32-x64/node.exe'),
      DSH_DESKTOP_DSH_BIN: path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      DEEPSEEK_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' }
  });
  try {
    const { origin, apiCall } = await authenticateHarnessSupervisor(supervisor);
    const { items } = await apiCall(origin, 'session.list', {});
    assert.ok(items.length > 0 && items.length <= 100, 'nonempty bounded session fixture');
    const rows = [];
    for (const item of items) {
      if (item.origin === 'subagent') continue;
      const history = await apiCall(origin, 'session.history', { sessionId: item.sessionId, maxMessages: 1000 });
      assert.equal(history.hasMore, false, 'fixture history must fit one complete page');
      rows.push({ sessionId: item.sessionId, eventCount: history.events.length,
        userMessages: history.events.filter((row) => row.event?.type === 'user/message').length,
        assistantMessages: history.events.filter((row) => row.event?.type === 'assistant/message').length,
        historyHash: hash(JSON.stringify(history.events)) });
    }
    return rows.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  } finally { await supervisor.stop(); }
}
async function main() {
  const inputs = Object.fromEntries(['old-runtime', 'new-runtime', 'fixture-home', 'output-root'].map((key) => [key, arg(key)]));
  for (const value of Object.values(inputs)) assert.ok(value && path.isAbsolute(value), 'all paths must be absolute');
  const source = inputs['fixture-home'], destination = inputs['output-root'];
  // A fresh destination prevents mutation of a real profile or previous evidence.
  await fs.mkdir(destination);
  const sessions = path.join(source, 'sessions');
  const before = await fingerprint(sessions);
  await fs.mkdir(path.join(destination, 'harness'));
  for (const relative of ['sessions', 'storages/session_projcache']) {
    const target = path.join(source, relative);
    try { await filesUnder(target); }
    catch (error) { if (error.code === 'ENOENT' && relative !== 'sessions') continue; throw error; }
    await fs.cp(target, path.join(destination, 'harness', relative), { recursive: true, errorOnExist: true, force: false });
  }
  const old = await readHistory(inputs['old-runtime'], destination, 'old-runtime');
  const updated = await readHistory(inputs['new-runtime'], destination, 'new-runtime');
  assert.deepEqual(updated, old, 'upgraded runtime must read the identical persisted event records');
  assert.ok(old.some((row) => row.userMessages > 0 && row.assistantMessages > 0), 'real conversation coverage required');
  assert.deepEqual(await fingerprint(sessions), before, 'source sessions remain byte-for-byte unchanged');
  const report = { ok: true, sessions: old, sourceFilesUnchanged: Object.keys(before).length,
    credentialsCopied: false, modelCalls: 0, storage: 'jsonl-zstd', sqliteMigrationTested: false };
  await fs.writeFile(path.join(destination, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
