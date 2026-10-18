// Test-only DOM observation for the official 0.2 document preview. Serialized
// into the real renderer; never reads framework state or changes product CSS.
function inspectOfficialPreview(name, page = 1, action = 'inspect', selector) {
  const visible = (element) => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    let left = Math.max(0, box.left), top = Math.max(0, box.top);
    let right = Math.min(innerWidth, box.right), bottom = Math.min(innerHeight, box.bottom);
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.inert
        || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse'
        || Number(style.opacity) === 0) return false;
      if (node !== element) {
        const parent = node.getBoundingClientRect();
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)) {
          left = Math.max(left, parent.left); right = Math.min(right, parent.right);
        }
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
          top = Math.max(top, parent.top); bottom = Math.min(bottom, parent.bottom);
        }
      }
    }
    return box.width > 0 && box.height > 0 && right > left && bottom > top;
  };
  const tabs = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')];
  // Presented-file tabs may omit the extension. Bind the selected dock owner
  // to the exact resource address instead of trusting its cosmetic title.
  const owners = tabs.filter(visible).map(tab => {
    const id = tab.getAttribute('data-dockkit-tab');
    const host = [...document.querySelectorAll('[data-dockkit-content]')]
      .find(node => node.getAttribute('data-dockkit-content') === id && node.getAttribute('aria-hidden') !== 'true' && visible(node));
    const preview = host?.querySelector('[data-document-preview]');
    let fileMatches = false;
    try { fileMatches = decodeURIComponent(preview?.getAttribute('data-textpreview-url') || '').replace(/\\/g, '/').split('/').at(-1) === name; } catch {}
    return { tab, id, preview, fileMatches };
  }).filter(owner => owner.fileMatches);
  const { tab, id, preview, fileMatches = false } = owners.length === 1 ? owners[0] : {};
  const ready = Boolean(preview && visible(preview) && fileMatches && document.getElementById('root')?.inert === false
    && ![...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(visible));
  const geometry = node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { className: node.className, hidden: node.hidden, inert: node.inert, ariaHidden: node.getAttribute('aria-hidden'),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: style.display, visibility: style.visibility, grid: style.gridTemplateColumns };
  };
  if (!ready) return { ready: false, selected: Boolean(tab), fileMatches,
    rootInert: document.getElementById('root')?.inert,
    tabs: tabs.map(node => ({ title: node.querySelector('[data-dockkit-tab-title]')?.textContent,
      visible: visible(node), id: node.getAttribute('data-dockkit-tab') })),
    previews: [...document.querySelectorAll('[data-document-preview]')].map(node => ({
      visible: visible(node), address: node.getAttribute('data-textpreview-url'),
      owner: node.closest('[data-dockkit-content]')?.getAttribute('data-dockkit-content')
    })),
    panels: [...document.querySelectorAll('[data-sidebar-right-panel]')].map(node => {
      const ancestors = [];
      for (let current = node; current && ancestors.length < 8; current = current.parentElement) ancestors.push(geometry(current));
      return { mode: node.getAttribute('data-sidebar-right-panel'), open: node.getAttribute('data-sidebar-right-open'), ancestors };
    }) };
  const pdf = preview.querySelector('[data-pdf-preview]');
  const excel = preview.querySelector('[data-excel-preview]');
  const target = pdf?.querySelector(`[data-pdf-page="${page}"]`);
  if (action === 'scroll') target?.scrollIntoView({ block: 'start' });
  const canvas = target?.querySelector('canvas') || excel?.querySelector('canvas');
  let ink = 0;
  if (visible(canvas) && canvas.width > 0 && canvas.height > 0) {
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; pixels && index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0 && Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 200) ink += 1;
    }
  }
  const occlusion = { clear: false, samples: 0, obstructions: [] };
  if (visible(canvas)) {
    const box = canvas.getBoundingClientRect();
    const body = (preview.querySelector('[data-textpreview-body]') || preview).getBoundingClientRect();
    const left = Math.max(0, box.left, body.left), top = Math.max(0, box.top, body.top);
    const right = Math.min(innerWidth, box.right, body.right), bottom = Math.min(innerHeight, box.bottom, body.bottom);
    for (const x of [0.15, 0.5, 0.85]) for (const y of [0.15, 0.5, 0.85]) {
      if (right <= left || bottom <= top) continue;
      const hit = document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y);
      occlusion.samples += 1;
      if (!hit || !preview.contains(hit)) occlusion.obstructions.push({ tag: hit?.tagName, className: hit?.className });
    }
    occlusion.clear = occlusion.samples === 9 && occlusion.obstructions.length === 0;
  }
  const point = (node, x, y) => {
    if (!visible(node)) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.round(box.left + (x ?? box.width / 2)), y: Math.round(box.top + (y ?? box.height / 2)) };
  };
  const warning = preview.querySelector('[data-office-font-warning] button');
  return {
    ready, tabId: id, kind: excel ? 'spreadsheet' : pdf ? 'pdf' : 'pending', pages: pdf?.querySelectorAll('[data-pdf-page]').length || 0,
    selectorVisible: Boolean(selector && visible(preview.querySelector(selector))),
    selectorText: selector ? preview.querySelector(selector)?.textContent || '' : '',
    htmlSandbox: preview.querySelector('iframe[data-html-preview]')?.getAttribute('sandbox'),
    canvasVisible: visible(canvas), occlusion, bitmap: { width: canvas?.width || 0, height: canvas?.height || 0, ink },
    text: target?.querySelector('[data-pdf-text]')?.textContent.replace(/\s/g, '') || '',
    fontWarning: warning ? { label: warning.getAttribute('aria-label'), expanded: warning.getAttribute('aria-expanded'),
      controls: warning.getAttribute('aria-controls'), point: point(warning), focused: document.activeElement === warning } : null,
    spreadsheet: excel ? {
      sheets: [...excel.querySelectorAll('.luckysheet-sheets-item-name')].filter(visible).map(node => node.textContent.trim()),
      formula: excel.querySelector('.fortune-fx-input')?.textContent || '',
      formulaReadOnly: excel.querySelector('.fortune-fx-input')?.getAttribute('contenteditable') === 'false',
      selection: excel.querySelector('.fortune-name-box')?.textContent.trim(),
      copied: [...excel.querySelectorAll('#fortune-copy-content table td')].map(node => node.textContent),
      formulaWarning: excel.querySelector('[data-excel-formula-warning]')?.getAttribute('aria-label'),
      editingToolbar: Boolean(excel.querySelector('.fortune-toolbar')),
      keyboardTargetReady: ['.fortune-sheet-overlay', '.luckysheet-cell-input']
        .some(selector => { const node = excel.querySelector(selector); return node && node === document.activeElement; }),
      overlayPoint: point(excel.querySelector('.fortune-sheet-overlay'), 70, 30)
    } : null
  };
}

