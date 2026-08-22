const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', Object.freeze({
  app: Object.freeze({
    getInfo: () => ipcRenderer.invoke('app:get-info')
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
    setTerminalPanelOpen: (open) => ipcRenderer.invoke('workbench:set-terminal-panel-open', open),
    setTerminalPanelHeight: (height) => ipcRenderer.invoke('workbench:set-terminal-panel-height', height)
  }),
  files: Object.freeze({
    list: (directoryPath = '') => ipcRenderer.invoke('files:list', directoryPath),
    read: (filePath) => ipcRenderer.invoke('files:read', filePath),
    search: (query) => ipcRenderer.invoke('files:search', query)
  }),
  terminal: Object.freeze({
    getState: () => ipcRenderer.invoke('terminal:get-state'),
    run: (command) => ipcRenderer.invoke('terminal:run', command),
    stop: () => ipcRenderer.invoke('terminal:stop'),
    onState: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('terminal:state', handler);
      return () => ipcRenderer.removeListener('terminal:state', handler);
    },
    onOutput: (listener) => {
      const handler = (_event, output) => listener(output);
      ipcRenderer.on('terminal:output', handler);
      return () => ipcRenderer.removeListener('terminal:output', handler);
    }
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
