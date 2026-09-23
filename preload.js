const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  showContextMenu: () => ipcRenderer.send('pet:context-menu'),
  onReconnectAudio: (callback) => ipcRenderer.on('audio:reconnect', callback),
  moveBy: (dx, dy) => ipcRenderer.send('pet:move-by', dx, dy),

  // 소리 입력 방식: 'all'(getDisplayMedia 루프백) | 'exclude'(헬퍼가 보내는 PCM)
  getAudioSource: () => ipcRenderer.invoke('audio:get-source'),
  onAudioSource: (callback) => ipcRenderer.on('audio:source', (_event, source) => callback(source)),
  onPcm: (callback) => ipcRenderer.on('audio:pcm', (_event, bytes) => callback(bytes)),
  restartAudioHelper: () => ipcRenderer.send('audio:restart-helper'),
});
