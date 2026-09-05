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
  clearDshHistorySource,
  clearWikiRecoveryMarker,
  initializeWikiVault,
  inspectWikiVault,
  previewDshHistoryIngest,
  previewProjectSync,
  queryWiki,
  readWikiRecoveryProtection,
  readDshHistorySession,
  readDshHistorySource,
  readDshHistoryWikiPage,
  readProjectWikiPage,
  saveCapture,
  saveDshHistoryIngest,
  saveProjectSync
} = require('../resources/skills/llm-wiki/scripts/wiki-basic.cjs');

const fixedClock = () => new Date('2026-08-29T08:00:00.000Z');
const wikiWriteLockPath = (vault) => path.join(vault, '_staging', '.dsh-wiki-write.lock');
const wikiRecoveryMarkerPath = (vault) => path.join(vault, '_staging', '.dsh-wiki-recovery-required.json');
const wikiRecoveryClearGuardPath = (vault) => path.join(vault, '.dsh-wiki-recovery-clear.lock');
const wikiRecoveryClearJournalMagic = 'DSH-WIKI-RECOVERY-CLEAR/1 ';
const recoveryConfirmation = (protection) => ({
  type: protection.type,
  archive: protection.archive,
  id: protection.type === 'marker'
    ? protection.id
    : protection.type === 'clear-guard'
      ? protection.guardToken
      : protection.lockToken,
  digest: protection.type === 'marker'
    ? protection.markerSha256
    : protection.type === 'clear-guard'
      ? protection.guardSha256
      : protection.lockSha256
});

const directoryIdentityRecord = async (directory) => {
  const info = await fsp.lstat(directory, { bigint: true });
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    birthtimeNs: String(info.birthtimeNs ?? ''),
    isDirectory: info.isDirectory(),
    isSymbolicLink: info.isSymbolicLink()
  };
};

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

const prepareMarkerRecovery = async (vault, suffix = '5') => {
  const digit = String(suffix).slice(0, 1);
  const archive = `_archives/dsh-capture/2026-08-29T08-00-00-000Z-${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
  const archivePath = path.join(vault, ...archive.split('/'));
  await fsp.mkdir(archivePath, { recursive: true });
  const marker = {
    version: 1,
    id: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    operation: 'capture',
    archive,
    createdAt: '2026-08-29T08:00:00.000Z',
    originalCode: 'forced-failure',
    failures: ['interrupted-recovery-clear-test']
  };
  const markerText = `${JSON.stringify(marker, null, 2)}\n`;
  await fsp.writeFile(wikiRecoveryMarkerPath(vault), markerText, 'utf8');
  return {
    archive,
    archivePath,
    marker,
    markerText,
    protection: {
      type: 'marker',
      archive,
      id: marker.id,
      digest: createHash('sha256').update(markerText).digest('hex')
    }
  };
};

const writeInterruptedRecoveryClearGuard = async (vault, {
  token,
  pid = 2147483647,
  state = 'recovery-required',
  phase,
  archive = '',
  protection,
  claimedStaging,
  retainedStaging,
  stagingIdentity,
  freshStagingIdentity
}) => {
  const record = {
    version: 1,
    token,
    pid,
    state,
    started: '2026-08-29T08:05:00.000Z',
    ...(phase ? { phase } : {}),
    ...(archive ? { archive } : {}),
    ...(protection ? { protection } : {}),
    ...(claimedStaging ? { claimedStaging } : {}),
    ...(retainedStaging ? { retainedStaging } : {}),
    ...(stagingIdentity ? { stagingIdentity } : {}),
    ...(freshStagingIdentity ? { freshStagingIdentity } : {}),
    failure: 'simulated-process-exit'
  };
  await fsp.writeFile(wikiRecoveryClearGuardPath(vault), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  return record;
};

const encodeRecoveryClearJournalFrame = (record, sequence, previousFrameSha256, discardedTail = null) => {
  const payload = {
    journalVersion: 1,
    sequence,
    previousFrameSha256,
    ...(discardedTail ? { discardedTail: { bytes: discardedTail.length, sha256: createHash('sha256').update(discardedTail).digest('hex') } } : {}),
    record
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  return Buffer.from(`${wikiRecoveryClearJournalMagic}${payloadBytes.toString('base64url')}.${createHash('sha256').update(payloadBytes).digest('hex')}\n`, 'utf8');
};

const buildRecoveryClearJournal = (records, { trailingRecord = null, trailingRatio = 0.5 } = {}) => {
  const frames = [];
  let previousFrameSha256 = '';
  for (let index = 0; index < records.length; index += 1) {
    const frame = encodeRecoveryClearJournalFrame(records[index], index + 1, previousFrameSha256);
    frames.push(frame);
    previousFrameSha256 = createHash('sha256').update(frame).digest('hex');
  }
  if (trailingRecord) {
    const frame = encodeRecoveryClearJournalFrame(trailingRecord, records.length + 1, previousFrameSha256);
    frames.push(frame.subarray(0, Math.max(1, Math.min(frame.length - 1, Math.floor(frame.length * trailingRatio)))));
  }
  return Buffer.concat(frames);
};

const recoveryClearJournalRecords = ({ token, pid = 2147483647, recovery, stagingIdentity, through = 'prepared', freshStagingIdentity }) => {
  const started = '2026-08-29T08:05:00.000Z';
  const base = { version: 1, token, pid, state: 'recovery-required', started };
  const created = { ...base, phase: 'created' };
  const validated = {
    ...created,
    phase: 'protection-validated',
    archive: recovery.archive,
    protection: recovery.protection
  };
  const prepared = {
    ...validated,
    phase: 'prepared',
    claimedStaging: `_staging-recovery-clear-${token}`,
    stagingIdentity
  };
  const claimed = { ...prepared, phase: 'claimed' };
  const retained = { ...claimed, phase: 'retained', retainedStaging: `_cleared-staging-${token}` };
  const stagingCreated = { ...retained, phase: 'staging-created', freshStagingIdentity };
  const ordered = { created, 'protection-validated': validated, prepared, claimed, retained, 'staging-created': stagingCreated };
  const phases = ['created', 'protection-validated', 'prepared', 'claimed', 'retained', 'staging-created'];
  return phases.slice(0, phases.indexOf(through) + 1).map((phase) => ordered[phase]);
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

test('Wiki health reports a verified last sync and rejects a corrupt manifest', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const manifestPath = path.join(vault, '.manifest.json');
  await fsp.writeFile(manifestPath, `${JSON.stringify({
    projects: { one: { updated: '2026-08-29T07:00:00.000Z' } },
    history: { dsh: { two: { updated: '2026-08-29T08:00:00.000Z' } } }
  })}\n`, 'utf8');
  const healthy = await inspectWikiVault(vault);
  assert.equal(healthy.status, 'ready');
  assert.equal(healthy.lastSyncAt, '2026-08-29T08:00:00.000Z');

  await fsp.writeFile(manifestPath, '{not-json}\n', 'utf8');
  const corrupt = await inspectWikiVault(vault);
  assert.equal(corrupt.status, 'unavailable');
  assert.equal(corrupt.lastSyncAt, '');
  assert.match(corrupt.message, /恢复副本/);
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

test('Wiki query excludes reserved directories case-insensitively', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const variants = [
    ['_archives', '_Archives'],
    ['_raw', '_Raw'],
    ['_staging', '_Staging'],
    ['.obsidian', '.Obsidian'],
    ['', '.Git']
  ];
  for (const [canonicalName, variantName] of variants) {
    const variant = path.join(vault, variantName);
    if (canonicalName) {
      const canonical = path.join(vault, canonicalName);
      const temporary = path.join(vault, `${canonicalName}-case-move`);
      await fsp.rename(canonical, temporary);
      await fsp.rename(temporary, variant);
      await fsp.mkdir(canonical, { recursive: true });
    } else {
      await fsp.mkdir(variant, { recursive: true });
    }
    await fsp.writeFile(path.join(variant, 'reserved-secret.md'), '# RESERVED_DIRECTORY_QUERY_SENTINEL\n', 'utf8');
  }

  const result = await queryWiki(vault, 'RESERVED_DIRECTORY_QUERY_SENTINEL', { log: false });
  assert.equal(result.results.length, 0);
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
  assert.match(result.archive, /^_archives\/dsh-capture\//);
  assert.equal(fs.existsSync(path.join(vault, result.archive, 'index.md')), true);
  assert.equal(fs.existsSync(path.join(vault, result.archive, 'log.md')), true);
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

test('capture publication failure never leaves a partial unindexed page', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const capture = {
    title: '原子发布失败保护',
    content: '页面必须完整落盘后才能对知识库可见。',
    sourceSessionId: 'session-capture-atomic',
    sourceSeq: 1
  };
  const preview = buildCapturePreview(vault, capture);
  const originalIndex = await fsp.readFile(path.join(vault, 'index.md'), 'utf8');
  const originalLog = await fsp.readFile(path.join(vault, 'log.md'), 'utf8');
  const originalOpen = fsp.open;
  let injected = false;
  fsp.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    const resolvedTarget = path.resolve(target);
    if (!injected && resolvedTarget.startsWith(`${path.resolve(preview.absolutePath)}.`) && resolvedTarget.endsWith('.tmp')) {
      injected = true;
      const originalWrite = handle.writeFile.bind(handle);
      handle.writeFile = async (text, ...writeArgs) => {
        await originalWrite(String(text).slice(0, 16), ...writeArgs);
        const error = new Error('injected capture write failure');
        error.code = 'EIO';
        throw error;
      };
    }
    return handle;
  };
  try {
    await assert.rejects(() => saveCapture(vault, capture, { clock: fixedClock }), (error) => error?.code === 'EIO');
  } finally {
    fsp.open = originalOpen;
  }
  assert.equal(injected, true);
  assert.equal(fs.existsSync(preview.absolutePath), false);
  assert.equal(await fsp.readFile(path.join(vault, 'index.md'), 'utf8'), originalIndex);
  assert.equal(await fsp.readFile(path.join(vault, 'log.md'), 'utf8'), originalLog);
  assert.equal((await fsp.readdir(path.dirname(preview.absolutePath))).some((name) => name.endsWith('.tmp')), false);
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
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
  assert.deepEqual(unchanged.humanEditedPages, []);
  await assert.rejects(
    () => saveProjectSync(vault, workspace, { ...spec, previewToken: unchanged.previewToken }, { ...options, confirmed: true }),
    (error) => error instanceof WikiBasicError && error.code === 'project-unchanged'
  );

  await fsp.appendFile(path.join(vault, overviewPath), '\n人工保留段落。\n', 'utf8');
  const manuallyEdited = await previewProjectSync(vault, workspace, options);
  assert.equal(manuallyEdited.unchanged, true);
  assert.deepEqual(manuallyEdited.humanEditedPages, [overviewPath]);

  await fsp.writeFile(path.join(workspace, 'README.md'), '# Wiki Product\n\nLocal project knowledge with an incremental decision.\n', 'utf8');
  const changed = await previewProjectSync(vault, workspace, options);
  assert.equal(changed.delta.modified.length, 1);
  assert.deepEqual(changed.humanEditedPages, [overviewPath]);
  const currentPage = await readProjectWikiPage(vault, workspace, overviewPath, options);
  assert.match(currentPage.content, /人工保留段落/);
  const updateSpec = {
    previewToken: changed.previewToken,
    pages: [{
      ...spec.pages[0],
      expectedSha256: currentPage.sha256,
      content: '# Wiki Product\n\n增量合并后的事实和决策。\n\n人工保留段落。'
    }]
  };
  const updated = await saveProjectSync(vault, workspace, updateSpec, { ...options, confirmed: true });
  assert.deepEqual(updated.pagesUpdated, [overviewPath]);
  assert.equal((await previewProjectSync(vault, workspace, options)).unchanged, true);
  const manifest = JSON.parse(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'));
  assert.equal(Object.keys(manifest.projects).length, 1);
  assert.deepEqual(manifest.projects[changed.project.id].pages_in_vault, [overviewPath]);
  assert.equal(manifest.projects[changed.project.id].page_sha256[overviewPath], (await previewProjectSync(vault, workspace, options)).existingPages[0].sha256);
  assert.equal((await inspectWikiVault(vault)).lastSyncAt, '2026-08-29T08:00:00.000Z');
  assert.match(await fsp.readFile(path.join(vault, 'log.md'), 'utf8'), /WIKI_UPDATE project=/);
});

test('project sync preserves the committed hash of an untouched human-edited page and reports missing managed pages', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'managed-page-health-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Initial\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  let preview = await previewProjectSync(vault, workspace, options);
  const overviewPath = preview.project.overviewPath;
  const manualPath = `${preview.project.rootPath}/references/manual-preserved.md`;
  const page = (pagePath, title) => ({
    path: pagePath,
    expectedSha256: null,
    title,
    summary: `${title} summary.`,
    content: `# ${title}\n\nInitial.`,
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  });
  await saveProjectSync(vault, workspace, {
    previewToken: preview.previewToken,
    pages: [page(overviewPath, 'Overview'), page(manualPath, 'Manual preserved')]
  }, { ...options, confirmed: true });
  await fsp.appendFile(path.join(vault, manualPath), '\nHUMAN-PRESERVED\n', 'utf8');
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Changed\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  assert.deepEqual(preview.humanEditedPages, [manualPath]);
  const overview = await readProjectWikiPage(vault, workspace, overviewPath, options);
  await saveProjectSync(vault, workspace, {
    previewToken: preview.previewToken,
    pages: [{ ...page(overviewPath, 'Overview'), expectedSha256: overview.sha256, content: '# Overview\n\nChanged.' }]
  }, { ...options, confirmed: true });
  const after = await previewProjectSync(vault, workspace, options);
  assert.deepEqual(after.humanEditedPages, [manualPath]);
  await fsp.unlink(path.join(vault, manualPath));
  const missing = await previewProjectSync(vault, workspace, options);
  assert.equal(missing.unchanged, false);
  assert.deepEqual(missing.missingManagedPages, [manualPath]);
  const currentOverview = await readProjectWikiPage(vault, workspace, overviewPath, options);
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      previewToken: missing.previewToken,
      pages: [{ ...page(overviewPath, 'Overview'), expectedSha256: currentOverview.sha256 }]
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'managed-pages-missing'
  );
});

