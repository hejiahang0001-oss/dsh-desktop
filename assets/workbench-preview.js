(() => {
  const api = window.desktopAPI;
  const bootstrap = window.__DSH_WORKBENCH_BOOTSTRAP__ || { previewPanelOpen: false };
  if (!api?.preview || !api?.workbench) return false;
  if (window.__DSH_PREVIEW__) {
    window.__DSH_PREVIEW__.applyLayout(bootstrap);
    return true;
  }

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const labels = {
    idle: '未启动',
    starting: '连接中',
    ready: '可用',
    offline: '离线',
    failed: '失败',
    stopped: '已停止',
    unavailable: '不可用'
  };

  const panel = create('section');
  panel.id = 'dsh-app-preview';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'dsh-app-preview-title');

  const header = create('header', 'dsh-preview-header');
  const identity = create('div', 'dsh-preview-identity');
  const title = create('h2', '', '应用预览');
  title.id = 'dsh-app-preview-title';
  const subtitle = create('p', '', '工作区 HTML 或本机开发服务器');
  identity.append(title, subtitle);
  const badge = create('span', 'dsh-preview-badge', '未启动');
  badge.dataset.status = 'idle';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  const headerActions = create('div', 'dsh-preview-header-actions');
  const externalButton = create('button', 'dsh-preview-button', '浏览器打开');
  externalButton.type = 'button';
  const closeButton = create('button', 'dsh-preview-icon-button', '×');
  closeButton.type = 'button';
  closeButton.title = '关闭应用预览并释放软件管理的端口';
  closeButton.setAttribute('aria-label', '关闭应用预览');
  headerActions.append(externalButton, closeButton);
  header.append(identity, badge, headerActions);

  const addressBar = create('form', 'dsh-preview-address');
  const addressLabel = create('label', 'dsh-preview-address-label');
  const addressLabelText = create('span', 'dsh-preview-sr-only', '本机开发服务器地址');
  const addressInput = create('input', 'dsh-preview-address-input');
  addressInput.type = 'url';
  addressInput.inputMode = 'url';
  addressInput.autocomplete = 'off';
  addressInput.spellcheck = false;
  addressInput.placeholder = 'http://127.0.0.1:3000';
  addressInput.setAttribute('aria-describedby', 'dsh-preview-address-help');
  addressLabel.append(addressLabelText, addressInput);
  const connectButton = create('button', 'dsh-preview-button dsh-preview-primary', '连接');
  connectButton.type = 'submit';
  const refreshButton = create('button', 'dsh-preview-icon-button', '↻');
  refreshButton.type = 'button';
  refreshButton.title = '重新加载预览';
  refreshButton.setAttribute('aria-label', '重新加载预览');
  const stopButton = create('button', 'dsh-preview-button', '停止');
  stopButton.type = 'button';
  addressBar.append(addressLabel, connectButton, refreshButton, stopButton);

  const viewport = create('div', 'dsh-preview-viewport');
  const frame = create('iframe', 'dsh-preview-frame');
  frame.title = '本机应用预览内容';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.src = 'about:blank';
  const message = create('div', 'dsh-preview-message');
  message.setAttribute('role', 'status');
  const messageMark = create('span', 'dsh-preview-message-mark', '◇');
  const messageTitle = create('strong', '', '尚未启动预览');
  const messageCopy = create('p', '', '从文件面板打开 HTML，或连接已经运行的本机开发服务器。');
  message.append(messageMark, messageTitle, messageCopy);
  viewport.append(frame, message);

  const footer = create('footer', 'dsh-preview-footer');
  const source = create('span', 'dsh-preview-source', '无预览来源');
  source.title = '';
  const help = create('span', 'dsh-preview-help', '');
  help.id = 'dsh-preview-address-help';
  help.textContent = '仅允许本机回环地址；关闭面板会释放软件启动的随机端口。';
  footer.append(source, help);
  panel.append(header, addressBar, viewport, footer);
  document.body.append(panel);

  let layout = { ...bootstrap };
  let state = { status: 'idle', mode: 'none', url: '', owned: false };
  let currentFrameUrl = 'about:blank';
  let previousFocus = null;
  let busy = false;

  const showMessage = (heading, copy, mark = '◇') => {
    message.hidden = false;
    messageMark.textContent = mark;
    messageTitle.textContent = heading;
    messageCopy.textContent = copy;
  };
  const hideMessage = () => { message.hidden = true; };

  const applyLayout = (next = {}) => {
    layout = { ...layout, ...next, previewPanelOpen: next.previewPanelOpen === true };
    document.documentElement.dataset.dshPreviewOpen = String(layout.previewPanelOpen);
    panel.hidden = !layout.previewPanelOpen;
    panel.inert = !layout.previewPanelOpen;
    if (!layout.previewPanelOpen && currentFrameUrl !== 'about:blank') {
      frame.src = 'about:blank';
      currentFrameUrl = 'about:blank';
    }
  };

  const applyState = (next = {}) => {
    state = { ...state, ...next };
    const status = state.status || 'idle';
    badge.dataset.status = status;
    badge.textContent = labels[status] || '未知';
    const active = ['starting', 'ready', 'offline'].includes(status);
    const ready = status === 'ready' && Boolean(state.url);
    externalButton.disabled = !ready;
    refreshButton.disabled = !ready;
    stopButton.disabled = !active;
    connectButton.disabled = busy;
    addressInput.disabled = busy;
    if (state.mode === 'external' && state.url && document.activeElement !== addressInput) addressInput.value = state.url;
    source.textContent = state.filePath
      ? `${state.filePath} · 软件管理端口 ${state.port || '—'}`
      : state.url
        ? `${state.url} · 外部本机服务`
        : '无预览来源';
    source.title = state.filePath || state.url || '';

    if (status === 'starting') {
      showMessage('正在连接本机预览', '正在检查端口并准备隔离的预览区域。', '…');
      return;
    }
    if (ready) {
      if (currentFrameUrl !== state.url) {
        showMessage('正在载入应用', state.owned ? '软件已启动随机回环端口。' : '本机开发服务器已连接。', '…');
        currentFrameUrl = state.url;
        frame.src = state.url;
      }
      return;
    }
    if (status === 'offline') {
      showMessage('本机服务暂时离线', state.error || '确认开发服务器仍在运行，然后重新连接。', '!');
      return;
    }
    if (status === 'failed' || status === 'unavailable') {
      showMessage('预览无法启动', state.error || '预览运行时暂不可用。', '!');
      return;
    }
    if (currentFrameUrl !== 'about:blank') {
      frame.src = 'about:blank';
      currentFrameUrl = 'about:blank';
    }
    showMessage(status === 'stopped' ? '预览已停止' : '尚未启动预览', status === 'stopped'
      ? '软件管理的端口已释放；可以打开另一个 HTML 或重新连接。'
      : '从文件面板打开 HTML，或连接已经运行的本机开发服务器。');
  };

  const openFile = async (filePath) => {
    if (busy) return false;
    busy = true;
    previousFocus = document.activeElement;
    applyState({ status: 'starting', mode: 'static', filePath, error: '' });
    try {
      const result = await api.preview.openFile(filePath);
      if (!result?.ok) {
        applyState({ ...(result?.state || {}), status: result?.state?.status || 'failed', error: result?.message || 'HTML 预览启动失败。' });
        return false;
      }
      applyState(result.state);
      window.__DSH_FILES__?.closePreview?.({ restoreFocus: false });
      return true;
    } finally {
      busy = false;
      applyState(state);
    }
  };

  const connect = async (url) => {
    if (busy) return false;
    busy = true;
    previousFocus = document.activeElement;
    applyState({ status: 'starting', mode: 'external', url: String(url || ''), error: '' });
    try {
      const result = await api.preview.connect(url);
      applyState({ ...(result?.state || {}), error: result?.message || result?.state?.error || '' });
      return Boolean(result?.ok);
    } finally {
      busy = false;
      applyState(state);
    }
  };

  addressBar.addEventListener('submit', (event) => {
    event.preventDefault();
    void connect(addressInput.value);
  });
  refreshButton.addEventListener('click', () => {
    if (!state.url) return;
    showMessage('正在重新加载应用', '预览内容将从当前本机地址重新读取。', '…');
    frame.src = state.url;
  });
  externalButton.addEventListener('click', () => { void api.preview.openExternal(); });
  stopButton.addEventListener('click', async () => applyState(await api.preview.stop()));
  closeButton.addEventListener('click', async () => {
    const next = await api.workbench.setPreviewPanelOpen(false);
    applyLayout(next);
    applyState(await api.preview.getState());
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  });
  frame.addEventListener('load', () => {
    if (state.status === 'ready' && currentFrameUrl !== 'about:blank') hideMessage();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !layout.previewPanelOpen || document.documentElement.dataset.dshFilePreviewOpen === 'true') return;
    event.preventDefault();
    closeButton.click();
  });

  window.__DSH_PREVIEW__ = Object.freeze({
    applyLayout,
    openFile,
    connect,
    focus: () => {
      if (!layout.previewPanelOpen) return false;
      addressInput.focus();
      addressInput.select();
      return true;
    }
  });
  applyLayout(bootstrap);
  void api.preview.getState().then(applyState);
  api.preview.onState(applyState);
  return true;
})();
