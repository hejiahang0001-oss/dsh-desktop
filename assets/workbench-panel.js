(() => {
  const api = window.desktopAPI;
  const bootstrap = window.__DSH_WORKBENCH_BOOTSTRAP__ || { reviewPanelOpen: true, reviewPanelWidth: 340 };
  if (!api?.diagnostics || !api?.changes || !api?.workbench) return false;
  if (window.__DSH_WORKBENCH__) {
    window.__DSH_WORKBENCH__.applyLayout(bootstrap);
    return true;
  }

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const labelForStatus = (status) => ({
    pending: '待审',
    protected: '已保护',
    accepted: '已接受',
    clean: '已恢复',
    unavailable: '只读'
  }[status] || '未知');
  const markForStatus = (status, untracked) => {
    if (status === 'accepted') return '✓';
    if (status === 'protected') return '!';
    if (untracked) return 'A';
    return 'M';
  };
  const kindForLine = (line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
    if (line.startsWith('+')) return 'add';
    if (line.startsWith('-')) return 'delete';
    if (line.startsWith('@@')) return 'hunk';
    return 'context';
  };

  const panel = create('aside');
  panel.id = 'dsh-workbench-review';
  panel.setAttribute('aria-label', 'Git 变更审查');
  panel.setAttribute('role', 'complementary');

  const resizer = create('div', 'dsh-review-resizer');
  resizer.tabIndex = 0;
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-label', '调整变更审查面板宽度');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-valuemin', '280');
  resizer.setAttribute('aria-valuemax', '520');
  panel.append(resizer);

  const header = create('header', 'dsh-review-header');
  const heading = create('div', 'dsh-review-heading');
  const title = create('h2', '', '变更审查');
  title.id = 'dsh-review-title';
  const summary = create('p', 'dsh-review-summary', '正在读取 Git 状态…');
  heading.append(title, summary);
  const headerActions = create('div', 'dsh-review-header-actions');
  const refreshButton = create('button', 'dsh-review-icon-button', '↻');
  refreshButton.type = 'button';
  refreshButton.title = '刷新变更';
  refreshButton.setAttribute('aria-label', '刷新变更');
  const closeButton = create('button', 'dsh-review-icon-button', '×');
  closeButton.type = 'button';
  closeButton.title = '隐藏变更审查面板';
  closeButton.setAttribute('aria-label', '隐藏变更审查面板');
  headerActions.append(refreshButton, closeButton);
  header.append(heading, headerActions);
  panel.append(header);

  const content = create('div', 'dsh-review-content');
  const files = create('div', 'dsh-review-files');
  files.setAttribute('role', 'listbox');
  files.setAttribute('aria-label', 'Git 变更文件');
  const diff = create('section', 'dsh-review-diff');
  diff.setAttribute('aria-labelledby', 'dsh-review-diff-path');
  const diffHeader = create('div', 'dsh-review-diff-header');
  const diffPath = create('span', 'dsh-review-diff-path', '未选择文件');
  diffPath.id = 'dsh-review-diff-path';
  const diffNote = create('span', 'dsh-review-diff-note', '选择文件后显示有界 Git Diff');
  diffHeader.append(diffPath, diffNote);
  const diffScroll = create('div', 'dsh-review-diff-scroll');
  diffScroll.tabIndex = 0;
  diffScroll.setAttribute('aria-label', '所选文件的 Git Diff');
  const diffLines = create('ol', 'dsh-review-diff-lines');
  diffScroll.append(diffLines);
  diff.append(diffHeader, diffScroll);
  content.append(files, diff);
  panel.append(content);

  const footer = create('footer', 'dsh-review-footer');
  const actions = create('div', 'dsh-review-actions');
  const acceptButton = create('button', 'dsh-review-button', '接受并暂存');
  acceptButton.type = 'button';
  acceptButton.dataset.action = 'accept';
  const rejectButton = create('button', 'dsh-review-button', '拒绝并恢复');
  rejectButton.type = 'button';
  rejectButton.dataset.action = 'reject';
  const acceptAllButton = create('button', 'dsh-review-button', '全部接受');
  acceptAllButton.type = 'button';
  acceptAllButton.dataset.action = 'accept';
  const rejectAllButton = create('button', 'dsh-review-button', '全部拒绝');
  rejectAllButton.type = 'button';
  rejectAllButton.dataset.action = 'reject';
  actions.append(acceptButton, rejectButton, acceptAllButton, rejectAllButton);
  const live = create('p', 'dsh-review-live', '仅处理当前工作区，拒绝操作恢复到 Git 暂存基线。');
  live.setAttribute('aria-live', 'polite');
  footer.append(actions, live);
  panel.append(footer);
  document.body.append(panel);

  let layout = { ...bootstrap };
  let diagnostics = {};
  let selectedPath = '';
  let selectedItem = null;
  let changeSignature = '';
  let diffRequest = 0;
  let busy = false;

  const setLive = (message) => { live.textContent = message; };
  const applyLayout = (next = {}) => {
    const width = Math.min(520, Math.max(280, Math.round(Number(next.reviewPanelWidth) || 340)));
    layout = { reviewPanelOpen: next.reviewPanelOpen !== false, reviewPanelWidth: width };
    document.documentElement.style.setProperty('--dsh-review-width', `${width}px`);
    document.documentElement.dataset.dshReviewOpen = String(layout.reviewPanelOpen);
    resizer.setAttribute('aria-valuenow', String(width));
    panel.setAttribute('aria-hidden', String(!layout.reviewPanelOpen));
    panel.inert = !layout.reviewPanelOpen;
  };

  const renderDiffLines = (contentValue, message) => {
    diffLines.replaceChildren();
    const text = String(contentValue || '');
    if (!text) {
      const line = create('li', 'dsh-review-diff-line', message || '暂无可显示的 Diff。');
      line.dataset.kind = 'meta';
      diffLines.append(line);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const value of text.split('\n')) {
      const line = create('li', 'dsh-review-diff-line', value || ' ');
      line.dataset.kind = kindForLine(value);
      fragment.append(line);
    }
    diffLines.append(fragment);
  };

  const loadDiff = async () => {
    const request = ++diffRequest;
    if (!selectedPath) {
      diffPath.textContent = '未选择文件';
      diffNote.textContent = '选择文件后显示有界 Git Diff';
      renderDiffLines('', '暂无 Git 变更。');
      return;
    }
    diffPath.textContent = selectedPath;
    diffPath.title = selectedPath;
    diffNote.textContent = '正在读取 Git Diff…';
    renderDiffLines('', '正在读取…');
    const result = await api.changes.getDiff(selectedPath);
    if (request !== diffRequest) return;
    if (!result?.available) {
      diffNote.textContent = result?.reason === 'no-diff' ? '当前文件没有可显示的差异' : '无法安全读取 Diff';
      renderDiffLines('', result?.reason === 'no-diff' ? '当前文件没有可显示的差异。' : 'Diff 读取失败，请刷新后重试。');
      return;
    }
    const notes = [labelForStatus(result.status)];
    if (result.binary) notes.push('二进制');
    if (result.truncated) notes.push('已截断');
    diffNote.textContent = notes.join(' · ');
    renderDiffLines(result.content);
  };

  const updateActionState = () => {
    const agent = diagnostics.agent || {};
    const idle = !agent.canStop && agent.status !== 'waiting' && !busy;
    acceptButton.disabled = !idle || !selectedItem?.canAccept;
    rejectButton.disabled = !idle || !selectedItem?.canReject;
    const changes = diagnostics.changes || {};
    acceptAllButton.disabled = !idle || !(changes.canAcceptCount > 0);
    rejectAllButton.disabled = !idle || !(changes.canRejectCount > 0);
  };

  const selectPath = (pathValue) => {
    selectedPath = pathValue;
    selectedItem = (diagnostics.changes?.items || []).find((item) => item.path === selectedPath) || null;
    for (const button of files.querySelectorAll('.dsh-review-file')) {
      button.setAttribute('aria-selected', String(button.dataset.path === selectedPath));
    }
    updateActionState();
    void loadDiff();
  };

  const renderChanges = (next = {}) => {
    diagnostics = next;
    const changes = diagnostics.changes || {};
    const items = Array.isArray(changes.items) ? changes.items : [];
    const signature = JSON.stringify([
      changes.total,
      changes.pendingCount,
      changes.protectedCount,
      changes.acceptedCount,
      changes.truncated,
      items.map((item) => [item.path, item.status, item.canAccept, item.canReject])
    ]);
    summary.textContent = changes.total > 0
      ? `${changes.total}${changes.truncated ? '+' : ''} 个 · 待审 ${changes.pendingCount || 0} · 保护 ${changes.protectedCount || 0} · 已接受 ${changes.acceptedCount || 0}`
      : '暂无 Git 变更';
    if (signature !== changeSignature) {
      changeSignature = signature;
      files.replaceChildren();
      if (items.length === 0) {
        const empty = create('div', 'dsh-review-empty');
        empty.append(create('strong', '', '暂无 Git 变更'), create('p', '', 'Agent 修改文件后会自动出现在这里。'));
        files.append(empty);
        selectedPath = '';
        selectedItem = null;
      } else {
        if (!items.some((item) => item.path === selectedPath)) {
          selectedPath = (items.find((item) => item.status === 'pending') || items[0]).path;
        }
        const fragment = document.createDocumentFragment();
        for (const item of items) {
          const button = create('button', 'dsh-review-file');
          button.type = 'button';
          button.dataset.path = item.path;
          button.dataset.status = item.status;
          button.setAttribute('role', 'option');
          button.setAttribute('aria-selected', String(item.path === selectedPath));
          button.title = item.path;
          button.append(
            create('span', 'dsh-review-file-mark', markForStatus(item.status, item.untracked)),
            create('span', 'dsh-review-file-path', item.path),
            create('span', 'dsh-review-file-state', labelForStatus(item.status))
          );
          button.addEventListener('click', () => selectPath(item.path));
          fragment.append(button);
        }
        files.append(fragment);
        selectedItem = items.find((item) => item.path === selectedPath) || null;
      }
      void loadDiff();
    } else {
      selectedItem = items.find((item) => item.path === selectedPath) || null;
    }
    updateActionState();
  };

  const runAction = async (action, all = false) => {
    if (busy) return;
    busy = true;
    updateActionState();
    setLive(all ? `正在准备${action === 'accept' ? '批量接受' : '批量拒绝'}…` : '正在等待确认…');
    try {
      const result = all
        ? action === 'accept' ? await api.changes.acceptAll() : await api.changes.rejectAll()
        : action === 'accept' ? await api.changes.accept(selectedPath) : await api.changes.reject(selectedPath);
      setLive(result?.ok ? '操作已完成，Git 状态已刷新。' : '操作已取消或未执行。');
      renderChanges(result?.diagnostics || await api.diagnostics.getState());
    } catch {
      setLive('操作失败；没有绕过桌面安全门禁。');
    } finally {
      busy = false;
      updateActionState();
    }
  };

  refreshButton.addEventListener('click', async () => {
    refreshButton.disabled = true;
    setLive('正在刷新 Git 状态…');
    try {
      renderChanges(await api.changes.refresh());
      setLive('Git 状态已刷新。');
    } finally {
      refreshButton.disabled = false;
    }
  });
  closeButton.addEventListener('click', async () => {
    const next = await api.workbench.setReviewPanelOpen(false);
    applyLayout(next);
  });
  acceptButton.addEventListener('click', () => void runAction('accept'));
  rejectButton.addEventListener('click', () => void runAction('reject'));
  acceptAllButton.addEventListener('click', () => void runAction('accept', true));
  rejectAllButton.addEventListener('click', () => void runAction('reject', true));

  let dragStartWidth = 0;
  let dragStartX = 0;
  resizer.addEventListener('pointerdown', (event) => {
    dragStartWidth = layout.reviewPanelWidth;
    dragStartX = event.clientX;
    resizer.dataset.dragging = 'true';
    resizer.setPointerCapture(event.pointerId);
  });
  resizer.addEventListener('pointermove', (event) => {
    if (resizer.dataset.dragging !== 'true') return;
    applyLayout({ ...layout, reviewPanelWidth: dragStartWidth + dragStartX - event.clientX });
  });
  resizer.addEventListener('pointerup', async (event) => {
    if (resizer.dataset.dragging !== 'true') return;
    delete resizer.dataset.dragging;
    resizer.releasePointerCapture(event.pointerId);
    applyLayout(await api.workbench.setReviewPanelWidth(layout.reviewPanelWidth));
  });
  resizer.addEventListener('keydown', async (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = event.key === 'Home' ? 280
      : event.key === 'End' ? 520
        : layout.reviewPanelWidth + (event.key === 'ArrowLeft' ? 12 : -12);
    applyLayout(await api.workbench.setReviewPanelWidth(width));
  });

  window.__DSH_WORKBENCH__ = Object.freeze({
    applyLayout,
    focus: () => {
      if (!layout.reviewPanelOpen) return false;
      (files.querySelector('[aria-selected="true"]') || refreshButton).focus();
      return true;
    }
  });
  applyLayout(bootstrap);
  void api.diagnostics.getState().then(renderChanges);
  api.diagnostics.onState(renderChanges);
  return true;
})();