test('an incomplete project rollback fails closed and points to its recovery archive', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'rollback-incomplete-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Rollback incomplete\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const target = path.join(vault, preview.project.overviewPath);
  const spec = {
    previewToken: preview.previewToken,
    pages: [{
      path: preview.project.overviewPath,
      expectedSha256: null,
      title: 'Rollback incomplete',
      summary: 'A failed automatic restore must retain a recovery archive.',
      content: '# Rollback incomplete',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  let observed;
  await assert.rejects(
    () => saveProjectSync(vault, workspace, spec, {
      ...options,
      confirmed: true,
      afterPageWrites: async () => {
        await fsp.unlink(target);
        await fsp.mkdir(target);
        throw new Error('injected-unrecoverable-page-shape');
      }
    }),
    (error) => {
      observed = error;
      return error instanceof WikiBasicError && error.code === 'rollback-incomplete';
    }
  );
  assert.match(observed.archive, /^_archives\/dsh-project-sync\//);
  assert.equal(observed.originalCode, 'wiki-write-failed');
  assert.ok(observed.rollbackFailures.some((item) => item.startsWith(`${preview.project.overviewPath}:`)));
  assert.equal(fs.existsSync(path.join(vault, observed.archive, '.manifest.json')), true);
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
});

test('rollback preserves a concurrent human edit and creates a validated recovery marker', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'human-concurrent-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Initial source\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const firstPreview = await previewProjectSync(vault, workspace, options);
  const pagePath = firstPreview.project.overviewPath;
  const firstSpec = {
    previewToken: firstPreview.previewToken,
    pages: [{
      path: pagePath,
      expectedSha256: null,
      title: 'Concurrent edit project',
      summary: 'Initial managed page.',
      content: '# Concurrent edit project\n\nInitial.',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  await saveProjectSync(vault, workspace, firstSpec, { ...options, confirmed: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Changed source\n', 'utf8');
  const preview = await previewProjectSync(vault, workspace, options);
  const current = await readProjectWikiPage(vault, workspace, pagePath, options);
  const spec = {
    previewToken: preview.previewToken,
    pages: [{ ...firstSpec.pages[0], expectedSha256: current.sha256, content: '# Concurrent edit project\n\nTransaction update.' }]
  };
  const manifestBefore = await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8');
  let observed;
  await assert.rejects(
    () => saveProjectSync(vault, workspace, spec, {
      ...options,
      confirmed: true,
      afterPageWrites: async () => {
        await fsp.appendFile(path.join(vault, pagePath), '\nHUMAN-CONCURRENT-EDIT\n', 'utf8');
        throw new Error('failure-after-human-edit');
      }
    }),
    (error) => {
      observed = error;
      return error instanceof WikiBasicError && error.code === 'rollback-incomplete';
    }
  );
  assert.match(await fsp.readFile(path.join(vault, pagePath), 'utf8'), /HUMAN-CONCURRENT-EDIT/);
  assert.equal(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'), manifestBefore);
  const marker = JSON.parse(await fsp.readFile(wikiRecoveryMarkerPath(vault), 'utf8'));
  assert.equal(marker.version, 1);
  assert.equal(marker.operation, 'project-sync');
  assert.equal(marker.archive, observed.archive);
  assert.ok(marker.failures.some((item) => item.includes('concurrent-content-preserved')));
  assert.equal((await inspectWikiVault(vault)).status, 'recovery-required');
  await assert.rejects(
    () => saveCapture(vault, { title: '恢复前禁止写入', content: '不得越过恢复标记。' }, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'wiki-recovery-required'
  );
  const protection = await readWikiRecoveryProtection(vault);
  await assert.rejects(
    () => clearWikiRecoveryMarker(vault, { ...recoveryConfirmation(protection), archive: '_archives/dsh-project-sync/not-the-current-transaction' }),
    (error) => error instanceof WikiBasicError && error.code === 'stale-recovery-marker'
  );
  const cleared = await clearWikiRecoveryMarker(vault, recoveryConfirmation(protection));
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.retainedStaging.startsWith(`${observed.archive}/_cleared-staging-`), true);
  assert.equal(fs.existsSync(path.join(vault, cleared.retainedStaging)), true);
  assert.equal((await inspectWikiVault(vault)).status, 'ready');
  assert.equal(fs.existsSync(path.join(vault, observed.archive)), true);
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
});

test('a failed recovery marker publication retains the canonical write lock and blocks every later write', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'marker-publication-failure');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Marker failure\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const target = path.join(vault, preview.project.overviewPath);
  const spec = {
    previewToken: preview.previewToken,
    pages: [{
      path: preview.project.overviewPath,
      expectedSha256: null,
      title: 'Marker publication failure',
      summary: 'The lock must remain when a recovery marker cannot be published.',
      content: '# Marker publication failure',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  const originalLink = fsp.link;
  let markerFailureInjected = false;
  fsp.link = async (source, destination, ...args) => {
    if (!markerFailureInjected && path.resolve(destination) === path.resolve(wikiRecoveryMarkerPath(vault))) {
      markerFailureInjected = true;
      const error = new Error('injected recovery marker denial');
      error.code = 'EACCES';
      throw error;
    }
    return originalLink(source, destination, ...args);
  };
  let observed;
  try {
    await assert.rejects(
      () => saveProjectSync(vault, workspace, spec, {
        ...options,
        confirmed: true,
        afterPageWrites: async () => {
          await fsp.unlink(target);
          await fsp.mkdir(target);
          throw new Error('force-incomplete-rollback');
        }
      }),
      (error) => {
        observed = error;
        return error instanceof WikiBasicError && error.code === 'rollback-incomplete';
      }
    );
  } finally {
    fsp.link = originalLink;
  }
  assert.equal(markerFailureInjected, true);
  assert.equal(observed.retainWriteLock, true);
  assert.equal(fs.existsSync(wikiRecoveryMarkerPath(vault)), false);
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), true);
  const lock = JSON.parse(await fsp.readFile(wikiWriteLockPath(vault), 'utf8'));
  assert.equal(lock.state, 'recovery-required');
  assert.equal(lock.archive, observed.archive);
  assert.equal((await inspectWikiVault(vault)).status, 'recovery-required');
  await assert.rejects(
    () => saveCapture(vault, { title: '保护锁之后', content: '不得继续写入。' }, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'wiki-write-recovery-required'
  );
  const protection = await readWikiRecoveryProtection(vault);
  assert.equal(protection.type, 'retained-lock');
  assert.equal(protection.archive, observed.archive);
  const cleared = await clearWikiRecoveryMarker(vault, recoveryConfirmation(protection));
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.protectionType, 'retained-lock');
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
  const savedAfterRecovery = await saveCapture(vault, { title: '恢复保护锁之后', content: '下一次写入可以正常完成。' }, { clock: fixedClock });
  assert.equal(savedAfterRecovery.ok, true);
});

test('recovery marker access rejects a staging junction and never removes the outside marker', async (t) => {
  const { root, vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const archiveId = '2026-08-29T08-00-00-000Z-11111111-1111-4111-8111-111111111111';
  const archive = `_archives/dsh-capture/${archiveId}`;
  await fsp.mkdir(path.join(vault, ...archive.split('/')), { recursive: true });
  const staging = path.join(vault, '_staging');
  const outside = path.join(root, 'outside-staging');
  await fsp.mkdir(outside, { recursive: true });
  await fsp.rmdir(staging);
  try {
    await fsp.symlink(outside, staging, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('This host does not allow creating a directory junction.');
      return;
    }
    throw error;
  }
  const outsideMarker = path.join(outside, '.dsh-wiki-recovery-required.json');
  const markerText = `${JSON.stringify({
    version: 1,
    id: '22222222-2222-4222-8222-222222222222',
    operation: 'capture',
    archive,
    createdAt: '2026-08-29T08:00:00.000Z',
    originalCode: 'forced-failure',
    failures: ['outside-marker-must-survive']
  }, null, 2)}\n`;
  await fsp.writeFile(outsideMarker, markerText, 'utf8');
  assert.equal((await inspectWikiVault(vault)).status, 'unavailable');
  await assert.rejects(
    () => clearWikiRecoveryMarker(vault, archive),
    (error) => error instanceof WikiBasicError && error.code === 'unsafe-recovery-staging'
  );
  assert.equal(await fsp.readFile(outsideMarker, 'utf8'), markerText);
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
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
});

test('project sync rechecks the expected page immediately before replacement', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'prewrite-cas-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Before\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  let preview = await previewProjectSync(vault, workspace, options);
  const pagePath = preview.project.overviewPath;
  const basePage = {
    path: pagePath,
    expectedSha256: null,
    title: 'Prewrite check',
    summary: 'Final page digest is checked before replacement.',
    content: '# Prewrite check\n\nBefore.',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  await saveProjectSync(vault, workspace, { previewToken: preview.previewToken, pages: [basePage] }, { ...options, confirmed: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# After\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  const current = await readProjectWikiPage(vault, workspace, pagePath, options);
  const target = path.join(vault, pagePath);
  const originalOpen = fsp.open;
  let injected = false;
  fsp.open = async (candidate, ...args) => {
    const handle = await originalOpen(candidate, ...args);
    const resolvedCandidate = path.resolve(candidate);
    if (!injected && resolvedCandidate.startsWith(`${path.resolve(target)}.`) && resolvedCandidate.endsWith('.tmp')) {
      const originalClose = handle.close.bind(handle);
      handle.close = async () => {
        await originalClose();
        if (!injected) {
          injected = true;
          await fsp.appendFile(target, '\nHUMAN-BEFORE-REPLACE\n', 'utf8');
        }
      };
    }
    return handle;
  };
  try {
    await assert.rejects(
      () => saveProjectSync(vault, workspace, {
        previewToken: preview.previewToken,
        pages: [{ ...basePage, expectedSha256: current.sha256, content: '# Prewrite check\n\nAfter.' }]
      }, { ...options, confirmed: true }),
      (error) => error instanceof WikiBasicError && error.code === 'stale-project-page'
    );
  } finally {
    fsp.open = originalOpen;
  }
  assert.equal(injected, true);
  assert.match(await fsp.readFile(target, 'utf8'), /HUMAN-BEFORE-REPLACE/);
  assert.equal(fs.existsSync(wikiRecoveryMarkerPath(vault)), false);
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
});

test('project sync atomically claims the current page and preserves an edit made at the claim boundary', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'claim-boundary-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Before\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  let preview = await previewProjectSync(vault, workspace, options);
  const pagePath = preview.project.overviewPath;
  const basePage = {
    path: pagePath,
    expectedSha256: null,
    title: 'Claim boundary',
    summary: 'The exact object moved into the archive is validated.',
    content: '# Claim boundary\n\nBefore.',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  await saveProjectSync(vault, workspace, { previewToken: preview.previewToken, pages: [basePage] }, { ...options, confirmed: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# After\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  const current = await readProjectWikiPage(vault, workspace, pagePath, options);
  const target = path.resolve(vault, pagePath);
  const originalRename = fsp.rename;
  let injected = false;
  fsp.rename = async (source, destination, ...args) => {
    if (!injected && path.resolve(source) === target && String(destination).includes(`${path.sep}_claims${path.sep}prewrite${path.sep}`)) {
      injected = true;
      await fsp.appendFile(source, '\nHUMAN-AT-CLAIM-BOUNDARY\n', 'utf8');
    }
    return originalRename(source, destination, ...args);
  };
  try {
    await assert.rejects(
      () => saveProjectSync(vault, workspace, {
        previewToken: preview.previewToken,
        pages: [{ ...basePage, expectedSha256: current.sha256, content: '# Claim boundary\n\nAfter.' }]
      }, { ...options, confirmed: true }),
      (error) => error instanceof WikiBasicError && error.code === 'stale-project-page'
    );
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal(injected, true);
  assert.match(await fsp.readFile(target, 'utf8'), /HUMAN-AT-CLAIM-BOUNDARY/);
  assert.equal(fs.existsSync(wikiRecoveryMarkerPath(vault)), false);
});

test('project sync never overwrites a human target recreated after the original page was claimed', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'exclusive-publish-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Before\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  let preview = await previewProjectSync(vault, workspace, options);
  const pagePath = preview.project.overviewPath;
  const basePage = {
    path: pagePath,
    expectedSha256: null,
    title: 'Exclusive publish',
    summary: 'A recreated path wins over the transaction.',
    content: '# Exclusive publish\n\nBefore.',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  await saveProjectSync(vault, workspace, { previewToken: preview.previewToken, pages: [basePage] }, { ...options, confirmed: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# After\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  const current = await readProjectWikiPage(vault, workspace, pagePath, options);
  const target = path.resolve(vault, pagePath);
  const originalLink = fsp.link;
  let injected = false;
  fsp.link = async (source, destination, ...args) => {
    if (!injected && path.resolve(destination) === target && String(source).startsWith(`${target}.`) && String(source).endsWith('.tmp')) {
      injected = true;
      await fsp.writeFile(target, '# HUMAN-RECREATED-TARGET\n', 'utf8');
    }
    return originalLink(source, destination, ...args);
  };
  try {
    await assert.rejects(
      () => saveProjectSync(vault, workspace, {
        previewToken: preview.previewToken,
        pages: [{ ...basePage, expectedSha256: current.sha256, content: '# Exclusive publish\n\nAfter.' }]
      }, { ...options, confirmed: true }),
      (error) => error instanceof WikiBasicError && error.code === 'stale-project-page'
    );
  } finally {
    fsp.link = originalLink;
  }
  assert.equal(injected, true);
  assert.equal(await fsp.readFile(target, 'utf8'), '# HUMAN-RECREATED-TARGET\n');
});

test('rollback claims the live target before restoring and preserves an edit made at that boundary', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'rollback-claim-boundary');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Before\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  let preview = await previewProjectSync(vault, workspace, options);
  const pagePath = preview.project.overviewPath;
  const basePage = {
    path: pagePath,
    expectedSha256: null,
    title: 'Rollback claim boundary',
    summary: 'Rollback preserves a simultaneous human save.',
    content: '# Rollback claim boundary\n\nBefore.',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  await saveProjectSync(vault, workspace, { previewToken: preview.previewToken, pages: [basePage] }, { ...options, confirmed: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# After\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  const current = await readProjectWikiPage(vault, workspace, pagePath, options);
  const target = path.resolve(vault, pagePath);
  const originalRename = fsp.rename;
  let injected = false;
  fsp.rename = async (source, destination, ...args) => {
    if (!injected && path.resolve(source) === target && String(destination).includes(`${path.sep}_claims${path.sep}rollback${path.sep}`)) {
      injected = true;
      await fsp.appendFile(source, '\nHUMAN-DURING-ROLLBACK-CLAIM\n', 'utf8');
    }
    return originalRename(source, destination, ...args);
  };
  let observed;
  try {
    await assert.rejects(
      () => saveProjectSync(vault, workspace, {
        previewToken: preview.previewToken,
        pages: [{ ...basePage, expectedSha256: current.sha256, content: '# Rollback claim boundary\n\nAfter.' }]
      }, { ...options, confirmed: true, afterPageWrites: async () => { throw new Error('force-rollback-claim'); } }),
      (error) => {
        observed = error;
        return error instanceof WikiBasicError && error.code === 'rollback-incomplete';
      }
    );
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal(injected, true);
  assert.match(await fsp.readFile(target, 'utf8'), /HUMAN-DURING-ROLLBACK-CLAIM/);
  assert.match(observed.archive, /^_archives\/dsh-project-sync\//);
  assert.equal((await inspectWikiVault(vault)).status, 'recovery-required');
});

test('release knowledge mode enforces and preserves exactly six bounded evidence pages', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'release-knowledge-project');
  await fsp.mkdir(path.join(workspace, 'docs'), { recursive: true });
  const evidence = {
    'package.json': '{"version":"1.1.8"}\n',
    'README.md': '# DSH Desktop\n',
    'PROGRESS.md': '# Verified progress\n',
    'DSH_DESKTOP_ITERATION_PLAN.md': '# Iteration plan\n',
    'CONTRIBUTING.md': '# Review rules\n',
    'docs/VALIDATION.md': '# Validation evidence\n',
    'notes.md': '# Not authorized release evidence\n'
  };
  await Promise.all(Object.entries(evidence).map(([relative, text]) => fsp.writeFile(path.join(workspace, relative), text, 'utf8')));
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const releaseNames = [
    'version-overview',
    'capability-evolution',
    'harness-compatibility',
    'release-channels',
    'iteration-standards',
    'validation-evidence'
  ];
  const pages = [{
    path: preview.project.overviewPath,
    expectedSha256: null,
    title: 'Release knowledge project',
    summary: 'Entry point for evidence-backed release knowledge.',
    content: '# Release knowledge project',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  }, ...releaseNames.map((name) => ({
    path: `${preview.project.rootPath}/references/releases/${name}.md`,
    expectedSha256: null,
    title: name,
    summary: `Evidence-backed ${name} release knowledge.`,
    content: `# ${name}\n\nVerified from bounded repository evidence.`,
    sources: name === 'validation-evidence' ? ['docs/VALIDATION.md'] : ['package.json', 'PROGRESS.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  }))];
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, { mode: 'release-knowledge', previewToken: preview.previewToken, pages: pages.slice(0, -1) }, options),
    (error) => error instanceof WikiBasicError && error.code === 'invalid-release-knowledge-pages'
  );
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      mode: 'release-knowledge',
      previewToken: preview.previewToken,
      pages: pages.map((page, index) => index === 1 ? { ...page, sources: ['notes.md'] } : page)
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'invalid-release-knowledge-source'
  );
  const saved = await saveProjectSync(vault, workspace, { mode: 'release-knowledge', previewToken: preview.previewToken, pages }, { ...options, confirmed: true });
  assert.equal(saved.pagesCreated.length, 7);
  const manifest = JSON.parse(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'));
  const entry = manifest.projects[preview.project.id];
  for (const name of releaseNames) {
    const pagePath = `${preview.project.rootPath}/references/releases/${name}.md`;
    assert.equal(fs.existsSync(path.join(vault, pagePath)), true);
    assert.match(entry.page_sha256[pagePath], /^[a-f0-9]{64}$/);
  }
  assert.equal(entry.workflow_mode, 'release-knowledge');
  assert.equal(entry.release_knowledge.mode, 'release-knowledge');
  assert.equal(entry.release_knowledge.complete, true);
  assert.deepEqual(entry.release_knowledge.pages, releaseNames.map((name) => `${preview.project.rootPath}/references/releases/${name}.md`));
});

test('release knowledge migrates an unchanged normal project, forces its mode, and rejects a seventh page', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'release-migration-project');
  await fsp.mkdir(workspace, { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(workspace, 'README.md'), '# Release migration\n', 'utf8'),
    fsp.writeFile(path.join(workspace, 'package.json'), '{"version":"1.1.8"}\n', 'utf8'),
    fsp.writeFile(path.join(workspace, 'PROGRESS.md'), '# Progress\n', 'utf8')
  ]);
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  let preview = await previewProjectSync(vault, workspace, options);
  const overviewPage = {
    path: preview.project.overviewPath,
    expectedSha256: null,
    title: 'Release migration project',
    summary: 'A normal project may later initialize release knowledge.',
    content: '# Release migration project',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  await saveProjectSync(vault, workspace, { previewToken: preview.previewToken, pages: [overviewPage] }, { ...options, confirmed: true });
  preview = await previewProjectSync(vault, workspace, options);
  assert.equal(preview.sourceUnchanged, true);
  assert.equal(preview.releaseKnowledge.complete, false);
  const makeReleasePages = (currentPreview) => currentPreview.releaseKnowledge.requiredPaths.map((pagePath) => {
    const existing = currentPreview.existingPages.find((page) => page.path === pagePath);
    return {
      path: pagePath,
      expectedSha256: existing?.sha256 ?? null,
      title: path.basename(pagePath, '.md'),
      summary: 'Fixed release knowledge backed by bounded repository evidence.',
      content: `# ${path.basename(pagePath, '.md')}\n\nVerified release evidence.`,
      sources: ['package.json', 'PROGRESS.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    };
  });
  const firstRelease = await saveProjectSync(vault, workspace, {
    mode: 'release-knowledge',
    previewToken: preview.previewToken,
    pages: makeReleasePages(preview)
  }, { ...options, confirmed: true });
  assert.equal(firstRelease.pagesCreated.length, 6);

  await fsp.appendFile(path.join(workspace, 'PROGRESS.md'), '\nSource changed.\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  const releasePages = makeReleasePages(preview);
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, { previewToken: preview.previewToken, pages: [releasePages[0]] }, options),
    (error) => error instanceof WikiBasicError && error.code === 'release-mode-required'
  );

  const extraPath = path.join(vault, preview.project.rootPath, 'references', 'releases', 'legacy-extra.md');
  await fsp.writeFile(extraPath, '# Legacy extra\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  assert.deepEqual(preview.releaseKnowledge.extraPages, [`${preview.project.rootPath}/references/releases/legacy-extra.md`]);
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      mode: 'release-knowledge',
      previewToken: preview.previewToken,
      pages: makeReleasePages(preview)
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'release-knowledge-extra-pages'
  );
  assert.equal(fs.existsSync(extraPath), true);

  await fsp.unlink(extraPath);
  preview = await previewProjectSync(vault, workspace, options);
  await saveProjectSync(vault, workspace, {
    mode: 'release-knowledge',
    previewToken: preview.previewToken,
    pages: makeReleasePages(preview)
  }, { ...options, confirmed: true });
  preview = await previewProjectSync(vault, workspace, options);
  assert.equal(preview.unchanged, true);
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      mode: 'release-knowledge',
      previewToken: preview.previewToken,
      pages: makeReleasePages(preview)
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'release-knowledge-unchanged'
  );
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
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
});

test('one vault lock serializes all writes and query fails closed while a transaction is active', async (t) => {
  const { root, vault } = await fixture(t);
  const projectWorkspace = path.join(root, 'shared-lock-project');
  const historyWorkspace = path.join(root, 'shared-lock-history');
  const historySourcePath = path.join(root, 'shared-lock-history-source.json');
  await Promise.all([
    fsp.mkdir(projectWorkspace, { recursive: true }),
    fsp.mkdir(historyWorkspace, { recursive: true })
  ]);
  await fsp.writeFile(path.join(projectWorkspace, 'README.md'), '# Shared lock project\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  await fsp.writeFile(path.join(vault, 'concepts', 'shared-lock-probe.md'), `---\ntitle: 共享写锁探针\nsummary: 查询在写锁繁忙时仍返回结果。\ntags: [dsh, lock]\n---\n\n# 共享写锁探针\n`, 'utf8');

  const projectOptions = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const projectPreview = await previewProjectSync(vault, projectWorkspace, projectOptions);
  const projectSpec = {
    previewToken: projectPreview.previewToken,
    pages: [{
      path: projectPreview.project.overviewPath,
      expectedSha256: null,
      title: 'Shared lock project',
      summary: 'Project write holds the shared vault lock.',
      content: '# Shared lock project',
      sources: ['README.md'],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };

  const historySource = await writeHistorySource(historySourcePath, historyWorkspace);
  const historyPreview = await previewDshHistoryIngest(vault, historyWorkspace, historySourcePath, { clock: fixedClock });
  const historySpec = {
    previewToken: historyPreview.previewToken,
    sourceToken: historyPreview.sourceToken,
    pages: [{
      path: `${historyPreview.project.rootPath}/history/shared-lock.md`,
      expectedSha256: null,
      title: 'Shared lock history',
      summary: 'History write uses the same vault lock.',
      content: '# Shared lock history',
      sources: [historySource.sessions[0].sourceId],
      provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
    }]
  };
  const capture = {
    title: '共享锁保存结论',
    content: '保存会话结论也必须使用同一个知识库写锁。',
    sourceSessionId: 'session-shared-lock',
    sourceSeq: 9,
    sourceTime: 1787990400000
  };

  let continueProject;
  let signalProjectPaused;
  const projectPaused = new Promise((resolve) => { signalProjectPaused = resolve; });
  const resumeProject = new Promise((resolve) => { continueProject = resolve; });
  const projectSave = saveProjectSync(vault, projectWorkspace, projectSpec, {
    ...projectOptions,
    confirmed: true,
    afterPageWrites: async () => {
      signalProjectPaused();
      await resumeProject;
    }
  });
  await projectPaused;
  const logBeforeBusyQuery = await fsp.readFile(path.join(vault, 'log.md'), 'utf8');
  try {
    assert.equal(fs.existsSync(wikiWriteLockPath(vault)), true);
    const query = await queryWiki(vault, '共享写锁探针', { clock: fixedClock });
    assert.equal(query.ok, false);
    assert.equal(query.code, 'wiki-read-busy');
    assert.deepEqual(query.results, []);
    assert.equal(query.logged, false);
    assert.equal(await fsp.readFile(path.join(vault, 'log.md'), 'utf8'), logBeforeBusyQuery);
    await assert.rejects(
      () => saveCapture(vault, capture, { clock: fixedClock }),
      (error) => error instanceof WikiBasicError && error.code === 'capture-busy'
    );
    await assert.rejects(
      () => saveDshHistoryIngest(vault, historyWorkspace, historySourcePath, historySpec, { clock: fixedClock, confirmed: true }),
      (error) => error instanceof WikiBasicError && error.code === 'history-ingest-busy'
    );
  } finally {
    continueProject();
    await projectSave;
  }

  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
  assert.equal((await saveCapture(vault, capture, { clock: fixedClock })).ok, true);
  assert.equal((await saveDshHistoryIngest(vault, historyWorkspace, historySourcePath, historySpec, { clock: fixedClock, confirmed: true })).ok, true);
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
  const finalLog = await fsp.readFile(path.join(vault, 'log.md'), 'utf8');
  assert.match(finalLog, /WIKI_UPDATE project=/);
  assert.match(finalLog, /CAPTURE type=synthesis/);
  assert.match(finalLog, /DSH_HISTORY_INGEST project=/);
  assert.doesNotMatch(finalLog, /QUERY query="共享写锁探针"/);
});

test('a dead shared Wiki lock requires explicit recovery and is never reclaimed by path', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const lockPath = wikiWriteLockPath(vault);
  const staleLock = `${JSON.stringify({ pid: 0, token: 'stale-owner-token', operation: 'project-sync' })}\n`;
  await fsp.writeFile(lockPath, staleLock, 'utf8');
  const staleTime = new Date(Date.now() - (10 * 60 * 1000));
  await fsp.utimes(lockPath, staleTime, staleTime);

  await assert.rejects(
    () => saveCapture(vault, {
      title: '死锁恢复边界',
      content: '死锁不得由竞争进程自动删除。',
      sourceSessionId: 'session-dead-lock',
      sourceSeq: 1
    }, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'wiki-write-recovery-required'
  );
  assert.equal(await fsp.readFile(lockPath, 'utf8'), staleLock);
});

test('legacy project and history locks fail closed with compatible error codes', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const capture = {
    title: '旧版锁兼容边界',
    content: '旧版写锁存在时新版不得写入。',
    sourceSessionId: 'session-legacy-lock',
    sourceSeq: 2
  };
  const cases = [
    ['.dsh-wiki-project-sync.lock', 'project-sync-busy'],
    ['.dsh-wiki-history-ingest.lock', 'history-ingest-busy']
  ];
  for (const [name, code] of cases) {
    const legacyPath = path.join(vault, '_staging', name);
    await fsp.writeFile(legacyPath, '{}\n', 'utf8');
    await assert.rejects(
      () => saveCapture(vault, capture, { clock: fixedClock }),
      (error) => error instanceof WikiBasicError && error.code === code
    );
    assert.equal(fs.existsSync(legacyPath), true);
    await fsp.unlink(legacyPath);
  }
});

test('legacy unsafe locks retain their operation-specific compatibility codes', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const capture = {
    title: '旧版不安全锁',
    content: '不安全旧锁必须失败关闭。',
    sourceSessionId: 'session-unsafe-legacy-lock',
    sourceSeq: 3
  };
  const cases = [
    ['.dsh-wiki-project-sync.lock', 'unsafe-project-sync-lock'],
    ['.dsh-wiki-history-ingest.lock', 'unsafe-history-lock']
  ];
  for (const [name, code] of cases) {
    const legacyPath = path.join(vault, '_staging', name);
    await fsp.mkdir(legacyPath);
    await assert.rejects(
      () => saveCapture(vault, capture, { clock: fixedClock }),
      (error) => error instanceof WikiBasicError && error.code === code
    );
    assert.equal(fs.statSync(legacyPath).isDirectory(), true);
    await fsp.rmdir(legacyPath);
  }
});

test('shared Wiki lock release retries transient Windows unlink failures', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const lockPath = path.resolve(wikiWriteLockPath(vault));
  const originalUnlink = fsp.unlink;
  let transientFailures = 2;
  let lockUnlinkAttempts = 0;
  fsp.unlink = async (target, ...args) => {
    if (path.resolve(target).startsWith(`${lockPath}.release-`)) {
      lockUnlinkAttempts += 1;
      if (transientFailures > 0) {
        transientFailures -= 1;
        const error = new Error('injected transient lock interference');
        error.code = transientFailures === 1 ? 'EACCES' : 'EPERM';
        throw error;
      }
    }
    return originalUnlink(target, ...args);
  };
  try {
    const saved = await saveCapture(vault, {
      title: '写锁短暂干扰',
      content: '释放锁时遇到短暂占用应有限重试。',
      sourceSessionId: 'session-transient-lock',
      sourceSeq: 4
    }, { clock: fixedClock });
    assert.equal(saved.ok, true);
  } finally {
    fsp.unlink = originalUnlink;
  }
  assert.equal(lockUnlinkAttempts, 3);
  assert.equal(fs.existsSync(lockPath), false);
});

test('a released lock cleanup failure never reclaims the canonical path from a later writer', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const lockPath = path.resolve(wikiWriteLockPath(vault));
  const originalUnlink = fsp.unlink;
  let lockUnlinkAttempts = 0;
  fsp.unlink = async (target, ...args) => {
    if (path.resolve(target).startsWith(`${lockPath}.release-`)) {
      lockUnlinkAttempts += 1;
      const error = new Error('injected persistent lock interference');
      error.code = 'EBUSY';
      throw error;
    }
    return originalUnlink(target, ...args);
  };
  try {
    const committed = await saveCapture(vault, {
      title: '写锁孤儿首次保存',
      content: '内容已保存，但锁释放被持续干扰。',
      sourceSessionId: 'session-orphan-lock-a',
      sourceSeq: 5
    }, { clock: fixedClock });
    assert.equal(committed.ok, true);
    assert.equal(committed.committed, true);
    assert.equal(committed.cleanupPending, true);
    assert.equal(committed.warningCode, 'wiki-write-lock-release-incomplete');
    assert.match(committed.message, /已验证保存/);
    assert.ok(lockUnlinkAttempts > 1);
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal((await fsp.readdir(path.dirname(lockPath))).some((name) => name.startsWith(`${path.basename(lockPath)}.release-`)), true);
  } finally {
    fsp.unlink = originalUnlink;
  }

  const recovered = await saveCapture(vault, {
    title: '写锁孤儿后续保存',
    content: '同进程下一次写入先校验 token，再清理自己的孤儿锁。',
    sourceSessionId: 'session-orphan-lock-b',
    sourceSeq: 6
  }, { clock: fixedClock });
  assert.equal(recovered.ok, true);
  assert.equal(fs.existsSync(lockPath), false);
});

test('metadata failure never removes a replacement lock with a different token', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const lockPath = path.resolve(wikiWriteLockPath(vault));
  const originalOpen = fsp.open;
  const foreign = `${JSON.stringify({ pid: 0, token: 'foreign-replacement-token', operation: 'external' })}\n`;
  let injected = false;
  fsp.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    if (path.resolve(target) !== lockPath || injected) return handle;
    injected = true;
    const originalSync = handle.sync.bind(handle);
    handle.sync = async () => {
      await originalSync();
      await fsp.writeFile(lockPath, foreign, 'utf8');
      const error = new Error('injected metadata sync failure');
      error.code = 'EIO';
      throw error;
    };
    return handle;
  };
  try {
    await assert.rejects(
      () => saveCapture(vault, {
        title: '元数据失败边界',
        content: '只能删除 token 仍然属于自己的锁。',
        sourceSessionId: 'session-metadata-failure',
        sourceSeq: 7
      }, { clock: fixedClock })
    );
  } finally {
    fsp.open = originalOpen;
  }
  assert.equal(await fsp.readFile(lockPath, 'utf8'), foreign);
});

test('lock release claims and validates the exact directory entry before deleting it', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const lockPath = path.resolve(wikiWriteLockPath(vault));
  const displacedOwnLock = `${lockPath}.displaced-own-lock`;
  const foreign = `${JSON.stringify({ pid: 0, token: 'foreign-at-release-boundary', operation: 'external', state: 'held' })}\n`;
  const originalRename = fsp.rename;
  let injected = false;
  fsp.rename = async (source, destination, ...args) => {
    if (!injected && path.resolve(source) === lockPath && String(destination).startsWith(`${lockPath}.release-`)) {
      injected = true;
      await originalRename(source, displacedOwnLock);
      await fsp.writeFile(lockPath, foreign, 'utf8');
    }
    return originalRename(source, destination, ...args);
  };
  try {
    await assert.rejects(
      () => saveCapture(vault, {
        title: '锁释放边界',
        content: '被替换的外部锁不能因旧 token 校验而删除。',
        sourceSessionId: 'session-release-boundary',
        sourceSeq: 8
      }, { clock: fixedClock }),
      (error) => error instanceof WikiBasicError && error.code === 'wiki-write-lock-lost'
    );
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal(injected, true);
  assert.equal(await fsp.readFile(lockPath, 'utf8'), foreign);
  assert.equal(fs.existsSync(displacedOwnLock), true);
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

test('first project sync refuses a pre-existing untracked overview page', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'manual-overview-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Manual overview project\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const initial = await previewProjectSync(vault, workspace, options);
  const target = path.join(vault, initial.project.overviewPath);
  const original = '# Human-owned overview\n\nThis page predates DSH ownership.\n';
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, original, 'utf8');

  await assert.rejects(
    () => previewProjectSync(vault, workspace, options),
    (error) => error instanceof WikiBasicError && error.code === 'untracked-project-page'
  );
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      previewToken: initial.previewToken,
      pages: [{
        path: initial.project.overviewPath,
        expectedSha256: null,
        title: 'Manual overview project',
        summary: 'DSH must not adopt this existing page.',
        content: '# Replacement overview',
        sources: ['README.md'],
        provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
      }]
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'untracked-project-page'
  );
  assert.equal(await fsp.readFile(target, 'utf8'), original);
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
  assert.match(manifest.history.dsh[preview.project.id].page_sha256[pagePath], /^[a-f0-9]{64}$/);

  await writeHistorySource(sourcePath, workspace, { sourceToken: 'f'.repeat(32) });
  const unchanged = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.delta.unchanged.length, 1);
  assert.deepEqual(unchanged.humanEditedPages, []);
  await fsp.appendFile(path.join(vault, pagePath), '\n人工补充历史说明。\n', 'utf8');
  const humanEdited = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  assert.deepEqual(humanEdited.humanEditedPages, [pagePath]);
  const trackedPage = await readDshHistoryWikiPage(vault, workspace, sourcePath, pagePath, { clock: fixedClock });
  assert.match(trackedPage.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    () => saveDshHistoryIngest(vault, workspace, sourcePath, { ...spec, previewToken: unchanged.previewToken, sourceToken: unchanged.sourceToken }, { clock: fixedClock, confirmed: true }),
    (error) => error instanceof WikiBasicError && error.code === 'history-unchanged'
  );
  await fsp.unlink(path.join(vault, pagePath));
  const missing = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  assert.equal(missing.unchanged, false);
  assert.deepEqual(missing.missingManagedPages, [pagePath]);
  await assert.rejects(
    () => buildDshHistoryIngestPlan(vault, workspace, sourcePath, {
      ...spec,
      previewToken: missing.previewToken,
      sourceToken: missing.sourceToken
    }, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'managed-pages-missing'
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
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
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

test('DSH history import refuses a configured page without a committed hash', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'history-manifest-ownership-project');
  const sourcePath = path.join(root, 'wiki-history-source.json');
  await fsp.mkdir(workspace, { recursive: true });
  await initializeWikiVault(vault, { clock: fixedClock });
  const source = await writeHistorySource(sourcePath, workspace);
  const initial = await previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock });
  const pagePath = `${initial.project.rootPath}/history/human-note.md`;
  const absolute = path.join(vault, pagePath);
  const original = '# Human history page\n\nA path alone does not establish DSH ownership.\n';
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, original, 'utf8');

  const manifestPath = path.join(vault, '.manifest.json');
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  manifest.history = {
    ...(manifest.history || {}),
    dsh: {
      ...(manifest.history?.dsh || {}),
      [initial.project.id]: {
        id: initial.project.id,
        name: initial.project.name,
        source_cwd: initial.project.sourceCwd,
        sessions: {},
        pages_in_vault: [pagePath],
        page_sha256: {}
      }
    }
  };
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  await assert.rejects(
    () => previewDshHistoryIngest(vault, workspace, sourcePath, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'untracked-history-page'
  );
  await assert.rejects(
    () => buildDshHistoryIngestPlan(vault, workspace, sourcePath, {
      previewToken: initial.previewToken,
      sourceToken: initial.sourceToken,
      pages: [{
        path: pagePath,
        expectedSha256: createHash('sha256').update(original).digest('hex'),
        title: 'Replacement',
        summary: 'This must be refused without a committed ownership hash.',
        content: '# Replacement',
        sources: [source.sessions[0].sourceId],
        provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
      }]
    }, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'untracked-history-page'
  );
  assert.equal(await fsp.readFile(absolute, 'utf8'), original);
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
  assert.equal(fs.existsSync(wikiWriteLockPath(vault)), false);
  assert.match(await fsp.readFile(path.join(vault, pagePath), 'utf8'), /One serialized writer/);
});

test('project page claims recover when rename completed before reporting an error', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'claim-completion-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# First\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  let preview = await previewProjectSync(vault, workspace, options);
  const pagePath = preview.project.overviewPath;
  const page = (expectedSha256, content) => ({
    path: pagePath,
    expectedSha256,
    title: 'Claim completion',
    summary: 'A completed rename must be discovered after an uncertain error.',
    content,
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  });
  await saveProjectSync(vault, workspace, { previewToken: preview.previewToken, pages: [page(null, '# First')] }, { ...options, confirmed: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Second\n', 'utf8');
  preview = await previewProjectSync(vault, workspace, options);
  const current = await readProjectWikiPage(vault, workspace, pagePath, options);
  const originalRename = fsp.rename;
  let injected = false;
  fsp.rename = async (source, destination, ...args) => {
    if (!injected && path.resolve(source) === path.resolve(path.join(vault, pagePath))
      && String(destination).includes(`${path.sep}_claims${path.sep}prewrite${path.sep}`)) {
      injected = true;
      await originalRename(source, destination, ...args);
      const error = new Error('rename completed before EIO');
      error.code = 'EIO';
      throw error;
    }
    return originalRename(source, destination, ...args);
  };
  try {
    const saved = await saveProjectSync(vault, workspace, {
      previewToken: preview.previewToken,
      pages: [page(current.sha256, '# Second')]
    }, { ...options, confirmed: true });
    assert.equal(saved.ok, true);
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal(injected, true);
  assert.match(await fsp.readFile(path.join(vault, pagePath), 'utf8'), /# Second/);
  assert.equal((await inspectWikiVault(vault)).status, 'ready');
});

test('new page publication recovers when link completed before reporting an error', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const capture = {
    title: 'Link completion ambiguity',
    content: 'The visible page and metadata must commit together.',
    sourceSessionId: 'session-link-completion',
    sourceSeq: 1
  };
  const target = path.resolve(buildCapturePreview(vault, capture).absolutePath);
  const originalLink = fsp.link;
  let injected = false;
  fsp.link = async (source, destination, ...args) => {
    if (!injected && path.resolve(destination) === target) {
      injected = true;
      await originalLink(source, destination, ...args);
      const error = new Error('link completed before EIO');
      error.code = 'EIO';
      throw error;
    }
    return originalLink(source, destination, ...args);
  };
  try {
    const saved = await saveCapture(vault, capture, { clock: fixedClock });
    assert.equal(saved.ok, true);
  } finally {
    fsp.link = originalLink;
  }
  assert.equal(injected, true);
  const queried = await queryWiki(vault, 'completion ambiguity', { log: false });
  assert.equal(queried.results.some((item) => path.resolve(path.join(vault, item.path)) === target), true);
});

test('release namespace and project paths are governed case-insensitively', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'release-case-policy');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Release policy\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const base = {
    expectedSha256: null,
    title: 'Policy page',
    summary: 'Case-insensitive policy path.',
    content: '# Policy',
    sources: ['README.md'],
    provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
  };
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      previewToken: preview.previewToken,
      pages: [{ ...base, path: `${preview.project.rootPath}/references/ReLeAsEs/seventh.md` }]
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'release-mode-required'
  );
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      previewToken: preview.previewToken,
      pages: [
        { ...base, path: preview.project.overviewPath },
        { ...base, path: `${preview.project.rootPath}/concepts/Foo.md` },
        { ...base, path: `${preview.project.rootPath}/concepts/foo.md` }
      ]
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'invalid-project-page-path'
  );
  await assert.rejects(
    () => buildProjectSyncPlan(vault, workspace, {
      previewToken: preview.previewToken,
      pages: [{ ...base, path: `/${preview.project.overviewPath}` }]
    }, options),
    (error) => error instanceof WikiBasicError && error.code === 'invalid-project-page-path'
  );
});

test('history source cleanup claims and preserves a replacement at the rename boundary', async (t) => {
  const { root } = await fixture(t);
  const workspace = path.join(root, 'history-cleanup-workspace');
  const sourcePath = path.join(root, 'history-source.json');
  const displaced = path.join(root, 'history-source-original.json');
  await fsp.mkdir(workspace, { recursive: true });
  await writeHistorySource(sourcePath, workspace);
  const replacementToken = 'f'.repeat(32);
  const originalRename = fsp.rename;
  let injected = false;
  fsp.rename = async (source, destination, ...args) => {
    if (!injected && path.resolve(source) === path.resolve(sourcePath) && String(destination).includes('.consumed-')) {
      injected = true;
      await originalRename(source, displaced);
      await writeHistorySource(sourcePath, workspace, { sourceToken: replacementToken });
    }
    return originalRename(source, destination, ...args);
  };
  try {
    await assert.rejects(
      () => clearDshHistorySource(sourcePath, '0123456789abcdef0123456789abcdef'),
      (error) => error instanceof WikiBasicError && error.code === 'stale-history-source'
    );
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal(injected, true);
  const replacement = JSON.parse(await fsp.readFile(sourcePath, 'utf8'));
  assert.equal(replacement.sourceToken, replacementToken);
  assert.equal(fs.existsSync(displaced), true);
});

test('recovery clear claims the exact staging directory and quarantines a dynamic junction', async (t) => {
  const { root, vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const archive = '_archives/dsh-capture/2026-08-29T08-00-00-000Z-33333333-3333-4333-8333-333333333333';
  const archivePath = path.join(vault, ...archive.split('/'));
  await fsp.mkdir(archivePath, { recursive: true });
  const marker = {
    version: 1,
    id: '44444444-4444-4444-8444-444444444444',
    operation: 'capture',
    archive,
    createdAt: '2026-08-29T08:00:00.000Z',
    originalCode: 'forced-failure',
    failures: ['dynamic-junction-test']
  };
  await fsp.writeFile(wikiRecoveryMarkerPath(vault), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  const protection = await readWikiRecoveryProtection(vault);
  const staging = path.join(vault, '_staging');
  const safeAside = path.join(vault, '_staging-original-safe');
  const outside = path.join(root, 'outside-dynamic-staging');
  const outsideMarker = path.join(outside, '.dsh-wiki-recovery-required.json');
  await fsp.mkdir(outside, { recursive: true });
  await fsp.writeFile(outsideMarker, 'OUTSIDE-MARKER-MUST-STAY\n', 'utf8');
  const originalRename = fsp.rename;
  let injected = false;
  fsp.rename = async (source, destination, ...args) => {
    if (!injected && path.resolve(source) === path.resolve(staging) && String(destination).includes('_staging-recovery-clear-')) {
      injected = true;
      await originalRename(staging, safeAside);
      await fsp.symlink(outside, staging, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return originalRename(source, destination, ...args);
  };
  try {
    await assert.rejects(
      () => clearWikiRecoveryMarker(vault, recoveryConfirmation(protection)),
      (error) => error instanceof WikiBasicError && error.code === 'unsafe-recovery-staging'
    );
  } finally {
    fsp.rename = originalRename;
  }
  assert.equal(injected, true);
  assert.equal(await fsp.readFile(outsideMarker, 'utf8'), 'OUTSIDE-MARKER-MUST-STAY\n');
  assert.equal(fs.existsSync(path.join(vault, '.dsh-wiki-recovery-clear.lock')), true);
  assert.equal((await inspectWikiVault(vault)).status, 'recovery-required');
  await assert.rejects(
    () => initializeWikiVault(vault, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'wiki-recovery-clear-busy'
  );
});

test('an interrupted recovery clear before staging is claimed safely resets and reveals the original protection', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '5');
  const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await writeInterruptedRecoveryClearGuard(vault, { token });

  const guard = await readWikiRecoveryProtection(vault);
  assert.equal(guard.type, 'clear-guard');
  assert.equal(guard.archive, '');
  const reset = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(reset.cleared, false);
  assert.equal(reset.reset, true);
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), false);
  assert.equal(await fsp.readFile(wikiRecoveryMarkerPath(vault), 'utf8'), recovery.markerText);

  const revealed = await readWikiRecoveryProtection(vault);
  assert.equal(revealed.type, 'marker');
  assert.deepEqual(recoveryConfirmation(revealed), recovery.protection);
  const cleared = await clearWikiRecoveryMarker(vault, recoveryConfirmation(revealed));
  assert.equal(cleared.cleared, true);
  const retainedJournal = await fsp.readFile(path.join(vault, ...cleared.retainedGuard.split('/')), 'utf8');
  assert.ok((retainedJournal.match(/DSH-WIKI-RECOVERY-CLEAR\/1 /gu) || []).length >= 6);
});

test('an empty first recovery-clear journal remains explicitly resettable', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '4');
  await fsp.writeFile(wikiRecoveryClearGuardPath(vault), Buffer.alloc(0), { mode: 0o600 });

  const guard = await readWikiRecoveryProtection(vault);
  assert.equal(guard.type, 'clear-guard');
  assert.equal(guard.archive, '');
  assert.equal(guard.guardPhase, 'uninitialized');
  assert.equal((await inspectWikiVault(vault)).status, 'recovery-required');
  await assert.rejects(
    () => initializeWikiVault(vault, { clock: fixedClock }),
    (error) => error instanceof WikiBasicError && error.code === 'wiki-recovery-clear-busy'
  );

  const reset = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(reset.cleared, false);
  assert.equal(reset.reset, true);
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), false);
  assert.equal(await fsp.readFile(wikiRecoveryMarkerPath(vault), 'utf8'), recovery.markerText);
});

test('a partial first recovery-clear journal remains explicitly resettable', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '3');
  await fsp.writeFile(
    wikiRecoveryClearGuardPath(vault),
    Buffer.from(`${wikiRecoveryClearJournalMagic}eyJqb3VybmFsVmVyc2lvbiI6MQ`, 'utf8'),
    { mode: 0o600 }
  );

  const guard = await readWikiRecoveryProtection(vault);
  assert.equal(guard.guardPhase, 'uninitialized');
  assert.equal((await inspectWikiVault(vault)).status, 'recovery-required');
  const reset = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(reset.reset, true);
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), false);
  assert.equal(await fsp.readFile(wikiRecoveryMarkerPath(vault), 'utf8'), recovery.markerText);
});

test('a partial tail after a valid prepared journal record resets without losing the original protection', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '2');
  const token = '12121212-1212-4121-8121-121212121212';
  const records = recoveryClearJournalRecords({
    token,
    recovery,
    stagingIdentity: await directoryIdentityRecord(path.join(vault, '_staging')),
    through: 'prepared'
  });
  await fsp.writeFile(
    wikiRecoveryClearGuardPath(vault),
    buildRecoveryClearJournal(records, { trailingRecord: { ...records.at(-1), phase: 'claimed' } }),
    { mode: 0o600 }
  );

  const guard = await readWikiRecoveryProtection(vault);
  assert.equal(guard.guardPhase, 'prepared');
  const reset = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(reset.reset, true);
  assert.equal(reset.cleared, false);
  assert.equal(await fsp.readFile(wikiRecoveryMarkerPath(vault), 'utf8'), recovery.markerText);
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), false);
});

test('a partial tail after a claimed journal record resumes from the last complete phase', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '1');
  const token = '13131313-1313-4131-8131-131313131313';
  const staging = path.join(vault, '_staging');
  const stagingIdentity = await directoryIdentityRecord(staging);
  const records = recoveryClearJournalRecords({ token, recovery, stagingIdentity, through: 'claimed' });
  const retainedRecord = {
    ...records.at(-1),
    phase: 'retained',
    retainedStaging: `_cleared-staging-${token}`
  };
  await fsp.rename(staging, path.join(vault, `_staging-recovery-clear-${token}`));
  await fsp.writeFile(
    wikiRecoveryClearGuardPath(vault),
    buildRecoveryClearJournal(records, { trailingRecord: retainedRecord }),
    { mode: 0o600 }
  );

  const guard = await readWikiRecoveryProtection(vault);
  assert.equal(guard.guardPhase, 'claimed');
  const cleared = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.resumed, true);
  assert.equal((await inspectWikiVault(vault)).status, 'ready');
});

