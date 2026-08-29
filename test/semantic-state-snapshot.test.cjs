const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { snapshotSemanticUserData } = require('../scripts/semantic-state-snapshot.cjs');

test('semantic user-data snapshot ignores transient logs and credential files', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-semantic-state-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  };
  write('desktop-state.json', '{"active":"repo"}');
  write('wiki-settings.json', '{"version":1,"vaultPath":"C:\\\\Wiki"}');
  write('harness/sessions/project/session.jsonl', '{"type":"message"}\n');
  write('Local Storage/leveldb/000003.ldb', 'semantic-db');
  write('Local Storage/leveldb/CURRENT', 'MANIFEST-000001');
  write('Local Storage/leveldb/LOG', 'first transient log');
  write('harness/.credentials.yaml', 'api_key: must-not-be-hashed');
  write('harness/profiles/web/package.json', '{"dependencies":{}}');
  write('harness/profiles/web/pnpm-lock.yaml', 'lockfileVersion: 9.0');
  write('harness/profiles/web/node_modules/plugin/secret.txt', 'must-not-be-hashed');
  write('worktrees/ownership.json', '{"version":1,"worktrees":[]}');
  write('worktrees/repository/worktree-20260825-000000-a1b2c3/pending.txt', 'working copy must not enter backup');

  const before = await snapshotSemanticUserData(root);
  write('Local Storage/leveldb/LOG', 'rotated transient log');
  write('harness/.credentials.yaml', 'api_key: changed-secret');
  const afterTransient = await snapshotSemanticUserData(root);
  assert.deepEqual(afterTransient, before);
  assert.equal(before.files.some((file) => /credentials|\/LOG$/i.test(file.path)), false);
  assert.equal(before.files.some((file) => /node_modules/i.test(file.path)), false);
  assert.equal(before.files.some((file) => file.path === 'worktrees/ownership.json'), true);
  assert.equal(before.files.some((file) => /pending\.txt$/i.test(file.path)), false);
  assert.equal(before.files.some((file) => file.path === 'wiki-settings.json'), true);
  assert.equal(before.counts.pluginProfiles, 2);

  write('harness/sessions/project/session.jsonl', '{"type":"changed"}\n');
  const afterSemantic = await snapshotSemanticUserData(root);
  assert.notDeepEqual(afterSemantic, before);
  assert.equal(afterSemantic.counts.sessions, 1);

  write('harness/profiles/web/package.json.dsh-desktop-plugin-last-known-good.json', '{"version":1}');
  const afterPluginState = await snapshotSemanticUserData(root);
  assert.notDeepEqual(afterPluginState, afterSemantic);
  assert.equal(afterPluginState.counts.pluginProfiles, 3);
});