function previewExpression(name, page = 1, action = 'inspect', selector) {
  return `(${inspectOfficialPreview.toString()})(${JSON.stringify(name)},${page},${JSON.stringify(action)},${JSON.stringify(selector)})`;
}

// Test-only observer: use the exact public controls of the foreground modal.
// Never initiate an account flow, write a key or override onboarding state.
function observeAndAdvanceOfficialOnboarding() {
  const visible = element => {
    if (!element) return false;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || node.inert || style.display === 'none'
        || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
  const clear = dialogs.length === 0 && document.getElementById('root')?.inert === false;
  if (!dialogs.length) return { clear };
  const dialog = dialogs.at(-1);
  if (dialog.getAttribute('aria-modal') !== 'true' || dialog.getAttribute('aria-busy') === 'true'
    || dialog.querySelector('[aria-busy="true"]')) return { clear: false };
  const title = dialog.getAttribute('aria-label') || '';
  const legacy = {
    '预览版说明': '继续', 'Preview Notice': 'Continue',
    '添加一个 API Key 开始使用': '稍后配置', 'Add an API key to get started': 'Configure later'
  };
  const account = {
    '开始使用': { close: '关闭', key: '添加 API Key', signIn: '登录' },
    'Get started': { close: 'Close', key: 'Add API Key', signIn: 'Sign in' }
  };
  const buttons = [...dialog.querySelectorAll('button')].filter(visible);
  const enabled = button => !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  let targets = [];
  if (Object.hasOwn(legacy, title)) {
    targets = buttons.filter(button => button.textContent.trim() === legacy[title]);
  } else if (Object.hasOwn(account, title)) {
    const expected = account[title];
    // Only the idle account choice; busy, waiting, error and expired states
    // have different titles/actions and must remain untouched.
    const keyActions = buttons.filter(button => button.textContent.trim() === expected.key);
    const signInActions = buttons.filter(button => button.textContent.trim() === expected.signIn);
    if (keyActions.length !== 1 || signInActions.length !== 1
      || !enabled(keyActions[0]) || !enabled(signInActions[0])) return { clear: false };
    targets = buttons.filter(button => button.getAttribute('aria-label') === expected.close);
  }
  if (targets.length !== 1) return { clear: false };
  const button = targets[0];
  if (!enabled(button)) return { clear: false };
  const box = button.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return { clear: false };
  const hit = document.elementFromPoint(x, y);
  if (hit !== button && !button.contains(hit)) return { clear: false };
  const action = button.getAttribute('aria-label') || button.textContent.trim();
  button.click();
  return { action };
}

async function finishOfficialOnboarding({ evaluate }) {
  const deadline = Date.now() + 15000;
  let settledAt = 0;
  const actions = [];
  while (Date.now() < deadline) {
    const state = await evaluate(`(${observeAndAdvanceOfficialOnboarding.toString()})()`);
    if (state.action) { actions.push(state.action); settledAt = 0; }
    else if (state.clear) {
      settledAt ||= Date.now();
      if (Date.now() - settledAt >= 600) return { ok: true, actions, rootInert: false };
    } else settledAt = 0;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Official onboarding did not settle: visible dialog or inert application root');
}

module.exports = { inspectOfficialPreview, previewExpression, observeAndAdvanceOfficialOnboarding, finishOfficialOnboarding };
