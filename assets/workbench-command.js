(() => {
  const api = window.desktopAPI;
  if (!api?.workbench) return false;
  if (window.__DSH_COMMAND_PALETTE__) return true;

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const visible = (node) => Boolean(node && !node.hidden && node.getClientRects().length);
  const focusChat = () => {
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"]')];
    const target = candidates.find((node) => visible(node) && /描述|构建|消息|ask|message/i.test(node.getAttribute('placeholder') || node.getAttribute('data-placeholder') || ''))
      || candidates.find((node) => visible(node) && !node.closest('[id^="dsh-"]'));
    target?.focus();
    return Boolean(target);
  };
  const clickNewSession = () => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((button) => visible(button) && /新建会话|new session/i.test(`${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`));
    target?.click();
    return Boolean(target);
  };
  const togglePanel = async (key, setter) => {
    const state = await api.workbench.getState();
    return setter(!state?.[key]);
  };
  const openAndFocus = async (key, setter, globalName) => {
    const state = await api.workbench.getState();
    if (!state?.[key]) await setter(true);
    return window[globalName]?.focus?.() !== false;
  };

  const commands = Object.freeze([
    { id: 'chat.focus', title: '聚焦对话输入', detail: '继续向当前 Harness 会话提问', shortcut: 'Ctrl+Alt+M', run: focusChat },
    { id: 'session.new', title: '新建会话', detail: '使用官方 Harness 新建会话入口', shortcut: 'Ctrl+N', run: clickNewSession },
    { id: 'files.toggle', title: '显示或隐藏工作区文件', detail: '切换左侧文件面板', shortcut: 'Ctrl+Alt+E', run: () => togglePanel('filePanelOpen', api.workbench.setFilePanelOpen) },
    { id: 'files.focus', title: '聚焦文件搜索', detail: '打开文件面板并选中搜索框', shortcut: 'Ctrl+Alt+F', run: () => openAndFocus('filePanelOpen', api.workbench.setFilePanelOpen, '__DSH_FILES__') },
    { id: 'preview.toggle', title: '显示或隐藏应用预览', detail: '切换 HTML 与本机服务预览', shortcut: 'Ctrl+Alt+P', run: () => togglePanel('previewPanelOpen', api.workbench.setPreviewPanelOpen) },
    { id: 'preview.focus', title: '聚焦应用预览', detail: '打开预览并聚焦地址栏', shortcut: 'Ctrl+Alt+L', run: () => openAndFocus('previewPanelOpen', api.workbench.setPreviewPanelOpen, '__DSH_PREVIEW__') },
    { id: 'terminal.toggle', title: '显示或隐藏集成终端', detail: '切换当前工作区 PTY', shortcut: 'Ctrl+Alt+T', run: () => togglePanel('terminalPanelOpen', api.workbench.setTerminalPanelOpen) },
    { id: 'terminal.focus', title: '聚焦集成终端', detail: '打开终端并聚焦输入', shortcut: 'Ctrl+Alt+K', run: () => openAndFocus('terminalPanelOpen', api.workbench.setTerminalPanelOpen, '__DSH_TERMINAL__') },
    { id: 'review.toggle', title: '显示或隐藏变更审查', detail: '切换右侧 Git Diff 面板', shortcut: 'Ctrl+Alt+D', run: () => togglePanel('reviewPanelOpen', api.workbench.setReviewPanelOpen) },
    { id: 'review.focus', title: '聚焦变更审查', detail: '打开 Git Diff 并聚焦文件列表', shortcut: 'Ctrl+Alt+J', run: () => openAndFocus('reviewPanelOpen', api.workbench.setReviewPanelOpen, '__DSH_WORKBENCH__') },
    { id: 'page.reload', title: '重新加载 Harness 页面', detail: '保留桌面进程与工作台状态并重载页面', shortcut: 'Ctrl+R', run: () => window.location.reload() }
  ]);

  const backdrop = create('div', 'dsh-command-backdrop');
  backdrop.hidden = true;
  const dialog = create('section', 'dsh-command-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'dsh-command-title');
  const title = create('h2', 'dsh-command-sr-only', '命令面板');
  title.id = 'dsh-command-title';
  const search = create('input', 'dsh-command-search');
  search.type = 'search';
  search.placeholder = '输入命令或功能名称';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.setAttribute('aria-label', '搜索命令');
  search.setAttribute('aria-controls', 'dsh-command-results');
  search.setAttribute('aria-autocomplete', 'list');
  const results = create('div', 'dsh-command-results');
  results.id = 'dsh-command-results';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', '可用命令');
  const empty = create('p', 'dsh-command-empty', '没有匹配的命令。');
  empty.hidden = true;
  const footer = create('footer', 'dsh-command-footer');
  footer.append(
    create('span', '', '↑↓ 选择 · Enter 执行 · Esc 关闭'),
    create('span', '', 'Ctrl+Shift+P 打开')
  );
  dialog.append(title, search, results, empty, footer);
  backdrop.append(dialog);
  document.body.append(backdrop);

  let filtered = [...commands];
  let activeIndex = 0;
  let previousFocus = null;

  const close = ({ restoreFocus = true } = {}) => {
    if (backdrop.hidden) return false;
    backdrop.hidden = true;
    backdrop.inert = true;
    delete document.documentElement.dataset.dshCommandOpen;
    search.removeAttribute('aria-activedescendant');
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
    return true;
  };
  const select = (index) => {
    if (filtered.length === 0) return;
    activeIndex = (index + filtered.length) % filtered.length;
    const options = [...results.querySelectorAll('[role="option"]')];
    options.forEach((option, optionIndex) => option.setAttribute('aria-selected', String(optionIndex === activeIndex)));
    const active = options[activeIndex];
    if (active) {
      search.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  };
  const runCommand = async (command) => {
    if (!command) return;
    const fallbackFocus = previousFocus;
    close({ restoreFocus: false });
    try {
      await command.run();
    } catch {
      if (fallbackFocus?.isConnected) fallbackFocus.focus();
    }
  };
  const render = () => {
    results.replaceChildren();
    empty.hidden = filtered.length > 0;
    filtered.forEach((command, index) => {
      const option = create('button', 'dsh-command-option');
      option.type = 'button';
      option.id = `dsh-command-${command.id}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === activeIndex));
      const copy = create('span', 'dsh-command-copy');
      copy.append(create('strong', '', command.title), create('small', '', command.detail));
      const shortcut = create('kbd', 'dsh-command-shortcut', command.shortcut);
      option.append(copy, shortcut);
      option.addEventListener('pointermove', () => select(index));
      option.addEventListener('click', () => void runCommand(command));
      results.append(option);
    });
    select(Math.min(activeIndex, Math.max(0, filtered.length - 1)));
  };
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase();
    filtered = query
      ? commands.filter((command) => `${command.title} ${command.detail} ${command.shortcut}`.toLocaleLowerCase().includes(query))
      : [...commands];
    activeIndex = 0;
    render();
  };
  const open = () => {
    if (!backdrop.hidden) {
      search.focus();
      search.select();
      return true;
    }
    previousFocus = document.activeElement;
    backdrop.hidden = false;
    backdrop.inert = false;
    document.documentElement.dataset.dshCommandOpen = 'true';
    search.value = '';
    filtered = [...commands];
    activeIndex = 0;
    render();
    search.focus();
    return true;
  };

  search.addEventListener('input', filter);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void runCommand(filtered[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  });
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLocaleLowerCase() === 'p') {
      event.preventDefault();
      event.stopPropagation();
      open();
    } else if (event.key === 'Escape' && !backdrop.hidden) {
      event.preventDefault();
      close();
    }
  }, true);

  window.__DSH_COMMAND_PALETTE__ = Object.freeze({ open, close, focus: open, commandCount: commands.length });
  backdrop.inert = true;
  render();
  return true;
})();
