const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jarvisDesktop', {
  daemon: () => ipcRenderer.invoke('jarvis:daemon'),
  voice: (action, payload) => ipcRenderer.invoke('jarvis:voice', action, payload),
  tts: (action, payload) => ipcRenderer.invoke('jarvis:tts', action, payload),
  onTtsProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('jarvis:tts-progress', listener);
    return () => ipcRenderer.removeListener('jarvis:tts-progress', listener);
  }
});

