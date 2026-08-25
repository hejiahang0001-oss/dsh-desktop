const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
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
  changes: Object.freeze({
    getDiff: (filePath) => ipcRenderer.invoke('changes:get-diff', filePath),
    refresh: () => ipcRenderer.invoke('changes:refresh'),
    accept: (filePath) => ipcRenderer.invoke('changes:accept', filePath),
    reject: (filePath) => ipcRenderer.invoke('changes:reject', filePath),
    acceptAll: () => ipcRenderer.invoke('changes:accept-all'),
    rejectAll: () => ipcRenderer.invoke('changes:reject-all')
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
  harness: Object.freeze({
    getState: () => ipcRenderer.invoke('harness:get-state'),
    restart: () => ipcRenderer.invoke('harness:restart'),
    openLog: () => ipcRenderer.invoke('harness:open-log'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('harness:state', handler);
      return () => ipcRenderer.removeListener('harness:state', handler);
    }
  })
}));
