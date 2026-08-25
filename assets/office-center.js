(() => {
  const api = window.officeCenterAPI;
  if (!api) return;
  const grid = document.getElementById('office-grid');
  const integrationGrid = document.getElementById('integration-grid');
  const readyCount = document.getElementById('ready-count');
  const totalCount = document.getElementById('total-count');
  const harnessSignal = document.getElementById('harness-signal');
  const workspaceSignal = document.getElementById('workspace-signal');
  const status = document.getElementById('status');

  const empty = (node) => { while (node.firstChild) node.firstChild.remove(); };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const setSignal = (node, state, text) => {
    node.className = `signal ${state || 'waiting'}`;
    node.textContent = text;
  };
  const renderOffice = (item, canInvoke) => {
    const card = element('article', `office-card ${item.accent || ''}`);
    card.dataset.skill = item.id || '';
    const top = element('div', 'office-top');
    const mark = element('span', 'office-mark', (item.name || '?').slice(0, 1));
    const format = element('span', 'format', item.extension || '');
    top.append(mark, format);
    const title = element('h3', '', item.name || 'Office');
    const summary = element('p', 'summary', item.summary || '');
    const list = element('ul', 'capabilities');
    for (const capability of item.capabilities || []) list.append(element('li', '', capability));
    const boundary = element('p', 'boundary', item.boundary || '');
    const action = element('button', 'invoke', item.ready ? `使用 ${item.name}` : '组件缺失');
    action.type = 'button';
    action.disabled = !item.ready || !canInvoke;
    action.addEventListener('click', async () => {
      action.disabled = true;
      status.textContent = `正在把 /${item.skill} 写入当前 Harness 对话…`;
      try {
        const result = await api.invoke(item.id);
        status.textContent = result?.message || (result?.ok ? '已定位到 Harness 输入框。' : '当前无法调用该能力。');
        if (!result?.ok) action.disabled = false;
      } catch {
        status.textContent = '交付命令未写入；没有执行文件或网络操作。';
        action.disabled = false;
      }
    });
    card.append(top, title, summary, list, boundary, action);
    return card;
  };
  const render = (state = {}) => {
    readyCount.textContent = String(state.readyCount || 0);
    totalCount.textContent = String(state.total || 3);
    setSignal(harnessSignal, state.harness?.status, state.harness?.status === 'ready' ? 'Harness 已连接' : 'Harness 连接中');
    setSignal(workspaceSignal, state.workspace?.status, state.workspace?.status === 'ready' ? `${state.workspace.name || '工作区'} 已同步` : '工作区同步中');
    empty(grid);
    const canInvoke = state.harness?.status === 'ready' && state.workspace?.status === 'ready';
    for (const item of state.office || []) grid.append(renderOffice(item, canInvoke));
    if ((state.office || []).length === 0) grid.append(element('p', 'empty-state', 'Office 能力清单暂不可用。'));
    empty(integrationGrid);
    for (const item of state.integrations || []) {
      const card = element('article', 'integration-card');
      const badge = element('span', `mini-status ${item.status || 'waiting'}`, item.status === 'ready' ? '已接入' : '待连接');
      card.append(element('h3', '', item.title || ''), element('p', '', item.detail || ''), badge);
      integrationGrid.append(card);
    }
    status.textContent = state.available
      ? (canInvoke ? '三个可编辑 Office 文件能力均已就绪。' : '三个 Office 组件完整；等待 Harness 与工作区同步。')
      : '一个或多个 Office 组件缺失；调用入口已关闭。';
  };
  document.getElementById('close').addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.close(); });
  api.getState().then(render).catch(() => { status.textContent = '交付中心状态不可用。'; });
})();
