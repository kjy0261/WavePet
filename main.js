const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, session, desktopCapturer } = require('electron');
const path = require('path');

// 왼쪽 파형 + 오른쪽 펫이 들어가는 가로형 위젯 크기
const WINDOW_WIDTH = 460;
const WINDOW_HEIGHT = 170;

const petIconPath = path.join(__dirname, 'assets', 'pet', 'idle.png');

let mainWindow = null;
let tray = null;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: width - WINDOW_WIDTH - 40,
    y: height - WINDOW_HEIGHT - 40,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindowVisible() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.show();
}

function buildMenuTemplate() {
  const visible = !!mainWindow && mainWindow.isVisible();
  return [
    { label: visible ? 'WavePet 숨기기' : 'WavePet 보이기', click: toggleWindowVisible },
    {
      label: '오디오 다시 연결',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('audio:reconnect');
      },
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ];
}

ipcMain.on('pet:context-menu', () => {
  if (!mainWindow) return;
  Menu.buildFromTemplate(buildMenuTemplate()).popup({ window: mainWindow });
});

ipcMain.on('pet:move-by', (event, dx, dy) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + Number(dx || 0)), Math.round(y + Number(dy || 0)));
});

function createTray() {
  tray = new Tray(nativeImage.createFromPath(petIconPath).resize({ width: 32, height: 32 }));
  tray.setToolTip('WavePet: 클릭 보이기/숨기기, 우클릭 메뉴');
  tray.on('click', toggleWindowVisible);
  tray.on('right-click', () => {
    tray.popUpContextMenu(Menu.buildFromTemplate(buildMenuTemplate()));
  });
}

// 렌더러의 getDisplayMedia() 요청에 선택 창 없이 주 화면 + 시스템 소리(loopback)로
// 응답한다. 영상은 쓰지 않지만 getDisplayMedia가 요구해서 함께 넘긴다.
function allowLoopbackAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch((err) => {
        console.error('[wavepet] 화면 소스 조회 실패:', err);
        callback({});
      });
  });
}

app.whenReady().then(() => {
  allowLoopbackAudioCapture();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
