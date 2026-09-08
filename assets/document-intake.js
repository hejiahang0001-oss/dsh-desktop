(() => {
  if (window.__DSH_DOCUMENT_INTAKE__) return true;
  const api = window.desktopAPI?.documents;
  const bridge = window.__DSH_COMPOSER_TEXT__;
  if (!api || !bridge) return false;
  // Compatibility only: new files belong to the official attachment UI.
  // Keep removing/restoring references already created by older desktop builds.
  let bar, list, status, mountedCard, scheduled = false;
  const refs = new Map();
  let catalogSelection = null, catalogLoading = false;
  const hydrate = async () => {
    const selected = localStorage.getItem('dsh.sessions.current');
    if (catalogLoading || catalogSelection === selected) return;
    catalogLoading = true;
    try {
      const state = await api.getState();
      if (selected !== localStorage.getItem('dsh.sessions.current')) return;
      refs.clear(); state.references?.forEach((reference, index) => refs.set(reference, state.items[index]));
      catalogSelection = selected; if (list) redraw();
    } catch { /* A failed catalog read must never alter the draft. */ }
    finally { catalogLoading = false; }
  };
  const composer = bridge.current;
  const message = (text, error = false) => {
    status.textContent = text; status.dataset.error = String(error);
  };
  const redraw = () => {
    list.replaceChildren();
    let visible = false;
    const value = bridge.read();
    for (const [reference, item] of refs) {
      if (!value.includes(reference)) continue;
      if (!item) continue;
      visible = true;
      const chip = document.createElement('span'); chip.className = 'dsh-document-chip';
      const label = document.createElement('span'); label.textContent = item.name; label.title = item.relativePath;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `移除附件 ${item.name}`);
      remove.onclick = async () => {
        const input = composer(); if (!input) return;
        try { await bridge.remove(input, reference); }
        catch (error) { return message(error.message, true); }
        redraw(); input.focus({ preventScroll: true });
        message('已从输入中移除引用，原文件和已导入副本未删除。');
      };
      chip.append(label, remove); list.append(chip);
    }
    bar.hidden = !visible;
  };
  const mount = () => {
    scheduled = false;
    void hydrate();
    const card = document.querySelector('[data-composer-card]');
    if (!card) return;
    if (bar?.isConnected && mountedCard === card) return;
    bar?.remove(); mountedCard = card;
    bar = document.createElement('section'); bar.className = 'dsh-document-intake'; bar.setAttribute('aria-label', '旧版文件引用'); bar.hidden = true;
    list = document.createElement('div'); list.className = 'dsh-document-list';
    status = document.createElement('div'); status.className = 'dsh-document-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    bar.append(list, status); card.insertAdjacentElement('beforebegin', bar); redraw();
  };
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(mount); }
  });
  const onInput = (event) => { if (event.target === composer() && list) redraw(); };
  const restored = () => { catalogSelection = null; void hydrate(); if (list) redraw(); };
  document.addEventListener('dsh-draft-restored', restored);
  document.addEventListener('input', onInput);
  observer.observe(document.body, { childList: true, subtree: true }); mount();
  window.__DSH_DOCUMENT_INTAKE__ = Object.freeze({ installed: true, isPending: () => catalogLoading, dispose: () => {
    observer.disconnect(); document.removeEventListener('dsh-draft-restored', restored); document.removeEventListener('input', onInput); bar?.remove();
  } });
  return true;
})();
