const stage = document.getElementById('stage');
const waveCanvas = document.getElementById('wave');

const BAR_COUNT = 40;

// 1단계: 오디오 연결 전이라 무음 상태(최소 높이 막대)만 그린다.
const visualizer = Visualizer.create(waveCanvas);
const silentLevels = new Array(BAR_COUNT).fill(0);
visualizer.draw(silentLevels);
window.addEventListener('resize', () => visualizer.draw(silentLevels));

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
