(() => {
  const api = window.contextSourcesAPI;
  if (!api) return;
  const workspacePath = document.getElementById('workspace-path');
  const layers = document.getElementById('layers');
  const sources = document.getElementById('sources');
  const rulesSummary = document.getElementById('rules-summary');
  const memoryStatus = document.getElementById('memory-status');
  const memoryName = document.getElementById('memory-name');
  const memoryDetail = document.getElementById('memory-detail');
  const status = document.getElementById('status');
  const refreshButton = document.getElementById('refresh');
  const closeButton = document.getElementById('close');

  const empty = (node) => { while (node.firstChild) node.firstChild.remove(); };
  const formatBytes = (value) => {
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1024) return `${value} B`;
    return `${(value / 1024).toFixed(1)} KiB`;
  };
  const badge = (value) => ({ active: '生效', empty: '未配置', waiting: '等待同步' }[value] || '已声明');

  const render = (state = {}) => {
    workspacePath.textContent = state.workspacePath || '当前工作区不可用';
    workspacePath.title = state.workspacePath || '';
    empty(layers);
    for (const layer of state.layers || []) {
      const card = document.createElement('article');
      card.className = 'layer-card';
      const meta = document.createElement('div');
      meta.className = 'card-meta';
      const owner = document.createElement('span');
      owner.textContent = layer.owner || '未知';
      const stateBadge = document.createElement('span');
      stateBadge.className = `badge ${layer.status || ''}`;
      stateBadge.textContent = badge(layer.status);
      meta.append(owner, stateBadge);
      const title = document.createElement('h3');
      title.textContent = layer.title || '未命名来源';
      const detail = document.createElement('p');
      detail.textContent = layer.detail || '';
      card.append(meta, title, detail);
      layers.append(card);
    }

    empty(sources);
    const sourceList = state.sources || [];
    rulesSummary.textContent = sourceList.length > 0
      ? `检测到 ${sourceList.length} 个候选${state.sourceLimitReached ? '（已达展示上限）' : ''}；内容去重、总预算省略和截断由 Harness 决定，本窗口只展示元数据。`
      : '未检测到 AGENTS.md、CLAUDE.md、AGENTS.local.md 或 CLAUDE.local.md。';
    for (const source of sourceList) {
      const row = document.createElement('article');
      row.className = 'source-row';
      const body = document.createElement('div');
      body.className = 'source-body';
      const title = document.createElement('h3');
      title.textContent = source.displayPath || '规则文件';
      const meta = document.createElement('p');
      const kind = { global: '用户全局', project: '项目基础', overlay: '本地覆盖' }[source.kind] || '用户规则';
      const modified = source.modifiedAt ? new Date(source.modifiedAt).toLocaleString() : '时间未知';
      const budget = source.status === 'oversized' ? '超过 1 MiB，Harness 忽略' : '预算候选';
      meta.textContent = `${kind} · ${budget} · ${formatBytes(source.bytes)} · ${modified}`;
      body.append(title, meta);
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.textContent = '在文件夹中显示';
      reveal.addEventListener('click', async () => {
        reveal.disabled = true;
        const result = await api.reveal(source.id);
        status.textContent = result?.ok ? '已在文件资源管理器中定位规则文件。' : (result?.message || '规则文件已变化，请刷新。');
        reveal.disabled = false;
      });
      row.append(body, reveal);
      sources.append(row);
    }
    if (sourceList.length === 0) {
      const emptyState = document.createElement('p');
      emptyState.className = 'empty-state';
      emptyState.textContent = '当前只有 Harness 基础上下文和会话历史；桌面版不会创建隐形项目规则。';
      sources.append(emptyState);
    }

    memoryStatus.textContent = state.memory?.status === 'harness-managed' ? 'Harness 管理' : '不可用';
    memoryName.textContent = state.memory?.title || '长期记忆';
    memoryDetail.textContent = state.memory?.detail || '尚未检查记忆边界。';
    status.textContent = state.available === false
      ? '当前工作区不可用，没有读取任何规则正文。'
      : '已刷新；本窗口只读取规则文件元数据，不读取正文或凭据。';
  };

  const refresh = async () => {
    refreshButton.disabled = true;
    status.textContent = '正在刷新上下文来源…';
    try { render(await api.refresh()); }
    catch { status.textContent = '刷新失败；没有放宽文件或 IPC 边界。'; }
    finally { refreshButton.disabled = false; }
  };

  refreshButton.addEventListener('click', () => void refresh());
  closeButton.addEventListener('click', () => window.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
    if (event.key === 'F5') { event.preventDefault(); void refresh(); }
  });
  api.getState().then(render).catch(() => { status.textContent = '上下文来源暂时不可用。'; });
})();
