(() => {
  const api = window.desktopAPI;
  const bootstrap = window.__DSH_WORKBENCH_BOOTSTRAP__ || { filePanelOpen: true, filePanelWidth: 260 };
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
  const parentPath = (value) => {
    const parts = String(value || '').split('/').filter(Boolean);
    parts.pop();
    return parts.join('/');
  };
  const formatSize = (bytes) => {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const panel = create('aside');
  panel.id = 'dsh-workbench-files';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', '工作区文件');

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
  const title = create('h2', '', '工作区');
  const workspaceName = create('p', 'dsh-files-workspace', '正在读取…');
  heading.append(title, workspaceName);
  const headerActions = create('div', 'dsh-files-header-actions');
  const refreshButton = create('button', 'dsh-files-icon-button', '↻');
  refreshButton.type = 'button';
  refreshButton.title = '刷新文件';
  refreshButton.setAttribute('aria-label', '刷新文件');
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
  tree.setAttribute('aria-label', '当前工作区文件树');
  tree.tabIndex = -1;
  const status = create('p', 'dsh-files-status', '仅读取当前工作区；凭据、链接和二进制文件受保护。');
  status.setAttribute('aria-live', 'polite');
  panel.append(header, searchLabel, tree, status);

  const preview = create('section');
  preview.id = 'dsh-file-preview';
  preview.setAttribute('role', 'dialog');
  preview.setAttribute('aria-labelledby', 'dsh-file-preview-title');
  preview.setAttribute('aria-modal', 'false');
  preview.hidden = true;
  preview.inert = true;
  const previewHeader = create('header', 'dsh-file-preview-header');
  const previewIdentity = create('div', 'dsh-file-preview-identity');
  const previewTitle = create('h2', '', '文件预览');
  previewTitle.id = 'dsh-file-preview-title';
  const previewPath = create('p', 'dsh-file-preview-path', '');
  previewIdentity.append(previewTitle, previewPath);
  const previewMeta = create('p', 'dsh-file-preview-meta', '只读');
  const previewActions = create('div', 'dsh-file-preview-actions');
  const previewRefresh = create('button', 'dsh-file-preview-button', '重新读取');
  previewRefresh.type = 'button';
  const previewClose = create('button', 'dsh-file-preview-button dsh-file-preview-close', '×');
  previewClose.type = 'button';
  previewClose.title = '关闭文件预览';
  previewClose.setAttribute('aria-label', '关闭文件预览');
  previewActions.append(previewRefresh, previewClose);
  previewHeader.append(previewIdentity, previewMeta, previewActions);
  const previewBody = create('div', 'dsh-file-preview-body');
  previewBody.tabIndex = 0;
  previewBody.setAttribute('aria-label', '只读文件内容');
  const previewCode = create('pre', 'dsh-file-preview-code');
  previewBody.append(previewCode);
  const previewNotice = create('p', 'dsh-file-preview-notice', '只读预览，不会修改磁盘文件。');
  preview.append(previewHeader, previewBody, previewNotice);
  document.body.append(panel, preview);

  let layout = { ...bootstrap };
  let workspace = {};
  let directoryCache = new Map();
  const expanded = new Set(['']);
  let searchResults = null;
  let selectedPath = '';
  let previewRequest = 0;
  let searchRequest = 0;
  let searchTimer;
  let previousFocus = null;

  const setStatus = (message) => { status.textContent = message; };
  const applyLayout = (next = {}) => {
    const width = Math.min(380, Math.max(220, Math.round(Number(next.filePanelWidth) || 260)));
    layout = { ...layout, ...next, filePanelOpen: next.filePanelOpen !== false, filePanelWidth: width };
    document.documentElement.style.setProperty('--dsh-files-width', `${width}px`);
    document.documentElement.dataset.dshFilesOpen = String(layout.filePanelOpen);
    resizer.setAttribute('aria-valuenow', String(width));
    panel.setAttribute('aria-hidden', String(!layout.filePanelOpen));
    panel.inert = !layout.filePanelOpen;
  };

  const closePreview = ({ restoreFocus = true } = {}) => {
    if (preview.hidden) return;
    previewRequest += 1;
    preview.hidden = true;
    preview.inert = true;
    delete document.documentElement.dataset.dshFilePreviewOpen;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  };

  const loadDirectory = async (pathValue = '', { refresh = false } = {}) => {
    if (!refresh && directoryCache.has(pathValue)) return directoryCache.get(pathValue);
    const result = await api.files.list(pathValue);
    if (!result?.available) throw new Error(result?.message || '目录暂不可用。');
    directoryCache.set(pathValue, result);
    return result;
  };

  const setSelectedRow = () => {
    for (const row of tree.querySelectorAll('.dsh-files-row')) {
      row.setAttribute('aria-selected', String(row.dataset.path === selectedPath));
    }
  };

  const openPreview = async (pathValue, sourceButton) => {
    selectedPath = pathValue;
    setSelectedRow();
    previousFocus = sourceButton || document.activeElement;
    preview.hidden = false;
    preview.inert = false;
    document.documentElement.dataset.dshFilePreviewOpen = 'true';
    previewPath.textContent = pathValue;
    previewPath.title = pathValue;
    previewTitle.textContent = pathValue.split('/').pop() || '文件预览';
    previewMeta.textContent = '正在读取…';
    previewCode.textContent = '正在读取只读内容…';
    const request = ++previewRequest;
    const result = await api.files.read(pathValue);
    if (request !== previewRequest) return;
    if (!result?.available) {
      previewMeta.textContent = '不可预览';
      previewCode.textContent = result?.message || '该文件当前无法安全预览。';
      return;
    }
    previewMeta.textContent = [result.language, result.encoding, `${result.lineCount} 行`, formatSize(result.size)].filter(Boolean).join(' · ');
    previewCode.textContent = result.content || '（空文件）';
    previewBody.scrollTop = 0;
  };

  const onRowKeyDown = async (event) => {
    const button = event.currentTarget;
    const kind = button.dataset.kind;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      button.click();
      return;
    }
    if (kind === 'directory' && event.key === 'ArrowRight') {
      event.preventDefault();
      if (!expanded.has(button.dataset.path)) button.click();
      return;
    }
    if (kind === 'directory' && event.key === 'ArrowLeft' && expanded.has(button.dataset.path)) {
      event.preventDefault();
      expanded.delete(button.dataset.path);
      renderTree();
      buttonForPath(button.dataset.path)?.focus();
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
    if (entry.kind === 'directory') row.setAttribute('aria-expanded', String(expanded.has(entry.path)));
    row.title = entry.path;
    const disclosure = create('span', 'dsh-files-disclosure', entry.kind === 'directory' ? (expanded.has(entry.path) ? '▾' : '▸') : '');
    const icon = create('span', 'dsh-files-kind', entry.restricted ? '⌕' : entry.kind === 'directory' ? '▰' : entry.kind === 'link' ? '↗' : '·');
    icon.setAttribute('aria-hidden', 'true');
    const name = create('span', 'dsh-files-name', entry.name);
    row.append(disclosure, icon, name);
    row.addEventListener('keydown', onRowKeyDown);
    row.addEventListener('click', async () => {
      if (entry.kind === 'directory') {
        if (expanded.has(entry.path)) {
          expanded.delete(entry.path);
          renderTree();
          buttonForPath(entry.path)?.focus();
          return;
        }
        setStatus(`正在展开 ${entry.name}…`);
        try {
          await loadDirectory(entry.path);
          expanded.add(entry.path);
          renderTree();
          buttonForPath(entry.path)?.focus();
          setStatus('目录已展开。');
        } catch (error) {
          setStatus(error.message);
        }
        return;
      }
      if (entry.kind === 'file') await openPreview(entry.path, row);
      else setStatus('链接和特殊文件不会在桌面面板中打开。');
    });
    return row;
  };

  const appendDirectory = (container, directoryPath, level) => {
    const result = directoryCache.get(directoryPath);
    if (!result) return;
    for (const entry of result.entries || []) {
      const wrapper = create('div', 'dsh-files-node');
      wrapper.append(createRow(entry, level));
      if (entry.kind === 'directory' && expanded.has(entry.path)) {
        const group = create('div', 'dsh-files-group');
        group.setAttribute('role', 'group');
        appendDirectory(group, entry.path, level + 1);
        wrapper.append(group);
      }
      container.append(wrapper);
    }
  };

  function buttonForPath(pathValue) {
    return [...tree.querySelectorAll('.dsh-files-row')].find((button) => button.dataset.path === pathValue);
  }

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
    const root = directoryCache.get('');
    if (!root) {
      tree.append(create('p', 'dsh-files-empty', '正在读取文件…'));
      return;
    }
    appendDirectory(tree, '', 1);
    if ((root.entries || []).length === 0) tree.append(create('p', 'dsh-files-empty', '工作区中没有可显示的文件。'));
  }

  const refreshFiles = async () => {
    refreshButton.disabled = true;
    setStatus('正在刷新工作区文件…');
    directoryCache = new Map();
    searchResults = null;
    searchInput.value = '';
    expanded.clear();
    expanded.add('');
    renderTree();
    try {
      const root = await loadDirectory('', { refresh: true });
      renderTree();
      setStatus(root.truncated ? '根目录条目过多，仅显示安全上限内的项目。' : '文件已刷新。');
    } catch (error) {
      tree.replaceChildren(create('p', 'dsh-files-empty', error.message));
      setStatus('文件面板暂不可用。');
    } finally {
      refreshButton.disabled = false;
    }
  };

  const reveal = async (pathValue) => {
    if (typeof pathValue !== 'string' || !pathValue) return false;
    if (!layout.filePanelOpen) applyLayout(await api.workbench.setFilePanelOpen(true));
    searchInput.value = '';
    searchResults = null;
    const directory = parentPath(pathValue);
    const parts = directory ? directory.split('/') : [];
    try {
      await loadDirectory('');
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        await loadDirectory(current);
        expanded.add(current);
      }
      renderTree();
      const button = buttonForPath(pathValue);
      await openPreview(pathValue, button || searchInput);
      if (button) {
        button.scrollIntoView({ block: 'nearest' });
        button.focus();
      }
      return true;
    } catch (error) {
      setStatus(error.message);
      return false;
    }
  };

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = searchInput.value.trim();
    if (!query) {
      searchRequest += 1;
      searchResults = null;
      renderTree();
      setStatus('显示按需展开的工作区文件。');
      return;
    }
    searchTimer = setTimeout(async () => {
      const request = ++searchRequest;
      setStatus(`正在搜索“${query}”…`);
      const result = await api.files.search(query);
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
    closePreview();
    applyLayout(await api.workbench.setFilePanelOpen(false));
  });
  previewClose.addEventListener('click', () => closePreview());
  previewRefresh.addEventListener('click', () => {
    if (selectedPath) void openPreview(selectedPath, previousFocus);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !preview.hidden) {
      event.preventDefault();
      closePreview();
    }
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
    reveal
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
