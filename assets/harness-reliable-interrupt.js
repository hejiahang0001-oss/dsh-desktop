(() => {
  if (window.__DSH_RELIABLE_INTERRUPT__) return true;

  const STATUS_ID = 'dsh-reliable-interrupt-status';
  const STOP_LABELS = ['停止生成', 'Stop generating'];
  const STEER_LABELS = ['插话发送', 'Steer queued message'];
  let pending = false;

  const normalized = (element) => (element?.getAttribute?.('aria-label') || element?.textContent || '').trim();
  const running = () => Array.from(document.querySelectorAll('button, [role="button"]'))
    .some((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true' && STOP_LABELS.includes(normalized(element)));

  const statusFor = (card) => {
    let status = document.getElementById(STATUS_ID);
    if (status) return status;
    status = document.createElement('div');
    status.id = STATUS_ID;
    status.className = 'dsh-reliable-interrupt-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    card.insertAdjacentElement('beforebegin', status);
    return status;
  };

  const showStatus = (card, message, state) => {
    const status = statusFor(card);
    status.textContent = message;
    status.dataset.state = state;
  };

  const safePlainTextDraft = (card, value) => {
    const prompt = value.trim();
    if (!prompt || prompt.length > 8000 || prompt.startsWith('/')) return false;
    if (card.querySelector('[data-decoration="chip"], [data-decoration="text-ref"]')) return false;
    if (card.querySelector('img')) return false;
    return true;
  };

  const clearIfUnchanged = (target, original) => {
    if (!target.isConnected || target.value !== original) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (typeof setter !== 'function') return false;
    setter.call(target, '');
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  const onKeyDown = async (event) => {
    if (pending || event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.altKey
      || !(event.ctrlKey || event.metaKey) || event.repeat || event.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || target.disabled || target.readOnly) return;
    const card = target.closest('[data-composer-card]');
    if (!(card instanceof HTMLElement) || !running() || !safePlainTextDraft(card, target.value)) return;
    const api = window.desktopAPI?.harness?.interruptAndPrompt;
    if (typeof api !== 'function') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const original = target.value;
    pending = true;
    card.dataset.dshInterruptPending = 'true';
    showStatus(card, '正在中断当前回合并发送插话…', 'pending');
    try {
      const receipt = await api(original);
      if (receipt?.accepted !== true) throw new Error(receipt?.message || 'Harness 未确认插话消息。');
      const cleared = clearIfUnchanged(target, original);
      showStatus(card, cleared ? receipt.message : `${receipt.message} 新输入的草稿已保留。`, 'success');
    } catch (error) {
      showStatus(card, error?.message || '插话发送失败，草稿已保留，请重试。', 'error');
    } finally {
      pending = false;
      delete card.dataset.dshInterruptPending;
      target.focus({ preventScroll: true });
    }
  };

  const onClick = async (event) => {
    if (pending || event.defaultPrevented) return;
    const control = event.target?.closest?.('button, [role="button"]');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true'
      || !STEER_LABELS.includes(normalized(control))) return;
    const card = document.querySelector('[data-composer-card]');
    const api = window.desktopAPI?.harness?.interruptQueued;
    if (!(card instanceof HTMLElement) || typeof api !== 'function') return;

    event.preventDefault();
    event.stopImmediatePropagation();
    pending = true;
    card.dataset.dshInterruptPending = 'true';
    showStatus(card, '正在中断当前回合并处理排队消息…', 'pending');
    try {
      const receipt = await api();
      if (receipt?.accepted !== true) throw new Error(receipt?.message || 'Harness 未确认排队消息。');
      showStatus(card, receipt.message, 'success');
    } catch (error) {
      showStatus(card, error?.message || '插话发送失败，排队消息仍保留。', 'error');
    } finally {
      pending = false;
      delete card.dataset.dshInterruptPending;
      card.querySelector('textarea:not([disabled])')?.focus({ preventScroll: true });
    }
  };

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onClick, true);
  window.__DSH_RELIABLE_INTERRUPT__ = Object.freeze({
    installed: true,
    isPending: () => pending,
    dispose: () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
    }
  });
  return true;
})();
