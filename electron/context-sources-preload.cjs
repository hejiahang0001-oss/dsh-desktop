const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('contextSourcesAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('context-sources:get-state'),
  refresh: () => ipcRenderer.invoke('context-sources:refresh'),
  reveal: (id) => ipcRenderer.invoke('context-sources:reveal', id)
}));
