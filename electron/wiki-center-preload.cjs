'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wikiCenterAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('wiki-center:get-state'),
  chooseVault: () => ipcRenderer.invoke('wiki-center:choose-vault'),
  initializeVault: () => ipcRenderer.invoke('wiki-center:initialize-vault'),
  query: (query) => ipcRenderer.invoke('wiki-center:query', query),
  previewProjectSync: () => ipcRenderer.invoke('wiki-center:preview-project-sync'),
  invokeProjectSync: () => ipcRenderer.invoke('wiki-center:invoke-project-sync'),
  getSessionCandidates: () => ipcRenderer.invoke('wiki-center:get-session-candidates'),
  previewCapture: (capture) => ipcRenderer.invoke('wiki-center:preview-capture', capture),
  saveCapture: (capture) => ipcRenderer.invoke('wiki-center:save-capture', capture)
}));
