const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const read = (file) => fs.readFileSync(file, 'utf8');
const projectRoot = path.resolve(__dirname, '..');

test('official Harness owns queue, steer and stop interaction', (context) => {
  const runtimeManifest = JSON.parse(read(path.join(projectRoot, 'runtime', 'harness', 'package.json')));
  const identity = runtimeManifest.dshDesktop;
  assert.equal(identity.packageVersion, runtimeManifest.version);
  assert.equal(identity.tag, `dsh-v${runtimeManifest.version}`);
  assert.match(identity.commit, /^[0-9a-f]{40}$/);
  const sourceRoot = path.join(projectRoot, 'vendor', `harness-source-${runtimeManifest.version}`);
  if (!fs.existsSync(sourceRoot)) {
    context.skip('The ignored upstream source checkout is available only during local compatibility validation.');
    return;
  }
  const sourceManifest = JSON.parse(read(path.join(sourceRoot, 'package.json')));
  assert.equal(sourceManifest.version, runtimeManifest.version);
  const git = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', 'HEAD'), identity.commit);
  assert.equal(git('rev-parse', `${identity.tag}^{commit}`), identity.commit);
  assert.equal(git('remote', 'get-url', 'origin'), identity.repository);
  const changed = git('diff', 'HEAD', '--name-only').split(/\r?\n/).filter(Boolean).sort();
  if (changed.length) {
    // Security resolution is an exact reviewed overlay, never an upstream UI edit.
    assert.deepEqual(changed, ['pnpm-lock.yaml', 'pnpm-workspace.yaml']);
    const policy = require('../runtime/harness-security/overrides.json');
    assert.equal(policy.upstreamCommit, identity.commit);
    for (const [file, expected] of [['pnpm-lock.yaml', policy.lockSha256], ['pnpm-workspace.yaml', policy.workspaceSha256]]) {
      assert.equal(createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, file))).digest('hex'), expected);
    }
  }
  const clientRoot = path.join(sourceRoot, 'packages', 'client', 'ui-conversation', 'src', 'client');
  const inputBar = read(path.join(clientRoot, 'skeleton', 'InputBar.tsx'));
  const inputHub = read(path.join(clientRoot, 'input', 'hub.ts'));
  const editorBinding = read(path.join(clientRoot, 'input', 'editor', 'view-binding.ts'));
  const submission = read(path.join(clientRoot, 'input', 'submission-policy.ts'));

  assert.match(inputBar, /installDraftKeymap\(editor, keyboard, gate\)/);
  assert.match(editorBinding, /accelerated && g\.canSteerQueue/);
  assert.match(editorBinding, /keyboard\.steerQueue\(\)/);
  assert.match(inputHub, /updateQueue\(item\.id, \{ kind: 'steer' \}\)/);
  assert.match(submission, /BusyEnterBehavior/);
  assert.match(inputBar, /onClick=\{stop\}/);
});

test('desktop does not intercept or reimplement official queue and steer controls', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  const manifest = read('package.json');
  const client = read('electron/session-control-client.cjs');
  const host = read('runtime/dsh-desktop-tools/session-control.mjs');
  const smoke = read('electron/session-workflow-smoke.cjs');

  assert.equal(fs.existsSync('electron/harness-reliable-interrupt.cjs'), false);
  assert.equal(fs.existsSync('assets/harness-reliable-interrupt.js'), false);
  assert.equal(fs.existsSync('assets/session-workflow.js'), false);
  for (const source of [main, preload, manifest]) {
    assert.doesNotMatch(source, /harness-reliable-interrupt|interrupt-and-prompt|interrupt-queued/);
  }
  assert.doesNotMatch(manifest, /assets\/session-workflow\.js/);
  assert.doesNotMatch(client, /resume-queue/);
  assert.doesNotMatch(host, /resume-queue/);

  assert.match(smoke, /Steer queued message/);
  assert.match(smoke, /querySelectorAll\('button'\)/);
  assert.match(smoke, /pressEnter\(true\)/);
  assert.match(smoke, /Stop generating/);
  assert.doesNotMatch(smoke, /__DSH_WORKFLOW__|dsh-session-workflow|reliable interrupt/i);
});
