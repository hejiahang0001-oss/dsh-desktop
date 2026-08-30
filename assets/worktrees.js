(() => {
  const api = window.worktreesAPI;
  if (!api) return;
  const repositoryPath = document.getElementById('repository-path');
  const summary = document.getElementById('summary');
  const list = document.getElementById('worktree-list');
  const status = document.getElementById('status');
  const createButton = document.getElementById('create');
  const handoffButton = document.getElementById('handoff');
  const refreshButton = document.getElementById('refresh');
  const closeButton = document.getElementById('close');
  let operationActive = false;
  let currentState = null;

  const empty = (node) => { while (node.firstChild) node.firstChild.remove(); };
  const shortPath = (value) => value || '路径不可用';
  const setBusy = (busy) => {
    operationActive = busy;
    createButton.disabled = busy || currentState?.available !== true || currentState?.status === 'busy' || currentState?.counts?.managed >= currentState?.limits?.managed;
    refreshButton.disabled = busy;
    handoffButton.disabled = busy || currentState?.available !== true;
    for (const button of document.querySelectorAll('.worktree-actions button')) button.disabled = busy || button.dataset.disabled === 'true';
    list.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  const addSummary = (label, value, title = '') => {
    const card = document.createElement('article');
    card.className = 'summary-card';
    const caption = document.createElement('span');
    caption.textContent = label;
    const content = document.createElement('strong');
    content.textContent = value;
    content.title = title || value;
    card.append(caption, content);
    summary.append(card);
  };

  const actionButton = (caption, action, { className = '', disabled = false } = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = caption;
    button.className = className;
    button.dataset.disabled = disabled ? 'true' : 'false';
    button.disabled = disabled || operationActive;
    button.addEventListener('click', () => void action(button));
    return button;
  };

  const runAction = async (message, operation) => {
    if (operationActive) return;
    setBusy(true);
    status.textContent = message;
    try {
      const result = await operation();
      if (result?.state) render(result.state);
      status.textContent = result?.message || (result?.ok ? '工作树操作已完成。' : '工作树没有变化。');
    } catch {
      status.textContent = '工作树操作失败；分支和当前工作区保持原状态。';
    } finally { setBusy(false); }
  };

  const render = (state = {}) => {
    currentState = state;
    repositoryPath.textContent = state.repository?.root || '当前工作区不是可管理的 Git 仓库';
    repositoryPath.title = state.repository?.root || '';
    createButton.disabled = operationActive || state.available !== true || state.status === 'busy' || state.counts?.managed >= state.limits?.managed;
    handoffButton.disabled = operationActive || state.available !== true;
    const handoffs = document.getElementById('handoff-list'); empty(handoffs);
    const phaseLabels = { preparing: '准备中', copying: '复制代码中', forking: '保存关联会话中', ready: '可继续', returned: '已返回', failed: '需要处理', interrupted: '上次中断，未自动重试' };
    for (const record of (state.handoffs || []).slice().reverse()) {
      const row = document.createElement('article'); row.className = 'worktree-card';
      const text = document.createElement('div'); text.className = 'worktree-main';
      const heading = document.createElement('h3'); heading.textContent = `${record.direction === 'back' ? '返回原目录' : '交接到工作树'} · ${phaseLabels[record.phase] || record.phase}`;
      const detail = document.createElement('p'); detail.textContent = record.message || `${record.sourcePath} → ${record.targetPath || '尚未建立目标'}`;
      detail.className = 'worktree-path'; text.append(heading, detail);
      const actions = document.createElement('div'); actions.className = 'worktree-actions';
      actions.append(actionButton('打开原会话', () => runAction('正在打开保留的原会话…', () => api.openHandoff(record.id, 'source'))));
      if (record.targetPath) actions.append(actionButton('打开目标会话', () => runAction('正在核对并打开目标会话…', () => api.openHandoff(record.id, 'target'))));
      row.append(text, actions); handoffs.append(row);
    }
    if (!handoffs.children.length) { const note = document.createElement('p'); note.className = 'empty-state'; note.textContent = '尚无交接记录。点击“交接当前会话”进入独立工作树；在交接会话中再次点击可返回原目录。'; handoffs.append(note); }
    empty(summary);
    addSummary('当前分支', state.repository?.branch || (state.repository?.detached ? 'detached HEAD' : '—'));
    addSummary('当前提交', state.repository?.headShort || '—', state.repository?.head || '');
    addSummary('工作树', `${state.counts?.total || 0} / ${state.limits?.total || 0}`);
    addSummary('软件管理 / 有修改', `${state.counts?.managed || 0} / ${state.counts?.dirty || 0}`);

    empty(list);
    const worktrees = state.worktrees || [];
    if (worktrees.length === 0) {
      const notice = document.createElement('p');
      notice.className = `empty-state ${state.available === false ? 'error-state' : ''}`;
      notice.textContent = state.message || '当前仓库还没有可显示的工作树。';
      list.append(notice);
      list.setAttribute('aria-busy', 'false');
      return;
    }
    for (const item of worktrees) {
      const card = document.createElement('article');
      card.className = `worktree-card${item.current ? ' current' : ''}`;
      const body = document.createElement('div');
      body.className = 'worktree-main';
      const titleRow = document.createElement('div');
      titleRow.className = 'worktree-title';
      const title = document.createElement('h3');
      title.textContent = item.branch || 'detached HEAD';
      titleRow.append(title);
      const badges = [];
      if (item.current) badges.push(['当前', 'current']);
      if (item.main) badges.push(['主工作树', '']);
      badges.push([item.managed ? 'DSH 管理' : '外部只读', '']);
      badges.push(item.status?.available === false
        ? ['状态不可用', 'dirty']
        : [item.status?.clean ? '干净' : `${item.status?.changed || 0} 项修改`, item.status?.clean ? 'clean' : 'dirty']);
      for (const [text, kind] of badges) {
        const badge = document.createElement('span');
        badge.className = `badge ${kind}`.trim();
        badge.textContent = text;
        titleRow.append(badge);
      }
      const itemPath = document.createElement('p');
      itemPath.className = 'worktree-path';
      itemPath.textContent = shortPath(item.path);
      itemPath.title = item.path || '';
      const meta = document.createElement('div');
      meta.className = 'worktree-meta';
      const details = [
        `提交 ${item.headShort || '未知'}`,
        `所有者 ${item.owner || '未知'}`,
        item.status?.available === false
          ? '目录或 Git 状态未通过安全校验'
          : item.status?.clean ? '无未提交修改' : `暂存 ${item.status?.staged || 0} · 未暂存 ${item.status?.unstaged || 0} · 新文件 ${item.status?.untracked || 0}`
      ];
      for (const value of details) {
        const text = document.createElement('span');
        text.textContent = value;
        meta.append(text);
      }
      body.append(titleRow, itemPath, meta);

      const actions = document.createElement('div');
      actions.className = 'worktree-actions';
      if (item.canActivate) actions.append(actionButton('切换', () => runAction(`正在切换到 ${item.branch || item.directoryName}…`, () => api.activate(item.id))));
      actions.append(actionButton('显示', () => runAction('正在文件资源管理器中定位工作树…', () => api.reveal(item.id)), { disabled: item.status?.available === false || item.prunable || item.bare }));
      if (item.managed) actions.append(actionButton('安全回收', () => runAction(`正在检查 ${item.branch} 的修改和恢复点…`, () => api.remove(item.id)), { className: 'danger', disabled: !item.canRemove }));
      card.append(body, actions);
      list.append(card);
    }
    list.setAttribute('aria-busy', 'false');
  };

  const refresh = () => runAction('正在刷新 Git 工作树状态…', () => api.refresh());
  createButton.addEventListener('click', () => runAction('正在准备新的隔离分支和目录…', () => api.create()));
  handoffButton.addEventListener('click', () => runAction('正在检查会话、代码和恢复点…', () => api.handoff()));
  refreshButton.addEventListener('click', () => void refresh());
  closeButton.addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
    if (event.key === 'F5') { event.preventDefault(); void refresh(); }
  });
  api.onState((state) => {
    if (!operationActive) render(state);
  });
  api.getState().then(render).catch(() => {
    status.textContent = '工作树状态暂时不可用。';
    list.setAttribute('aria-busy', 'false');
  });
})();
