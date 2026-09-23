const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  moveBy: (dx, dy) => ipcRenderer.send('pet:move-by', dx, dy),
});
