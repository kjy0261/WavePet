const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, session, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// 음악 플레이어 카드 크기 (제목/파형/캐릭터 + 진행 바 + 버튼)
const WINDOW_WIDTH = 360;
const WINDOW_HEIGHT = 176;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// 소리 가져오는 방식
//  - 'all': 시스템 소리 전체 (getDisplayMedia 루프백)
//  - 'exclude': 특정 프로그램(Discord) 소리만 빼고 (native/loopback 헬퍼, Windows 11)
const EXCLUDE_EXE = 'Discord.exe';
const helperPath = path
  .join(__dirname, 'native', 'bin', 'win32-x64', 'wavepet-loopback.exe')
  .replace('app.asar', 'app.asar.unpacked');
const helperAvailable = process.platform === 'win32' && process.arch === 'x64' && fs.existsSync(helperPath);

// 지금 재생 중인 곡 정보 (Windows 미디어 세션, native/media 헬퍼)
const mediaHelperPath = path
  .join(__dirname, 'native', 'bin', 'win32-x64', 'wavepet-media.exe')
  .replace('app.asar', 'app.asar.unpacked');
const mediaHelperAvailable =
  process.platform === 'win32' && process.arch === 'x64' && fs.existsSync(mediaHelperPath);

let mainWindow = null;
let tray = null;
let settings = loadSettings();

function loadSettings() {
  try {
    return { audioSource: 'exclude', ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  } catch (err) {
    return { audioSource: 'exclude' };
  }
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

// 슬라이더를 끄는 동안 파일을 계속 쓰지 않도록 잠깐 모았다가 저장
let saveTimer = null;
function saveSettingsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

// ---- 오디오 헬퍼 (Discord 제외 캡처) ----

const HELPER_MAX_ERRORS = 3; // 이 시간 안에 이만큼 실패하면 이번 실행에서는 헬퍼를 포기
const HELPER_ERROR_WINDOW_MS = 15000;

let helper = null;
let helperStatus = '';
let helperErrorTimes = [];
let helperDisabled = false; // 반복 실패로 포기한 상태
let helperRestartTimer = null;

// 실제로 쓰는 방식: 설정이 exclude여도 헬퍼를 못 쓰면 all
function effectiveAudioSource() {
  return settings.audioSource === 'exclude' && helperAvailable && !helperDisabled ? 'exclude' : 'all';
}

function recordHelperError(reason) {
  console.warn('[wavepet] 오디오 헬퍼 오류:', reason);
  const now = Date.now();
  helperErrorTimes = helperErrorTimes.filter((t) => now - t < HELPER_ERROR_WINDOW_MS);
  helperErrorTimes.push(now);
  if (helperErrorTimes.length >= HELPER_MAX_ERRORS && !helperDisabled) {
    helperDisabled = true;
    helperStatus = `사용 불가: ${reason}`;
    stopHelper();
    applyAudioSource();
    return true;
  }
  return false;
}

function startHelper() {
  if (helper) return;
  helperStatus = '시작 중';
  const child = spawn(helperPath, ['--exclude', EXCLUDE_EXE], { stdio: 'pipe', windowsHide: true });
  helper = child;

  // stdout: f32 PCM. 조각 경계가 4바이트에 안 맞을 수 있어 남는 바이트를 이어 붙인다.
  let leftover = Buffer.alloc(0);
  child.stdout.on('data', (data) => {
    const buf = leftover.length ? Buffer.concat([leftover, data]) : data;
    const usable = buf.length - (buf.length % 4);
    leftover = buf.subarray(usable);
    if (usable > 0) sendToRenderer('audio:pcm', buf.subarray(0, usable));
  });

  // stderr: 상태 한 줄씩
  let errText = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    errText += text;
    const lines = errText.split(/\r?\n/);
    errText = lines.pop();
    for (const line of lines) {
      console.log('[wavepet-loopback]', line);
      if (line === 'status all') helperStatus = `${EXCLUDE_EXE} 꺼져 있음, 전체 소리`;
      else if (line.startsWith('status excluding')) helperStatus = `${EXCLUDE_EXE} 제외 중`;
      else if (line.startsWith('error')) recordHelperError(line.slice(6));
    }
  });

  child.on('error', (err) => {
    // 실행 자체 실패 (파일 없음 등): 'exit'도 뒤따를 수 있으니 여기서는 기록만
    recordHelperError(err.message);
  });

  child.on('exit', (code) => {
    if (helper !== child) return; // 우리가 일부러 멈춘 경우
    helper = null;
    if (recordHelperError(`종료 코드 ${code}`)) return;
    clearTimeout(helperRestartTimer);
    helperRestartTimer = setTimeout(() => {
      if (effectiveAudioSource() === 'exclude') startHelper();
    }, 2000);
  });
}

function stopHelper() {
  clearTimeout(helperRestartTimer);
  if (!helper) return;
  const child = helper;
  helper = null;
  child.stdin.end(); // 헬퍼는 stdin이 닫히면 스스로 끝남
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 1000);
}

