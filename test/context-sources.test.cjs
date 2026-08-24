const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ContextSourceCatalog, MAX_SOURCE_BYTES } = require('../electron/context-sources.cjs');

test('context source catalog mirrors Harness instruction discovery without reading content', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-context-sources-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const harnessHome = path.join(root, 'harness-home');
  const repository = path.join(root, 'repo');
  const workspace = path.join(repository, 'packages', 'app');
  fs.mkdirSync(path.join(repository, '.git'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(harnessHome, { recursive: true });
  fs.writeFileSync(path.join(harnessHome, 'AGENTS.md'), 'global secret instructions');
  fs.writeFileSync(path.join(repository, 'AGENTS.md'), 'root rules');
  fs.writeFileSync(path.join(repository, 'CLAUDE.md'), 'claude rules');
  fs.truncateSync(path.join(repository, 'CLAUDE.md'), MAX_SOURCE_BYTES + 1);
  fs.writeFileSync(path.join(repository, 'packages', 'AGENTS.local.md'), 'local package rules');
  fs.writeFileSync(path.join(workspace, 'CLAUDE.local.md'), 'local app rules');

  const catalog = new ContextSourceCatalog({ workspacePath: workspace, harnessHome });
  const state = await catalog.scan({ sessionActive: true });
  assert.equal(state.available, true);
  assert.equal(state.projectRoot, repository);
  assert.deepEqual(state.sources.map((source) => source.displayPath), [
    '$DSH_HOME/AGENTS.md',
    'AGENTS.md',
    'CLAUDE.md',
    'packages/AGENTS.local.md',
    'packages/app/CLAUDE.local.md'
  ]);
  assert.equal(state.sources.every((source) => !Object.hasOwn(source, 'content')), true);
  assert.equal(state.sources.find((source) => source.displayPath === 'CLAUDE.md').status, 'oversized');
  assert.equal(state.instructionPolicy.maxSourceBytes, MAX_SOURCE_BYTES);
  assert.equal(state.layers.find((layer) => layer.id === 'durable-session').status, 'active');
  assert.equal(state.memory.status, 'harness-managed');
  assert.equal(await catalog.resolveSourcePath(state.sources[1].id), path.join(repository, 'AGENTS.md'));
  assert.equal(await catalog.resolveSourcePath('../AGENTS.md'), null);
});

test('context source catalog resets reveal tokens after a workspace change', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-context-switch-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  fs.writeFileSync(path.join(first, 'AGENTS.md'), 'first');
  const catalog = new ContextSourceCatalog({ workspacePath: first, harnessHome: path.join(root, 'home') });
  const source = (await catalog.scan()).sources[0];
  catalog.setWorkspace(second);
  assert.equal(await catalog.resolveSourcePath(source.id), null);
  const state = await catalog.scan();
  assert.equal(state.sources.length, 0);
  assert.match(state.memory.detail, /MCP/);
});
