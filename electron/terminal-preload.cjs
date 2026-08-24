const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('terminal:get-state'),
  start: (size) => ipcRenderer.invoke('terminal:start', size),
  write: (data) => ipcRenderer.send('terminal:write', data),
  resize: (size) => ipcRenderer.send('terminal:resize', size),
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
}));