// 설정/상태에 맞춰 헬퍼를 켜거나 끄고, 렌더러에 어떤 입력을 쓸지 알린다.
function applyAudioSource() {
  const source = effectiveAudioSource();
  if (source === 'exclude') startHelper();
  else stopHelper();
  sendToRenderer('audio:source', source);
}

ipcMain.handle('audio:get-source', () => effectiveAudioSource());
ipcMain.on('audio:restart-helper', () => {
  if (effectiveAudioSource() !== 'exclude') return;
  stopHelper();
  startHelper();
});

// ---- 미디어 헬퍼 (지금 재생 중인 곡 제목) ----

const MEDIA_HELPER_MAX_RESTARTS = 3;

let mediaHelper = null;
let mediaHelperRestarts = 0;
let nowPlaying = { has: false };

function startMediaHelper() {
  if (!mediaHelperAvailable || mediaHelper) return;
  const child = spawn(mediaHelperPath, [], { stdio: 'pipe', windowsHide: true });
  mediaHelper = child;

  // stdout: 곡 정보가 바뀔 때마다 JSON 한 줄
  let text = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    text += chunk;
    const lines = text.split(/\r?\n/);
    text = lines.pop();
    for (const line of lines) {
      try {
        nowPlaying = JSON.parse(line);
      } catch (err) {
        continue;
      }
      sendToRenderer('media:now-playing', nowPlaying);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (line) => console.warn('[wavepet-media]', line.trim()));
  child.on('error', (err) => console.warn('[wavepet-media] 실행 실패:', err.message));

  child.on('exit', () => {
    if (mediaHelper !== child) return; // 일부러 멈춘 경우
    mediaHelper = null;
    nowPlaying = { has: false };
    sendToRenderer('media:now-playing', nowPlaying);
    // 제목 표시는 부가 기능이라 몇 번만 다시 시도하고 포기
    if (++mediaHelperRestarts <= MEDIA_HELPER_MAX_RESTARTS) setTimeout(startMediaHelper, 3000);
  });
}

// 카드의 이전/재생·일시정지/다음 버튼
ipcMain.on('media:command', (event, cmd) => {
  if (!mediaHelper || !['prev', 'toggle', 'next'].includes(cmd)) return;
  mediaHelper.stdin.write(`${cmd}\n`);
});

function stopMediaHelper() {
  if (!mediaHelper) return;
  const child = mediaHelper;
  mediaHelper = null;
  child.stdin.end(); // 헬퍼는 stdin이 닫히면 스스로 끝남
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 1000);
}

// ---- 캐릭터 그림 (설정 창에서 바꾸기) ----
// 사용자가 고른 그림은 userData/pet에 복사해 두어(원본을 옮기거나 지워도 유지) 기본 그림보다 우선한다.

// idle: 노래 멈출 때, listen: 노래 나올 때, left/right: 노래 나올 때 고개 까딱(왼쪽/오른쪽으로 기운 모습)
// left/right는 기본 그림이 없어도 된다(없으면 listen 그림을 기울여 대신함).
const FACE_SLOTS = ['idle', 'listen', 'left', 'right'];
const FACE_LABELS = {
  idle: '노래 멈출 때',
  listen: '노래 나올 때',
  left: '까딱 왼쪽',
  right: '까딱 오른쪽',
};
const bundledPetDir = path.join(__dirname, 'assets', 'pet');
const customPetDir = path.join(app.getPath('userData'), 'pet');

function customFacePath(slot) {
  const name = settings.faces && settings.faces[slot];
  if (!name) return null;
  const file = path.join(customPetDir, path.basename(name));
  return fs.existsSync(file) ? file : null;
}

// 쓸 그림 파일. 사용자가 고른 것 → 기본 그림 → 없음(null)
function facePath(slot) {
  const custom = customFacePath(slot);
  if (custom) return custom;
  const bundled = path.join(bundledPetDir, `${slot}.png`);
  return fs.existsSync(bundled) ? bundled : null;
}

function getFaces() {
  const urls = {};
  const custom = {};
  for (const slot of FACE_SLOTS) {
    const file = facePath(slot);
    // 같은 이름으로 다시 바꿔도 새로 읽도록 수정 시각을 붙임
    urls[slot] = file ? `${pathToFileURL(file).href}?t=${fs.statSync(file).mtimeMs}` : null;
    custom[slot] = !!customFacePath(slot);
  }
  return { urls, custom };
}

function broadcastFaces() {
  const faces = getFaces();
  sendToRenderer('pet:faces', faces);
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('pet:faces', faces);
  updateTrayIcon();
}

function removeCustomFace(slot) {
  const file = customFacePath(slot);
  if (file) {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      // 지우지 못해도 설정에서 빼면 기본 그림을 쓴다
    }
  }
  if (settings.faces) delete settings.faces[slot];
}

