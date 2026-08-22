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

test('workspace directory listing is lazy, sorted, and omits generated roots', async (context) => {
  const root = createWorkspace(context);
  const files = new WorkspaceFiles();
  await files.activate(root);
  const listing = await files.listDirectory('');

  assert.deepEqual(listing.entries.map((entry) => entry.name), ['src', 'README.md']);
  assert.equal(listing.entries[0].kind, 'directory');
  assert.equal(listing.truncated, false);
  assert.deepEqual((await files.listDirectory('src')).entries.map((entry) => entry.path), ['src/app.js']);
});

test('workspace file reader returns bounded UTF text and blocks secrets and binary data', async (context) => {
  const root = createWorkspace(context);
  fs.writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=secret\n', 'utf8');
  fs.writeFileSync(path.join(root, 'image.bin'), Buffer.from([0, 1, 2, 3]));
  fs.writeFileSync(path.join(root, 'large.txt'), 'x'.repeat(40));
  const files = new WorkspaceFiles();
  await files.activate(root);

  const text = await files.readFile('src/app.js');
  assert.equal(text.available, true);
  assert.equal(text.language, 'JavaScript');
  assert.match(text.content, /ready = true/);
  assert.equal((await files.readFile('.env')).reason, 'restricted');
  assert.equal((await files.readFile('image.bin')).reason, 'binary');
  assert.equal((await files.readFile('large.txt', { maxBytes: 20 })).reason, 'too-large');
  assert.equal(isRestrictedWorkspaceFile('nested/private.pem'), true);
});

test('workspace file reader never follows a directory link outside the workspace', async (context) => {
  const root = createWorkspace(context);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-workspace-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'note.txt'), 'outside\n', 'utf8');
  fs.symlinkSync(outside, path.join(root, 'outside-link'), 'junction');
  const files = new WorkspaceFiles();
  await files.activate(root);

  const listing = await files.listDirectory('');
  assert.equal(listing.entries.find((entry) => entry.name === 'outside-link').kind, 'link');
  await assert.rejects(() => files.listDirectory('outside-link'), WorkspaceFilesError);
  assert.equal((await files.readFile('outside-link/note.txt')).reason, 'link');
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
