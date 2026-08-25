const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tasksSubagentsAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('tasks-subagents:get-state'),
  refresh: () => ipcRenderer.invoke('tasks-subagents:refresh'),
  open: (id) => ipcRenderer.invoke('tasks-subagents:open', id),
  prompt: (id, text) => ipcRenderer.invoke('tasks-subagents:prompt', id, text),
  interrupt: (id) => ipcRenderer.invoke('tasks-subagents:interrupt', id),
  onState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('tasks-subagents:state', handler);
    return () => ipcRenderer.removeListener('tasks-subagents:state', handler);
  }
}));