ipcMain.handle('pet:get-faces', () => getFaces());

ipcMain.handle('pet:pick-face', async (event, slot) => {
  if (!FACE_SLOTS.includes(slot)) return getFaces();
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(owner, {
    title: `${FACE_LABELS[slot]} 이미지 선택`,
    filters: [{ name: '이미지', extensions: ['png', 'gif', 'webp', 'jpg', 'jpeg'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return getFaces();

  removeCustomFace(slot);
  fs.mkdirSync(customPetDir, { recursive: true });
  const ext = path.extname(result.filePaths[0]).toLowerCase() || '.png';
  const name = `${slot}-${Date.now()}${ext}`;
  fs.copyFileSync(result.filePaths[0], path.join(customPetDir, name));
  settings.faces = { ...(settings.faces || {}), [slot]: name };
  saveSettings();
  broadcastFaces();
  return getFaces();
});

ipcMain.handle('pet:reset-face', (event, slot) => {
  if (FACE_SLOTS.includes(slot)) {
    removeCustomFace(slot);
    saveSettings();
    broadcastFaces();
  }
  return getFaces();
});

// ---- 배경 설정 ----

const DEFAULT_BACKGROUND = { color: '#3b414e', opacity: 0.8 };
const MIN_OPACITY = 0.2;

function sanitizeBackground(bg) {
  if (!bg || typeof bg.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(bg.color)) return null;
  const opacity = Number(bg.opacity);
  if (!Number.isFinite(opacity)) return null;
  return { color: bg.color.toLowerCase(), opacity: Math.min(1, Math.max(MIN_OPACITY, opacity)) };
}

function currentBackground() {
  return sanitizeBackground(settings.background) || DEFAULT_BACKGROUND;
}

ipcMain.handle('settings:get-background', () => currentBackground());
ipcMain.on('settings:set-background', (event, bg) => {
  const clean = sanitizeBackground(bg);
  if (!clean) return;
  settings.background = clean;
  saveSettingsSoon();
  sendToRenderer('settings:background', clean);
});

let settingsWindow = null;

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 440,
    height: 590,
    useContentSize: true, // 창 테두리/제목줄을 뺀 안쪽 크기 (설정 내용 약 440×580px)
    title: 'WavePet 설정',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#1f232b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ---- 창 / 메뉴 / 트레이 ----

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
  // 새로고침 등으로 렌더러가 다시 떠도 마지막 곡 정보를 다시 보내 줌
  mainWindow.webContents.on('did-finish-load', () => sendToRenderer('media:now-playing', nowPlaying));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleWindowVisible() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) mainWindow.hide();
  else mainWindow.show();
}

function setAudioSource(source) {
  settings.audioSource = source;
  saveSettings();
  if (source === 'exclude') {
    // 사용자가 다시 고르면 한 번 더 기회를 준다
    helperDisabled = false;
    helperErrorTimes = [];
  }
  applyAudioSource();
}

function audioStatusLabel() {
  if (effectiveAudioSource() === 'all') {
    return helperDisabled ? `상태: 전체 소리 (Discord 제외 ${helperStatus})` : '상태: 전체 소리';
  }
  return `상태: ${helperStatus}`;
}

function buildMenuTemplate() {
  const visible = !!mainWindow && mainWindow.isVisible();
  return [
    { label: visible ? 'WavePet 숨기기' : 'WavePet 보이기', click: toggleWindowVisible },
    {
      label: '소리 가져오기',
      submenu: [
        {
          label: '전체 소리',
          type: 'radio',
          checked: settings.audioSource === 'all',
          click: () => setAudioSource('all'),
        },
        {
          label: `${EXCLUDE_EXE.replace('.exe', '')} 소리 제외 (Windows 11)`,
          type: 'radio',
          checked: settings.audioSource === 'exclude',
          enabled: helperAvailable,
          click: () => setAudioSource('exclude'),
        },
        { type: 'separator' },
        { label: audioStatusLabel(), enabled: false },
      ],
    },
    { label: '설정 (배경 · 캐릭터)...', click: openSettingsWindow },
    {
      label: '오디오 다시 연결',
      click: () => sendToRenderer('audio:reconnect'),
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

function trayImage() {
  return nativeImage.createFromPath(facePath('idle')).resize({ width: 32, height: 32 });
}

// 노래 멈출 때 그림을 바꾸면 트레이 아이콘도 따라 바꾼다
function updateTrayIcon() {
  if (!tray) return;
  try {
    tray.setImage(trayImage());
  } catch (err) {
    // 못 읽는 그림이면 이전 아이콘 유지
  }
}

function createTray() {
  tray = new Tray(trayImage());
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
  if (effectiveAudioSource() === 'exclude') startHelper();
  startMediaHelper();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  clearTimeout(saveTimer);
  saveSettings();
  stopHelper();
  stopMediaHelper();
});
