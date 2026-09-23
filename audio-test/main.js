// 1단계 확인용: 스피커로 나가는 소리(유튜브 등)가 시스템 오디오 루프백으로
// 잡히는지만 확인하는 독립 테스트 창. 본 앱(../main.js)과는 무관하며,
// 확인이 끝나면 폴더째 지워도 된다.
const { app, BrowserWindow, session, desktopCapturer } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  // 렌더러가 getDisplayMedia()를 호출하면 선택 창 없이 바로
  // 주 화면 + 시스템 소리(loopback)를 넘겨준다. loopback은 Windows에서 지원된다.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch((err) => {
        console.error('[audio-test] 화면 소스 조회 실패:', err);
        callback({});
      });
  });

  const win = new BrowserWindow({
    width: 720,
    height: 360,
    title: 'WavePet 오디오 캡처 테스트',
    backgroundColor: '#0f1c2e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.openDevTools({ mode: 'detach' });
});

app.on('window-all-closed', () => app.quit());
