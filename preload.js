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

  // 지금 재생 중인 곡 {has, playing, title, artist, app, position, duration}
  onNowPlaying: (callback) => ipcRenderer.on('media:now-playing', (_event, info) => callback(info)),
  mediaCommand: (cmd) => ipcRenderer.send('media:command', cmd),

  // 배경 설정 {color: '#rrggbb', opacity: 0~1}
  getBackground: () => ipcRenderer.invoke('settings:get-background'),
  setBackground: (bg) => ipcRenderer.send('settings:set-background', bg),
  onBackground: (callback) => ipcRenderer.on('settings:background', (_event, bg) => callback(bg)),
});
