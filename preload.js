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

  // 캐릭터 크기 배율 (0.6~1.2)
  getPetSize: () => ipcRenderer.invoke('settings:get-pet-size'),
  setPetSize: (size) => ipcRenderer.send('settings:set-pet-size', size),
  onPetSize: (callback) => ipcRenderer.on('settings:pet-size', (_event, size) => callback(size)),

  // 캐릭터 애니메이션 {interval: 초, tilt: 도, bob: %, notes: bool}
  getAnimation: () => ipcRenderer.invoke('settings:get-animation'),
  setAnimation: (anim) => ipcRenderer.send('settings:set-animation', anim),
  onAnimation: (callback) => ipcRenderer.on('settings:animation', (_event, anim) => callback(anim)),

  // 캐릭터 그림 {urls, custom, bounds}: 각각 slot('idle' | 'left' | 'right')별 값.
  // bounds는 그림에서 실제로 그려진 영역 비율 {x0, y0, x1, y1} (없으면 null)
  getFaces: () => ipcRenderer.invoke('pet:get-faces'),
  pickFace: (slot) => ipcRenderer.invoke('pet:pick-face', slot),
  resetFace: (slot) => ipcRenderer.invoke('pet:reset-face', slot),
  onFaces: (callback) => ipcRenderer.on('pet:faces', (_event, faces) => callback(faces)),
});