test('a partial tail after a retained journal record resumes and recreates staging', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '9');
  const token = '14141414-1414-4141-8141-141414141414';
  const staging = path.join(vault, '_staging');
  const stagingIdentity = await directoryIdentityRecord(staging);
  const records = recoveryClearJournalRecords({ token, recovery, stagingIdentity, through: 'retained' });
  await fsp.rename(staging, path.join(recovery.archivePath, `_cleared-staging-${token}`));
  await fsp.writeFile(
    wikiRecoveryClearGuardPath(vault),
    buildRecoveryClearJournal(records, { trailingRecord: { ...records.at(-1), phase: 'staging-created' } }),
    { mode: 0o600 }
  );

  const guard = await readWikiRecoveryProtection(vault);
  assert.equal(guard.guardPhase, 'retained');
  const cleared = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.resumed, true);
  assert.equal(fs.statSync(staging).isDirectory(), true);
  assert.equal((await fsp.readdir(staging)).length, 0);
});

test('a complete recovery-clear journal frame with a broken checksum fails closed', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '0');
  const token = '15151515-1515-4151-8151-151515151515';
  const records = recoveryClearJournalRecords({
    token,
    recovery,
    stagingIdentity: await directoryIdentityRecord(path.join(vault, '_staging')),
    through: 'prepared'
  });
  const corrupted = buildRecoveryClearJournal(records);
  corrupted[corrupted.length - 2] = corrupted[corrupted.length - 2] === 0x30 ? 0x31 : 0x30;
  await fsp.writeFile(wikiRecoveryClearGuardPath(vault), corrupted, { mode: 0o600 });

  await assert.rejects(
    () => readWikiRecoveryProtection(vault),
    (error) => error instanceof WikiBasicError && error.code === 'unsafe-recovery-clear-guard'
  );
  const middleCorrupted = buildRecoveryClearJournal(records);
  const firstNewline = middleCorrupted.indexOf(0x0a);
  const secondNewline = middleCorrupted.indexOf(0x0a, firstNewline + 1);
  middleCorrupted[secondNewline - 1] = middleCorrupted[secondNewline - 1] === 0x30 ? 0x31 : 0x30;
  await fsp.writeFile(wikiRecoveryClearGuardPath(vault), middleCorrupted, { mode: 0o600 });
  await assert.rejects(
    () => readWikiRecoveryProtection(vault),
    (error) => error instanceof WikiBasicError && error.code === 'unsafe-recovery-clear-guard'
  );
  const unavailable = await inspectWikiVault(vault);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.recovery.invalid, true);
  assert.equal(unavailable.recovery.code, 'unsafe-recovery-clear-guard');
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), true);
});

