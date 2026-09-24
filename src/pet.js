// 캐릭터 상태와 연출
//  - idle: 가만히 ('노래 멈출 때' 그림)
//  - listening: 고개를 까딱까딱. NOD_INTERVAL_MS마다 일정한 리듬으로 좌우를 오가며
//    left/right 그림으로 바꾸고, 기울어지는 동안 살짝 올라갔다 내려온다(#pet-body.bob).
//    기울기는 CSS transition으로 천천히 넘어간다(#pet[data-tilt]). left/right 그림이 없으면
//    '노래 나올 때' 그림을 조금 더 크게 기울여 대신한다(#pet.no-lr).
//    몇 박자에 한 번 머리 위로 ♪가 떠오름
//
// 전환 기준
//  1) 재생 앱이 Windows 미디어 정보로 재생 상태를 알려 주면(setMediaPlaying) 그대로 따른다.
//     노래가 시작/정지되면 바로 바뀌고, 곡 중간의 조용한 부분에도 흔들리지 않는다.
//  2) 알려 주지 않으면(null) 소리 크기로 판단한다.
//     - idle → listening: 소리(loudness > LISTEN_ON)가 LISTEN_AFTER_MS 동안 이어질 때
//     - listening → idle: 조용함(loudness < QUIET_BELOW)이 IDLE_AFTER_MS 동안 이어질 때
//     - QUIET_BELOW를 LISTEN_ON보다 낮게 두어 경계 음량에서 흔들리지 않게 함
// 그림은 설정 창에서 바꿀 수 있다(setFaces). listen 그림을 못 읽으면 idle 그림으로 대신 보여 준다.
//
// 배치: 그림마다 여백이 달라도 캐릭터 칸(#pet)에 딱 맞도록, main.js가 잰 '실제로 그려진 영역'
// (bounds)을 모든 표정에 걸쳐 합친 뒤 그 영역이 칸 안에 들어오게 크기와 위치를 정한다.
// 모든 표정에 같은 기준을 쓰므로 표정이 바뀌어도 캐릭터가 튀지 않는다.
const Pet = (() => {
  const LISTEN_ON = 0.12; // 이보다 크면 '소리 남'
  const QUIET_BELOW = 0.06; // 이보다 작으면 '조용함'
  const LISTEN_AFTER_MS = 500;
  const IDLE_AFTER_MS = 2000;
  const NOTE_EVERY_BEATS = 4;
  const NOD_INTERVAL_MS = 900; // 한쪽으로 까딱하는 간격 (좌→우 한 번 왕복이 1.8초)
  const NOTES = ['♪', '♫', '♩'];
  const FIT_RATIO = 0.94; // 칸 안에서 기울어질 여유를 조금 남김
  const FULL_BOUNDS = { x0: 0, y0: 0, x1: 1, y1: 1 };
  // main.js가 실제 경로(사용자가 고른 그림 포함)를 알려 주기 전까지 쓰는 기본 그림
  const DEFAULT_FACES = {
    idle: '../assets/pet/idle.png',
    listen: '../assets/pet/listen.png',
  };

  function create(petEl) {
    const bodyEl = petEl.querySelector('#pet-body');
    const sprites = [...bodyEl.querySelectorAll('.pet-sprite')];
    let front = 0; // 지금 보이는 그림 (sprites[front])
    let swapToken = 0;
    sprites[0].classList.add('shown');

    let listening = false;
    let loudSince = null; // 소리가 계속 나기 시작한 시각
    let quietSince = null; // 조용함이 계속되기 시작한 시각
    let beatCount = 0;
    let mediaPlaying = null; // true/false: 미디어 정보의 재생 상태, null: 정보 없음
    let nodSide = 'right'; // 마지막으로 기운 쪽. 첫 까딱은 왼쪽
    let lastNodAt = 0;

    let faces = {};
    let fitBounds = FULL_BOUNDS; // 모든 표정의 그려진 영역을 합친 것

    // 합친 그려진 영역이 칸 가운데에 FIT_RATIO만큼 차도록 그림 크기와 위치를 정한다
    function placeSprite(img) {
      const boxW = petEl.clientWidth;
      const boxH = petEl.clientHeight;
      const natW = img.naturalWidth;
      const natH = img.naturalHeight;
      if (!boxW || !boxH || !natW || !natH) return;
      const drawnW = (fitBounds.x1 - fitBounds.x0) * natW;
      const drawnH = (fitBounds.y1 - fitBounds.y0) * natH;
      const scale = Math.min((boxW * FIT_RATIO) / drawnW, (boxH * FIT_RATIO) / drawnH);
      const top = (boxH - drawnH * scale) / 2; // 그려진 영역의 위쪽
      img.style.width = `${natW * scale}px`;
      img.style.height = `${natH * scale}px`;
      img.style.left = `${(boxW - drawnW * scale) / 2 - fitBounds.x0 * natW * scale}px`;
      img.style.top = `${top - fitBounds.y0 * natH * scale}px`;
      // 기울기/통통은 발(그려진 영역 아래 끝)을 축으로, 음표는 머리 위에서
      const origin = `50% ${top + drawnH * scale}px`;
      petEl.style.transformOrigin = origin;
      bodyEl.style.transformOrigin = origin;
      petEl.style.setProperty('--drawn-top', `${top}px`);
    }

    function relayout() {
      for (const img of sprites) if (img.getAttribute('src')) placeSprite(img);
    }

    // 뒤쪽 그림에 새 표정을 다 읽어 둔 뒤 앞뒤를 한 번에 바꿈 (빈 화면 깜빡임 없음)
    function setFace(name) {
      const src = faces[name];
      if (!src || sprites[front].getAttribute('src') === src) return;
      const token = ++swapToken;
      const back = sprites[1 - front];
      if (back.getAttribute('src') !== src) back.setAttribute('src', src);
      back
        .decode()
        .catch(() => {})
        .then(() => {
          if (token !== swapToken) return; // 그 사이 다른 표정으로 바뀜
          placeSprite(back);
          back.classList.add('shown');
          sprites[front].classList.remove('shown');
          front = 1 - front;
        });
    }

    // 미리 읽어 두어 표정이 바뀔 때 깜빡이지 않게 하고, 못 읽은 표정은 idle로 대체
    function setFaces(urls, bounds = {}) {
      faces = { ...urls };
      // 있는 표정들의 그려진 영역을 모두 합침 (못 잰 그림은 그림 전체로)
      const boxes = Object.keys(urls)
        .filter((name) => urls[name])
        .map((name) => bounds[name] || FULL_BOUNDS);
      fitBounds = boxes.length
        ? {
            x0: Math.min(...boxes.map((b) => b.x0)),
            y0: Math.min(...boxes.map((b) => b.y0)),
            x1: Math.max(...boxes.map((b) => b.x1)),
            y1: Math.max(...boxes.map((b) => b.y1)),
          }
        : FULL_BOUNDS;
      relayout();
      for (const [name, src] of Object.entries(urls)) {
        if (!src) continue; // left/right는 없을 수 있음
        const img = new Image();
        img.onerror = () => {
          if (faces[name] !== src) return; // 그 사이 다른 그림으로 바뀜
          faces[name] = faces.idle;
          setFace(listening ? 'listen' : 'idle');
        };
        img.src = src;
      }
      setFace(listening ? 'listen' : 'idle');
    }

    setFaces(DEFAULT_FACES);

    function bob() {
      // 애니메이션이 끝나기 전에 다음 까딱이 와도 처음부터 다시 재생
      bodyEl.classList.remove('bob');
      void bodyEl.offsetWidth;
      bodyEl.classList.add('bob');
    }

    // 고개 까딱: 반대쪽으로 천천히 기울며 살짝 올라갔다 내려온다
    function nod(now) {
      lastNodAt = now;
      nodSide = nodSide === 'left' ? 'right' : 'left';
      const hasImage = !!faces[nodSide];
      petEl.classList.toggle('no-lr', !hasImage); // 그림이 없으면 기울기를 더 크게
      setFace(hasImage ? nodSide : 'listen');
      petEl.dataset.tilt = nodSide;
      bob();
    }

    function spawnNote() {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = NOTES[Math.floor(Math.random() * NOTES.length)];
      note.style.left = `${35 + Math.random() * 40}%`;
      note.style.setProperty('--drift', `${(Math.random() - 0.5) * 40}px`);
      note.addEventListener('animationend', () => note.remove());
      petEl.appendChild(note);
    }

    function setListening(value) {
      if (listening === value) return;
      listening = value;
      petEl.classList.toggle('listening', value);
      delete petEl.dataset.tilt;
      setFace(value ? 'listen' : 'idle');
    }

    function update({ loudness, beat }, now) {
      loudSince = loudness > LISTEN_ON ? (loudSince ?? now) : null;
      quietSince = loudness < QUIET_BELOW ? (quietSince ?? now) : null;

      if (mediaPlaying !== null) {
        setListening(mediaPlaying);
      } else if (!listening && loudSince !== null && now - loudSince >= LISTEN_AFTER_MS) {
        setListening(true);
      } else if (listening && quietSince !== null && now - quietSince >= IDLE_AFTER_MS) {
        setListening(false);
      }

      if (!listening) return;
      if (now - lastNodAt >= NOD_INTERVAL_MS) nod(now);
      if (beat) {
        beatCount++;
        if (beatCount % NOTE_EVERY_BEATS === 0) spawnNote();
      }
    }

    return {
      update,
      setFaces,
      relayout,
      setMediaPlaying(value) {
        mediaPlaying = value;
        if (value !== null) setListening(value); // 다음 프레임을 기다리지 않고 바로
      },
    };
  }

  return { create };
})();
