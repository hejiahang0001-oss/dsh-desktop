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
    conflict: '冲突待解决',
    unavailable: '只读'
  }[status] || '未知');
  const markForStatus = (status, untracked) => {
    if (status === 'conflict') return '!';
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

  const scopeControls = create('div', 'dsh-review-scopes');
  const scopeSelect = create('select');
  scopeSelect.setAttribute('aria-label', '审查范围');
  for (const [value, text] of Object.entries({ unstaged: '未暂存（含新文件）', staged: '已暂存', branch: '当前分支提交', 'last-turn': '上一回合以来' })) {
    const option = create('option', '', text); option.value = value; scopeSelect.append(option);
  }
  const baseSelect = create('select'); baseSelect.setAttribute('aria-label', '基准分支'); baseSelect.hidden = true;
  scopeControls.append(scopeSelect, baseSelect); panel.append(scopeControls);

  const content = create('div', 'dsh-review-content');
  const files = create('div', 'dsh-review-files');
  files.setAttribute('role', 'listbox');
  files.setAttribute('aria-label', 'Git 变更文件');
  const diff = create('section', 'dsh-review-diff');
  diff.setAttribute('aria-labelledby', 'dsh-review-diff-path');
  const diffHeader = create('div', 'dsh-review-diff-header');
  const diffIdentity = create('div', 'dsh-review-diff-identity');
  const diffPath = create('span', 'dsh-review-diff-path', '未选择文件');
  diffPath.id = 'dsh-review-diff-path';
  const diffNote = create('span', 'dsh-review-diff-note', '选择文件后显示有界 Git Diff');
  diffIdentity.append(diffPath, diffNote);
  const revealFileButton = create('button', 'dsh-review-view-file', '查看文件');
  revealFileButton.type = 'button';
  revealFileButton.disabled = true;
  revealFileButton.title = '在工作区文件中定位并只读查看';
  diffHeader.append(diffIdentity, revealFileButton);
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
  const commentsPanel = create('details', 'dsh-review-comments');
  const commentsSummary = create('summary', '', '审查批注（0）');
  const commentsList = create('div');
  const commentForm = create('div'); commentForm.hidden = true;
  const commentLabel = create('label', '', '所选行批注'); commentLabel.htmlFor = 'dsh-review-comment-text';
  const commentText = create('textarea'); commentText.id = commentLabel.htmlFor; commentText.maxLength = 2000; commentText.rows = 2;
  const saveComment = create('button', 'dsh-review-button', '保存批注'); saveComment.type = 'button';
  const cancelComment = create('button', 'dsh-review-button', '取消'); cancelComment.type = 'button';
  commentForm.append(commentLabel, commentText, saveComment, cancelComment);
  const sendComments = create('button', 'dsh-review-button', '将批注放入输入框'); sendComments.type = 'button'; sendComments.disabled = true;
  commentsPanel.append(commentsSummary, commentsList, commentForm, sendComments);
  footer.append(actions, commentsPanel, live);
  panel.append(footer);
  document.body.append(panel);

  let layout = { ...bootstrap };
  let diagnostics = {};
  let selectedPath = '';
  let selectedItem = null;
  let changeSignature = '';
  let diffRequest = 0;
  let busy = false;
  let scopeView = null, currentDiff = null, commentAnchor = null, editingCommentId = null;
  let scopeRequest = 0, lastScopeRefresh = 0, lastContext = '';

  const setLive = (message) => { live.textContent = message; };
  const reviewStateOf = (changes = {}) => changes.reviewState || ({
    'no-change': 'clean',
    ready: 'changes',
    'git-unavailable': 'git-unavailable',
    'not-a-git-repository': 'not-a-git-repository',
    'git-status-failed': 'status-read-failed'
  }[changes.reason] || 'not-initialized');
  const copyForReviewState = (state) => ({
    changes: ['Git 变更', '选择文件后可查看有界 Diff，并按安全门禁接受或拒绝。'],
    clean: ['仓库干净', '已成功读取 Git 状态，当前没有待审、受保护或已接受的变更。'],
    'git-unavailable': ['Git 不可用', '未检测到 Git。对话、Office、Wiki、文件查看和终端仍可使用。'],
    'not-a-git-repository': ['当前目录不是 Git 仓库', 'Git 审查动作已关闭；其他工作台能力仍可使用。'],
    'status-read-failed': ['Git 状态读取失败', '未将读取失败误判为仓库干净。请检查 Git 后刷新；其他工作台能力仍可使用。'],
    'not-initialized': ['Git 审查尚未初始化', '工作台就绪后可刷新状态。']
  }[state] || ['Git 状态不可用', 'Git 审查动作已关闭；其他工作台能力仍可使用。']);
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
    for (const [index, value] of text.split('\n').entries()) {
      const line = create('li', 'dsh-review-diff-line', value || ' ');
      line.dataset.kind = kindForLine(value);
      const anchor = currentDiff?.lines?.[index];
      if (anchor?.line && !currentDiff.binary) {
        line.dataset.kind = value.startsWith('+') ? 'add' : value.startsWith('-') ? 'delete' : 'context';
        line.dataset.sourceLine = anchor.line; line.dataset.side = anchor.side;
        const button = create('button', 'dsh-review-line-comment', '+'); button.type = 'button';
        button.setAttribute('aria-label', `评论${anchor.side === 'old' ? '删除侧' : '新侧'}第 ${anchor.line} 行`);
        button.addEventListener('click', () => {
          commentAnchor = { token: scopeView.token, file: selectedPath, fingerprint: currentDiff.fingerprint, index };
          editingCommentId = null; commentText.value = ''; commentLabel.textContent = `${selectedPath}:${anchor.line} 批注`;
          commentForm.hidden = false; commentsPanel.open = true; commentText.focus();
        });
        line.prepend(button);
      }
      fragment.append(line);
    }
    diffLines.append(fragment);
  };

  const loadDiff = async () => {
    const request = ++diffRequest;
    currentDiff = null;
    if (!selectedPath) {
      diffPath.textContent = '未选择文件';
      diffNote.textContent = '选择文件后显示有界 Git Diff';
      renderDiffLines('', '当前没有可审查文件。');
      return;
    }
    diffPath.textContent = selectedPath;
    diffPath.title = selectedPath;
    diffNote.textContent = '正在读取 Git Diff…';
    renderDiffLines('', '正在读取…');
    let result;
    try { result = api.reviews && scopeView?.token ? await api.reviews.diff({ token: scopeView.token, file: selectedPath }) : await api.changes.getDiff(selectedPath); }
    catch (error) { if (request === diffRequest) { diffNote.textContent = '差异读取失败'; renderDiffLines('', error.message || '请刷新后重试。'); } return; }
    if (request !== diffRequest) return;
    if (!result?.available) {
      diffNote.textContent = result?.reason === 'no-diff' ? '当前文件没有可显示的差异' : '无法安全读取 Diff';
      renderDiffLines('', result?.reason === 'no-diff' ? '当前文件没有可显示的差异。' : 'Diff 读取失败，请刷新后重试。');
      return;
    }
    currentDiff = result;
    const notes = [scopeView?.label || labelForStatus(result.status)];
    if (selectedItem?.status === 'conflict') notes.push('合并冲突，先解决后再接受');
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
    revealFileButton.disabled = !selectedPath;
    actions.hidden = Boolean(api.reviews && scopeSelect.value !== 'unstaged');
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
    const reviewState = reviewStateOf(changes);
    const [emptyTitle, emptyDetail] = copyForReviewState(reviewState);
    const signature = JSON.stringify([
      reviewState,
      changes.reason,
      changes.total,
      changes.pendingCount,
      changes.protectedCount,
      changes.acceptedCount,
      changes.truncated,
      items.map((item) => [item.path, item.status, item.canAccept, item.canReject])
    ]);
    summary.textContent = reviewState === 'changes' && changes.total > 0
      ? `${changes.total}${changes.truncated ? '+' : ''} 个 · 待审 ${changes.pendingCount || 0} · 保护 ${changes.protectedCount || 0} · 已接受 ${changes.acceptedCount || 0}`
      : emptyTitle;
    if (signature !== changeSignature) {
      changeSignature = signature;
      files.replaceChildren();
      if (items.length === 0) {
        const empty = create('div', 'dsh-review-empty');
        empty.dataset.state = reviewState;
        empty.append(create('strong', '', emptyTitle), create('p', '', emptyDetail));
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
      if (!api.reviews) void loadDiff();
    } else {
      selectedItem = items.find((item) => item.path === selectedPath) || null;
    }
    updateActionState();
  };

  const renderComments = async () => {
    if (!api.reviews) return;
    const context = scopeView?.context;
    const comments = await api.reviews.listComments();
    if (context !== scopeView?.context) return;
    commentsList.replaceChildren(); commentsSummary.textContent = `审查批注（${comments.length}）`; sendComments.disabled = comments.length === 0;
    for (const comment of comments) {
      const item = create('div', 'dsh-review-comment');
      item.append(create('strong', '', `${comment.file}:${comment.line}`), create('p', '', comment.body));
      const edit = create('button', 'dsh-review-button', '编辑'); edit.type = 'button';
      const remove = create('button', 'dsh-review-button', '删除'); remove.type = 'button';
      edit.addEventListener('click', async () => {
        try {
          const view = await api.reviews.list({ scope: comment.scope, base: comment.base });
          const diffValue = await api.reviews.diff({ token: view.token, file: comment.file });
          if (diffValue.fingerprint !== comment.fingerprint) throw new Error('文件已变化，请删除旧批注后重新选行。');
          commentAnchor = { token: view.token, file: comment.file, fingerprint: comment.fingerprint, index: comment.index };
          editingCommentId = comment.id; commentText.value = comment.body; commentLabel.textContent = `${comment.file}:${comment.line} 批注`;
          commentForm.hidden = false; commentText.focus();
        } catch (error) { setLive(error.message); }
      });
      remove.addEventListener('click', async () => { try { await api.reviews.removeComment(comment.id); await renderComments(); } catch (error) { setLive(error.message); } });
      item.append(edit, remove); commentsList.append(item);
    }
  };

  const refreshScope = async (next = diagnostics) => {
    if (!api.reviews) { renderChanges(next); return; }
    const request = ++scopeRequest;
    lastScopeRefresh = Date.now();
    try {
      const view = await api.reviews.list({ scope: scopeSelect.value, base: baseSelect.value });
      if (request !== scopeRequest) return;
      if (lastContext && lastContext !== view.context) { selectedPath = ''; commentForm.hidden = true; commentAnchor = null; }
      lastContext = view.context; scopeView = view; lastScopeRefresh = Date.now();
      baseSelect.hidden = scopeSelect.value !== 'branch';
      baseSelect.replaceChildren();
      for (const branch of view.baseChoices || []) { const option = create('option', '', branch); option.value = branch; baseSelect.append(option); }
      if (view.base) baseSelect.value = view.base;
      const items = view.items || [];
      const changes = { ...view, reviewState: view.available ? items.length ? 'changes' : 'clean' : next.changes?.reviewState,
        pendingCount: items.filter((item) => item.status === 'pending').length, protectedCount: items.filter((item) => item.protected).length,
        canAcceptCount: items.filter((item) => item.canAccept && !item.protected).length, canRejectCount: items.filter((item) => item.canReject).length };
      renderChanges({ ...next, changes });
      summary.textContent = view.available ? `${view.label} · ${items.length}${view.truncated ? '+' : ''} 个文件` : view.message || summary.textContent;
      if (!view.available) renderDiffLines('', view.message || copyForReviewState(reviewStateOf(changes))[1]);
      else await loadDiff();
      await renderComments();
    } catch (error) {
      if (request !== scopeRequest) return;
      scopeView = null; selectedPath = ''; selectedItem = null; currentDiff = null; ++diffRequest;
      commentAnchor = null; commentForm.hidden = true; commentsList.replaceChildren(); commentsSummary.textContent = '审查批注（未就绪）'; sendComments.disabled = true;
      renderChanges({ ...next, changes: { reviewState: 'status-read-failed', items: [] } });
      setLive(error.message || '审查读取失败，请刷新后重试。');
    }
  };
  scopeSelect.addEventListener('change', () => { baseSelect.replaceChildren(); changeSignature = ''; commentForm.hidden = true; void refreshScope(); });
  baseSelect.addEventListener('change', () => { changeSignature = ''; void refreshScope(); });
  cancelComment.addEventListener('click', () => { commentForm.hidden = true; commentAnchor = null; diffScroll.focus(); });
  commentText.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); cancelComment.click(); } });
  saveComment.addEventListener('click', async () => {
    if (!commentAnchor) return;
    saveComment.disabled = true;
    try { await api.reviews.addComment({ ...commentAnchor, body: commentText.value, id: editingCommentId }); commentForm.hidden = true; await renderComments(); setLive('批注已保存，尚未发送给 AI。'); }
    catch (error) { setLive(error.message); }
    finally { saveComment.disabled = false; }
  });
  sendComments.addEventListener('click', async () => {
    const selection = localStorage.getItem('dsh.sessions.current'); sendComments.disabled = true;
    try {
      const result = await api.reviews.prompt();
      const state = await api.documents.getState();
      if (state.context !== result.context || selection !== localStorage.getItem('dsh.sessions.current')) throw new Error('会话已切换，请回到原会话重试。');
      const bridge = window.__DSH_COMPOSER_TEXT__;
      await bridge.append(bridge.current(), result.text, () => selection === localStorage.getItem('dsh.sessions.current'));
      setLive('批注已放入输入框，请确认后发送。');
    } catch (error) { setLive(error.message || '无法放入输入框，请重试。'); }
    finally { sendComments.disabled = false; }
  });

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
      await refreshScope(result?.diagnostics || await api.diagnostics.getState());
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
      const next = await api.changes.refresh();
      await refreshScope(next);
      const state = reviewStateOf(next?.changes || {});
      setLive(state === 'status-read-failed' ? 'Git 状态读取失败；未执行任何修改。' : 'Git 状态已刷新。');
    } catch {
      setLive('Git 状态刷新失败；未执行任何修改。');
    } finally {
      refreshButton.disabled = false;
    }
  });
  closeButton.addEventListener('click', async () => {
    const next = await api.workbench.setReviewPanelOpen(false);
    applyLayout(next);
    window.__DSH_COMPOSER_TEXT__?.current()?.focus({ preventScroll: true });
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && commentForm.hidden) { event.preventDefault(); closeButton.click(); }
  });
  acceptButton.addEventListener('click', () => void runAction('accept'));
  rejectButton.addEventListener('click', () => void runAction('reject'));
  acceptAllButton.addEventListener('click', () => void runAction('accept', true));
  rejectAllButton.addEventListener('click', () => void runAction('reject', true));
  revealFileButton.addEventListener('click', async () => {
    if (!selectedPath) return;
    const revealed = await window.__DSH_FILES__?.reveal?.(selectedPath);
    if (!revealed) setLive('无法在工作区文件中定位该路径。');
  });

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
  void api.diagnostics.getState().then(refreshScope);
  api.diagnostics.onState((next) => {
    diagnostics.agent = next.agent;
    updateActionState();
    if (Date.now() - lastScopeRefresh > 2000 && !commentForm.contains(document.activeElement)) void refreshScope(next);
  });
  return true;
})();
