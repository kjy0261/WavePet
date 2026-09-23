const stage = document.getElementById('stage');
const waveCanvas = document.getElementById('wave');

const BAR_COUNT = 40;
const FRAME_INTERVAL_MS = 1000 / 30; // 켜 두는 위젯이라 30fps로 제한

const visualizer = Visualizer.create(waveCanvas);
const spectrum = Spectrum.create(BAR_COUNT);
const audio = AudioInput.create({
  onStatus: (status) => console.log('[wavepet] audio:', status),
});
audio.start();

window.petAPI.onReconnectAudio(() => audio.reconnect());

// 창이 숨겨지면 requestAnimationFrame이 멈추므로 별도 정지 처리는 필요 없다.
let lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (now - lastFrame < FRAME_INTERVAL_MS - 2) return; // 60Hz에서 2프레임마다 한 번 그리도록 여유를 둠
  lastFrame = now;
  const levels = spectrum.update(audio.getFrequencyData(), audio.binHz);
  visualizer.draw(levels);
}
requestAnimationFrame(frame);

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.petAPI.showContextMenu();
});

// 드래그로 창 이동. movementX/Y는 포인터 캡처 직후 0으로 읽힐 수 있어
// 절대 좌표(screenX/Y) 차이로 계산한다.
let dragPointerId = null;
let lastScreenX = 0;
let lastScreenY = 0;

stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return; // 왼쪽 버튼만. 우클릭은 메뉴
  dragPointerId = event.pointerId;
  lastScreenX = event.screenX;
  lastScreenY = event.screenY;
  stage.setPointerCapture(dragPointerId);
  stage.style.cursor = 'grabbing';
});

stage.addEventListener('pointermove', (event) => {
  if (dragPointerId === null || event.pointerId !== dragPointerId) return;
  const dx = event.screenX - lastScreenX;
  const dy = event.screenY - lastScreenY;
  lastScreenX = event.screenX;
  lastScreenY = event.screenY;
  if (dx !== 0 || dy !== 0) window.petAPI.moveBy(dx, dy);
});

function endDrag(event) {
  if (dragPointerId === null || event.pointerId !== dragPointerId) return;
  stage.releasePointerCapture(dragPointerId);
  dragPointerId = null;
  stage.style.cursor = 'grab';
}

stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
