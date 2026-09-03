(() => {
  const api = window.dockAPI, tabs = document.getElementById('dock-tabs'), status = document.getElementById('dock-status');
  const labels = { terminal: '终端', office: 'Office', tasks: '任务', extensions: '扩展', wiki: 'Wiki', worktrees: '工作树' };
  const act = async (action, value) => { try { status.textContent = ''; await api.act(action, value); } catch (error) { status.textContent = error.message || '操作失败，请重试'; } };
  for (const [id, label] of Object.entries(labels)) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.tool = id; button.setAttribute('role', 'tab');
    button.addEventListener('click', () => void act('select', id)); tabs.append(button);
  }
  for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click', () => void act('panel', button.dataset.panel));
  document.getElementById('dock-collapse').addEventListener('click', () => void act('collapse'));
  document.getElementById('dock-detach').addEventListener('click', () => void act('detach'));
  document.getElementById('dock-size').addEventListener('change', (event) => void act('height', Number(event.target.value)));
  tabs.addEventListener('keydown', (event) => {
    const buttons = [...tabs.children], index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') { void act('collapse'); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[target].focus(); buttons[target].click();
  });
  const render = (state) => {
    status.textContent = state.error || '';
    document.getElementById('dock-size').value = String(state.height <= 280 ? 240 : state.height < 430 ? 360 : 500);
    for (const button of tabs.children) { const selected = state.open && state.active === button.dataset.tool; button.dataset.opened = String(state.opened.includes(button.dataset.tool)); button.setAttribute('aria-selected', String(selected)); button.tabIndex = state.active === button.dataset.tool ? 0 : -1; }
    document.getElementById('dock-collapse').disabled = !state.open;
    document.getElementById('dock-detach').disabled = !state.open || !state.opened.includes(state.active);
    document.getElementById('dock-detach').textContent = state.floating ? '↙' : '↗';
    document.getElementById('dock-detach').title = state.floating ? '停靠回主窗口' : '在独立窗口打开当前工具';
    document.getElementById('dock-detach').setAttribute('aria-label', document.getElementById('dock-detach').title);
  };
  api.onState(render); void api.getState().then(render).catch(() => { status.textContent = '工作台尚未就绪'; });
})();