test('an oversized recovery-clear journal fails closed', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  await fsp.writeFile(wikiRecoveryClearGuardPath(vault), Buffer.alloc((64 * 1024) + 1, 0x78), { mode: 0o600 });
  await assert.rejects(
    () => readWikiRecoveryProtection(vault),
    (error) => error instanceof WikiBasicError && error.code === 'unsafe-recovery-clear-guard'
  );
  assert.equal((await inspectWikiVault(vault)).status, 'unavailable');
});

test('an interrupted recovery clear resumes after the original staging directory was claimed', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '6');
  const token = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const staging = path.join(vault, '_staging');
  const stagingIdentity = await directoryIdentityRecord(staging);
  const claimedStaging = `_staging-recovery-clear-${token}`;
  await fsp.rename(staging, path.join(vault, claimedStaging));
  await writeInterruptedRecoveryClearGuard(vault, {
    token,
    phase: 'claimed',
    archive: recovery.archive,
    protection: recovery.protection,
    claimedStaging,
    stagingIdentity
  });

  const guard = await readWikiRecoveryProtection(vault);
  const cleared = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.resumed, true);
  assert.equal(fs.existsSync(path.join(vault, '_staging')), true);
  assert.equal(fs.existsSync(path.join(vault, claimedStaging)), false);
  assert.equal(fs.existsSync(path.join(vault, cleared.retainedStaging)), true);
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), false);
  assert.equal((await inspectWikiVault(vault)).status, 'ready');
});

