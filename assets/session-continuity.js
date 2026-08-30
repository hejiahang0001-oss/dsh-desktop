(() => {
  if (window.__DSH_CONTINUITY__) return true;
  const api = window.desktopAPI?.drafts, bridge = window.__DSH_COMPOSER_TEXT__;
  if (!api || !bridge) return false;
  let current = null, loading = false, disposed = false, status;
  const selection = () => localStorage.getItem('dsh.sessions.current') || '';
  const show = (text) => { if (status?.isConnected) status.textContent = text; };
  const mount = () => {
    const bar = document.querySelector('.dsh-document-intake'); if (!bar) return;
    if (status?.isConnected && status.parentElement === bar) return;
    status?.remove(); status = document.createElement('div'); status.className = 'dsh-document-status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); bar.append(status);
  };
  const persist = (record) => {
    const text = record.latest;
    record.queue = record.queue.catch(() => {}).then(async () => {
      if (text === record.saved) return;
      const result = await api.save({ token: record.token, context: record.context, text, revision: record.revision });
      record.revision = result.revision; record.saved = text;
      if (record === current) show(text ? '未发送草稿已保存在本机。' : '输入已清空。');
    }).catch((error) => { if (record === current) show(`草稿未保存：${error.message}`); throw error; });
    record.queue.catch(() => {}); return record.queue;
  };
  const load = async () => {
    if (loading || disposed || !bridge.current()) return;
    const selected = selection();
    if (current?.selection === selected && Date.now() - current.loadedAt < 60000) return;
    loading = true;
    try {
      if (current) await persist(current).catch(() => {});
      const row = await api.getState();
      if (disposed || selected !== selection() || !bridge.current()) return;
      const refreshing = current?.selection === selected;
      const record = { ...row, selection: selected, loadedAt: Date.now(), saved: row.text, latest: row.text, queue: Promise.resolve() };
      current = record;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (selected !== selection() || current !== record) return;
      const input = bridge.current(), existing = bridge.read(input);
      if (!refreshing && !existing.trim() && row.text) {
        await bridge.restore(input, row.text, () => selected === selection() && current === record);
        show('已恢复当前会话的未发送文字与文档引用；尚未发送。');
        document.dispatchEvent(new Event('dsh-draft-restored'));
      }
      record.latest = bridge.read();
      if (record.latest !== record.saved) await persist(record);
    } catch (error) { show(`草稿恢复暂不可用：${error.message}`); }
    finally { loading = false; }
  };
  const input = () => {
    if (!current || loading || current.selection !== selection() || !bridge.current()) return;
    current.latest = bridge.read(); void persist(current);
  };
  const timer = setInterval(() => {
    mount();
    if (current && !loading && current.selection === selection() && bridge.current()) {
      const value = bridge.read(); if (value !== current.latest) { current.latest = value; void persist(current); }
    }
    void load();
  }, 350);
  document.addEventListener('input', input); document.addEventListener('dsh-draft-restored', input);
  mount(); void load();
  window.__DSH_CONTINUITY__ = Object.freeze({
    ready: () => Boolean(current && current.selection === selection() && !loading),
    flush: () => { input(); return current?.queue || Promise.resolve(); },
    dispose: () => { disposed = true; clearInterval(timer); document.removeEventListener('input', input); document.removeEventListener('dsh-draft-restored', input); status?.remove(); }
  });
  return true;
})();
