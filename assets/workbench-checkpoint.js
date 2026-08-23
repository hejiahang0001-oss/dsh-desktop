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
  let toastTimer = null;
  let armed = true;
  let creating = null;
  let replaying = false;
  let agentWasBusy = false;

  const show = (message, tone = 'neutral') => {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
  };
  const showState = (state) => {
    if (state?.restored) {
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
      show('代码未变化，沿用最近检查点。');
    } else if (state?.error) {
      show(state.error, 'error');
    } else if (state && !state.available) {
      show(state.reason === 'workspace-is-subdirectory' ? '请打开 Git 仓库根目录以启用检查点。' : '当前工作区暂不可建立 Git 检查点。', 'warning');
    }
    return state;
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
  const resumeButton = async (button) => {
    await ensureCheckpoint();
    if (!button?.isConnected) return;
    replaying = true;
    button.click();
    queueMicrotask(() => { replaying = false; });
  };

  document.addEventListener('focusin', (event) => {
    if (isComposer(event.target)) void ensureCheckpoint();
  }, true);
  document.addEventListener('input', (event) => {
    if (isComposer(event.target)) void ensureCheckpoint();
  }, true);
  document.addEventListener('click', (event) => {
    if (replaying) return;
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (!isSendButton(button) || (!armed && !creating)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void resumeButton(button);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (replaying || event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || !isComposer(event.target)) return;
    const button = findSendButton(event.target);
    if (!button || (!armed && !creating)) return;
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

  window.__DSH_CHECKPOINTS__ = Object.freeze({
    create: () => ensureCheckpoint(),
    restoreLatest: () => api.checkpoints.restoreLatest().then(showState),
    focus: () => { show('下一次 Agent 回合会先自动建立代码检查点。'); return true; },
    showState,
    rearm: () => { armed = true; return true; }
  });
  const active = document.activeElement;
  if (isComposer(active)) void ensureCheckpoint();
  return true;
})();
