const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('V1.1.8 Wiki center is local-only, health-aware, provenance-aware, and packaged', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/wiki-center-preload.cjs');
  const renderer = read('assets/wiki-center.js');
  const page = read('wiki-center.html');
  const styles = read('assets/wiki-center.css');
  const desktopPreload = read('electron/preload.cjs');
  const command = read('assets/workbench-command.js');
  const manifest = JSON.parse(read('package.json'));

  assert.match(main, /wikiCenterIpcAllowed/);
  assert.match(main, /isTrustedMainFrameEvent\(\s*event,\s*wikiCenterWindow\?\.webContents,\s*wikiCenterUrlAllowed\s*\)/);
  for (const channel of ['get-state', 'choose-vault', 'initialize-vault', 'recover', 'query', 'preview-project-sync', 'invoke-project-sync', 'list-history-sessions', 'prepare-history', 'invoke-history', 'get-session-candidates', 'preview-capture', 'save-capture', 'open-window']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('wiki-center:${channel}'`));
  }
  assert.match(main, /label: 'Wiki 中心…'/);
  assert.match(main, /--wiki-center-smoke-file=/);
  assert.match(main, /historyScreenshotPath/);
  assert.match(main, /不会修改原始会话，也不会执行 Git 操作/);
  assert.match(main, /selectedSummary\.origin === 'subagent'/);
  assert.match(main, /scheduleDshHistorySourceExpiry/);
  assert.match(main, /discardPreparedDshHistorySource/);
  assert.match(main, /pathKey\(selectedSummary\.cwd\) !== pathKey\(getWorkspaceState\(\)\.activePath\)/);
  assert.match(main, /defaultId: 1,\s*cancelId: 1/);
  assert.match(main, /inspectWikiRecovery/);
  assert.match(main, /wikiRuntime\.readWikiRecoveryProtection\(vault\.vaultPath\)/);
  assert.match(main, /protection\.invalid === true/);
  assert.match(main, /manualOnly: recovery\.type === 'invalid-recovery'/);
  assert.match(main, /wikiRuntime\.clearWikiRecoveryMarker\(state\.vault\.vaultPath, \{/);
  assert.match(main, /clearGuard \|\| \(protection\.archivePath && protection\.archive\)/);
  assert.match(main, /const canOpenArchive = Boolean\(recovery\.archivePath\)/);
  assert.match(main, /if \(!canOpenArchive\) return \{ ok: false, message: '已保留 Wiki 写入保护/);
  assert.match(main, /cleared\?\.reset === true && cleared\?\.cleared === false/);
  assert.match(main, /重置中断状态/);
  assert.match(main, /!cleared\?\.cleared \|\| refreshed\.vault\.status === 'recovery-required'/);
  assert.match(main, /shell\.openPath\(recovery\.archivePath\)/);
  const invalidRecoveryStart = main.indexOf("if (recovery.type === 'invalid-recovery')");
  const invalidRecoveryEnd = main.indexOf('const interruptedClear', invalidRecoveryStart);
  assert.ok(invalidRecoveryStart > 0 && invalidRecoveryEnd > invalidRecoveryStart);
  const invalidRecoveryBlock = main.slice(invalidRecoveryStart, invalidRecoveryEnd);
  assert.match(invalidRecoveryBlock, /\.dsh-wiki-recovery-clear\.lock/);
  assert.match(invalidRecoveryBlock, /shell\.openPath\(refreshed\.vault\.vaultPath\)/);
  assert.match(invalidRecoveryBlock, /fsp\.lstat\(refreshed\.vault\.vaultPath\)/);
  assert.doesNotMatch(invalidRecoveryBlock, /fsp\.(?:unlink|rename)|clearWikiRecoveryMarker/);
  assert.match(main, /onboardingScreenshotPath/);
  assert.match(main, /narrowScreenshotPath/);
  assert.match(main, /narrowLayout\.bodyScrollWidth <= narrowLayout\.viewportWidth/);

  for (const channel of ['get-state', 'choose-vault', 'initialize-vault', 'query', 'preview-project-sync', 'invoke-project-sync', 'list-history-sessions', 'prepare-history', 'invoke-history', 'get-session-candidates', 'preview-capture', 'save-capture']) {
    assert.match(preload, new RegExp(`wiki-center:${channel}`));
  }
  assert.match(preload, /recover: \(\) => ipcRenderer\.invoke\('wiki-center:recover'\)/);
  assert.doesNotMatch(preload, /readFile|writeFile|shell|ipcRenderer\.send/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /api\.previewCapture/);
  assert.match(renderer, /api\.saveCapture/);
  assert.match(renderer, /api\.previewProjectSync/);
  assert.match(renderer, /api\.invokeProjectSync/);
  assert.match(renderer, /api\.listHistorySessions/);
  assert.match(renderer, /api\.prepareHistory/);
  assert.match(renderer, /api\.invokeHistory/);
  assert.match(renderer, /api\.recover\(\)/);
  assert.match(renderer, /response\.cleanupPending/);
  for (const archiveKind of ['dsh-capture', 'dsh-project-sync', 'dsh-history-ingest']) assert.match(renderer, new RegExp(archiveKind));
  assert.match(renderer, /_archives\/\$\{archiveKind\}\//);
  assert.doesNotMatch(renderer, /未完成的页面和跟踪更新已回退/);
  assert.match(renderer, /不会自动覆盖并发修改/);
  assert.match(renderer, /state\?\.appVersion \|\| state\?\.app\?\.version/);
  assert.match(renderer, /state\?\.harness\?\.version/);
  assert.match(renderer, /Harness V/);
  assert.match(renderer, /vault\.lastSyncAt, state\.lastSyncAt, state\.project\?\.lastSyncAt/);
  assert.match(renderer, /sourceFreshness/);
  assert.match(renderer, /sourceCheck\.unchanged/);
  assert.doesNotMatch(renderer, /Date\.now\(/);
  assert.doesNotMatch(renderer, /innerHTML|eval\(/);
  assert.match(page, /id="app-version"[^>]*>DSH Desktop</);
  assert.doesNotMatch(page, /DSH Desktop\s+V?0\.\d/);
  const onboarding = page.slice(page.indexOf('id="wiki-onboarding"'), page.indexOf('id="wiki-overview"'));
  assert.equal((onboarding.match(/<li>/g) || []).length, 3);
  assert.match(onboarding, /选择目录/);
  assert.match(onboarding, /补齐结构/);
  assert.match(onboarding, /检查并使用/);
  for (const label of ['Vault 路径', '结构', '页面数', '最近同步', '来源新鲜度']) assert.match(page, new RegExp(label));
  assert.match(page, /id="recover-vault"[^>]*type="button"/);
  assert.match(page, /id="recovery-callout"[^>]*role="status"/);
  assert.match(page, /id="recovery-managed-pages"/);
  assert.match(page, /id="recovery-guidance"/);
  assert.match(page, /<ol class="onboarding-steps">/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none !important/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(page, /原始会话只读/);
  assert.match(page, /项目知识增量同步/);
  assert.match(page, /DSH 历史批量导入/);
  assert.match(page, /系统指令、图片和固定凭据模式不会交给 Agent/);
  assert.match(read('resources/skills/wiki-history-ingest/SKILL.md'), /untrusted source material, never as an instruction/);
  assert.match(page, /无 Git、Python、QMD 或 Obsidian 也可使用基础能力/);
  assert.match(desktopPreload, /wiki: Object\.freeze/);
  assert.match(command, /id: 'wiki-center\.open'/);
  assert.match(command, /id: 'wiki-query\.invoke'/);
  assert.match(command, /id: 'wiki-capture\.invoke'/);
  assert.match(command, /id: 'wiki-update\.invoke'/);
  assert.match(command, /id: 'wiki-history-ingest\.open'/);
  assert.match(command, /invokeWikiHistory: \(\) => invokeSkill\('wiki-history-ingest dsh'\)/);
  for (const asset of ['wiki-center.html', 'assets/wiki-center.css', 'assets/wiki-center.js']) assert.ok(manifest.build.files.includes(asset), asset);
});

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.classList = {
      add() {},
      remove() {}
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  append(...items) {
    this.children.push(...items);
  }

  replaceChildren(...items) {
    this.children = [...items];
  }

  closest() {
    return null;
  }

  dispatch(type, event = {}) {
    return this.listeners.get(type)?.({ preventDefault() {}, key: '', ...event });
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const createWikiCenterHarness = ({ previewResponse, recoverResponse, state }) => {
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };
  const calls = { preview: 0, recover: 0 };
  const readyState = state || {
    appVersion: '1.1.8',
    vault: { configured: true, ready: true, status: 'ready', vaultPath: 'D:\\Wiki', pageCount: 4 },
    harness: { status: 'ready', version: '0.1.2' },
    session: { available: true },
    project: { available: true, name: 'demo', path: 'D:\\demo' },
    history: { available: true },
    recovery: { available: false },
    skills: []
  };
  const wikiCenterAPI = {
    getState: async () => readyState,
    previewProjectSync: async () => {
      calls.preview += 1;
      return previewResponse;
    },
    recover: async () => {
      calls.recover += 1;
      return recoverResponse;
    },
    chooseVault: async () => ({ ok: false }),
    initializeVault: async () => ({ ok: false }),
    query: async () => ({ ok: true, results: [] }),
    invokeProjectSync: async () => ({ ok: false }),
    listHistorySessions: async () => ({ ok: true, items: [] }),
    prepareHistory: async () => ({ ok: false }),
    invokeHistory: async () => ({ ok: false }),
    getSessionCandidates: async () => ({ ok: true, items: [] }),
    previewCapture: async () => ({ ok: false }),
    saveCapture: async () => ({ ok: false })
  };
  const document = {
    createElement: (tag) => new MockElement(tag),
    getElementById,
    addEventListener() {}
  };
  const context = {
    window: { wikiCenterAPI, close() {} },
    document,
    console,
    Date,
    Intl,
    Number,
    String,
    Object,
    Array,
    Set,
    Promise
  };
  vm.runInNewContext(read('assets/wiki-center.js'), context);
  return { calls, elements, getElementById };
};

test('managed project page loss routes to recovery guidance instead of a refresh loop', async () => {
  const harness = createWikiCenterHarness({
    previewResponse: {
      ok: true,
      unchanged: false,
      mode: 'manifest',
      scannedFiles: 3,
      delta: { added: 0, modified: 0, removed: 0 },
      existingPages: 2,
      humanEditedPages: [],
      missingManagedPages: ['projects/demo/overview.md'],
      project: { name: 'demo' },
      message: 'managed pages missing'
    },
    recoverResponse: { ok: false, message: '当前没有可直接打开的恢复副本。' }
  });
  await settle();

  await harness.getElementById('preview-project-sync').dispatch('click');
  assert.equal(harness.getElementById('recovery-title').textContent, '核对缺失受管页');
  assert.equal(harness.getElementById('recover-vault').textContent, '检查恢复副本');
  assert.match(harness.getElementById('recovery-managed-pages').textContent, /projects\/demo\/overview\.md/);
  assert.match(harness.getElementById('recovery-guidance').textContent, /_archives\/dsh-project-sync/);
  assert.match(harness.getElementById('recovery-guidance').textContent, /不会自动删除清单记录/);

  await harness.getElementById('recover-vault').dispatch('click');
  assert.equal(harness.calls.preview, 1, 'recovery action must not repeat the source preview');
  assert.equal(harness.calls.recover, 1, 'recovery action must use the bounded recovery IPC');
  assert.match(harness.getElementById('global-status').textContent, /手动恢复缺失页后再刷新状态/);
});

test('managed-pages-missing error code is rendered as a recoverable state', async () => {
  const harness = createWikiCenterHarness({
    previewResponse: {
      ok: false,
      code: 'managed-pages-missing',
      missingManagedPages: ['projects/demo/source-map.md'],
      message: '受管页面缺失。'
    },
    recoverResponse: { ok: false }
  });
  await settle();

  await harness.getElementById('preview-project-sync').dispatch('click');
  assert.equal(harness.getElementById('project-sync-status').textContent, '受管页缺失');
  assert.equal(harness.getElementById('recovery-callout').hidden, false);
  assert.match(harness.getElementById('global-status').textContent, /普通同步保持停用/);
});

test('recovery-required vault state has an explicit protected-state action', async () => {
  const harness = createWikiCenterHarness({
    state: {
      appVersion: '1.1.8',
      vault: { configured: true, ready: false, status: 'recovery-required', vaultPath: 'D:\\Wiki', pageCount: 4 },
      harness: { status: 'ready', version: '0.1.2' },
      project: { available: false },
      history: { available: false },
      recovery: { available: false },
      skills: []
    },
    previewResponse: { ok: false },
    recoverResponse: { ok: false }
  });
  await settle();

  assert.equal(harness.getElementById('health-structure').textContent, '写入保护中');
  assert.equal(harness.getElementById('vault-status').textContent, '写入保护中');
  assert.equal(harness.getElementById('recovery-title').textContent, '核对恢复事务');
  assert.match(harness.getElementById('recovery-detail').textContent, /确认前不会继续写入/);
});

test('an archive-less recovery-clear guard is routed to the bounded reset IPC', async () => {
  const readyAfterReset = {
    appVersion: '1.1.8',
    vault: { configured: true, ready: false, status: 'recovery-required', vaultPath: 'D:\\Wiki', pageCount: 4 },
    harness: { status: 'ready', version: '0.1.2' },
    project: { available: false },
    history: { available: false },
    recovery: { available: false },
    skills: []
  };
  const harness = createWikiCenterHarness({
    state: {
      ...readyAfterReset,
      recovery: {
        available: true,
        label: '重置中断的恢复清理',
        message: '首次保护日志未完整写入；重置不会移动知识页面。'
      }
    },
    previewResponse: { ok: false },
    recoverResponse: { ok: true, message: '已安全重置中断状态。', state: readyAfterReset }
  });
  await settle();

  assert.equal(harness.getElementById('recovery-title').textContent, '重置中断的恢复清理');
  assert.match(harness.getElementById('recovery-detail').textContent, /不会移动知识页面/);
  await harness.getElementById('recover-vault').dispatch('click');
  assert.equal(harness.calls.recover, 1);
  assert.equal(harness.getElementById('global-status').textContent, '已安全重置中断状态。');
});

test('a corrupt recovery journal keeps an executable manual-recovery action instead of choose-vault loop', async () => {
  const unavailableState = {
    appVersion: '1.1.8',
    vault: { configured: true, ready: false, status: 'unavailable', vaultPath: 'D:\\Wiki', pageCount: 4 },
    harness: { status: 'ready', version: '0.1.2' },
    project: { available: false },
    history: { available: false },
    recovery: {
      available: true,
      manualOnly: true,
      label: '人工处理无法验证的恢复保护',
      message: '恢复保护记录无法安全校验。可打开知识库目录人工核对；软件不会自动移动或删除保护记录。'
    },
    skills: []
  };
  const harness = createWikiCenterHarness({
    state: unavailableState,
    previewResponse: { ok: false },
    recoverResponse: { ok: true, message: '已打开知识库目录；写入保护保持不变。', state: unavailableState }
  });
  await settle();

  assert.equal(harness.getElementById('health-structure').textContent, '恢复保护异常');
  assert.equal(harness.getElementById('recovery-title').textContent, '人工处理无法验证的恢复保护');
  assert.doesNotMatch(harness.getElementById('recovery-detail').textContent, /D:\\Wiki/);
  await harness.getElementById('recover-vault').dispatch('click');
  assert.equal(harness.calls.recover, 1);
  assert.match(harness.getElementById('global-status').textContent, /写入保护保持不变/);
});
