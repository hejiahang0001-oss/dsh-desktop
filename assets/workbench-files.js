(() => {
  const api = window.desktopAPI;
  const bootstrap = window.__DSH_WORKBENCH_BOOTSTRAP__ || { filePanelOpen: false, filePanelWidth: 260 };
  if (!api?.files || !api?.workspace || !api?.workbench) return false;
  if (window.__DSH_FILES__) {
    window.__DSH_FILES__.applyLayout(bootstrap);
    return true;
  }

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  };
  const panel = create('aside');
  panel.id = 'dsh-workbench-files';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', '工作区文件搜索');

  const resizer = create('div', 'dsh-files-resizer');
  resizer.tabIndex = 0;
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-label', '调整文件面板宽度');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-valuemin', '220');
  resizer.setAttribute('aria-valuemax', '380');
  panel.append(resizer);

  const header = create('header', 'dsh-files-header');
  const heading = create('div', 'dsh-files-heading');
  const title = create('h2', '', '文件搜索');
  const workspaceName = create('p', 'dsh-files-workspace', '正在读取…');
  heading.append(title, workspaceName);
  const headerActions = create('div', 'dsh-files-header-actions');
  const refreshButton = create('button', 'dsh-files-icon-button', '↻');
  refreshButton.type = 'button';
  refreshButton.title = '重置搜索';
  refreshButton.setAttribute('aria-label', '重置搜索');
  const closeButton = create('button', 'dsh-files-icon-button', '×');
  closeButton.type = 'button';
  closeButton.title = '隐藏文件面板';
  closeButton.setAttribute('aria-label', '隐藏文件面板');
  headerActions.append(refreshButton, closeButton);
  header.append(heading, headerActions);

  const searchLabel = create('label', 'dsh-files-search');
  const searchText = create('span', 'dsh-files-sr-only', '按文件名搜索');
  const searchInput = create('input', 'dsh-files-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = '搜索文件名';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  searchLabel.append(searchText, searchInput);

  const tree = create('div', 'dsh-files-tree');
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', '当前工作区文件搜索结果');
  tree.tabIndex = -1;
  const status = create('p', 'dsh-files-status', '普通文件浏览请使用官方右侧文件面板；搜索结果也在官方面板中预览。');
  status.setAttribute('aria-live', 'polite');
  panel.append(header, searchLabel, tree, status);

  document.body.append(panel);

  let layout = { ...bootstrap };
  let workspace = {};
  let searchResults = null;
  let selectedPath = '';
  let previewRequest = 0;
  let searchRequest = 0;
  let searchTimer;
  const setStatus = (message) => { status.textContent = message; status.title = message; };
  const applyLayout = (next = {}) => {
    const width = Math.min(380, Math.max(220, Math.round(Number(next.filePanelWidth) || 260)));
    layout = { ...layout, ...next, filePanelOpen: next.filePanelOpen !== false, filePanelWidth: width };
    document.documentElement.style.setProperty('--dsh-files-width', `${width}px`);
    document.documentElement.dataset.dshFilesOpen = String(layout.filePanelOpen);
    resizer.setAttribute('aria-valuenow', String(width));
    panel.setAttribute('aria-hidden', String(!layout.filePanelOpen));
    panel.inert = !layout.filePanelOpen;
  };

  const setSelectedRow = () => {
    for (const row of tree.querySelectorAll('.dsh-files-row')) {
      row.setAttribute('aria-selected', String(row.dataset.path === selectedPath));
    }
  };

  const openPreview = async (pathValue) => {
    const request = ++previewRequest;
    try {
      const bridge = window.__DSH_OFFICIAL_FILES__;
      if (!bridge) throw new Error('官方文件面板尚未就绪，请稍后重试。');
      selectedPath = pathValue;
      setSelectedRow();
      setStatus('正在打开官方预览…');
      await bridge.openFile(pathValue, workspace.activePath);
      if (request !== previewRequest) return false;
      setStatus('已交给官方右侧文件面板；内容加载状态请查看该面板。');
      return true;
    } catch (error) {
      if (request === previewRequest) setStatus(error.message || '文件暂时无法打开，请重试。');
      return false;
    }
  };

  const onRowKeyDown = async (event) => {
    const button = event.currentTarget;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      button.click();
      return;
    }
  };

  const createRow = (entry, level) => {
    const row = create('button', 'dsh-files-row');
    row.type = 'button';
    row.dataset.path = entry.path;
    row.dataset.kind = entry.kind;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(level));
    row.setAttribute('aria-selected', String(entry.path === selectedPath));
    row.title = entry.path;
    const disclosure = create('span', 'dsh-files-disclosure', '');
    const icon = create('span', 'dsh-files-kind', entry.restricted ? '⌕' : entry.kind === 'directory' ? '▰' : entry.kind === 'link' ? '↗' : '·');
    icon.setAttribute('aria-hidden', 'true');
    const name = create('span', 'dsh-files-name', entry.name);
    row.append(disclosure, icon, name);
    row.addEventListener('keydown', onRowKeyDown);
    row.addEventListener('click', async () => {
      if (entry.kind === 'file') await openPreview(entry.path, row);
      else setStatus('链接和特殊文件不会在桌面面板中打开。');
    });
    return row;
  };

  function renderTree() {
    tree.replaceChildren();
    if (searchResults) {
      if (searchResults.length === 0) {
        tree.append(create('p', 'dsh-files-empty', '没有匹配的文件。'));
        return;
      }
      for (const entry of searchResults) {
        tree.append(createRow({ ...entry, name: entry.path }, 1));
      }
      return;
    }
    tree.append(create('p', 'dsh-files-empty', '输入文件名搜索。浏览目录、文档和交付文件请使用官方右侧文件面板。'));
  }

  const refreshFiles = async () => {
    clearTimeout(searchTimer);
    searchRequest += 1;
    searchResults = null;
    searchInput.value = '';
    renderTree();
    setStatus('普通文件浏览请使用官方右侧文件面板；搜索只读取当前工作区。');
  };

  const reveal = async (pathValue) => {
    if (typeof pathValue !== 'string' || !pathValue) return false;
    if (!layout.filePanelOpen) applyLayout(await api.workbench.setFilePanelOpen(true));
    await refreshFiles();
    try {
      return await openPreview(pathValue);
    } catch (error) {
      setStatus(error.message);
      return false;
    }
  };

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const request = ++searchRequest;
    const query = searchInput.value.trim();
    if (!query) {
      searchResults = null;
      renderTree();
      setStatus('输入文件名搜索；普通浏览使用官方右侧文件面板。');
      return;
    }
    searchTimer = setTimeout(async () => {
      setStatus(`正在搜索“${query}”…`);
      let result;
      try { result = await api.files.search(query); }
      catch (error) { result = { available: false, message: error.message || '搜索暂不可用。' }; }
      if (request !== searchRequest || searchInput.value.trim() !== query) return;
      if (!result?.available) {
        searchResults = [];
        renderTree();
        setStatus(result?.message || '搜索暂不可用。');
        return;
      }
      searchResults = result.results || [];
      renderTree();
      setStatus(`找到 ${searchResults.length}${result.truncated ? '+' : ''} 个文件。`);
    }, 250);
  });

  refreshButton.addEventListener('click', () => void refreshFiles());
  closeButton.addEventListener('click', async () => {
    applyLayout(await api.workbench.setFilePanelOpen(false));
  });
  let dragStartWidth = 0;
  let dragStartX = 0;
  resizer.addEventListener('pointerdown', (event) => {
    dragStartWidth = layout.filePanelWidth;
    dragStartX = event.clientX;
    resizer.dataset.dragging = 'true';
    resizer.setPointerCapture(event.pointerId);
  });
  resizer.addEventListener('pointermove', (event) => {
    if (resizer.dataset.dragging !== 'true') return;
    applyLayout({ ...layout, filePanelWidth: dragStartWidth + event.clientX - dragStartX });
  });
  resizer.addEventListener('pointerup', async (event) => {
    if (resizer.dataset.dragging !== 'true') return;
    delete resizer.dataset.dragging;
    resizer.releasePointerCapture(event.pointerId);
    applyLayout(await api.workbench.setFilePanelWidth(layout.filePanelWidth));
  });
  resizer.addEventListener('keydown', async (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = event.key === 'Home' ? 220
      : event.key === 'End' ? 380
        : layout.filePanelWidth + (event.key === 'ArrowLeft' ? -12 : 12);
    applyLayout(await api.workbench.setFilePanelWidth(width));
  });

  window.__DSH_FILES__ = Object.freeze({
    applyLayout,
    focus: () => {
      if (!layout.filePanelOpen) return false;
      searchInput.focus();
      searchInput.select();
      return true;
    },
    reveal,
    refresh: refreshFiles
  });
  applyLayout(bootstrap);
  void api.workspace.getState().then((state) => {
    workspace = state || {};
    workspaceName.textContent = workspace.displayName || '当前工作区';
    workspaceName.title = workspace.activePath || '';
  });
  void refreshFiles();
  return true;
})();
