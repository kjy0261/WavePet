// 설정 창: 캐릭터 그림(노래 나올 때 / 멈출 때)과 배경 색·불투명도. 바꾸면 바로 위젯에 반영된다.
const DEFAULT_BACKGROUND = { color: '#3b414e', opacity: 0.8 };
const PRESETS = [
  { name: '그레이 글래스 (기본)', color: '#3b414e' },
  { name: '네이비', color: '#1b2a41' },
  { name: '블랙', color: '#111214' },
  { name: '퍼플', color: '#3d2c5a' },
  { name: '핑크', color: '#f4b6c8' },
  { name: '민트', color: '#b8e6d4' },
  { name: '화이트', color: '#f5f5f7' },
];

const presetsEl = document.getElementById('presets');
const colorInput = document.getElementById('color');
const colorValue = document.getElementById('color-value');
const opacityInput = document.getElementById('opacity');
const opacityValue = document.getElementById('opacity-value');

let bg = { ...DEFAULT_BACKGROUND };

function render() {
  colorInput.value = bg.color;
  colorValue.textContent = bg.color.toUpperCase();
  opacityInput.value = Math.round(bg.opacity * 100);
  opacityValue.textContent = `${Math.round(bg.opacity * 100)}%`;
  for (const swatch of presetsEl.children) {
    swatch.classList.toggle('selected', swatch.dataset.color === bg.color);
  }
}

function update(changes) {
  bg = { ...bg, ...changes };
  render();
  window.petAPI.setBackground(bg);
}

for (const preset of PRESETS) {
  const swatch = document.createElement('button');
  swatch.className = 'swatch';
  swatch.title = preset.name;
  swatch.dataset.color = preset.color;
  swatch.style.background = preset.color;
  swatch.addEventListener('click', () => update({ color: preset.color }));
  presetsEl.appendChild(swatch);
}

colorInput.addEventListener('input', () => update({ color: colorInput.value.toLowerCase() }));
opacityInput.addEventListener('input', () => update({ opacity: Number(opacityInput.value) / 100 }));
document.getElementById('reset').addEventListener('click', () => update({ ...DEFAULT_BACKGROUND }));

// ---- 캐릭터 그림 ----

function renderFaces({ urls, custom }) {
  for (const box of document.querySelectorAll('.face')) {
    const slot = box.dataset.slot;
    const img = box.querySelector('img');
    if (urls[slot]) img.src = urls[slot];
    else img.removeAttribute('src');
    box.querySelector('.preview').classList.toggle('empty', !urls[slot]); // left/right는 없을 수 있음
    box.querySelector('.reset').disabled = !custom[slot]; // 이미 기본 그림이면 비활성
  }
}

for (const box of document.querySelectorAll('.face')) {
  const slot = box.dataset.slot;
  box.querySelector('.pick').addEventListener('click', async () => {
    renderFaces(await window.petAPI.pickFace(slot));
  });
  box.querySelector('.reset').addEventListener('click', async () => {
    renderFaces(await window.petAPI.resetFace(slot));
  });
}

window.petAPI.getFaces().then(renderFaces);
window.petAPI.onFaces(renderFaces);

// ---- 캐릭터 크기 ----

const petSizeInput = document.getElementById('pet-size');
const petSizeValue = document.getElementById('pet-size-value');

function renderPetSize(size) {
  petSizeInput.value = Math.round(size * 100);
  petSizeValue.textContent = `${Math.round(size * 100)}%`;
}

petSizeInput.addEventListener('input', () => {
  const size = Number(petSizeInput.value) / 100;
  renderPetSize(size);
  window.petAPI.setPetSize(size);
});
window.petAPI.getPetSize().then(renderPetSize);

// ---- 애니메이션 ----

const DEFAULT_ANIMATION = { interval: 0.9, tilt: 0, bob: 2.5, notes: true };
const animInputs = {
  interval: document.getElementById('anim-interval'),
  tilt: document.getElementById('anim-tilt'),
  bob: document.getElementById('anim-bob'),
};
const animLabels = {
  interval: (v) => `${v.toFixed(1)}초`,
  tilt: (v) => `${v}°`,
  bob: (v) => `${v}%`,
};
const animNotes = document.getElementById('anim-notes');

function renderAnimation(anim) {
  for (const [key, input] of Object.entries(animInputs)) {
    input.value = anim[key];
    document.getElementById(`anim-${key}-value`).textContent = animLabels[key](anim[key]);
  }
  animNotes.checked = anim.notes;
}

function readAnimation() {
  const anim = { notes: animNotes.checked };
  for (const [key, input] of Object.entries(animInputs)) anim[key] = Number(input.value);
  return anim;
}

function sendAnimation(anim) {
  renderAnimation(anim);
  window.petAPI.setAnimation(anim);
}

for (const input of Object.values(animInputs)) input.addEventListener('input', () => sendAnimation(readAnimation()));
animNotes.addEventListener('change', () => sendAnimation(readAnimation()));
document.getElementById('anim-reset').addEventListener('click', () => sendAnimation({ ...DEFAULT_ANIMATION }));
window.petAPI.getAnimation().then(renderAnimation);

// ---- 배경 ----

window.petAPI.getBackground().then((saved) => {
  bg = { ...saved };
  render();
});
