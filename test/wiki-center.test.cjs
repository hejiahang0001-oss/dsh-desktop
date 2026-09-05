const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildWikiCenterDashboardState,
  extractWikiSessionCandidates,
  selectCaptureCandidate,
  trustedAppVersion,
  trustedHarnessVersion
} = require('../electron/wiki-center.cjs');

const history = {
  events: [
    { seq: 1, time: 100, event: { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'thinking', thinking: '不应暴露' }, { type: 'text', text: '# 第一条结论\n保留正文。' }] } } } },
    { seq: 2, event: { type: 'turn/end', data: { reason: { kind: 'aborted' } } } },
    { seq: 3, time: 300, event: { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '中断前可见前缀' }] } } } },
    { seq: 4, event: { type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '用户内容' }] } } } },
    { seq: 5, time: 500, event: { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '最终结论\n第二行。' }] } } } }
  ]
};

test('Wiki candidates include only bounded assistant text with source sequence', () => {
  const candidates = extractWikiSessionCandidates(history);
  assert.deepEqual(candidates.map((item) => item.seq), [5, 3, 1]);
  assert.equal(candidates[0].title, '最终结论');
  assert.equal(candidates[1].interrupted, false);
  assert.equal(candidates[2].interrupted, true);
  assert.equal(candidates[2].text.includes('不应暴露'), false);
  assert.equal(candidates[2].title, '第一条结论');
});

test('capture request must reference a candidate and accepts only the fixed shape', () => {
  const candidates = extractWikiSessionCandidates(history);
  const selected = selectCaptureCandidate({ title: '修订标题', content: '由用户确认的内容', sourceSeq: 5 }, candidates);
  assert.equal(selected.candidate.sourceTime, 500);
  assert.equal(selected.title, '修订标题');
  assert.equal(selectCaptureCandidate({ title: '标题', content: '内容', sourceSeq: 999 }, candidates), null);
  assert.equal(selectCaptureCandidate({ title: '标题', content: '内容', sourceSeq: 5, sourceSessionId: '伪造' }, candidates), null);
});

test('Wiki dashboard accepts its product version only from bounded trusted state', () => {
  assert.equal(trustedAppVersion({ appVersion: '1.1.8' }), '1.1.8');
  assert.equal(trustedAppVersion({ app: { version: '1.2.0-rc.1' } }), '1.2.0-rc.1');
  assert.equal(trustedAppVersion({ appVersion: '1.1.8\n伪造' }), '');
  assert.equal(trustedAppVersion({}), '');
  assert.equal(trustedHarnessVersion({ harness: { version: '0.1.2-rc.1' } }), '0.1.2-rc.1');
  assert.equal(trustedHarnessVersion({ harness: { version: '0.1.2\n伪造' } }), '');
});

test('Wiki dashboard keeps first-run guidance separate from configured health data', () => {
  const firstRun = buildWikiCenterDashboardState({
    appVersion: '1.1.8',
    harness: { version: '0.1.2-rc.1' },
    vault: { configured: false, status: 'unconfigured', pageCount: 0 }
  });
  assert.equal(firstRun.configured, false);
  assert.equal(firstRun.appVersion, '1.1.8');
  assert.equal(firstRun.harnessVersion, '0.1.2-rc.1');
  assert.equal(firstRun.lastSyncAt, '');
  assert.equal(firstRun.freshness.status, 'unknown');
  assert.equal(firstRun.recovery.available, false);

  const configured = buildWikiCenterDashboardState({
    app: { version: '1.1.8' },
    vault: {
      configured: true,
      status: 'ready',
      vaultPath: 'D:\\Knowledge\\DSH',
      missing: [],
      pageCount: 37,
      limited: false,
      lastSyncAt: '2026-09-04T01:02:03.000Z',
      sourceFreshness: { status: 'fresh', checkedAt: '2026-09-04T02:03:04.000Z' }
    }
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.vaultPath, 'D:\\Knowledge\\DSH');
  assert.equal(configured.structure.status, 'ready');
  assert.equal(configured.pages.count, 37);
  assert.equal(configured.lastSyncAt, '2026-09-04T01:02:03.000Z');
  assert.equal(configured.freshness.status, 'fresh');
});

test('Wiki dashboard exposes only executable recovery modes and never invents sync time', () => {
  const missingStructure = buildWikiCenterDashboardState({
    vault: { configured: true, status: 'needs-init', vaultPath: 'D:\\Knowledge', missing: ['index.md'], pageCount: 0 }
  });
  assert.deepEqual(missingStructure.structure.missing, ['index.md']);
  assert.equal(missingStructure.recovery.mode, 'initialize-vault');
  assert.equal(missingStructure.lastSyncAt, '');

  const stale = buildWikiCenterDashboardState({
    vault: { configured: true, status: 'ready', vaultPath: 'D:\\Knowledge', pageCount: 2 },
    project: { available: true }
  }, {
    sourceCheck: { ok: true, unchanged: false, generatedAt: '2026-09-04T03:04:05.000Z' }
  });
  assert.equal(stale.freshness.status, 'stale');
  assert.equal(stale.freshness.checkedAt, '2026-09-04T03:04:05.000Z');
  assert.equal(stale.lastSyncAt, '');
  assert.equal(stale.recovery.mode, 'refresh-source');

  const routed = buildWikiCenterDashboardState({
    vault: { configured: true, status: 'recovery-required', vaultPath: 'D:\\Knowledge', pageCount: 2 },
    recovery: { available: true, label: '恢复最近一次同步', message: '由主进程重新校验恢复点。' }
  });
  assert.equal(routed.structure.status, 'recovery-required');
  assert.equal(routed.recovery.mode, 'ipc');
  assert.equal(routed.recovery.label, '恢复最近一次同步');
});
