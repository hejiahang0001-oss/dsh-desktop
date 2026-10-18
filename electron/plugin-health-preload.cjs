const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pluginHealthAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('plugin-health:get-state'),
  refresh: () => ipcRenderer.invoke('plugin-health:refresh'),
  reveal: (id) => ipcRenderer.invoke('plugin-health:reveal', id),
  openOfficial: () => ipcRenderer.invoke('plugin-health:open-official'),
  rollbackHistory: (profileId, catalogId) => ipcRenderer.invoke('plugin-health:rollback-history', profileId, catalogId)
}));