test('an interrupted recovery clear finishes after staging was retained and a fresh staging directory was created', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '7');
  const token = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const staging = path.join(vault, '_staging');
  const stagingIdentity = await directoryIdentityRecord(staging);
  const retainedStaging = `_cleared-staging-${token}`;
  await fsp.rename(staging, path.join(recovery.archivePath, retainedStaging));
  await fsp.mkdir(staging);
  const freshStagingIdentity = await directoryIdentityRecord(staging);
  await writeInterruptedRecoveryClearGuard(vault, {
    token,
    phase: 'staging-created',
    archive: recovery.archive,
    protection: recovery.protection,
    claimedStaging: `_staging-recovery-clear-${token}`,
    retainedStaging,
    stagingIdentity,
    freshStagingIdentity
  });

  const guard = await readWikiRecoveryProtection(vault);
  const cleared = await clearWikiRecoveryMarker(vault, recoveryConfirmation(guard));
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.resumed, true);
  assert.equal(cleared.retainedStaging, `${recovery.archive}/${retainedStaging}`);
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), false);
  assert.equal((await fsp.readdir(staging)).length, 0);
  assert.equal((await inspectWikiVault(vault)).status, 'ready');
});

test('recovery clear resume rejects an active owner and every stale guard confirmation tuple', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '8');
  const token = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const staging = path.join(vault, '_staging');
  await writeInterruptedRecoveryClearGuard(vault, {
    token,
    pid: process.pid,
    phase: 'prepared',
    archive: recovery.archive,
    protection: recovery.protection,
    claimedStaging: `_staging-recovery-clear-${token}`,
    stagingIdentity: await directoryIdentityRecord(staging)
  });
  const activeGuard = await readWikiRecoveryProtection(vault);
  await assert.rejects(
    () => clearWikiRecoveryMarker(vault, recoveryConfirmation(activeGuard)),
    (error) => error instanceof WikiBasicError && error.code === 'wiki-recovery-clear-busy'
  );

  const stalePidRecord = JSON.parse(await fsp.readFile(wikiRecoveryClearGuardPath(vault), 'utf8'));
  stalePidRecord.pid = 2147483647;
  await fsp.writeFile(wikiRecoveryClearGuardPath(vault), `${JSON.stringify(stalePidRecord)}\n`, 'utf8');
  await assert.rejects(
    () => clearWikiRecoveryMarker(vault, recoveryConfirmation(activeGuard)),
    (error) => error instanceof WikiBasicError && error.code === 'stale-recovery-marker'
  );
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), true);

  const currentGuard = await readWikiRecoveryProtection(vault);
  for (const stale of [
    { ...recoveryConfirmation(currentGuard), type: 'marker' },
    { ...recoveryConfirmation(currentGuard), id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
    { ...recoveryConfirmation(currentGuard), digest: '0'.repeat(64) },
    { ...recoveryConfirmation(currentGuard), archive: '_archives/dsh-capture/not-current' }
  ]) {
    await assert.rejects(
      () => clearWikiRecoveryMarker(vault, stale),
      (error) => error instanceof WikiBasicError && error.code === 'stale-recovery-marker'
    );
    assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), true);
  }

  const changedMarker = JSON.parse(await fsp.readFile(wikiRecoveryMarkerPath(vault), 'utf8'));
  changedMarker.failures.push('changed-after-clear-guard-confirmation');
  await fsp.writeFile(wikiRecoveryMarkerPath(vault), `${JSON.stringify(changedMarker, null, 2)}\n`, 'utf8');
  await assert.rejects(
    () => clearWikiRecoveryMarker(vault, recoveryConfirmation(currentGuard)),
    (error) => error instanceof WikiBasicError && error.code === 'stale-recovery-marker'
  );
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), true);
});

