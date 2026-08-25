const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('officeCenterAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('office-center:get-state'),
  invoke: (id) => ipcRenderer.invoke('office-center:invoke', id)
}));
