const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadURL: (url) => ipcRenderer.invoke('load-url', url),
  assessURL: (url) => ipcRenderer.invoke('assess-url', url),
  getMicrophoneAccessStatus: () => ipcRenderer.invoke('get-microphone-access'),
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access'),
  aiChat: (payload) => ipcRenderer.invoke('ai-chat', payload),
  onSecurityEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('zero-security-event', listener);
    return () => ipcRenderer.removeListener('zero-security-event', listener);
  },
});