test('recovery clear resume rejects guard file replacement during the claim boundary', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '6');
  const token = '16161616-1616-4161-8161-161616161616';
  const guardPath = wikiRecoveryClearGuardPath(vault);
  const records = recoveryClearJournalRecords({
    token,
    recovery,
    stagingIdentity: await directoryIdentityRecord(path.join(vault, '_staging')),
    through: 'prepared'
  });
  const journal = buildRecoveryClearJournal(records);
  await fsp.writeFile(guardPath, journal, { mode: 0o600 });
  const guard = await readWikiRecoveryProtection(vault);
  const displaced = path.join(vault, '.dsh-wiki-recovery-clear.original');
  const originalOpen = fsp.open;
  let injected = false;
  fsp.open = async (target, flags, ...args) => {
    if (!injected && path.resolve(String(target)) === path.resolve(guardPath) && flags === 'a+') {
      injected = true;
      await fsp.rename(guardPath, displaced);
      const replacement = await originalOpen(guardPath, 'wx', 0o600);
      try { await replacement.writeFile(journal); } finally { await replacement.close(); }
    }
    return originalOpen(target, flags, ...args);
  };
  try {
    await assert.rejects(
      () => clearWikiRecoveryMarker(vault, recoveryConfirmation(guard)),
      (error) => error instanceof WikiBasicError && error.code === 'stale-recovery-marker'
    );
  } finally {
    fsp.open = originalOpen;
  }
  assert.equal(injected, true);
  assert.equal(fs.existsSync(guardPath), true);
  assert.equal(fs.existsSync(displaced), true);
});

