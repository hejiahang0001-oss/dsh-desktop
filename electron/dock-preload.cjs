const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dockAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('dock:get-state'),
  act: (action, value) => ipcRenderer.invoke('dock:act', action, value),
  onState: (listener) => { const handler = (_event, state) => listener(state); ipcRenderer.on('dock:state', handler); return () => ipcRenderer.removeListener('dock:state', handler); }
}));
