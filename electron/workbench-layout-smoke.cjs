const fs = require('node:fs/promises');
const { finishOfficialOnboarding } = require('./official-office-preview-contract.cjs');
const { invokeHarnessUiAction } = require('./harness-ui-actions.cjs');

function inspectOfficialModal() {
  const visible = node => {
    if (!node) return false;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.left >= innerWidth || box.top >= innerHeight || box.right <= 0 || box.bottom <= 0) return false;
    for (let p = node; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (p.hidden || p.inert || s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(visible);
  const buttons = dialogs.length === 1 ? [...dialogs[0].querySelectorAll('button')].filter(b => visible(b) && !b.disabled).map(b => {
    const r = b.getBoundingClientRect(), x = Math.max(0, Math.min(innerWidth - 1, (r.left + r.right) / 2)), y = Math.max(0, Math.min(innerHeight - 1, (r.top + r.bottom) / 2));
    const hit = document.elementFromPoint(x, y);
    return { label: b.getAttribute('aria-label') || b.textContent.trim(), exposed: hit === b || b.contains(hit) };
  }) : [];
  return { ok: dialogs.length === 1 && buttons.length > 0 && buttons.every(b => b.exposed), dialogs: dialogs.length, buttons };
}

// Only measures DOM geometry in an isolated smoke session. Does not submit a
// prompt, inject product styles or reach into the official framework state.
function inspectWorkbenchLayout() {
  const rect = element => element ? element.getBoundingClientRect().toJSON() : null;
  const describe = element => {
    if (!element) return null;
    const style = getComputedStyle(element);
    return { tag: element.tagName, id: element.id, cls: element.className, rect: rect(element),
      width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
      position: style.position, display: style.display, overflowX: style.overflowX };
  };
  const root = document.getElementById('root');
  const card = document.querySelector('[data-composer-card]');
  const buttons = [...(card?.querySelectorAll('button') || [])].map(element => {
    const box = rect(element);
    const hits = box.width && box.height ? document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2) : [];
    // A disabled button may not be a pointer target; its card must still be
    // the foreground surface, never a host side panel overlay.
    const hit = hits.find(node => getComputedStyle(node).pointerEvents !== 'none');
    return { label: element.getAttribute('aria-label'), disabled: element.disabled, ...describe(element),
      hit: describe(hit), exposed: Boolean(hit && (element.contains(hit)
        || (card.contains(hit) && hit.contains(element)))) };
  });
  const ancestors = [];
  for (let element = card; element; element = element.parentElement) ancestors.push(describe(element));
  const box = rect(root), cardBox = rect(card);
  const within = bounds => bounds && bounds.width > 0 && bounds.height > 0 && bounds.left >= box.left - 1
    && bounds.right <= Math.min(box.right, innerWidth) + 1 && bounds.top >= 0 && bounds.bottom <= box.bottom + 1;
  const send = buttons.find(button => /^(发送(?:消息)?|Send(?: message)?)$/i.test(button.label || ''));
  return { innerWidth, innerHeight, root: describe(root), ancestors, buttons,
    review: describe(document.getElementById('dsh-workbench-review')),
    files: describe(document.getElementById('dsh-workbench-files')),
    filesOpen: document.documentElement.getAttribute('data-dsh-files-open'),
    reviewOpen: document.documentElement.getAttribute('data-dsh-review-open'),
    cardFits: within(cardBox), sendFits: Boolean(send && within(send.rect) && send.exposed),
    rootFits: box.left >= 0 && box.right <= innerWidth + 1 };
}

async function runWorkbenchLayoutSmoke({ window, dock, target, version }) {
  const evaluate = code => window.webContents.executeJavaScript(code, true);
  await finishOfficialOnboarding({ evaluate });
  const variants = [];
  for (const config of [
    { name: 'normal', width: 1280, height: 880, zoom: 1 },
    { name: 'compact', width: 1024, height: 720, zoom: 1 },
    { name: 'zoom', width: 1280, height: 880, zoom: 1.25 },
    { name: 'files', width: 1024, height: 720, zoom: 1, files: true },
    { name: 'both', width: 1440, height: 900, zoom: 1, files: true, review: true },
    { name: 'both-compact', width: 1024, height: 720, zoom: 1 },
    { name: 'zoom-high', width: 1280, height: 880, zoom: 1.4 }
  ]) {
    window.setSize(config.width, config.height); window.webContents.setZoomFactor(config.zoom); dock.layout();
    if (config.files) await evaluate('desktopAPI.workbench.setFilePanelOpen(true)');
    if (config.review) await evaluate('desktopAPI.workbench.setReviewPanelOpen(true)');
    // Wait for host resize IPC, panel transitions and two stable geometry samples.
    let previous = '', stable = 0, state;
    const end = Date.now() + 10000;
    while (Date.now() < end && stable < 3) {
      await new Promise(resolve => setTimeout(resolve, 120));
      state = await evaluate(`(${inspectWorkbenchLayout.toString()})()`);
      const snapshot = JSON.stringify(state);
      stable = snapshot === previous ? stable + 1 : 0; previous = snapshot;
    }
    variants.push({ ...config, stable: stable >= 3, ...state });
    await fs.writeFile(`${target}.${config.name}.png`, (await window.webContents.capturePage()).toPNG());
  }
  window.setSize(1280, 880); window.webContents.setZoomFactor(1); dock.layout();
  await evaluate('Promise.all([desktopAPI.workbench.setFilePanelOpen(true),desktopAPI.workbench.setReviewPanelOpen(true)])');
  await new Promise(resolve => setTimeout(resolve, 350));
  const panelState = () => evaluate('JSON.stringify({files:document.documentElement.dataset.dshFilesOpen,review:document.documentElement.dataset.dshReviewOpen})');
  const beforeModal = await panelState();
  const panels = JSON.parse(beforeModal);
  if (panels.files !== 'true' || panels.review !== 'true') throw new Error('Modal regression requires both desktop side panels open');
  if (!await invokeHarnessUiAction(window.webContents, 'models-settings')) throw new Error('Official settings navigation failed');
  let modal;
  for (const deadline = Date.now() + 10000; Date.now() < deadline;) {
    await new Promise(resolve => setTimeout(resolve, 150));
    modal = await evaluate(`(${inspectOfficialModal.toString()})()`);
    if (modal.ok) break;
  }
  await fs.writeFile(`${target}.official-settings.png`, (await window.webContents.capturePage()).toPNG());
  window.focus(); window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await new Promise(resolve => setTimeout(resolve, 350));
  const modalClosed = await evaluate('!Array.from(document.querySelectorAll(\'[role="dialog"][aria-modal="true"]\')).some(d=>d.getBoundingClientRect().width>0)');
  const panelStatePreserved = beforeModal === await panelState();
  const result = { ok: variants.every(state => state.stable && state.cardFits && state.sendFits && state.rootFits) && modal?.ok && modalClosed && panelStatePreserved,
    version, variants, modal, modalClosed, panelStatePreserved, realModel: false };
  await fs.writeFile(`${target}.geometry.json`, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { inspectWorkbenchLayout, inspectOfficialModal, runWorkbenchLayoutSmoke };