test('recovery clear resume rejects a replaced staging directory even when marker bytes match', async (t) => {
  const { vault } = await fixture(t);
  await initializeWikiVault(vault, { clock: fixedClock });
  const recovery = await prepareMarkerRecovery(vault, '7');
  const token = '17171717-1717-4171-8171-171717171717';
  const staging = path.join(vault, '_staging');
  const records = recoveryClearJournalRecords({
    token,
    recovery,
    stagingIdentity: await directoryIdentityRecord(staging),
    through: 'prepared'
  });
  await fsp.writeFile(wikiRecoveryClearGuardPath(vault), buildRecoveryClearJournal(records), { mode: 0o600 });
  const guard = await readWikiRecoveryProtection(vault);
  const originalStaging = path.join(vault, '_staging-original');
  await fsp.rename(staging, originalStaging);
  await fsp.cp(originalStaging, staging, { recursive: true, errorOnExist: true });

  await assert.rejects(
    () => clearWikiRecoveryMarker(vault, recoveryConfirmation(guard)),
    (error) => error instanceof WikiBasicError && error.code === 'stale-recovery-staging'
  );
  assert.equal(fs.existsSync(wikiRecoveryClearGuardPath(vault)), true);
  assert.equal(await fsp.readFile(wikiRecoveryMarkerPath(vault), 'utf8'), recovery.markerText);
});

