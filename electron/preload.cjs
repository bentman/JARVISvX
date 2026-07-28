const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jarvisDesktop', { daemon: () => ipcRenderer.invoke('jarvis:daemon'), voice: (action, payload) => ipcRenderer.invoke('jarvis:voice', action, payload) });
