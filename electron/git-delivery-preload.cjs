'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gitDeliveryAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('git-delivery:get-state'),
  refresh: (includeRemote = false) => ipcRenderer.invoke('git-delivery:refresh', includeRemote === true),
  commit: (message, fingerprint) => ipcRenderer.invoke('git-delivery:commit', message, fingerprint),
  openLink: (id) => ipcRenderer.invoke('git-delivery:open-link', id),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('git-delivery:state', handler);
    return () => ipcRenderer.removeListener('git-delivery:state', handler);
  }
}));
