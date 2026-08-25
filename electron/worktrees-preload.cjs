const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('worktreesAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('worktrees:get-state'),
  refresh: () => ipcRenderer.invoke('worktrees:refresh'),
  create: () => ipcRenderer.invoke('worktrees:create'),
  activate: (id) => ipcRenderer.invoke('worktrees:activate', id),
  reveal: (id) => ipcRenderer.invoke('worktrees:reveal', id),
  remove: (id) => ipcRenderer.invoke('worktrees:remove', id),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('worktrees:state', handler);
    return () => ipcRenderer.removeListener('worktrees:state', handler);
  }
}));
