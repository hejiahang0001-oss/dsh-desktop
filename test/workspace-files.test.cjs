const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  WorkspaceFiles,
  WorkspaceFilesError,
  isRestrictedWorkspaceFile,
  normalizeRelativePath
} = require('../electron/workspace-files.cjs');

const createWorkspace = (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-files-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'README.md'), '# Ready\n', 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const ready = true;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'node_modules', 'hidden.js'), 'hidden\n', 'utf8');
  fs.writeFileSync(path.join(root, '.git', 'config'), 'hidden\n', 'utf8');
  return root;
};

test('workspace paths are relative, normalized, and cannot traverse', () => {
  assert.equal(normalizeRelativePath('src/app.js'), 'src/app.js');
  assert.equal(normalizeRelativePath('src\\app.js'), 'src/app.js');
  assert.throws(() => normalizeRelativePath('../secret.txt'), WorkspaceFilesError);
  assert.throws(() => normalizeRelativePath('C:\\secret.txt'), WorkspaceFilesError);
  assert.throws(() => normalizeRelativePath('src//app.js'), WorkspaceFilesError);
});

test('workspace preview descriptors disclose no bytes and reject secrets and non-files', async (context) => {
  const root = createWorkspace(context);
  fs.writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=secret\n', 'utf8');
  fs.mkdirSync(path.join(root, 'secrets'));
  fs.writeFileSync(path.join(root, 'secrets', 'token.txt'), 'nested-secret\n', 'utf8');
  fs.mkdirSync(path.join(root, 'CrEdEnTiAlS'));
  fs.writeFileSync(path.join(root, 'CrEdEnTiAlS', 'api.txt'), 'mixed-case-secret\n', 'utf8');
  const files = new WorkspaceFiles();
  await files.activate(root);

  assert.deepEqual(await files.describeFile('src/app.js'), { path: 'src/app.js' });
  for (const file of ['.env', 'secrets/token.txt', 'CrEdEnTiAlS/api.txt']) {
    await assert.rejects(files.describeFile(file), { code: 'restricted' });
  }
  await assert.rejects(files.describeFile('src'), { code: 'not-file' });
  await assert.rejects(files.describeFile('../outside.txt'), { code: 'path-traversal' });
  await assert.rejects(files.describeFile(path.join(root, 'README.md')), { code: 'path-absolute' });
  assert.equal(isRestrictedWorkspaceFile('nested/private.pem'), true);
  assert.equal(isRestrictedWorkspaceFile('secrets/token.txt'), true);
});

test('workspace preview descriptors never follow a directory link outside the workspace', async (context) => {
  const root = createWorkspace(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'note.txt'), 'outside\n', 'utf8');
  fs.symlinkSync(outside, path.join(root, 'outside-link'), 'junction');
  const files = new WorkspaceFiles();
  await files.activate(root);

  await assert.rejects(files.describeFile('outside-link/note.txt'), { code: 'link' });
});

test('workspace filename search is bounded and skips generated and linked directories', async (context) => {
  const root = createWorkspace(context);
  fs.writeFileSync(path.join(root, 'src', 'ready.test.js'), 'test\n', 'utf8');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-search-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'ready-secret.js'), 'outside\n', 'utf8');
  fs.symlinkSync(outside, path.join(root, 'linked'), 'junction');
  const files = new WorkspaceFiles();
  await files.activate(root);
  const result = await files.search('ready');

  assert.deepEqual(result.results.map((entry) => entry.path), ['src/ready.test.js']);
  assert.equal(result.results.some((entry) => entry.path.includes('node_modules')), false);
  assert.equal(result.results.some((entry) => entry.path.includes('linked')), false);
});
