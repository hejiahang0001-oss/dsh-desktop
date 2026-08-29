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
  const invokeSkill = (name) => {
    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"]')];
    const target = candidates.find((node) => visible(node) && /描述|构建|消息|ask|message/i.test(node.getAttribute('placeholder') || node.getAttribute('data-placeholder') || ''))
      || candidates.find((node) => visible(node) && !node.closest('[id^="dsh-"]'));
    if (!target) return false;
    const prefix = `/${name} `;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const current = target.value || '';
      const next = current.startsWith(prefix) ? current : `${prefix}${current}`;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
      if (setter) setter.call(target, next);
      else target.value = next;
    } else {
      const current = target.textContent || '';
      target.textContent = current.startsWith(prefix) ? current : `${prefix}${current}`;
    }
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prefix }));
    target.focus();
    if (typeof target.setSelectionRange === 'function') target.setSelectionRange(target.value.length, target.value.length);
    return true;
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
  const adjustZoom = async (delta) => {
    const state = await api.workbench.getState();
    return api.workbench.setUiZoomFactor((state?.uiZoomFactor || 1) + delta);
  };

  const commands = Object.freeze([
    { id: 'chat.focus', title: '聚焦对话输入', detail: '继续向当前 Harness 会话提问', shortcut: 'Ctrl+Alt+M', run: focusChat },
    { id: 'session.new', title: '新建会话', detail: '使用官方 Harness 新建会话入口', shortcut: 'Ctrl+N', run: clickNewSession },
    { id: 'side-chat.open', title: '打开 Side Chat', detail: '在当前工作区建立独立 Harness 会话窗口', shortcut: 'Ctrl+Shift+S', run: () => api.sideChat.openWindow() },
    { id: 'extensions.open', title: '打开扩展中心', detail: '查看 Skills、Plugins、Hooks 与 MCP 的来源、范围和实时状态', shortcut: '', run: () => api.extensions.openWindow() },
    { id: 'office-center.open', title: '打开 Office 交付中心', detail: '统一查看并调用 Word、Excel 和 PowerPoint 可编辑文件能力', shortcut: '', run: () => api.office.openWindow() },
    { id: 'wiki-center.open', title: '打开 Wiki 中心', detail: '查询本地知识、保存结论、同步项目并导入 DSH 历史', shortcut: '', run: () => api.wiki.openWindow() },
    { id: 'wiki-query.invoke', title: '查询 Wiki 知识', detail: '加载内置 /wiki-query Skill，返回页面路径与来源', shortcut: '', run: () => invokeSkill('wiki-query') },
    { id: 'wiki-capture.invoke', title: '保存会话结论到 Wiki', detail: '加载内置 /wiki-capture Skill，先预览再保存结论', shortcut: '', run: () => invokeSkill('wiki-capture') },
    { id: 'wiki-update.invoke', title: '同步当前项目知识到 Wiki', detail: '加载内置 /wiki-update Skill，增量整理架构、边界和决策', shortcut: '', run: () => invokeSkill('wiki-update') },
    { id: 'wiki-history-ingest.open', title: '导入 DSH 历史到 Wiki', detail: '打开 Wiki 中心选择当前工作区的普通会话', shortcut: '', run: () => api.wiki.openWindow() },
    { id: 'support.diagnostics', title: '导出脱敏诊断报告', detail: '生成不含 Key、代理地址、完整路径、会话正文和日志正文的 JSON', shortcut: '', run: () => api.support.exportDiagnostics() },
    { id: 'support.backup', title: '备份 DSH 数据', detail: '短暂停止 Harness，备份会话和设置并逐文件校验，不复制软件 Key', shortcut: '', run: () => api.support.createBackup() },
    { id: 'support.validate-backup', title: '验证 DSH 备份', detail: '逐文件核对备份清单、大小和 SHA-256', shortcut: '', run: () => api.support.validateBackup() },
    { id: 'word-docx.invoke', title: '创建或修改 Word 文档', detail: '加载内置 /word-docx Skill，在当前工作区生成可编辑 DOCX', shortcut: '', run: () => invokeSkill('word-docx') },
    { id: 'excel-xlsx.invoke', title: '创建或修改 Excel 工作簿', detail: '加载内置 /excel-xlsx Skill，在当前工作区生成可编辑 XLSX', shortcut: '', run: () => invokeSkill('excel-xlsx') },
    { id: 'powerpoint-pptx.invoke', title: '创建或修改 PowerPoint 演示文稿', detail: '加载内置 /powerpoint-pptx Skill，在当前工作区生成可编辑 PPTX', shortcut: '', run: () => invokeSkill('powerpoint-pptx') },
    { id: 'files.toggle', title: '显示或隐藏工作区文件', detail: '切换左侧文件面板', shortcut: 'Ctrl+Alt+E', run: () => togglePanel('filePanelOpen', api.workbench.setFilePanelOpen) },
    { id: 'files.focus', title: '聚焦文件搜索', detail: '打开文件面板并选中搜索框', shortcut: 'Ctrl+Alt+F', run: () => openAndFocus('filePanelOpen', api.workbench.setFilePanelOpen, '__DSH_FILES__') },
    { id: 'preview.toggle', title: '显示或隐藏应用预览', detail: '切换 HTML 与本机服务预览', shortcut: 'Ctrl+Alt+P', run: () => togglePanel('previewPanelOpen', api.workbench.setPreviewPanelOpen) },
    { id: 'preview.focus', title: '聚焦应用预览', detail: '打开预览并聚焦地址栏', shortcut: 'Ctrl+Alt+L', run: () => openAndFocus('previewPanelOpen', api.workbench.setPreviewPanelOpen, '__DSH_PREVIEW__') },
    { id: 'terminal.open', title: '打开安全终端窗口', detail: '在本地隔离窗口中使用当前工作区 PTY', shortcut: 'Ctrl+Alt+T', run: () => api.terminal.openWindow() },
    { id: 'terminal.focus', title: '聚焦安全终端窗口', detail: '打开或聚焦本地终端窗口', shortcut: 'Ctrl+Alt+K', run: () => api.terminal.openWindow() },
    { id: 'review.toggle', title: '显示或隐藏变更审查', detail: '切换右侧 Git Diff 面板', shortcut: 'Ctrl+Alt+D', run: () => togglePanel('reviewPanelOpen', api.workbench.setReviewPanelOpen) },
    { id: 'review.focus', title: '聚焦变更审查', detail: '打开 Git Diff 并聚焦文件列表', shortcut: 'Ctrl+Alt+J', run: () => openAndFocus('reviewPanelOpen', api.workbench.setReviewPanelOpen, '__DSH_WORKBENCH__') },
    { id: 'checkpoint.create', title: '立即创建代码检查点', detail: '不改变工作树和 Git 索引，敏感路径不写入检查点', shortcut: 'Ctrl+Alt+B', run: async () => window.__DSH_CHECKPOINTS__?.showState(await api.checkpoints.create()) },
    { id: 'checkpoint.history', title: '浏览代码检查点', detail: '查看最近 12 个本地安全点，只恢复代码或从关联回合建立会话分支', shortcut: 'Ctrl+Alt+H', run: () => window.__DSH_CHECKPOINTS__?.openHistory?.() },
    { id: 'checkpoint.restore', title: '恢复到最近代码检查点', detail: '先建立恢复前安全点，再经原生确认恢复代码和索引', shortcut: 'Ctrl+Alt+R', run: () => api.checkpoints.restoreLatest() },
    { id: 'settings.network', title: '网络与代理设置', detail: '选择直连、Windows 系统代理或自定义 HTTP(S) 代理', shortcut: 'Ctrl+,', run: () => window.__DSH_NETWORK__?.open?.() },
    { id: 'zoom.in', title: '界面放大', detail: '放大 Harness 与工作台界面', shortcut: 'Ctrl+=', run: () => adjustZoom(0.1) },
    { id: 'zoom.out', title: '界面缩小', detail: '缩小 Harness 与工作台界面', shortcut: 'Ctrl+-', run: () => adjustZoom(-0.1) },
    { id: 'zoom.reset', title: '界面大小重置', detail: '恢复到 100% 界面大小', shortcut: 'Ctrl+0', run: () => api.workbench.setUiZoomFactor(1) },
    { id: 'layout.reset', title: '重置整个工作台布局', detail: '恢复默认面板、尺寸与 100% 界面大小', shortcut: 'Ctrl+Alt+0', run: () => api.workbench.resetLayout() },
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

  window.__DSH_COMMAND_PALETTE__ = Object.freeze({ open, close, focus: open, invokeWord: () => invokeSkill('word-docx'), invokeExcel: () => invokeSkill('excel-xlsx'), invokePowerPoint: () => invokeSkill('powerpoint-pptx'), invokeWikiQuery: () => invokeSkill('wiki-query'), invokeWikiCapture: () => invokeSkill('wiki-capture'), invokeWikiUpdate: () => invokeSkill('wiki-update'), invokeWikiHistory: () => invokeSkill('wiki-history-ingest dsh'), commandCount: commands.length });
  backdrop.inert = true;
  render();
  return true;
})();
