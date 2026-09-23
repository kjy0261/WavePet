const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  onReconnectAudio: (callback) => ipcRenderer.on('audio:reconnect', callback),
  moveBy: (dx, dy) => ipcRenderer.send('pet:move-by', dx, dy),
});
