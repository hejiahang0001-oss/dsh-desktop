(() => {
  const api = window.tasksSubagentsAPI;
  if (!api) return;
  const refreshButton = document.getElementById('refresh');
  const closeButton = document.getElementById('close');
  const rootLine = document.getElementById('root-line');
  const summary = document.getElementById('summary');
  const subagentList = document.getElementById('subagent-list');
  const jobList = document.getElementById('job-list');
  const status = document.getElementById('status');
  let busy = false;
  let currentState = null;
  let timer;

  const empty = (node) => { while (node.firstChild) node.firstChild.remove(); };
  const button = (label, action, { className = '', disabled = false } = {}) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = label;
    control.className = className;
    control.disabled = disabled || busy;
    control.dataset.disabled = disabled ? 'true' : 'false';
    control.addEventListener('click', () => void action(control));
    return control;
  };
  const setBusy = (value) => {
    busy = value;
    refreshButton.disabled = value;
    for (const control of document.querySelectorAll('.subagent-actions button, .compose button')) {
      control.disabled = value || control.dataset.disabled === 'true';
    }
    subagentList.setAttribute('aria-busy', value ? 'true' : 'false');
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
  const run = async (pending, operation) => {
    if (busy) return;
    setBusy(true);
    status.textContent = pending;
    try {
      const result = await operation();
      if (result?.state) render(result.state);
      status.textContent = result?.message || (result?.ok ? '操作已交给 Harness。' : '任务状态没有变化。');
    } catch {
      status.textContent = '操作失败；Harness 任务保持原状态。';
    } finally {
      setBusy(false);
    }
  };

  const renderSubagents = (state) => {
    const drafts = new Map(Array.from(subagentList.querySelectorAll('.subagent-row[data-entry-id]')).map((row) => {
      const input = row.querySelector('textarea');
      return [row.dataset.entryId, { open: row.querySelector('.compose')?.classList.contains('open') === true, value: input?.value || '' }];
    }));
    empty(subagentList);
    const rows = state.subagents || [];
    if (rows.length === 0) {
      const notice = document.createElement('p');
      notice.className = `empty-state${state.available === false ? ' error' : ''}`;
      notice.textContent = state.message || '当前主任务还没有子代理。';
      subagentList.append(notice);
      subagentList.setAttribute('aria-busy', 'false');
      return;
    }
    for (const item of rows) {
      const row = document.createElement('article');
      row.className = `subagent-row${item.current ? ' current' : ''}`;
      row.dataset.entryId = item.id || '';
      row.style.setProperty('--depth', String(item.depth || 0));
      const body = document.createElement('div');
      body.className = 'subagent-main';
      const nameLine = document.createElement('div');
      nameLine.className = 'name-line';
      const dot = document.createElement('span');
      dot.className = `dot${item.activity === 'running' ? ' live' : ''}`;
      const name = document.createElement('h3');
      name.textContent = item.label || '目录诊断';
      name.title = item.label || '';
      nameLine.append(dot, name);
      if (item.current) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '当前';
        nameLine.append(badge);
      }
      if (item.workspaceShared) {
        const badge = document.createElement('span');
        badge.className = 'badge warning';
        badge.textContent = '共享工作目录';
        nameLine.append(badge);
      }
      const meta = document.createElement('div');
      meta.className = 'subagent-meta';
      const details = item.kind === 'child'
        ? [item.mode === 'continuable' ? '可继续' : '一次性', item.activity === 'running' ? '正在运行' : '当前未运行', item.workspace === 'current' ? `当前工作树：${item.workspaceLabel}` : item.workspace === 'other' ? `其他目录：${item.workspaceLabel}` : item.workspaceLabel, `…${item.sessionSuffix}`]
        : [`诊断：${item.reason || 'unavailable'}`];
      for (const value of details) {
        const text = document.createElement('span');
        text.textContent = value;
        meta.append(text);
      }
      body.append(nameLine, meta);
      const actions = document.createElement('div');
      actions.className = 'subagent-actions';
      if (item.kind === 'child') {
        actions.append(button('打开记录', () => run('正在打开 Harness 子代理记录…', () => api.open(item.id))));
        let compose;
        if (item.canPrompt) {
          const promptButton = button('补充消息', () => {
            compose.classList.toggle('open');
            if (compose.classList.contains('open')) compose.querySelector('textarea')?.focus();
          });
          actions.append(promptButton);
          compose = document.createElement('div');
          compose.className = 'compose';
          const input = document.createElement('textarea');
          input.maxLength = 8000;
          input.placeholder = '补充要求会进入此子代理的 FIFO 队列…';
          input.setAttribute('aria-label', `给 ${item.label} 补充消息`);
          const send = button('发送', async () => {
            const value = input.value.trim();
            if (!value) { status.textContent = '请先输入补充消息。'; return; }
            await run('正在把补充消息交给 Harness…', async () => {
              const result = await api.prompt(item.id, value);
              if (result?.ok) input.value = '';
              return result;
            });
          });
          compose.append(input, send);
          const draft = drafts.get(item.id);
          if (draft?.open) compose.classList.add('open');
          if (draft?.value) input.value = draft.value;
        }
        if (item.canInterrupt) actions.append(button('中断当前轮次', () => run('正在请求 Harness 中断当前轮次…', () => api.interrupt(item.id)), { className: 'danger' }));
        row.append(body, actions);
        if (compose) row.append(compose);
      } else {
        row.append(body, actions);
      }
      subagentList.append(row);
    }
    subagentList.setAttribute('aria-busy', 'false');
  };

  const renderJobs = (state) => {
    empty(jobList);
    const jobs = state.jobs?.entries || [];
    if (jobs.length === 0) {
      const notice = document.createElement('p');
      notice.className = `empty-state${state.jobs?.status === 'unavailable' ? ' error' : ''}`;
      notice.textContent = state.jobs?.status === 'unavailable' ? '后台任务镜像暂时不可用。' : '当前会话没有后台任务。';
      jobList.append(notice);
      return;
    }
    for (const item of jobs) {
      const row = document.createElement('article');
      row.className = 'job-row';
      const kind = document.createElement('span');
      kind.className = 'job-kind';
      kind.textContent = item.kind;
      const label = document.createElement('span');
      label.className = 'job-label';
      label.textContent = item.label;
      label.title = item.label;
      const stateText = document.createElement('span');
      stateText.className = `job-status${item.live ? ' live' : ''}`;
      stateText.textContent = item.status;
      const duration = document.createElement('span');
      duration.className = 'job-duration';
      duration.textContent = item.duration || '—';
      row.append(kind, label, stateText, duration);
      jobList.append(row);
    }
  };

  const render = (state = {}) => {
    currentState = state;
    window.dispatchEvent(new CustomEvent('dsh-background-state', { detail: state.background }));
    rootLine.textContent = state.available
      ? `根任务：${state.root?.title || '未知'} · …${state.root?.sessionSuffix || ''} · 状态来自 ${state.source}`
      : state.message || 'Harness 任务状态尚未就绪。';
    empty(summary);
    addSummary('当前任务', state.current?.title || '尚未选择', state.current?.title || '');
    addSummary('当前状态', state.workflow?.approvals ? '等待你确认' : state.current?.running ? '正在运行' : state.available ? '当前未运行' : '不可用');
    addSummary('子代理', `${state.counts?.runningSubagents || 0} 运行 / ${state.counts?.subagents || 0} 总计`);
    addSummary('后台任务', `${state.counts?.liveJobs || 0} 运行 / ${state.counts?.backgroundJobs || 0} 总计`);
    addSummary('目录共享', String(state.counts?.sharedWorkspaces || 0));
    addSummary('等待确认', String(state.counts?.pending || 0));
    addSummary('排队 / 插话', state.workflow?.available ? `${state.workflow.queued} / ${state.workflow.steering}` : '状态待同步');
    renderSubagents(state);
    renderJobs(state);
  };

  const refresh = ({ quiet = false } = {}) => {
    if (busy) return Promise.resolve();
    return run(quiet ? status.textContent : '正在刷新 Harness 任务状态…', async () => ({ ok: true, state: await api.refresh(), message: quiet ? status.textContent : '任务状态已刷新。' }));
  };
  refreshButton.addEventListener('click', () => void refresh());
  closeButton.addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
    if (event.key === 'F5') { event.preventDefault(); void refresh(); }
  });
  api.onState((state) => { if (!busy) render(state); });
  api.getState().then(render).catch(() => render({ available: false, message: 'Harness 任务状态读取失败。' }));
  timer = setInterval(() => void refresh({ quiet: true }), 4000);
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });
})();
