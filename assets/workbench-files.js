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
  const formatSize = (bytes) => {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };
  const mediaKindForPath = (value) => {
    if (/\.(?:png|jpe?g|webp|gif)$/i.test(value)) return 'image';
    if (/\.pdf$/i.test(value)) return 'pdf';
    return '';
  };
  const blobFromBase64 = (base64, mimeType) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
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
  const status = create('p', 'dsh-files-status', '普通文件浏览请使用官方右侧文件面板；这里提供文件名搜索和只读预览。');
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
  const appPreviewButton = create('button', 'dsh-file-preview-button', '应用预览');
  appPreviewButton.type = 'button';
  appPreviewButton.hidden = true;
  appPreviewButton.title = '在隔离的本机应用预览中运行此 HTML';
  const previewRefresh = create('button', 'dsh-file-preview-button', '重新读取');
  previewRefresh.type = 'button';
  const previewClose = create('button', 'dsh-file-preview-button dsh-file-preview-close', '×');
  previewClose.type = 'button';
  previewClose.title = '关闭文件预览';
  previewClose.setAttribute('aria-label', '关闭文件预览');
  previewActions.append(appPreviewButton, previewRefresh, previewClose);
  previewHeader.append(previewIdentity, previewMeta, previewActions);
  const mediaToolbar = create('div', 'dsh-file-preview-toolbar');
  mediaToolbar.hidden = true;
  mediaToolbar.setAttribute('role', 'toolbar');
  mediaToolbar.setAttribute('aria-label', '图片和 PDF 预览控制');
  const previousPage = create('button', 'dsh-file-preview-button', '上一页');
  previousPage.type = 'button';
  const pageLabel = create('label', 'dsh-file-preview-page');
  const pageText = create('span', '', '第');
  const pageInput = create('input');
  pageInput.type = 'number';
  pageInput.min = '1';
  pageInput.value = '1';
  pageInput.setAttribute('aria-label', 'PDF 页码');
  pageLabel.append(pageText, pageInput, create('span', '', '页'));
  const nextPage = create('button', 'dsh-file-preview-button', '下一页');
  nextPage.type = 'button';
  const toolbarSpacer = create('span', 'dsh-file-preview-toolbar-spacer');
  const zoomOut = create('button', 'dsh-file-preview-button', '−');
  zoomOut.type = 'button';
  zoomOut.title = '缩小';
  zoomOut.setAttribute('aria-label', '缩小预览');
  const zoomLabel = create('output', 'dsh-file-preview-zoom', '适合窗口');
  zoomLabel.setAttribute('aria-live', 'polite');
  const zoomIn = create('button', 'dsh-file-preview-button', '+');
  zoomIn.type = 'button';
  zoomIn.title = '放大';
  zoomIn.setAttribute('aria-label', '放大预览');
  const fitButton = create('button', 'dsh-file-preview-button', '适合窗口');
  fitButton.type = 'button';
  mediaToolbar.append(previousPage, pageLabel, nextPage, toolbarSpacer, zoomOut, zoomLabel, zoomIn, fitButton);
  const previewBody = create('div', 'dsh-file-preview-body');
  previewBody.tabIndex = 0;
  previewBody.setAttribute('aria-label', '只读文件内容');
  const previewCode = create('pre', 'dsh-file-preview-code');
  const mediaStage = create('div', 'dsh-file-preview-media');
  mediaStage.hidden = true;
  const previewImage = create('img', 'dsh-file-preview-image');
  previewImage.alt = '';
  previewImage.hidden = true;
  const previewPdf = create('embed', 'dsh-file-preview-pdf');
  previewPdf.title = 'PDF 只读预览';
  previewPdf.type = 'application/pdf';
  previewPdf.hidden = true;
  mediaStage.append(previewImage, previewPdf);
  previewBody.append(previewCode, mediaStage);
  const previewNotice = create('p', 'dsh-file-preview-notice', '只读预览，不会修改磁盘文件。');
  preview.append(previewHeader, mediaToolbar, previewBody, previewNotice);
  document.body.append(panel, preview);

  let layout = { ...bootstrap };
  let workspace = {};
  let searchResults = null;
  let selectedPath = '';
  let previewRequest = 0;
  let searchRequest = 0;
  let searchTimer;
  let previousFocus = null;
  let mediaObjectUrl = '';
  let currentMediaKind = '';
  let imageScale = 0;
  let pdfPage = 1;
  let pdfZoom = 0;

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

  const clearMediaPreview = () => {
    previewImage.removeAttribute('src');
    previewPdf.removeAttribute('src');
    previewImage.hidden = true;
    previewPdf.hidden = true;
    mediaStage.hidden = true;
    mediaToolbar.hidden = true;
    if (mediaObjectUrl) URL.revokeObjectURL(mediaObjectUrl);
    mediaObjectUrl = '';
    currentMediaKind = '';
    imageScale = 0;
    pdfPage = 1;
    pdfZoom = 0;
  };

  const closePreview = ({ restoreFocus = true } = {}) => {
    if (preview.hidden) return;
    previewRequest += 1;
    clearMediaPreview();
    preview.hidden = true;
    preview.inert = true;
    delete document.documentElement.dataset.dshFilePreviewOpen;
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  };

  const updatePdfSource = () => {
    if (currentMediaKind !== 'pdf' || !mediaObjectUrl) return;
    const zoom = pdfZoom > 0 ? String(pdfZoom) : 'page-fit';
    previewPdf.src = `${mediaObjectUrl}#page=${pdfPage}&zoom=${zoom}&toolbar=0&navpanes=0`;
    pageInput.value = String(pdfPage);
    zoomLabel.textContent = pdfZoom > 0 ? `${pdfZoom}%` : '适合窗口';
  };

  const applyImageScale = () => {
    if (currentMediaKind !== 'image') return;
    const fitted = imageScale === 0;
    previewImage.dataset.fit = String(fitted);
    if (fitted) {
      previewImage.style.removeProperty('width');
      previewImage.style.removeProperty('height');
      zoomLabel.textContent = '适合窗口';
    } else {
      previewImage.style.width = `${Math.max(1, Math.round(previewImage.naturalWidth * imageScale / 100))}px`;
      previewImage.style.height = `${Math.max(1, Math.round(previewImage.naturalHeight * imageScale / 100))}px`;
      zoomLabel.textContent = `${imageScale}%`;
    }
  };

  const setMediaControls = (kind) => {
    const pdf = kind === 'pdf';
    previousPage.hidden = !pdf;
    pageLabel.hidden = !pdf;
    nextPage.hidden = !pdf;
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
    previewCode.hidden = false;
    clearMediaPreview();
    appPreviewButton.hidden = !/\.html?$/i.test(pathValue);
    appPreviewButton.disabled = true;
    const request = ++previewRequest;
    const requestedMediaKind = mediaKindForPath(pathValue);
    const result = requestedMediaKind ? await api.files.preview(pathValue) : await api.files.read(pathValue);
    if (request !== previewRequest) return;
    if (!result?.available) {
      previewMeta.textContent = '不可预览';
      previewCode.textContent = result?.message || '该文件当前无法安全预览。';
      appPreviewButton.hidden = true;
      return;
    }
    if (requestedMediaKind) {
      currentMediaKind = result.kind;
      mediaObjectUrl = URL.createObjectURL(blobFromBase64(result.base64, result.mimeType));
      previewCode.hidden = true;
      mediaStage.hidden = false;
      mediaToolbar.hidden = false;
      setMediaControls(result.kind);
      previewNotice.textContent = result.kind === 'pdf'
        ? 'PDF 在本机内存中只读打开；页码可直接输入，关闭后立即释放。'
        : '图片在本机内存中只读打开；不会上传或修改原文件。';
      if (result.kind === 'image') {
        previewImage.hidden = false;
        previewImage.alt = `${pathValue} 图片预览`;
        previewImage.addEventListener('load', () => {
          if (request !== previewRequest) return;
          previewMeta.textContent = [
            `${previewImage.naturalWidth} × ${previewImage.naturalHeight}`,
            result.mimeType,
            result.extensionMismatch ? '已按真实图片格式识别' : '',
            formatSize(result.size)
          ].filter(Boolean).join(' · ');
          applyImageScale();
        }, { once: true });
        previewImage.addEventListener('error', () => {
          if (request !== previewRequest) return;
          clearMediaPreview();
          previewCode.hidden = false;
          previewCode.textContent = '图片解码失败，文件可能已损坏或编码不受当前系统支持。';
          previewMeta.textContent = '加载失败';
        }, { once: true });
        previewImage.src = mediaObjectUrl;
      } else {
        previewPdf.hidden = false;
        previewMeta.textContent = ['PDF', formatSize(result.size)].join(' · ');
        updatePdfSource();
      }
      previewBody.scrollTop = 0;
      return;
    }
    previewMeta.textContent = [result.language, result.encoding, `${result.lineCount} 行`, formatSize(result.size)].filter(Boolean).join(' · ');
    previewCode.textContent = result.content || '（空文件）';
    appPreviewButton.disabled = false;
    previewNotice.textContent = '只读预览，不会修改磁盘文件。';
    previewBody.scrollTop = 0;
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
    tree.append(create('p', 'dsh-files-empty', '输入文件名搜索。浏览目录和打开文本标签请使用官方右侧文件面板。'));
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
      await openPreview(pathValue, searchInput);
      return true;
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
    closePreview();
    applyLayout(await api.workbench.setFilePanelOpen(false));
  });
  previewClose.addEventListener('click', () => closePreview());
  previewRefresh.addEventListener('click', () => {
    if (selectedPath) void openPreview(selectedPath, previousFocus);
  });
  appPreviewButton.addEventListener('click', () => {
    if (selectedPath && !appPreviewButton.disabled) void window.__DSH_PREVIEW__?.openFile?.(selectedPath);
  });
  previousPage.addEventListener('click', () => {
    pdfPage = Math.max(1, pdfPage - 1);
    updatePdfSource();
  });
  nextPage.addEventListener('click', () => {
    pdfPage += 1;
    updatePdfSource();
  });
  pageInput.addEventListener('change', () => {
    pdfPage = Math.max(1, Math.round(Number(pageInput.value) || 1));
    updatePdfSource();
  });
  zoomOut.addEventListener('click', () => {
    if (currentMediaKind === 'image') {
      imageScale = Math.max(25, (imageScale || 100) - 25);
      applyImageScale();
    } else if (currentMediaKind === 'pdf') {
      pdfZoom = Math.max(50, (pdfZoom || 100) - 25);
      updatePdfSource();
    }
  });
  zoomIn.addEventListener('click', () => {
    if (currentMediaKind === 'image') {
      imageScale = Math.min(400, (imageScale || 100) + 25);
      applyImageScale();
    } else if (currentMediaKind === 'pdf') {
      pdfZoom = Math.min(300, (pdfZoom || 100) + 25);
      updatePdfSource();
    }
  });
  fitButton.addEventListener('click', () => {
    if (currentMediaKind === 'image') {
      imageScale = 0;
      applyImageScale();
    } else if (currentMediaKind === 'pdf') {
      pdfZoom = 0;
      updatePdfSource();
    }
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
    reveal,
    refresh: refreshFiles,
    closePreview
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
