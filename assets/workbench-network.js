(() => {
  const api = window.desktopAPI;
  if (!api?.network) return false;
  if (window.__DSH_NETWORK__) return true;

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };

  const backdrop = create('div', 'dsh-network-backdrop');
  backdrop.hidden = true;
  backdrop.inert = true;
  const dialog = create('section', 'dsh-network-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'dsh-network-title');
  dialog.setAttribute('aria-describedby', 'dsh-network-description');

  const header = create('header', 'dsh-network-header');
  const heading = create('div', 'dsh-network-heading');
  const title = create('h2', '', '网络与代理');
  title.id = 'dsh-network-title';
  const description = create('p', '', '配置 DeepSeek Harness 访问外部网络时使用的连接方式。');
  description.id = 'dsh-network-description';
  heading.append(title, description);
  const closeButton = create('button', 'dsh-network-close', '关闭');
  closeButton.type = 'button';
  header.append(heading, closeButton);

  const form = create('form', 'dsh-network-form');
  const methods = create('fieldset', 'dsh-network-methods');
  methods.append(create('legend', '', '连接方式'));
  const methodDefinitions = [
    ['direct', '直连', '不使用软件或 Windows 代理。'],
    ['system', 'Windows 系统代理', '读取当前 Windows 代理；仅接受解析出的 HTTP(S) 代理。'],
    ['custom', '自定义代理', '为 Harness 指定一个 HTTP 或 HTTPS 代理地址。']
  ];
  const radios = new Map();
  methodDefinitions.forEach(([value, name, detail]) => {
    const label = create('label', 'dsh-network-method');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'dsh-network-mode';
    radio.value = value;
    const copy = create('span', 'dsh-network-method-copy');
    copy.append(create('strong', '', name), create('small', '', detail));
    label.append(radio, copy);
    methods.append(label);
    radios.set(value, radio);
  });

  const customRow = create('div', 'dsh-network-custom');
  const customLabel = create('label', '', '代理地址');
  customLabel.htmlFor = 'dsh-network-url';
  const customInput = document.createElement('input');
  customInput.id = 'dsh-network-url';
  customInput.type = 'url';
  customInput.inputMode = 'url';
  customInput.autocomplete = 'off';
  customInput.spellcheck = false;
  customInput.maxLength = 512;
  customInput.placeholder = 'http://127.0.0.1:7890';
  const customHelp = create('small', '', '支持 HTTP/HTTPS；本版不保存代理用户名或密码。');
  customRow.append(customLabel, customInput, customHelp);

  const scope = create('div', 'dsh-network-scope');
  scope.setAttribute('role', 'note');
  scope.append(
    create('strong', '', '作用范围'),
    create('span', '', '仅影响 Harness 外部网络请求；本机 127.0.0.1、localhost、::1 和集成终端保持不变。')
  );

  const status = create('p', 'dsh-network-status', '正在读取当前设置…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const footer = create('footer', 'dsh-network-footer');
  const testButton = create('button', 'dsh-network-secondary', '测试连接');
  testButton.type = 'button';
  const actions = create('div', 'dsh-network-actions');
  const cancelButton = create('button', 'dsh-network-secondary', '取消');
  cancelButton.type = 'button';
  const saveButton = create('button', 'dsh-network-primary', '保存并重启 Harness');
  saveButton.type = 'submit';
  actions.append(cancelButton, saveButton);
  footer.append(testButton, actions);
  form.append(methods, customRow, scope, status, footer);
  dialog.append(header, form);
  backdrop.append(dialog);
  document.body.append(backdrop);

  let previousFocus = null;
  let busy = false;

  const selectedMode = () => [...radios.entries()].find(([, radio]) => radio.checked)?.[0] || 'direct';
  const proposal = () => ({ mode: selectedMode(), proxyUrl: customInput.value.trim() });
  const setStatus = (message, tone = '') => {
    status.textContent = message;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };
  const renderMode = () => {
    const custom = selectedMode() === 'custom';
    customRow.hidden = !custom;
    customInput.disabled = !custom || busy;
    if (custom && !busy) customInput.removeAttribute('aria-disabled');
    else customInput.setAttribute('aria-disabled', 'true');
  };
  const setBusy = (next, label = '') => {
    busy = Boolean(next);
    [...radios.values()].forEach((radio) => { radio.disabled = busy; });
    testButton.disabled = busy;
    cancelButton.disabled = busy;
    saveButton.disabled = busy;
    testButton.textContent = busy && label === 'test' ? '测试中…' : '测试连接';
    saveButton.textContent = busy && label === 'save' ? '正在保存…' : '保存并重启 Harness';
    renderMode();
  };
  const stateMessage = (state) => {
    if (state?.status === 'error') return state.message || '当前代理设置不可用。';
    if (state?.mode === 'custom') return `当前：自定义代理 ${state.proxyUrl || ''}`.trim();
    if (state?.mode === 'system') return state.effectiveProxy ? '当前：Windows 系统代理' : '当前：Windows 系统设置（直连）';
    return '当前：直连';
  };
  const applyState = (state) => {
    const mode = radios.has(state?.mode) ? state.mode : 'direct';
    radios.get(mode).checked = true;
    customInput.value = state?.proxyUrl || '';
    renderMode();
  };
  const load = async () => {
    setBusy(true);
    setStatus('正在读取当前设置…');
    try {
      const state = await api.network.getState();
      applyState(state);
      setStatus(stateMessage(state), state?.status === 'error' ? 'error' : '');
    } catch {
      radios.get('direct').checked = true;
      setStatus('无法读取代理设置，请关闭后重试。', 'error');
    } finally {
      setBusy(false);
    }
  };
  const open = () => {
    if (!backdrop.hidden) return true;
    previousFocus = document.activeElement;
    backdrop.hidden = false;
    backdrop.inert = false;
    document.documentElement.dataset.dshNetworkOpen = 'true';
    closeButton.focus();
    void load();
    return true;
  };
  const close = () => {
    if (backdrop.hidden || busy) return false;
    backdrop.hidden = true;
    backdrop.inert = true;
    delete document.documentElement.dataset.dshNetworkOpen;
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
    return true;
  };

  methods.addEventListener('change', renderMode);
  closeButton.addEventListener('click', close);
  cancelButton.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  testButton.addEventListener('click', async () => {
    setBusy(true, 'test');
    setStatus('正在连接 DeepSeek API…');
    try {
      const result = await api.network.test(proposal());
      setStatus(result?.message || (result?.ok ? '连接成功。' : '连接失败。'), result?.ok ? 'success' : 'error');
    } catch {
      setStatus('连接测试失败，请检查代理地址。', 'error');
    } finally {
      setBusy(false);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(true, 'save');
    setStatus('正在保存并准备重启 Harness…');
    try {
      const result = await api.network.save(proposal());
      if (!result?.ok) {
        setBusy(false);
        if (result?.canceled) applyState(result.state);
        setStatus(result?.message || '代理设置保存失败。', result?.canceled ? '' : 'error');
        return;
      }
      setStatus(result?.restarting ? '设置已保存，Harness 正在重启…' : '设置未变化，无需重启。', 'success');
    } catch {
      setStatus('代理设置保存失败，请重试。', 'error');
      setBusy(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === ',') {
      event.preventDefault();
      event.stopPropagation();
      open();
      return;
    }
    if (backdrop.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter((node) => !node.closest('[hidden]'));
      const current = focusable.indexOf(document.activeElement);
      if (focusable.length && ((event.shiftKey && current <= 0) || (!event.shiftKey && current === focusable.length - 1))) {
        event.preventDefault();
        focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
      }
    }
  }, true);

  window.__DSH_NETWORK__ = Object.freeze({ open, close, focus: open });
  renderMode();
  return true;
})();
