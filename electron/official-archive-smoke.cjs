const fs = require('node:fs/promises');
const { callHarnessRemote } = require('./extension-center.cjs');
const { invokeHarnessUiAction } = require('./harness-ui-actions.cjs');

async function runOfficialArchiveSmoke({ window, selected, origin, fetchImpl, evaluate, waitFor, target, version }) {
  const wc = window.webContents, checks = {};
  const remote = (method) => callHarnessRemote(origin, 'workspace', method, { request: { sessionId: selected.sessionId } }, { fetchImpl });
  const buttons = `Array.from(document.querySelectorAll('button')).filter(b => /^(取消归档 |Unarchive )/.test(b.getAttribute('aria-label') || ''))`;
  const page = async () => {
    if (!await invokeHarnessUiAction(wc, 'models-settings')) throw new Error('Official settings navigation failed.');
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b => ['已归档会话','Archived sessions'].includes(b.textContent.trim()))`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b => ['已归档会话','Archived sessions'].includes(b.textContent.trim())).click()`);
    await waitFor(`Boolean(document.querySelector('input[aria-label="搜索已归档会话"],input[aria-label="Search archived sessions"]'))`);
  };
  try {
    const archived = await remote('archiveSession');
    checks.syntheticSessionArchived = archived.archivedSessionIds.length === 1 && archived.archivedSessionIds[0] === selected.sessionId;
    if (!checks.syntheticSessionArchived) throw new Error('Archive smoke requires exactly one isolated archived Session.');
    await page();
    await waitFor(`${buttons}.length === 1`);
    checks.officialRecoveryPageListsSession = true;
    await fs.writeFile(`${target}.archive.png`, (await wc.capturePage()).toPNG());
    await evaluate(`${buttons}[0].click()`);
    await waitFor(`${buttons}.length === 0 && /暂无已归档会话|No archived sessions/.test(document.body.textContent)`);
    checks.uiUnarchiveRemovesRow = true;
    await wc.loadURL(origin);
    await waitFor('Boolean(document.querySelector("[data-composer-card]"))');
    await page();
    await waitFor(`${buttons}.length === 0 && /暂无已归档会话|No archived sessions/.test(document.body.textContent)`);
    checks.restorePersistsAcrossReload = true;
    await fs.writeFile(`${target}.restored.png`, (await wc.capturePage()).toPNG());
    return { ok: true, version, checks, modelCalls: 0, evidence: 'Official archive Remote plus Settings recovery UI and reload; only a fresh isolated Session.', unverified: ['large archive search/paging', 'active-session archive races'] };
  } catch (error) {
    await fs.writeFile(`${target}.failure.png`, (await wc.capturePage()).toPNG());
    throw error;
  } finally { await remote('unarchiveSession').catch(() => {}); }
}
module.exports = { runOfficialArchiveSmoke };
