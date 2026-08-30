const { contextBridge, ipcRenderer, webUtils } = require('electron');
// Apply a host-confirmed one-shot selection before the upstream app boots.
// Writing only in the outgoing page can be overwritten by its unload mirror.
try {
  if (process.isMainFrame) {
    const selected = ipcRenderer.sendSync('harness:take-selection-intent');
    if (typeof selected === 'string' && /^session-[0-9a-f-]{36}$/i.test(selected)) localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: selected }));
  }
} catch { /* Startup synchronization still verifies the selected session. */ }

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  drafts: Object.freeze({
    getState: () => ipcRenderer.invoke('drafts:get-state'),
    save: (request) => ipcRenderer.invoke('drafts:save', request)
  }),
  documents: Object.freeze({
    getState: () => ipcRenderer.invoke('documents:get-state'),
    choose: (context) => ipcRenderer.invoke('documents:choose', context),
    importFiles: (files, context) => {
      if (!Array.isArray(files) || files.length < 1 || files.length > 10) return Promise.resolve({ ok: false, message: '每次最多添加 10 个文件。' });
      const paths = files.map((file) => webUtils.getPathForFile(file));
      if (paths.some((value) => !value)) return Promise.resolve({ ok: false, message: '请从本机资源管理器拖入文件，或点击添加文件。' });
      return ipcRenderer.invoke('documents:import', paths, context);
    }
  }),
  app: Object.freeze({
    getInfo: () => ipcRenderer.invoke('app:get-info')
  }),
  network: Object.freeze({
    getState: () => ipcRenderer.invoke('network:get-state'),
    test: (settings) => ipcRenderer.invoke('network:test', settings),
    save: (settings) => ipcRenderer.invoke('network:save', settings)
  }),
  workspace: Object.freeze({
    getState: () => ipcRenderer.invoke('workspace:get-state'),
    choose: () => ipcRenderer.invoke('workspace:choose')
  }),
  diagnostics: Object.freeze({
    getState: () => ipcRenderer.invoke('diagnostics:get-state'),
    refresh: () => ipcRenderer.invoke('diagnostics:refresh'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('diagnostics:state', handler);
      return () => ipcRenderer.removeListener('diagnostics:state', handler);
    }
  }),
  support: Object.freeze({
    exportDiagnostics: () => ipcRenderer.invoke('support:export-diagnostics'),
    createBackup: () => ipcRenderer.invoke('support:create-backup'),
    validateBackup: () => ipcRenderer.invoke('support:validate-backup')
  }),
  changes: Object.freeze({
    getDiff: (filePath) => ipcRenderer.invoke('changes:get-diff', filePath),
    refresh: () => ipcRenderer.invoke('changes:refresh'),
    accept: (filePath) => ipcRenderer.invoke('changes:accept', filePath),
    reject: (filePath) => ipcRenderer.invoke('changes:reject', filePath),
    acceptAll: () => ipcRenderer.invoke('changes:accept-all'),
    rejectAll: () => ipcRenderer.invoke('changes:reject-all')
  }),
  reviews: Object.freeze({
    list: (options) => ipcRenderer.invoke('reviews:list', options),
    diff: (options) => ipcRenderer.invoke('reviews:diff', options),
    addComment: (options) => ipcRenderer.invoke('reviews:add-comment', options),
    removeComment: (id) => ipcRenderer.invoke('reviews:remove-comment', id),
    listComments: () => ipcRenderer.invoke('reviews:list-comments'),
    prompt: () => ipcRenderer.invoke('reviews:prompt')
  }),
  workbench: Object.freeze({
    getState: () => ipcRenderer.invoke('workbench:get-state'),
    setFilePanelOpen: (open) => ipcRenderer.invoke('workbench:set-file-panel-open', open),
    setFilePanelWidth: (width) => ipcRenderer.invoke('workbench:set-file-panel-width', width),
    setReviewPanelOpen: (open) => ipcRenderer.invoke('workbench:set-review-panel-open', open),
    setReviewPanelWidth: (width) => ipcRenderer.invoke('workbench:set-review-panel-width', width),
    setPreviewPanelOpen: (open) => ipcRenderer.invoke('workbench:set-preview-panel-open', open),
    setUiZoomFactor: (factor) => ipcRenderer.invoke('workbench:set-ui-zoom-factor', factor),
    resetLayout: () => ipcRenderer.invoke('workbench:reset-layout')
  }),
  checkpoints: Object.freeze({
    getState: () => ipcRenderer.invoke('checkpoints:get-state'),
    create: () => ipcRenderer.invoke('checkpoints:create-manual'),
    createAutomatic: () => ipcRenderer.invoke('checkpoints:create-automatic'),
    matchesCurrentSession: () => ipcRenderer.invoke('checkpoints:matches-current-session'),
    listHistory: () => ipcRenderer.invoke('checkpoints:list-history'),
    forkSession: (id) => ipcRenderer.invoke('checkpoints:fork-session', id),
    restore: (id) => ipcRenderer.invoke('checkpoints:restore', id),
    restoreLatest: () => ipcRenderer.invoke('checkpoints:restore-latest'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('checkpoints:state', handler);
      return () => ipcRenderer.removeListener('checkpoints:state', handler);
    }
  }),
  files: Object.freeze({
    list: (directoryPath = '') => ipcRenderer.invoke('files:list', directoryPath),
    read: (filePath) => ipcRenderer.invoke('files:read', filePath),
    preview: (filePath) => ipcRenderer.invoke('files:preview', filePath),
    search: (query) => ipcRenderer.invoke('files:search', query)
  }),
  preview: Object.freeze({
    getState: () => ipcRenderer.invoke('preview:get-state'),
    openFile: (filePath) => ipcRenderer.invoke('preview:open-file', filePath),
    connect: (url) => ipcRenderer.invoke('preview:connect', url),
    stop: () => ipcRenderer.invoke('preview:stop'),
    openExternal: () => ipcRenderer.invoke('preview:open-external'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('preview:state', handler);
      return () => ipcRenderer.removeListener('preview:state', handler);
    }
  }),
  terminal: Object.freeze({
    openWindow: () => ipcRenderer.invoke('terminal:open-window')
  }),
  sideChat: Object.freeze({
    openWindow: () => ipcRenderer.invoke('side-chat:open-window')
  }),
  extensions: Object.freeze({
    openWindow: () => ipcRenderer.invoke('extensions:open-window')
  }),
  office: Object.freeze({
    openWindow: () => ipcRenderer.invoke('office-center:open-window')
  }),
  wiki: Object.freeze({
    openWindow: () => ipcRenderer.invoke('wiki-center:open-window')
  }),
  delivery: Object.freeze({
    openWindow: () => ipcRenderer.invoke('git-delivery:open-window')
  }),
  harness: Object.freeze({
    workflowState: () => ipcRenderer.invoke('harness:workflow-state'),
    getState: () => ipcRenderer.invoke('harness:get-state'),
    interruptAndPrompt: (text) => ipcRenderer.invoke('harness:interrupt-and-prompt', text),
    interruptQueued: () => ipcRenderer.invoke('harness:interrupt-queued'),
    restart: () => ipcRenderer.invoke('harness:restart'),
    openLog: () => ipcRenderer.invoke('harness:open-log'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('harness:state', handler);
      return () => ipcRenderer.removeListener('harness:state', handler);
    }
  })
}));
