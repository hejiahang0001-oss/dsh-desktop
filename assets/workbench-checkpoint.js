(() => {
  const api = window.desktopAPI;
  if (!api?.checkpoints || !api?.diagnostics) return false;
  if (window.__DSH_CHECKPOINTS__) return true;

  const visible = (node) => Boolean(node && !node.hidden && node.getClientRects().length);
  const isComposer = (node) => {
    if (!(node instanceof HTMLElement) || node.closest('[id^="dsh-"]')) return false;
    const editable = node.matches('textarea, [contenteditable="true"]');
    if (!editable || !visible(node)) return false;
    const hint = `${node.getAttribute('placeholder') || ''} ${node.getAttribute('data-placeholder') || ''}`;
    return /描述|构建|消息|ask|message|prompt/i.test(hint) || node.tagName === 'TEXTAREA';
  };
  const composers = () => [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(isComposer);
  const findComposerForButton = (button) => {
    const form = button?.closest('form');
    if (form) return composers().find((node) => node.closest('form') === form) || null;
    return null;
  };
  const isSendButton = (button) => {
    if (!(button instanceof HTMLButtonElement) || !visible(button) || button.closest('[id^="dsh-"]')) return false;
    const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.textContent || ''}`;
    return /发送|send|submit/i.test(label) || (button.type === 'submit' && Boolean(findComposerForButton(button)));
  };
  const findSendButton = (composer) => {
    const form = composer?.closest('form');
    if (form) {
      const submit = [...form.querySelectorAll('button')].find((button) => isSendButton(button));
      if (submit) return submit;
    }
    return [...document.querySelectorAll('button')].find((button) => isSendButton(button)) || null;
  };

  const toast = document.createElement('div');
  toast.id = 'dsh-checkpoint-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.hidden = true;
  document.body.append(toast);

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const historyBackdrop = create('div', 'dsh-checkpoint-history-backdrop');
  historyBackdrop.hidden = true;
  const historyDialog = create('section', 'dsh-checkpoint-history-dialog');
  historyDialog.setAttribute('role', 'dialog');
  historyDialog.setAttribute('aria-modal', 'true');
  historyDialog.setAttribute('aria-labelledby', 'dsh-checkpoint-history-title');
  historyDialog.setAttribute('aria-describedby', 'dsh-checkpoint-history-description');
  const historyHeader = create('header', 'dsh-checkpoint-history-header');
  const historyHeading = create('div', 'dsh-checkpoint-history-heading');
  const historyTitle = create('h2', '', '代码检查点');
  historyTitle.id = 'dsh-checkpoint-history-title';
  const historyDescription = create('p', '', '选择本地安全点后，可只恢复代码，或从已关联的完整回合建立新会话分支。');
  historyDescription.id = 'dsh-checkpoint-history-description';
  historyHeading.append(historyTitle, historyDescription);
  const historyClose = create('button', 'dsh-checkpoint-history-close', '关闭');
  historyClose.type = 'button';
  historyClose.setAttribute('aria-label', '关闭代码检查点历史');
  historyHeader.append(historyHeading, historyClose);
  const historyStatus = create('p', 'dsh-checkpoint-history-status', '正在核对本地检查点…');
  historyStatus.setAttribute('role', 'status');
  historyStatus.setAttribute('aria-live', 'polite');
  const historyList = create('div', 'dsh-checkpoint-history-list');
  historyList.setAttribute('role', 'listbox');
  historyList.setAttribute('aria-label', '最近代码检查点');
  const historyFooter = create('footer', 'dsh-checkpoint-history-footer');
  const historyHint = create('span', 'dsh-checkpoint-history-hint', '↑↓ 选择 · Enter 只恢复代码 · Esc 关闭');
  const historyActions = create('div', 'dsh-checkpoint-history-actions');
  const historyCancel = create('button', 'dsh-checkpoint-history-button', '取消');
  historyCancel.type = 'button';
  const historyFork = create('button', 'dsh-checkpoint-history-button', '建立会话分支…');
  historyFork.type = 'button';
  historyFork.disabled = true;
  const historyRestore = create('button', 'dsh-checkpoint-history-button dsh-checkpoint-history-primary', '只恢复代码…');
  historyRestore.type = 'button';
  historyRestore.disabled = true;
  historyActions.append(historyCancel, historyFork, historyRestore);
  historyFooter.append(historyHint, historyActions);
  historyDialog.append(historyHeader, historyStatus, historyList, historyFooter);
  historyBackdrop.append(historyDialog);
  document.body.append(historyBackdrop);

  let toastTimer = null;
  let armed = false;
  let creating = null;
  let replaying = false;
  let agentWasBusy = false;
  let historyItems = [];
  let historyIndex = -1;
  let historyPreviousFocus = null;
  let historyBusy = false;
  let historyLoadSequence = 0;

  const show = (message, tone = 'neutral') => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
  };
  const showState = (state) => {
    if (state?.forked) {
      show('已建立并切换到新的 Harness 会话分支；当前代码未改变', 'success');
    } else if (state?.restored) {
      const date = new Date(state.restoredTo?.createdAt || '');
      const time = Number.isNaN(date.getTime()) ? '最近检查点' : date.toLocaleTimeString('zh-CN', { hour12: false });
      show(`已恢复到代码检查点 · ${time}；恢复前安全点已保留`, 'success');
    } else if (state?.restoreReason) {
      show(state.rolledBack ? '恢复未完成，已自动回到恢复前状态。' : '无法安全恢复代码检查点。', 'error');
    } else if (state?.created) {
      const date = new Date(state.last?.createdAt || '');
      const time = Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleTimeString('zh-CN', { hour12: false });
      const excluded = state.last?.sensitiveExcludedCount
        ? `；已排除 ${state.last.sensitiveExcludedCount} 个敏感路径`
        : '';
      show(`代码检查点已建立 · ${time}${excluded}`, 'success');
    } else if (state?.unchanged) {
      const selected = state.preview?.targetId && state.preview.targetId !== state.last?.id;
      show(selected ? '当前代码和 Git 索引已与所选检查点一致。' : '代码未变化，沿用最近检查点。');
    } else if (state?.error) {
      show(state.error, 'error');
    } else if (state && !state.available && state.requestSource !== 'automatic') {
      show(state.reason === 'workspace-is-subdirectory' ? '请打开 Git 仓库根目录以启用检查点。' : '当前工作区暂不可建立 Git 检查点。', 'warning');
    }
    return state;
  };
  const sourceLabel = (source) => ({
    automatic: '自动',
    manual: '手动',
    safety: '恢复前安全点'
  }[source] || '未知来源');
  const timeLabel = (value) => {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime())
      ? '时间未知'
      : date.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
  };
  const impactLabel = (item) => {
    if (!item.available) return item.reason === 'too-many-paths' ? '超过 500 个路径，不能恢复' : '检查点对象无法安全核验';
    if (item.unchanged) return '与当前代码和 Git 索引一致';
    const parts = [`${item.affectedCount} 个代码路径`];
    if (item.indexWillChange) parts.push('恢复 Git 索引');
    if (item.untrackedTrashCount) parts.push(`${item.untrackedTrashCount} 个新文件进回收站`);
    if (item.sensitiveExcludedCount) parts.push(`${item.sensitiveExcludedCount} 个敏感路径保持不变`);
    return parts.join(' · ');
  };
  const conversationLabel = (item) => {
    if (item.conversationForkAvailable) return '已关联 Harness 完整回合；可建立新会话分支';
    if (item.conversationLinked) return '已关联 Harness 会话，但建立时尚无已完成回合';
    return '未关联 Harness 回合；仅可恢复代码';
  };
  const historyOptions = () => [...historyList.querySelectorAll('[role="option"]')];
  const selectHistory = (index, { focus = false } = {}) => {
    if (historyItems.length === 0) return false;
    historyIndex = (index + historyItems.length) % historyItems.length;
    historyOptions().forEach((option, optionIndex) => option.setAttribute('aria-selected', String(optionIndex === historyIndex)));
    const selected = historyItems[historyIndex];
    historyRestore.disabled = historyBusy || !selected?.available;
    historyFork.disabled = historyBusy || !selected?.conversationForkAvailable;
    const option = historyOptions()[historyIndex];
    if (option) {
      option.scrollIntoView({ block: 'nearest' });
      if (focus) option.focus();
    }
    return true;
  };
  const renderHistory = (result) => {
    historyList.replaceChildren();
    historyItems = Array.isArray(result?.items) ? result.items.slice(0, 12) : [];
    if (!result?.available) {
      historyStatus.textContent = result?.reason === 'checkpoint-busy'
        ? '代码检查点正在建立，请稍后重试。'
        : '当前无法读取代码检查点历史。';
      historyIndex = -1;
      historyRestore.disabled = true;
      historyFork.disabled = true;
      return;
    }
    if (historyItems.length === 0) {
      historyStatus.textContent = '当前仓库还没有可用的代码检查点。';
      historyIndex = -1;
      historyRestore.disabled = true;
      historyFork.disabled = true;
      return;
    }
    historyStatus.textContent = [
      `已核对最近 ${historyItems.length} 个本地检查点。`,
      result.truncated ? '仅显示最近 12 个。' : '',
      result.invalidCount ? `已忽略 ${result.invalidCount} 个无效私有引用。` : ''
    ].filter(Boolean).join(' ');
    historyItems.forEach((item, index) => {
      const option = create('button', 'dsh-checkpoint-history-option');
      option.type = 'button';
      option.id = `dsh-checkpoint-history-${item.id}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.setAttribute('aria-disabled', String(!item.available));
      const row = create('span', 'dsh-checkpoint-history-row');
      const title = create('strong', '', timeLabel(item.createdAt));
      const badges = create('span', 'dsh-checkpoint-history-badges');
      badges.append(create('span', 'dsh-checkpoint-history-badge', sourceLabel(item.source)));
      if (item.isLatest) badges.append(create('span', 'dsh-checkpoint-history-badge is-latest', '最近'));
      if (item.conversationForkAvailable) badges.append(create('span', 'dsh-checkpoint-history-badge is-conversation', '会话回合'));
      row.append(title, badges);
      option.append(
        row,
        create('small', '', impactLabel(item)),
        create('small', 'dsh-checkpoint-history-conversation', conversationLabel(item))
      );
      option.addEventListener('pointermove', () => selectHistory(index));
      option.addEventListener('focus', () => selectHistory(index));
      option.addEventListener('click', () => selectHistory(index));
      historyList.append(option);
    });
    const initial = Math.max(0, historyItems.findIndex((item) => item.available));
    selectHistory(initial);
  };
  const closeHistory = ({ restoreFocus = true } = {}) => {
    if (historyBackdrop.hidden || historyBusy) return false;
    historyBackdrop.hidden = true;
    historyBackdrop.inert = true;
    delete document.documentElement.dataset.dshCheckpointHistoryOpen;
    historyLoadSequence += 1;
    if (restoreFocus && historyPreviousFocus?.isConnected) historyPreviousFocus.focus();
    historyPreviousFocus = null;
    return true;
  };
  const loadHistory = async () => {
    const sequence = ++historyLoadSequence;
    historyStatus.textContent = '正在核对本地检查点…';
    historyList.replaceChildren();
    historyItems = [];
    historyIndex = -1;
    historyRestore.disabled = true;
    historyFork.disabled = true;
    try {
      const result = await api.checkpoints.listHistory();
      if (sequence !== historyLoadSequence || historyBackdrop.hidden) return;
      renderHistory(result);
      const option = historyOptions()[historyIndex];
      (option || historyClose).focus();
    } catch {
      if (sequence === historyLoadSequence && !historyBackdrop.hidden) {
        renderHistory({ available: false, reason: 'history-failed', items: [] });
        historyClose.focus();
      }
    }
  };
  const openHistory = () => {
    if (!historyBackdrop.hidden) return true;
    historyPreviousFocus = document.activeElement;
    historyBackdrop.hidden = false;
    historyBackdrop.inert = false;
    document.documentElement.dataset.dshCheckpointHistoryOpen = 'true';
    historyClose.focus();
    void loadHistory();
    return true;
  };
  const restoreSelected = async () => {
    const selected = historyItems[historyIndex];
    if (historyBusy || !selected?.available) return false;
    historyBusy = true;
    historyRestore.disabled = true;
    historyFork.disabled = true;
    historyCancel.disabled = true;
    historyClose.disabled = true;
    historyStatus.textContent = '正在打开恢复确认…';
    try {
      const state = await api.checkpoints.restore(selected.id);
      showState(state);
      if (state?.restored) {
        historyBusy = false;
        historyCancel.disabled = false;
        historyClose.disabled = false;
        closeHistory();
      } else {
        historyStatus.textContent = state?.unchanged ? '当前状态已与所选检查点一致。' : '恢复未执行，可继续选择其他检查点。';
      }
      return Boolean(state?.restored);
    } catch {
      historyStatus.textContent = '无法打开恢复确认，请稍后重试。';
      return false;
    } finally {
      historyBusy = false;
      historyCancel.disabled = false;
      historyClose.disabled = false;
      historyFork.disabled = !historyItems[historyIndex]?.conversationForkAvailable;
      historyRestore.disabled = !historyItems[historyIndex]?.available;
    }
  };
  const forkSelected = async () => {
    const selected = historyItems[historyIndex];
    if (historyBusy || !selected?.conversationForkAvailable) return false;
    historyBusy = true;
    historyRestore.disabled = true;
    historyFork.disabled = true;
    historyCancel.disabled = true;
    historyClose.disabled = true;
    historyStatus.textContent = '正在打开会话分支确认…';
    try {
      const state = await api.checkpoints.forkSession(selected.id);
      showState(state);
      if (!state?.forked) historyStatus.textContent = '会话分支未建立，可继续选择其他检查点。';
      return Boolean(state?.forked);
    } catch {
      historyStatus.textContent = '无法打开会话分支确认，请稍后重试。';
      return false;
    } finally {
      historyBusy = false;
      historyCancel.disabled = false;
      historyClose.disabled = false;
      historyFork.disabled = !historyItems[historyIndex]?.conversationForkAvailable;
      historyRestore.disabled = !historyItems[historyIndex]?.available;
    }
  };
  const ensureCheckpoint = () => {
    if (creating) return creating;
    if (!armed) return Promise.resolve(null);
    armed = false;
    creating = api.checkpoints.createAutomatic()
      .then(showState)
      .catch(() => show('无法建立代码检查点。', 'error'))
      .finally(() => { creating = null; });
    return creating;
  };
  const prepareSendCheckpoint = async () => {
    if (armed || creating) return ensureCheckpoint();
    try {
      const context = await api.checkpoints.matchesCurrentSession();
      if (context?.matches) return null;
    } catch { /* A failed context check falls back to a fresh code checkpoint. */ }
    armed = true;
    return ensureCheckpoint();
  };
  const resumeButton = async (button) => {
    await prepareSendCheckpoint();
    if (!button?.isConnected) return;
    replaying = true;
    button.click();
    queueMicrotask(() => { replaying = false; });
  };

  document.addEventListener('pointerdown', (event) => {
    if (!isComposer(event.target)) return;
    if (!creating) armed = true;
    void ensureCheckpoint();
  }, true);
  document.addEventListener('input', (event) => {
    if (!isComposer(event.target)) return;
    if (!creating) armed = true;
    void ensureCheckpoint();
  }, true);
  document.addEventListener('click', (event) => {
    if (replaying) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!isSendButton(button)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void resumeButton(button);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (replaying || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || !isComposer(event.target)) return;
    const button = findSendButton(event.target);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void resumeButton(button);
  }, true);

  api.diagnostics.onState((state) => {
    const agent = state?.agent || {};
    const busy = agent.status === 'running' || agent.status === 'stopping' || agent.pendingCount > 0 || agent.activeToolCount > 0;
    if (agentWasBusy && !busy) armed = true;
    agentWasBusy = busy;
  });
  api.checkpoints.onState((state) => {
    if (state?.restored) armed = true;
    if (state?.status !== 'creating') showState(state);
  });

  historyClose.addEventListener('click', () => closeHistory());
  historyCancel.addEventListener('click', () => closeHistory());
  historyFork.addEventListener('click', () => { void forkSelected(); });
  historyRestore.addEventListener('click', () => { void restoreSelected(); });
  historyBackdrop.addEventListener('pointerdown', (event) => {
    if (event.target === historyBackdrop) closeHistory();
  });
  historyBackdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeHistory();
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && historyItems.length > 0) {
      event.preventDefault();
      selectHistory(historyIndex + (event.key === 'ArrowDown' ? 1 : -1), { focus: true });
    } else if (event.key === 'Enter' && document.activeElement?.matches?.('.dsh-checkpoint-history-option')) {
      event.preventDefault();
      void restoreSelected();
    } else if (event.key === 'Tab') {
      const focusable = [historyClose, ...historyOptions(), historyCancel, historyFork, historyRestore]
        .filter((node) => !node.disabled && node.getClientRects().length);
      const current = focusable.indexOf(document.activeElement);
      if (focusable.length && ((event.shiftKey && current <= 0) || (!event.shiftKey && current === focusable.length - 1))) {
        event.preventDefault();
        focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
      }
    }
  });

  window.__DSH_CHECKPOINTS__ = Object.freeze({
    create: () => ensureCheckpoint(),
    openHistory,
    closeHistory,
    restoreLatest: () => api.checkpoints.restoreLatest().then(showState),
    focus: () => { show('下一次 Agent 回合会先自动建立代码检查点。'); return true; },
    showState,
    rearm: () => { armed = true; return true; }
  });
  historyBackdrop.inert = true;
  const active = document.activeElement;
  if (isComposer(active)) void ensureCheckpoint();
  return true;
})();
