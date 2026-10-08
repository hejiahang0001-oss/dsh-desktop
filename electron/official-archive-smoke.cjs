const fs = require('node:fs/promises');
const { callHarnessRemote } = require('./extension-center.cjs');
const { finishOfficialOnboarding } = require('./official-office-preview-contract.cjs');
const { officialActionExpression } = require('./session-workflow-contract.cjs');

// Observe public row identity and hit-testing only; never change official
// archive state, framework stores, visibility, or blank-session semantics.
function inspectArchiveRow(sessionId) {
  const rows = [...document.querySelectorAll('[data-row-key]')];
  const exact = rows.filter(row => row.getAttribute('data-row-key') === `session:${sessionId}`);
  const visiblePoint = node => {
    const box = node.getBoundingClientRect();
    const x = Math.round(box.left + box.width / 2), y = Math.round(box.top + box.height / 2);
    if (box.width <= 0 || box.height <= 0 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    for (let parent = node; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.inert || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return null;
    }
    const hit = document.elementFromPoint(x, y);
    return hit === node || node.contains(hit) ? { x, y } : null;
  };
  if (document.getElementById('root')?.inert !== false) return { ready: false };
  const row = exact.length === 1 ? exact[0] : null, point = row && visiblePoint(row);
  const empty = rows.filter(node => node.getAttribute('data-row-key') === 'empty'
    && /暂无已归档会话|No archived sessions yet/.test(node.textContent) && visiblePoint(node));
  let selectionMatches = false;
  try { selectionMatches = JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}').sessionId === sessionId; } catch {}
  return { count: exact.length, ready: Boolean(point), point, selected: row?.getAttribute('aria-selected') === 'true', selectionMatches,
    archived: Boolean(row?.getAttribute('aria-description')), emptyArchived: exact.length === 0 && empty.length === 1 };
}
const rowExpression = id => `(${inspectArchiveRow.toString()})(${JSON.stringify(id)})`;

async function runOfficialArchiveSmoke({ window, selected, origin, fetchImpl, evaluate, waitFor, target, version }) {
  const wc = window.webContents, checks = {};
  const remote = (method) => callHarnessRemote(origin, 'workspace', method, { request: { sessionId: selected.sessionId } }, { fetchImpl });
  const row = rowExpression(selected.sessionId);
  const action = async (labels, scope = '') => {
    await waitFor(officialActionExpression(labels, false, scope));
    if (!await evaluate(officialActionExpression(labels, true, scope))) throw new Error('Official archive action is no longer uniquely visible and hittable.');
  };
  const viewOption = async labels => {
    await action(['视图选项', 'View options']);
    await action(labels, '[role="menu"]');
  };
  try {
    const list = await callHarnessRemote(origin, 'session', 'list', { _request: {} }, { fetchImpl });
    const fixtureRows = list.items?.filter(item => item.sessionId === selected.sessionId) || [];
    if (fixtureRows.length !== 1 || fixtureRows[0].blank !== false) throw new Error('Archive smoke requires an existing non-blank isolated fixture Session; it never invokes a model to create one.');
    await finishOfficialOnboarding({ evaluate });
    // Flat grouping avoids relying on an unrelated workspace expansion state.
    await viewOption(['单列表', 'In one list']);
    await viewOption(['隐藏已归档', 'Hide archived']);
    await waitFor(`${row}.ready && !${row}.archived`);
    const archived = await remote('archiveSession');
    checks.syntheticSessionArchived = archived.archivedSessionIds.length === 1 && archived.archivedSessionIds[0] === selected.sessionId;
    if (!checks.syntheticSessionArchived) throw new Error('Archive smoke requires exactly one isolated archived Session.');
    await viewOption(['仅显示已归档', 'Archived only']);
    await waitFor(`${row}.ready && ${row}.archived`);
    checks.officialRecoveryPageListsSession = true;
    checks.officialArchivedFilterListsExactSession = true;
    await fs.writeFile(`${target}.archive.png`, (await wc.capturePage()).toPNG());
    const current = await evaluate(row);
    if (!current.ready || !current.archived) throw new Error('Exact archived row is no longer hittable.');
    // Upstream row actions are hover-only: produce a real pointer move, not CSS.
    wc.sendInputEvent({ type: 'mouseMove', ...current.point });
    await action(['取消归档', 'Unarchive session'], `[data-row-key=${JSON.stringify(`session:${selected.sessionId}`)}]`);
    await waitFor(`${row}.emptyArchived`);
    checks.uiUnarchiveRemovesRow = true;
    await viewOption(['隐藏已归档', 'Hide archived']);
    await waitFor(`${row}.ready && !${row}.archived`);
    const restored = await evaluate(row);
    if (!restored.ready || restored.archived) throw new Error('Restored row is no longer hittable.');
    wc.sendInputEvent({ type: 'mouseMove', ...restored.point });
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...restored.point });
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...restored.point });
    await waitFor(`${row}.selected && ${row}.selectionMatches`);
    await wc.loadURL(origin);
    await waitFor('Boolean(document.querySelector("[data-composer-card]"))');
    await finishOfficialOnboarding({ evaluate });
    await waitFor(`${row}.ready && !${row}.archived && ${row}.selected && ${row}.selectionMatches`);
    checks.restoredSelectionPersists = true;
    const persistedList = await callHarnessRemote(origin, 'session', 'list', { _request: {} }, { fetchImpl });
    const persisted = persistedList.items?.filter(item => item.sessionId === selected.sessionId) || [];
    if (persisted.length !== 1 || persisted[0].blank !== false) throw new Error('Restored fixture Session is missing from the persistent remote list.');
    checks.restoredRemoteSessionExists = true;
    await viewOption(['仅显示已归档', 'Archived only']);
    await waitFor(`${row}.emptyArchived`);
    checks.restorePersistsAcrossReload = true;
    await viewOption(['隐藏已归档', 'Hide archived']);
    await waitFor(`${row}.ready && !${row}.archived`);
    checks.restoredSessionVisible = true;
    await fs.writeFile(`${target}.restored.png`, (await wc.capturePage()).toPNG());
    return { ok: true, version, checks, modelCalls: 0, evidence: 'Official archive Remote, WorkspaceBrowser archived-only filter, exact-ID row UI unarchive, and reload persistence; only an isolated non-blank fixture Session.', unverified: ['large archive search/paging', 'active-session archive races'] };
  } catch (error) {
    await fs.writeFile(`${target}.failure.png`, (await wc.capturePage()).toPNG());
    throw error;
  } finally { await remote('unarchiveSession').catch(() => {}); }
}
module.exports = { runOfficialArchiveSmoke };
