'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  WikiBasicError,
  WikiSettingsStore,
  buildCapturePreview,
  buildDshHistoryIngestPlan,
  buildProjectSyncPlan,
  initializeWikiVault,
  inspectWikiVault,
  previewDshHistoryIngest,
  previewProjectSync,
  queryWiki,
  readDshHistorySession,
  readDshHistorySource,
  readDshHistoryWikiPage,
  readProjectWikiPage,
  saveCapture,
  saveDshHistoryIngest,
  saveProjectSync
} = require('../resources/skills/llm-wiki/scripts/wiki-basic.cjs');

const fixedClock = () => new Date('2026-08-29T08:00:00.000Z');

const writeHistorySource = async (sourcePath, workspace, {
  sourceToken = '0123456789abcdef0123456789abcdef',
  sourceId = 'a'.repeat(24),
  title = 'DSH 历史导入会话',
  messages = [
    { seq: 1, time: 100, role: 'user', text: '请整理项目知识。' },
    { seq: 2, time: 200, role: 'assistant', text: '固定历史导入应保留来源并去重。' }
  ],
  redactions = [],
  limited = false,
  expiresAt = '2026-08-29T08:30:00.000Z'
} = {}) => {
  const updatedAt = 200;
  const fingerprint = createHash('sha256').update(JSON.stringify({ sourceId, updatedAt, messages })).digest('hex');
  const source = {
    version: 1,
    sourceToken,
    createdAt: '2026-08-29T07:50:00.000Z',
    expiresAt,
    workspacePath: path.resolve(workspace),
    workspaceName: path.basename(workspace),
    limited,
    totalMessages: messages.length,
    totalChars: messages.reduce((sum, message) => sum + message.text.length, 0),
    redactions,
    sessions: [{ sourceId, title, updatedAt, lastSeq: messages[messages.length - 1].seq, fingerprint, messages, redactions, limited }]
  };
  await fsp.writeFile(sourcePath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  return source;
};

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

test('project sync preview is bounded, excludes credentials, and works without Git', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, '项目 源码');
  await fsp.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fsp.mkdir(path.join(workspace, 'node_modules', 'ignored'), { recursive: true });
  await fsp.mkdir(path.join(workspace, 'PRIVATE'), { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# 项目\n\n面向 Windows 的桌面工具。\n', 'utf8');
  await fsp.writeFile(path.join(workspace, 'src', 'app.js'), 'module.exports = { ready: true };\n', 'utf8');
  await fsp.writeFile(path.join(workspace, '.env'), 'DEEPSEEK_API_KEY=must-not-appear\n', 'utf8');
  await fsp.writeFile(path.join(workspace, '.dsh-wiki-update-test.json'), '{"temporary":"must-not-appear"}\n', 'utf8');
  await fsp.writeFile(path.join(workspace, 'node_modules', 'ignored', 'index.js'), 'ignored\n', 'utf8');
  await fsp.writeFile(path.join(workspace, 'PRIVATE', 'notes.md'), 'private-directory-marker\n', 'utf8');
  await fsp.writeFile(path.join(workspace, 'oversized.md'), Buffer.alloc((256 * 1024) + 1, 0x61));
  let deep = path.join(workspace, 'zz-depth');
  for (let index = 0; index < 22; index += 1) deep = path.join(deep, `level-${index}`);
  await fsp.mkdir(deep, { recursive: true });
  await fsp.writeFile(path.join(deep, 'too-deep.md'), 'deep-marker\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });

  const preview = await previewProjectSync(vault, workspace, {
    clock: fixedClock,
    inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' })
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.mode, 'inventory');
  assert.equal(preview.unchanged, false);
  assert.equal(preview.limited, true);
  assert.deepEqual(preview.delta.added.map((item) => item.path), ['README.md', 'src/app.js']);
  assert.doesNotMatch(JSON.stringify(preview), /must-not-appear|private-directory-marker|deep-marker|\.env|node_modules|oversized\.md/i);
  assert.match(preview.project.overviewPath, /^projects\/.+\/.+\.md$/);
});

test('project sync creates and incrementally updates pages without duplication', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'Wiki Product');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Wiki Product\n\nLocal project knowledge.\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const overviewPath = preview.project.overviewPath;
  const spec = {
    previewToken: preview.previewToken,
    pages: [{
      path: overviewPath,
      expectedSha256: null,
      title: 'Wiki Product',
      summary: '记录项目架构、边界和关键决策。',
      content: '# Wiki Product\n\n这是从 README 提取的项目事实。\n\n- 未来扩展需要保留来源。 ^[inferred]',
      sources: ['README.md'],
      provenance: { extracted: 0.8, inferred: 0.2, ambiguous: 0 }
    }]
  };
  const plan = await buildProjectSyncPlan(vault, workspace, spec, options);
  assert.equal(plan.pagesCreated, 1);
  assert.equal(plan.pagesUpdated, 0);
  const saved = await saveProjectSync(vault, workspace, spec, { ...options, confirmed: true });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.pagesCreated, [overviewPath]);
  const page = await fsp.readFile(path.join(vault, overviewPath), 'utf8');
  assert.match(page, /base_confidence: 0\.59/);
  assert.match(page, /source_cwd:/);
  assert.match(page, /\^\[inferred\]/);
  const unchanged = await previewProjectSync(vault, workspace, options);
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.existingPages.length, 1);
  await assert.rejects(
    () => saveProjectSync(vault, workspace, { ...spec, previewToken: unchanged.previewToken }, { ...options, confirmed: true }),
    (error) => error instanceof WikiBasicError && error.code === 'project-unchanged'
  );

  await fsp.writeFile(path.join(workspace, 'README.md'), '# Wiki Product\n\nLocal project knowledge with an incremental decision.\n', 'utf8');
  const changed = await previewProjectSync(vault, workspace, options);
  assert.equal(changed.delta.modified.length, 1);
  const currentPage = await readProjectWikiPage(vault, workspace, overviewPath, options);
  const updateSpec = {
    previewToken: changed.previewToken,
    pages: [{
      ...spec.pages[0],
      expectedSha256: currentPage.sha256,
      content: '# Wiki Product\n\n增量合并后的事实和决策。'
    }]
  };
  const updated = await saveProjectSync(vault, workspace, updateSpec, { ...options, confirmed: true });
  assert.deepEqual(updated.pagesUpdated, [overviewPath]);
  assert.equal((await previewProjectSync(vault, workspace, options)).unchanged, true);
  const manifest = JSON.parse(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'));
  assert.equal(Object.keys(manifest.projects).length, 1);
  assert.deepEqual(manifest.projects[changed.project.id].pages_in_vault, [overviewPath]);
  assert.match(await fsp.readFile(path.join(vault, 'log.md'), 'utf8'), /WIKI_UPDATE project=/);
});

