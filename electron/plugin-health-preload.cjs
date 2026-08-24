const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pluginHealthAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('plugin-health:get-state'),
  refresh: () => ipcRenderer.invoke('plugin-health:refresh'),
  reveal: (id) => ipcRenderer.invoke('plugin-health:reveal', id),
  toggle: (profileId, packageName, enable) => ipcRenderer.invoke('plugin-health:toggle', profileId, packageName, enable)
}));
