(() => {
  if (window.__DSH_WORKFLOW__) return true;
  const api = window.desktopAPI?.harness, bridge = window.__DSH_COMPOSER_TEXT__;
  if (!api?.workflowState || !bridge) return false;
  let bar, status, actions, resume, busy = false, polling = false, disposed = false;
  const selection = () => localStorage.getItem('dsh.sessions.current') || '';
  const label = (button) => (button.getAttribute('aria-label') || button.textContent || '').trim();
  const stopControl = () => Array.from(document.querySelectorAll('button')).find((button) => ['Stop generating', '停止生成'].includes(label(button)) && !button.disabled);
  const show = (message) => { if (status && status.textContent !== message) status.textContent = message; };
  const action = (text, help, callback) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.title = help;
    button.addEventListener('click', () => { if (!busy) void callback(); }); actions.append(button); return button;
  };
  const mount = () => {
    const card = document.querySelector('[data-composer-card]'); if (!card) return false;
    if (bar?.isConnected) return true;
    bar = document.createElement('section'); bar.className = 'dsh-document-intake dsh-session-workflow'; bar.setAttribute('aria-label', '会话执行状态');
    status = document.createElement('div'); status.className = 'dsh-document-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    actions = document.createElement('div'); actions.className = 'dsh-document-actions';
    action('排队发送', '不打断当前执行；等当前回合结束后处理。', async () => {
      const input = bridge.current(); if (!input || !bridge.read(input).trim()) return show('先输入要排队的内容。');
      input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      show('发送已交给输入框处理；请以排队数量或错误提示为准。'); setTimeout(() => void refresh(), 400);
    });
    action('插话并继续', '中断当前回合并处理这段文字。支持普通文字和文档引用；图片和命令请用原输入框。', async () => {
      const selected = selection(), input = bridge.current(), text = bridge.read(input);
      if (!text.trim() || text.length > 8000 || text.trim().startsWith('/') || card.querySelector('[data-decoration="chip"],img')) return show('此入口支持 1–8,000 字普通文字与文档引用；图片或命令请用原输入框。');
      busy = true; for (const button of actions.children) button.disabled = true; show('正在申请中断并发送插话…');
      try {
        const result = await api.interruptAndPrompt(text); if (!result.accepted) throw new Error(result.message || '插话未受理。');
        if (selection() === selected && input === bridge.current() && bridge.read(input) === text) { await bridge.remove(input, text); await window.__DSH_CONTINUITY__?.flush(); }
        show(`${result.message} 尚不代表已执行完成；新写的草稿会保留。`);
      } catch (error) { show(`插话失败，草稿保留：${error.message}`); }
      finally { busy = false; for (const button of actions.children) button.disabled = false; input?.focus({ preventScroll: true }); }
    });
    action('停止当前回合', '只申请停止当前执行；不宣称排队消息已删除。', async () => { const stop = stopControl(); if (!stop) return show('当前没有可停止的前台回合。'); stop.click(); show('已申请停止；排队消息请单独查看和取消。'); });
    resume = action('继续排队消息', '处理保留的排队消息，不重新提交一份。', async () => {
      busy = true; for (const button of actions.children) button.disabled = true;
      try { const result = await api.interruptQueued(); if (!result.accepted) throw new Error(result.message || '请求未受理'); show(result.message || '已请求继续；请以实际执行状态为准。'); }
      catch (error) { show(`未能继续：${error.message} 排队消息未自动删除。`); }
      finally { busy = false; for (const button of actions.children) button.disabled = false; void refresh(); }
    });
    bar.append(status, actions); card.insertAdjacentElement('beforebegin', bar); return true;
  };
  const refresh = async () => {
    if (disposed || polling || !mount()) return;
    polling = true; const selected = selection();
    try {
      const state = await api.workflowState();
      if (selected !== selection() || disposed || busy) return;
      actions.hidden = !state.running && !state.pending;
      for (const button of actions.children) button.hidden = button === resume ? state.running || !state.pending : !state.running;
      if (!state.available) return show('执行状态正在同步；请以会话中的确认和错误提示为准。');
      const end = { completed: '上一回合已完成', aborted: '上一回合已停止', blocked: '上一回合被阻止', error: '上一回合失败，请查看错误', interrupted: '上次运行中断，未自动重跑', 'max-tokens': '上一回合达到输出限制' };
      const phase = state.approvals ? `等待你确认 ${state.approvals} 项` : state.running ? '正在执行' : state.pending ? '等待处理排队消息' : end[state.lastTurnReason] || '可以发送问题';
      show(`${phase} · 排队 ${state.queued} · 插话 ${state.steering}${state.jobs ? ` · 后台命令 ${state.jobs}` : ''}`);
    } catch { if (!busy) show('执行状态暂不可用，请查看会话提示。'); }
    finally { polling = false; }
  };
  const timer = setInterval(() => void refresh(), 4000); void refresh();
  window.__DSH_WORKFLOW__ = Object.freeze({ refresh, dispose: () => { disposed = true; clearInterval(timer); bar?.remove(); } });
  return true;
})();
