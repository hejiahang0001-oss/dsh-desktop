(() => {
  if (window.__DSH_DOCUMENT_INTAKE__) return true;
  const api = window.desktopAPI?.documents;
  const bridge = window.__DSH_COMPOSER_TEXT__;
  if (!api || !bridge) return false;
  let bar, list, status, button, busy = false, mountedCard, scheduled = false;
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
    } catch { /* The add action reports connection errors. */ }
    finally { catalogLoading = false; }
  };
  const composer = bridge.current;
  const message = (text, error = false) => {
    status.textContent = text; status.dataset.error = String(error);
  };
  const redraw = () => {
    list.replaceChildren();
    const value = bridge.read();
    for (const [reference, item] of refs) {
      if (!value.includes(reference)) continue;
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
  };
  const add = async (files) => {
    if (busy) return;
    const input = composer();
    const selection = localStorage.getItem('dsh.sessions.current');
    if (!input) return message('输入框尚未就绪，请连接工作区后重试。', true);
    busy = true; button.disabled = true; bar.setAttribute('aria-busy', 'true');
    message('正在准备文件…');
    try {
      const before = await api.getState();
      if (!before.available) throw new Error(before.message || '请等待工作区连接完成。');
      const result = files ? await api.importFiles(files, before.context) : await api.choose(before.context);
      if (result.canceled) return message(result.message);
      const after = await api.getState();
      if (before.context !== after.context || input !== composer() || selection !== localStorage.getItem('dsh.sessions.current')) throw new Error('会话已切换；没有把引用写入新会话，请回原会话重新添加。');
      if (!result.ok) throw new Error(result.rejected?.map((r) => `${r.name}：${r.message}`).join('；') || result.message);
      const additions = [];
      result.references.forEach((reference, index) => {
        refs.set(reference, result.items[index]);
        if (!bridge.read(input).includes(reference)) additions.push(reference);
      });
      if (additions.length) await bridge.append(input, additions.join('\n'), () => selection === localStorage.getItem('dsh.sessions.current'));
      redraw(); input.focus({ preventScroll: true });
      const rejected = result.rejected?.map((r) => `${r.name}：${r.message}`).join('；');
      message(`${result.message}${rejected ? ` 未添加：${rejected}` : ''}`, Boolean(rejected));
    } catch (error) { message(error.message || '添加失败，草稿已保留，请重试。', true); }
    finally { busy = false; button.disabled = false; bar.removeAttribute('aria-busy'); }
  };
  const mount = () => {
    scheduled = false;
    void hydrate();
    const card = document.querySelector('[data-composer-card]');
    if (!card) return;
    if (bar?.isConnected && mountedCard === card) return;
    bar?.remove(); mountedCard = card;
    bar = document.createElement('section'); bar.className = 'dsh-document-intake'; bar.setAttribute('aria-label', '参考资料');
    const row = document.createElement('div'); row.className = 'dsh-document-actions';
    button = document.createElement('button'); button.type = 'button'; button.textContent = '＋ 添加文件'; button.disabled = busy;
    button.onclick = () => add();
    const hint = document.createElement('span'); hint.textContent = '可拖入 Excel / Word / PDF · 单文件 ≤ 32 MB';
    hint.title = '支持 xlsx、docx、pdf、pptx、csv、txt、md；每次最多 10 个、合计 64 MB。不支持旧版 xls/doc 和宏文件。';
    row.append(button, hint);
    list = document.createElement('div'); list.className = 'dsh-document-list';
    status = document.createElement('div'); status.className = 'dsh-document-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    bar.append(row, list, status); card.insertAdjacentElement('beforebegin', bar); redraw();
  };
  const observer = new MutationObserver(() => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(mount); }
  });
  let dragDepth = 0, dropHint;
  const fileTransfer = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  const resetDrag = () => { dragDepth = 0; if (dropHint) dropHint.hidden = true; };
  const showDropHint = () => {
    if (!dropHint) {
      dropHint = document.createElement('div'); dropHint.className = 'dsh-document-drop-hint';
      dropHint.setAttribute('role', 'status'); dropHint.setAttribute('aria-live', 'polite');
      document.body.append(dropHint);
    }
    dropHint.textContent = busy ? '正在添加上一批文件，请稍候。'
      : '松开即可添加文件 · Excel / Word / PDF 或图片（图片与文档请分开添加）';
    dropHint.hidden = false;
  };
  const dragenter = (event) => {
    if (!fileTransfer(event)) return;
    event.preventDefault(); event.stopImmediatePropagation(); dragDepth += 1; showDropHint();
  };
  const dragleave = (event) => {
    if (!dragDepth && !fileTransfer(event)) return;
    event.stopImmediatePropagation(); dragDepth = Math.max(0, dragDepth - 1);
    const leftViewport = event.clientX <= 0 || event.clientY <= 0
      || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
    if (!dragDepth || ((event.target === document.body || event.target === document.documentElement) && leftViewport)) resetDrag();
  };
  const drop = (event) => {
    resetDrag();
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length || files.every((file) => file.type.startsWith('image/'))) return;
    event.preventDefault(); event.stopImmediatePropagation(); mount();
    if (!bar) return;
    if (busy) return message('上一批资料正在导入，请稍候再拖入。', true);
    if (files.some((file) => file.type.startsWith('image/'))) return message('图片与文档请分两次添加；本次未导入。', true);
    void add(files);
  };
  const dragover = (event) => {
    if (fileTransfer(event)) {
      event.preventDefault(); event.stopImmediatePropagation(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      showDropHint();
    }
  };
  const onInput = (event) => { if (event.target === composer() && list) redraw(); };
  const restored = () => { if (list) redraw(); };
  document.addEventListener('dsh-draft-restored', restored);
  document.addEventListener('drop', drop, true);
  document.addEventListener('dragenter', dragenter, true);
  document.addEventListener('dragleave', dragleave, true);
  document.addEventListener('dragover', dragover, true);
  window.addEventListener('dragend', resetDrag);
  window.addEventListener('blur', resetDrag);
  document.addEventListener('input', onInput);
  observer.observe(document.body, { childList: true, subtree: true }); mount();
  window.__DSH_DOCUMENT_INTAKE__ = Object.freeze({ installed: true, isPending: () => busy, dispose: () => {
    observer.disconnect(); document.removeEventListener('dsh-draft-restored', restored); document.removeEventListener('drop', drop, true); document.removeEventListener('dragover', dragover, true); document.removeEventListener('input', onInput);
    document.removeEventListener('dragenter', dragenter, true); document.removeEventListener('dragleave', dragleave, true);
    window.removeEventListener('dragend', resetDrag); window.removeEventListener('blur', resetDrag); dropHint?.remove(); bar?.remove();
  } });
  return true;
})();