test('a target parent replaced at publication fails closed and is never reported as committed', async (t) => {
  const { root, vault } = await fixture(t);
  const workspace = path.join(root, 'parent-identity-project');
  await fsp.mkdir(workspace, { recursive: true });
  await fsp.writeFile(path.join(workspace, 'README.md'), '# Parent identity\n', 'utf8');
  await initializeWikiVault(vault, { clock: fixedClock });
  const options = { clock: fixedClock, inspectGit: async () => ({ status: 'unavailable', reason: 'git-not-found' }) };
  const preview = await previewProjectSync(vault, workspace, options);
  const pagePath = preview.project.overviewPath;
  const target = path.join(vault, pagePath);
  const targetParent = path.dirname(target);
  const safeAside = `${targetParent}-safe-aside`;
  const outside = path.join(root, 'outside-page-parent');
  await fsp.mkdir(outside, { recursive: true });
  const originalManifest = await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8');
  const originalLink = fsp.link;
  let injected = false;
  fsp.link = async (source, destination, ...args) => {
    if (!injected && path.resolve(destination) === path.resolve(target)) {
      injected = true;
      await fsp.rename(targetParent, safeAside);
      await fsp.symlink(outside, targetParent, process.platform === 'win32' ? 'junction' : 'dir');
      await fsp.copyFile(path.join(safeAside, path.basename(source)), path.join(outside, path.basename(source)));
    }
    return originalLink(source, destination, ...args);
  };
  let observed;
  try {
    await assert.rejects(
      () => saveProjectSync(vault, workspace, {
        previewToken: preview.previewToken,
        pages: [{
          path: pagePath,
          expectedSha256: null,
          title: 'Parent identity',
          summary: 'A replaced parent must fail closed.',
          content: '# Parent identity\n\nOUTSIDE-GHOST',
          sources: ['README.md'],
          provenance: { extracted: 1, inferred: 0, ambiguous: 0 }
        }]
      }, { ...options, confirmed: true }),
      (error) => {
        observed = error;
        return error instanceof WikiBasicError && error.code === 'rollback-incomplete';
      }
    );
  } finally {
    fsp.link = originalLink;
  }
  assert.equal(injected, true);
  assert.ok(observed.rollbackFailures.some((item) => item.includes('target-parent-changed')));
  assert.match(await fsp.readFile(path.join(outside, path.basename(target)), 'utf8'), /OUTSIDE-GHOST/);
  assert.equal(await fsp.readFile(path.join(vault, '.manifest.json'), 'utf8'), originalManifest);
  assert.equal((await inspectWikiVault(vault)).status, 'recovery-required');
  await assert.rejects(() => queryWiki(vault, 'OUTSIDE-GHOST', { log: false }), (error) => error instanceof WikiBasicError && error.code === 'vault-not-ready');
});
