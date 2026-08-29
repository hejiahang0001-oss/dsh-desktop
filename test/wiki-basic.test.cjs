'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  WikiBasicError,
  WikiSettingsStore,
  buildCapturePreview,
  initializeWikiVault,
  inspectWikiVault,
  queryWiki,
  saveCapture
} = require('../resources/skills/llm-wiki/scripts/wiki-basic.cjs');

const fixedClock = () => new Date('2026-08-29T08:00:00.000Z');

const fixture = async (t, name = 'DSH Wiki 中文 空格') => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-wiki-basic-'));
  const vault = path.join(root, name);
  await fsp.mkdir(vault, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, vault };
};

test('Wiki setup initializes a no-Git Chinese path and preserves existing files', async (t) => {
  const { vault } = await fixture(t);
  const existingIndex = '# Existing index\n\nkeep-me\n';
  await fsp.writeFile(path.join(vault, 'index.md'), existingIndex, 'utf8');
  const result = await initializeWikiVault(vault, { clock: fixedClock });
  assert.equal(result.ok, true);
  assert.equal(result.state.status, 'ready');
  assert.equal(await fsp.readFile(path.join(vault, 'index.md'), 'utf8'), existingIndex);
  assert.ok(result.preserved.includes('index.md'));
  assert.equal(fs.existsSync(path.join(vault, '.git')), false);
  for (const required of ['concepts', 'entities', 'skills', 'references', 'synthesis', 'journal', 'projects', '_raw', '_staging', '_archives', '.obsidian']) {
    assert.equal(fs.statSync(path.join(vault, required)).isDirectory(), true, required);
  }
});

test('Wiki settings persist only an authorized absolute vault path', async (t) => {
  const { root, vault } = await fixture(t);
  const config = path.join(root, 'wiki-settings.json');
  const store = new WikiSettingsStore({ filePath: config });
  await store.init();
  await store.setVault(vault);
  const reopened = new WikiSettingsStore({ filePath: config });
  assert.equal((await reopened.init()).vaultPath, path.resolve(vault));
  await assert.rejects(() => store.setVault('relative-vault'), (error) => error instanceof WikiBasicError && error.code === 'invalid-path');
});

test('Wiki settings retain a temporarily unavailable vault for later recovery', async (t) => {
  const { root, vault } = await fixture(t);
  const config = path.join(root, 'wiki-settings.json');
  const store = new WikiSettingsStore({ filePath: config });
  await store.init();
  await store.setVault(vault);
  await fsp.rm(vault, { recursive: true, force: true });
  const reopened = new WikiSettingsStore({ filePath: config });
  assert.equal((await reopened.init()).vaultPath, path.resolve(vault));
  assert.equal((await inspectWikiVault(reopened.getState().vaultPath)).status, 'unavailable');
});

test('Wiki query returns bounded page and source locations but excludes raw staging', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  await fsp.writeFile(path.join(vault, 'concepts', 'checkpoint.md'), `---\ntitle: Checkpoint 恢复\nsummary: 自动检查点与代码恢复边界\ntags: [dsh, recovery]\nsources:\n  - DSH_DESKTOP_ITERATION_PLAN.md\nlifecycle: draft\nupdated: 2026-08-29T08:00:00.000Z\n---\n\n# Checkpoint 恢复\n\n自动检查点在无 Git 时静默跳过，手动操作显示真实状态。\n`, 'utf8');
  await fsp.writeFile(path.join(vault, '_raw', 'secret-draft.md'), '# Checkpoint\n\nraw-only-marker\n', 'utf8');
  const result = await queryWiki(vault, '无 Git 检查点', { limit: 4, clock: fixedClock });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, 'concepts/checkpoint.md');
  assert.deepEqual(result.results[0].sources, ['DSH_DESKTOP_ITERATION_PLAN.md']);
  assert.doesNotMatch(JSON.stringify(result), /raw-only-marker/);
  assert.match(await fsp.readFile(path.join(vault, 'log.md'), 'utf8'), /QUERY query="无 Git 检查点" result_pages=1/);
});

test('Wiki capture previews sensitive content and requires a second confirmation', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const capture = {
    title: '代理配置结论',
    content: '不要保存 DEEPSEEK_API_KEY=sk-12345678901234567890。',
    sourceSessionId: 'session-11111111-1111-4111-8111-111111111111',
    sourceSeq: 18,
    sourceTime: 1787990400000
  };
  const preview = buildCapturePreview(vault, capture);
  assert.equal(preview.relativePath, 'synthesis/代理配置结论.md');
  assert.ok(preview.sensitive.length >= 1);
  await assert.rejects(
    () => saveCapture(vault, capture, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'sensitive-confirmation-required'
  );
  assert.equal(fs.existsSync(preview.absolutePath), false);
});

test('Wiki capture creates one page and updates index and log without overwriting', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const capture = {
    title: '无 Git 自动检查点边界',
    content: '自动检查点不可用时静默降级；手动检查点仍展示真实状态。',
    sourceSessionId: 'session-22222222-2222-4222-8222-222222222222',
    sourceSeq: 42,
    sourceTime: 1787990400000
  };
  const result = await saveCapture(vault, capture, { workspaceName: '中文 工作区', clock: fixedClock });
  assert.equal(result.ok, true);
  const page = await fsp.readFile(path.join(vault, result.path), 'utf8');
  assert.match(page, /dsh-session:session-22222222-2222-4222-8222-222222222222#seq=42/);
  assert.match(page, /source_time: 1787990400000/);
  assert.match(page, /原始会话保持只读/);
  assert.match(await fsp.readFile(path.join(vault, 'index.md'), 'utf8'), /\[\[synthesis\/无-git-自动检查点边界\|无 Git 自动检查点边界\]\]/i);
  assert.match(await fsp.readFile(path.join(vault, 'log.md'), 'utf8'), /CAPTURE type=synthesis/);
  await assert.rejects(
    () => saveCapture(vault, capture, { workspaceName: '中文 工作区', clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'page-exists'
  );
  assert.equal((await inspectWikiVault(vault)).status, 'ready');
});