test('project sync rejects stale source previews and rolls back a failed transaction', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'rollback-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Before\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const spec = {
    previewToken: preview.previewToken,
    pages: [{
      path: preview.project.overviewPath,
      expectedSha256: null,
      title: 'Rollback Project',
      summary: '验证陈旧预览和事务回滚。',
      content: '# Rollback Project\n\nBefore.',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Changed after preview\n', 'utf8');
  await assert.rejects(
    () => saveProjectSync(vault, workspace, spec, { ...options, confirmed: true }),
    (error) => error instanceof WikiBasicError && error.code === 'stale-project-preview'
  );
  assert.equal(fs.existsSync(path.join(vault, preview.project.overviewPath)), false);

  const fresh = await previewProjectSync(vault, workspace, options);
  const freshSpec = { ...spec, previewToken: fresh.previewToken };
  const originalManifest = await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8');
  const originalIndex = await fsp.readFile(path.join(vault, 'index.md'), 'utf8');
  await assert.rejects(
    () => saveProjectSync(vault, workspace, freshSpec, {
      ...options,
      confirmed: true,
      afterPageWrites: async () => { throw new Error('injected-transaction-failure'); }
    }),
    /injected-transaction-failure/
  );
  assert.equal(fs.existsSync(path.join(vault, fresh.project.overviewPath)), false);
  assert.equal(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'), originalManifest);
  assert.equal(await fsp.readFile(path.join(vault, 'index.md'), 'utf8'), originalIndex);
  assert.equal(fs.existsSync(path.join(vault, '_staging', '.dsh-wiki-project-sync.lock')), false);
});

test('project sync serializes concurrent writers and releases its lock', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'concurrent-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Concurrent project\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const spec = {
    previewToken: preview.previewToken,
    pages: [{
      path: preview.project.overviewPath,
      expectedSha256: null,
      title: 'Concurrent project',
      summary: 'Only one writer may commit at a time.',
      content: '# Concurrent project',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  let releaseFirst;
  let signalFirst;
  const firstPaused = new Promise((resolve) => { signalFirst = resolve; });
  const continueFirst = new Promise((resolve) => { releaseFirst = resolve; });
  const first = saveProjectSync(vault, workspace, spec, {
    ...options,
    confirmed: true,
    afterPageWrites: async () => {
      signalFirst();
      await continueFirst;
    }
  });
  await firstPaused;
  await assert.rejects(
    () => saveProjectSync(vault, workspace, spec, { ...options, confirmed: true }),
    (error) => error instanceof WikiBasicError && error.code === 'project-sync-busy'
  );
  releaseFirst();
  assert.equal((await first).ok, true);
  assert.equal(fs.existsSync(path.join(vault, '_staging', '.dsh-wiki-project-sync.lock')), false);
});

test('project sync never overwrites an untracked Wiki page', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'existing-page-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Existing page project\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const relativeTarget = `${preview.project.rootPath}/concepts/manual.md`;
  const target = path.join(vault, relativeTarget);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, '# Human page\n\nDo not overwrite.\n', 'utf8');
  const spec = {
    previewToken: preview.previewToken,
    pages: [{
      path: preview.project.overviewPath,
      expectedSha256: null,
      title: 'Existing page project',
      summary: 'Required first project overview.',
      content: '# Existing page project',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }, {
      path: relativeTarget,
      expectedSha256: null,
      title: 'Existing page project',
      summary: 'This should be rejected.',
      content: '# Replacement',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, spec, options),
    (error) => error instanceof WikiBasicError && error.code === 'untracked-project-page'
  );
  assert.equal(await fsp.readFile(target, 'utf8'), '# Human page\n\nDo not overwrite.\n');
});

test('project sync rejects Windows alternate streams and reserved page names', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'safe-page-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Safe page project\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const page = {
    expectedSha256: null,
    title: 'Unsafe page name',
    summary: 'This path must fail before writing.',
    content: '# Unsafe page name',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  for (const relative of [
    `${preview.project.rootPath}/concepts/note.md:alternate.md`,
    `${preview.project.rootPath}/concepts/CON.md`
  ]) {
    await assert.rejects(
      () => buildProjectSyncPlan(vault, workspace, {
        previewToken: preview.previewToken,
        pages: [{ ...page, path: preview.project.overviewPath }, { ...page, path: relative }]
      }, options),
      (error) => error instanceof WikiBasicError && error.code === 'invalid-project-page-path'
    );
  }
});

test('DSH history import previews, reads, saves, and deduplicates selected sessions', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'history-project');
  const sourcePath = path.join(root, 'wiki-history-source.json');
  await fsp.mkdir(workspace, { recursive: true });
  await initializeWikiVault(vault, { clock: fixedClock });
  const source = await writeHistorySource(sourcePath, workspace);
  const preview = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  assert.equal(preview.unchanged, false);
  assert.equal(preview.delta.added.length, 1);
  assert.equal(preview.totalMessages, 2);
  assert.doesNotMatch(JSON.stringify(preview), /请整理项目知识/);
  const session = await readDshHistorySession(sourcePath, workspace, preview.sourceToken, source.sessions[0].sourceId, { clock: fixedClock });
  assert.equal(session.messages.length, 2);
  const pagePath = `${preview.project.rootPath}/history/knowledge-ingest.md`;
  const spec = {
    previewToken: preview.previewToken,
    sourceToken: preview.sourceToken,
    pages: [{
      path: pagePath,
      expectedSha256: null,
      title: '历史导入知识',
      summary: '记录 DSH 历史导入的来源和去重边界。',
      content: '# 历史导入知识\n\n只读会话经用户选择后增量沉淀。 ^[extracted]',
      sources: [source.sessions[0].sourceId],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  assert.equal((await buildDshHistoryIngestPlan(vault, workspace, sourcePath, spec, { clock: fixedClock })).pagesCreated, 1);
  const saved = await saveDshHistoryIngest(vault, workspace, sourcePath, spec, { clock: fixedClock, confirmed: true });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.pagesCreated, [pagePath]);
  assert.equal(saved.sourceCleared, true);
  assert.equal(fs.existsSync(sourcePath), false);
  const page = await fsp.readFile(path.join(vault, pagePath), 'utf8');
  assert.match(page, /category: project-history/);
  assert.match(page, /dsh-session:a{24}/);
  assert.match(page, /原始历史只读/);
  const manifest = JSON.parse(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'));
  assert.equal(manifest.history.dsh[preview.project.id].sessions[source.sessions[0].sourceId].fingerprint, source.sessions[0].fingerprint);

  await writeHistorySource(sourcePath, workspace, { sourceToken: 'f'.repeat(32) });
  const unchanged = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.delta.unchanged.length, 1);
  const trackedPage = await readDshHistoryWikiPage(vault, workspace, sourcePath, pagePath, { clock: fixedClock });
  assert.match(trackedPage.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    () => saveDshHistoryIngest(vault, workspace, sourcePath, { ...spec, previewToken: unchanged.previewToken, sourceToken: unchanged.sourceToken }, { clock: fixedClock, confirmed: true }),
    (error) => error instanceof WikiBasicError && error.code === 'history-unchanged'
  );
});

test('DSH history import requires sensitive confirmation and rolls back failed writes', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'sensitive-history-project');
  const sourcePath = path.join(root, 'wiki-history-source.json');
  await fsp.mkdir(workspace, { recursive: true });
  await initializeWikiVault(vault, { clock: fixedClock });
  const redactions = [{ id: 'credential-value', label: '疑似凭据字段', count: 1 }];
  const source = await writeHistorySource(sourcePath, workspace, {
    messages: [{ seq: 1, time: 100, role: 'user', text: 'TOKEN=[已遮蔽凭据]' }, { seq: 2, time: 200, role: 'assistant', text: '安全结论' }],
    redactions
  });
  const preview = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  const pagePath = `${preview.project.rootPath}/history/sensitive.md`;
  const spec = {
    previewToken: preview.previewToken,
    sourceToken: preview.sourceToken,
    pages: [{
      path: pagePath,
      expectedSha256: null,
      title: '敏感历史边界',
      summary: '固定模式在进入 Agent 前已遮蔽。',
      content: '# 敏感历史边界\n\n源中固定凭据值已遮蔽。',
      sources: [source.sessions[0].sourceId],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  await assert.rejects(
    () => saveDshHistoryIngest(vault, workspace, sourcePath, spec, { clock: fixedClock, confirmed: true }),
    (error) => error instanceof WikiBasicError && error.code === 'sensitive-confirmation-required'
  );
  const originalManifest = await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8');
  await assert.rejects(
    () => saveDshHistoryIngest(vault, workspace, sourcePath, spec, {
      clock: fixedClock,
      confirmed: true,
      confirmedSensitive: true,
      afterPageWrites: async () => { throw new Error('history-rollback-injected'); }
    }),
    /history-rollback-injected/
  );
  assert.equal(fs.existsSync(sourcePath), true);
  assert.equal(fs.existsSync(path.join(vault, pagePath)), false);
  assert.equal(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'), originalManifest);
  assert.equal(fs.existsSync(path.join(vault, '_staging', '.dsh-wiki-history-ingest.lock')), false);
});

test('DSH history source rejects stale fingerprints, expiry, and unsafe page paths', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'invalid-history-project');
  const sourcePath = path.join(root, 'wiki-history-source.json');
  await fsp.mkdir(workspace, { recursive: true });
  await initializeWikiVault(vault, { clock: fixedClock });
  const source = await writeHistorySource(sourcePath, workspace);
  const tampered = JSON.parse(await fsp.readFile(sourcePath, 'utf8'));
  tampered.sessions[0].messages[0].text = 'tampered';
  await fsp.writeFile(sourcePath, JSON.stringify(tampered), 'utf8');
  await assert.rejects(
    () => readDshHistorySource(sourcePath, workspace, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'invalid-history-source'
  );
  await writeHistorySource(sourcePath, workspace, { expiresAt: '2026-08-29T07:59:59.000Z' });
  await assert.rejects(
    () => previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'history-source-expired'
  );
  await writeHistorySource(sourcePath, workspace);
  const preview = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  const base = {
    expectedSha256: null,
    title: 'Unsafe',
    summary: 'Unsafe page path.',
    content: '# Unsafe',
    sources: [source.sessions[0].sourceId],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  for (const relative of [`${preview.project.rootPath}/history/note.md:ads.md`, `${preview.project.rootPath}/history/CON.md`]) {
    await assert.rejects(
      () => buildDshHistoryIngestPlan(vault, workspace, sourcePath, {
        previewToken: preview.previewToken,
        sourceToken: preview.sourceToken,
        pages: [{ ...base, path: relative }]
      }, { clock: fixedClock }),
      (error) => error instanceof WikiBasicError && error.code === 'invalid-history-page-path'
    );
  }
});

test('DSH history import never overwrites an untracked human page', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'human-history-project');
  const sourcePath = path.join(root, 'wiki-history-source.json');
  await fsp.mkdir(workspace, { recursive: true });
  await initializeWikiVault(vault, { clock: fixedClock });
  const source = await writeHistorySource(sourcePath, workspace);
  const preview = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  const pagePath = `${preview.project.rootPath}/history/human-note.md`;
  const absolute = path.join(vault, pagePath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, '# Human history page\n\nDo not overwrite.\n', 'utf8');
  await assert.rejects(
    () => buildDshHistoryIngestPlan(vault, workspace, sourcePath, {
      previewToken: preview.previewToken,
      sourceToken: preview.sourceToken,
      pages: [{
        path: pagePath,
        expectedSha256: null,
        title: 'Replacement',
        summary: 'This must be refused.',
        content: '# Replacement',
        sources: [source.sessions[0].sourceId],
        provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
      }]
    }, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'untracked-history-page'
  );
  assert.equal(await fsp.readFile(absolute, 'utf8'), '# Human history page\n\nDo not overwrite.\n');
});

test('DSH history import serializes concurrent writers and releases its lock', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'concurrent-history-project');
  const sourcePath = path.join(root, 'wiki-history-source.json');
  await fsp.mkdir(workspace, { recursive: true });
  await initializeWikiVault(vault, { clock: fixedClock });
  const source = await writeHistorySource(sourcePath, workspace);
  const preview = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  const pagePath = `${preview.project.rootPath}/history/concurrent.md`;
  const spec = {
    previewToken: preview.previewToken,
    sourceToken: preview.sourceToken,
    pages: [{
      path: pagePath,
      expectedSha256: null,
      title: 'Concurrent history',
      summary: 'Only one writer may commit this history source.',
      content: '# Concurrent history\n\nOne serialized writer. ^[extracted]',
      sources: [source.sessions[0].sourceId],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  const results = await Promise.allSettled([
    saveDshHistoryIngest(vault, workspace, sourcePath, spec, { clock: fixedClock, confirmed: true }),
    saveDshHistoryIngest(vault, workspace, sourcePath, spec, { clock: fixedClock, confirmed: true })
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(fs.existsSync(path.join(vault, '_staging', '.dsh-wiki-history-ingest.lock')), false);
  assert.match(await fsp.readFile(path.join(vault, pagePath), 'utf8'), /One serialized writer/);
});
